#!/usr/bin/env node
/**
 * CLI de WebMCPcss.
 *
 * Comandos:
 * - `webmcpcss generate <url>`         → graba interacciones y genera un `.webmcp.css`.
 * - `webmcpcss generate --api <css>`   → genera JS con `registerTool()` desde un CSS.
 * - `webmcpcss validate <url> <css>`   → valida los selectores contra la página (`--api` incluye la API).
 * - `webmcpcss repair <url> <css>`     → repara selectores rotos y reescribe el archivo.
 * - `webmcpcss discover <url>`         → detecta si un sitio publica WebMCP (sin navegador).
 * - `webmcpcss inject <url>`           → auto-descubrimiento + estilos comunitarios.
 * - `webmcpcss dashboard`              → interfaz web con herramientas e historial.
 * - `webmcpcss parse <css>`            → CSS → JSON (sin navegador).
 */
import chalk from 'chalk';
import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer, { Browser, Page } from 'puppeteer';
import { DomAdapter } from './adapters/dom-adapter';
import { PuppeteerAdapter } from './adapters/puppeteer-adapter';
import { WebMCPApiAdapter } from './adapters/webmcp-api-adapter';
import { WebMCPcss } from './core';
import { startDashboard } from './dashboard/server';
import { enhanceToolMapWithAi, generateApiScript } from './generator';
import {
  buildGraph,
  generateObsidianVault,
  buildGraphHtml,
  serveGraphDashboard,
  type Graph,
  type ParsedFile,
  type StatusResult,
} from './graph';
import { parseWebMCP, parseWebMCPFile, serializeToolMap } from './parser';
import {
  buildAutoToolMap,
  detectFramework,
  scanInteractiveElementsInPage,
} from './generator';
import {
  createMcpHttpServer,
  EXPORT_FORMATS,
  exportForAgent,
  startMcpStdioServer,
  type ToolExecutor,
} from './exporters';
import { discoverWebMCP, injectWebMCP, resolveWebMCPStyles } from './proxy';
import {
  buildTailwindToolsScript,
  formatForFramework,
  frameworkFromExtension,
  generateTailwindTools,
  inspectClassList,
  scanPage,
  type Framework,
  type TailwindCategory,
  type TailwindToolDescriptor,
} from './tailwind';
import type { ToolMap } from './types';
import { appendHistory } from './utils/history';
import { logger, setVerbose } from './utils/logger';

/** Instantánea de interacción capturada por el grabador de `generate`. */
interface RecordedEvent {
  kind: 'click' | 'input' | 'submit';
  selector: string;
  tag: string;
  text: string;
  attrs: Record<string, string>;
  value?: string;
}

/**
 * Lanza un navegador Puppeteer con opciones seguras para CI/sandbox.
 * @param headless `true` para modo sin interfaz.
 */
async function launchBrowser(headless: boolean): Promise<Browser> {
  return puppeteer.launch({
    headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
}

/**
 * Navega a una URL (admite `http(s)://` y `file://` o rutas locales).
 * @param page Página de Puppeteer.
 * @param url URL o ruta local a un HTML.
 */
async function navigate(page: Page, url: string): Promise<void> {
  let target = url;
  if (!/^[a-z]+:\/\//i.test(url)) {
    const abs = path.resolve(url);
    if (fs.existsSync(abs)) target = `file://${abs}`;
    else target = `https://${url}`;
  }
  await page.goto(target, { waitUntil: 'networkidle2', timeout: 60_000 });
}

/**
 * Convierte los eventos grabados en un {@link ToolMap} razonable:
 * los inputs rellenados antes de un click/submit se agrupan como parámetros
 * de esa herramienta.
 * @param events Eventos capturados en orden.
 */
function eventsToToolMap(events: RecordedEvent[]): ToolMap {
  const map: ToolMap = { tools: {}, context: {} };
  let pendingInputs: RecordedEvent[] = [];
  let toolIndex = 0;

  const nameFor = (ev: RecordedEvent): string => {
    const base = (ev.text || ev.attrs['aria-label'] || ev.attrs['name'] || ev.tag)
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 3)
      .map((w, i) =>
        i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join('');
    return base || `tool${++toolIndex}`;
  };

  for (const ev of events) {
    if (ev.kind === 'input') {
      pendingInputs.push(ev);
      continue;
    }
    // click o submit cierran una herramienta.
    const name = nameFor(ev);
    const params: ToolMap['tools'][string]['params'] = {};
    for (const input of pendingInputs) {
      const pName = (input.attrs['name'] || input.attrs['id'] || 'value').replace(
        /[^a-zA-Z0-9]/g,
        '',
      );
      params[pName || 'value'] = { source: 'value', selector: input.selector };
    }
    map.tools[name] = {
      selector: ev.selector,
      params,
      trigger:
        ev.kind === 'submit' ? { event: 'submit', selector: ev.selector } : undefined,
      fingerprint: { tag: ev.tag, text: ev.text, attrs: ev.attrs },
    };
    pendingInputs = [];
  }
  return map;
}

/**
 * Script de grabación inyectado en la página por `webmcp generate`.
 * Es auto-contenido: usa `window.__webmcpRecord` (expuesto vía
 * `page.exposeFunction`) para enviar eventos al proceso Node.
 */
function installRecorder(): void {
  const report = (window as unknown as Record<string, unknown>).__webmcpRecord as (
    ev: unknown,
  ) => void;

  function stable(el: Element): string {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-') && attr.value) {
        const sel = `[${attr.name}="${attr.value.replace(/["\\]/g, '\\$&')}"]`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
    }
    if (el.id && document.querySelectorAll(`#${el.id}`).length === 1) {
      return `#${el.id}`;
    }
    const tag = el.tagName.toLowerCase();
    const cls = Array.from(el.classList)
      .slice(0, 2)
      .map((c) => `.${c}`)
      .join('');
    return tag + cls;
  }

  function fingerprint(el: Element) {
    const attrs: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) {
      if (
        a.name.startsWith('data-') ||
        ['id', 'name', 'type', 'aria-label', 'placeholder'].includes(a.name)
      ) {
        attrs[a.name] = a.value.slice(0, 80);
      }
    }
    return {
      selector: stable(el),
      tag: el.tagName.toLowerCase(),
      text: ((el as HTMLElement).innerText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80),
      attrs,
    };
  }

  document.addEventListener(
    'click',
    (e) => {
      const el = (e.target as Element).closest(
        'a, button, [role="button"], input[type="submit"]',
      );
      if (el) report({ kind: 'click', ...fingerprint(el) });
    },
    true,
  );
  document.addEventListener(
    'change',
    (e) => {
      const el = e.target as HTMLInputElement;
      if (el && 'value' in el) {
        report({
          kind: 'input',
          value: String(el.value).slice(0, 40),
          ...fingerprint(el),
        });
      }
    },
    true,
  );
  document.addEventListener(
    'submit',
    (e) => {
      report({ kind: 'submit', ...fingerprint(e.target as Element) });
    },
    true,
  );
  console.log('[WebMCPcss] Grabador activo: interactúa con la página.');
}

/** Comando `generate`: graba interacciones y escribe un `.webmcp.css`.
 *  Con `--api`, el argumento es un `.webmcp.css` y genera el script JS
 *  equivalente para `navigator.modelContext.registerTool()`.
 *  Con `--ai`, mejora nombres/descripciones con un modelo de lenguaje. */
async function cmdGenerate(
  url: string,
  opts: { output: string; timeout: string; api?: boolean; ai?: boolean; auto?: boolean },
) {
  // Modo --auto: escaneo headless sin grabación (v0.5.0).
  if (opts.auto) {
    logger.title('WebMCPcss · generate --auto');
    logger.info(`Escaneando ${chalk.bold(url)} sin grabación...`);
    const browser = await launchBrowser(true);
    try {
      const page = await browser.newPage();
      await navigate(page, url);
      const scan = (await page.evaluate(
        `(${scanInteractiveElementsInPage.toString()})(document)`,
      )) as import('./generator').PageScan;
      const frameworks = detectFramework(scan);
      logger.info(
        `Framework detectado: ${chalk.cyan(frameworks.join(', '))} · ` +
          `${scan.forms.length} formulario(s), ${scan.actions.length} acción(es)`,
      );
      const toolMap = buildAutoToolMap(scan);
      if (Object.keys(toolMap.tools).length === 0) {
        logger.warn('No se detectaron elementos interactivos; no se generó archivo.');
        return;
      }
      if (opts.ai) {
        logger.info('Pidiendo sugerencias a la IA...');
        await enhanceToolMapWithAi(toolMap, url);
      }
      fs.writeFileSync(opts.output, serializeToolMap(toolMap), 'utf8');
      logger.success(
        `Generado ${chalk.bold(opts.output)} con ${Object.keys(toolMap.tools).length} herramienta(s).`,
      );
      logger.info(`Valídalo con: webmcpcss validate ${url} ${opts.output}`);
    } finally {
      await browser.close();
    }
    return;
  }

  // Modo --api: CSS → código JS de la API imperativa (sin navegador).
  if (opts.api) {
    logger.title('WebMCPcss · generate --api');
    const toolMap = parseWebMCPFile(url);
    const script = generateApiScript(toolMap);
    const output = opts.output === 'webmcp.css' ? 'webmcp-tools.js' : opts.output;
    fs.writeFileSync(output, script, 'utf8');
    logger.success(
      `Generado ${chalk.bold(output)} con ${Object.keys(toolMap.tools).length} registerTool().`,
    );
    logger.info('Inclúyelo en tu sitio con: <script src="' + output + '"></script>');
    return;
  }

  logger.title('WebMCPcss · generate');
  logger.info(`Abriendo navegador para grabar interacciones en ${chalk.bold(url)}`);
  logger.info(
    'Interactúa con la página. Cierra el navegador (o espera el timeout) para terminar.',
  );

  const browser = await launchBrowser(false);
  const page = await browser.newPage();
  const events: RecordedEvent[] = [];

  await page.exposeFunction('__webmcpRecord', (ev: RecordedEvent) => {
    events.push(ev);
    logger.debug(`grabado: ${ev.kind} ${ev.selector}`);
  });
  await page.evaluateOnNewDocument(installRecorder);
  await navigate(page, url);
  await page.evaluate(installRecorder);

  const timeoutMs = parseInt(opts.timeout, 10) * 1000;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    browser.on('disconnected', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  try {
    await browser.close();
  } catch {
    /* ya cerrado por el usuario */
  }

  if (events.length === 0) {
    logger.warn('No se grabó ninguna interacción; no se generó archivo.');
    return;
  }

  const toolMap = eventsToToolMap(events);
  if (opts.ai) {
    logger.info('Pidiendo sugerencias a la IA...');
    await enhanceToolMapWithAi(toolMap, url);
  }
  const css = serializeToolMap(toolMap);
  fs.writeFileSync(opts.output, css, 'utf8');
  logger.success(
    `Generado ${chalk.bold(opts.output)} con ${Object.keys(toolMap.tools).length} herramienta(s).`,
  );
}

/** Crea un WebMCPcss conectado a la URL con el CSS dado. */
async function withWebMCP(
  url: string,
  cssPath: string,
  fn: (webmcp: WebMCPcss, toolMap: ToolMap) => Promise<void>,
  options: { headless?: boolean; api?: boolean } = {},
): Promise<void> {
  const toolMap = parseWebMCPFile(cssPath);
  const browser = await launchBrowser(options.headless ?? true);
  try {
    const page = await browser.newPage();
    // Con --api, el shim debe instalarse ANTES de navegar para capturar
    // los registerTool() del sitio.
    const adapter = options.api
      ? await WebMCPApiAdapter.create(page)
      : new PuppeteerAdapter(page);
    await navigate(page, url);
    const webmcp = new WebMCPcss(toolMap, adapter);
    await fn(webmcp, toolMap);
  } finally {
    await browser.close();
  }
}

/** Comando `validate`: reporte de selectores existentes/rotos. */
async function cmdValidate(
  url: string,
  cssPath: string,
  opts: { api?: boolean; saveStatus?: string | boolean; graph?: string | boolean } = {},
) {
  logger.title('WebMCPcss · validate');
  await withWebMCP(
    url,
    cssPath,
    async (webmcp) => {
      const report = await webmcp.validate(url, { includeApi: opts.api });
      for (const entry of report.entries) {
        const icon = entry.ok
          ? entry.kind === 'api'
            ? chalk.cyan('⚡')
            : chalk.green('✔')
          : entry.optional
            ? chalk.yellow('◌')
            : chalk.red('✖');
        const note =
          !entry.ok && entry.optional ? chalk.gray(' (aparece tras la acción)') : '';
        console.log(
          `  ${icon} ${chalk.bold(entry.name)} ${chalk.gray(`[${entry.kind}]`)} ${entry.selector}${note}`,
        );
      }
      console.log();
      appendHistory({
        type: 'validate',
        url,
        ok: report.failed === 0,
        details: { passed: report.passed, failed: report.failed, total: report.total },
      });
      if (opts.saveStatus) {
        const statusPath =
          typeof opts.saveStatus === 'string' ? opts.saveStatus : '.webmcp-status.json';
        fs.writeFileSync(statusPath, JSON.stringify(report, null, 2), 'utf8');
        logger.info(`Estado guardado en ${chalk.bold(statusPath)}`);
      }
      if (opts.graph) {
        const graphPath =
          typeof opts.graph === 'string' ? opts.graph : 'webmcp-graph.json';
        const graph = buildGraph(
          [{ path: cssPath, toolMap: parseWebMCPFile(cssPath) }],
          [report],
        );
        fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf8');
        logger.info(`Grafo actualizado: ${chalk.bold(graphPath)}`);
      }
      if (report.failed === 0) {
        logger.success(`${report.passed}/${report.total} selectores válidos. ¡Todo OK!`);
      } else {
        logger.error(
          `${report.failed}/${report.total} selectores rotos. Ejecuta ${chalk.bold(
            `webmcpcss repair ${url} ${cssPath}`,
          )} para intentar repararlos.`,
        );
        process.exitCode = 1;
      }
    },
    { api: opts.api },
  );
}

/** Comando `repair`: repara selectores rotos y reescribe el archivo. */
async function cmdRepair(
  url: string,
  cssPath: string,
  opts: { dryRun?: boolean; graph?: string | boolean },
) {
  logger.title('WebMCPcss · repair');
  await withWebMCP(url, cssPath, async (webmcp, toolMap) => {
    const results = await webmcp.repairAll();
    if (results.length === 0) {
      logger.success('No hay selectores rotos. Nada que reparar.');
      return;
    }
    let repairedCount = 0;
    for (const r of results) {
      if (r.repaired) {
        repairedCount++;
        logger.success(
          `${chalk.bold(r.name)}: ${chalk.strikethrough(r.oldSelector)} → ${chalk.green(
            r.newSelector ?? '',
          )} ${chalk.gray(`(confianza ${(r.score ?? 0).toFixed(2)})`)}`,
        );
      } else {
        logger.error(
          `${chalk.bold(r.name)}: no se encontró reemplazo para ${r.oldSelector}`,
        );
      }
    }
    if (repairedCount > 0 && !opts.dryRun) {
      fs.writeFileSync(cssPath, serializeToolMap(toolMap), 'utf8');
      logger.success(`Archivo actualizado: ${chalk.bold(cssPath)}`);
    } else if (opts.dryRun) {
      logger.info('Modo --dry-run: el archivo no se modificó.');
    }
    for (const r of results) {
      appendHistory({
        type: 'repair',
        url,
        tool: r.name,
        ok: r.repaired,
        details: { old: r.oldSelector, new: r.newSelector, score: r.score },
      });
    }
    if (opts.graph) {
      // Regenera el grafo con el estado post-reparación (reparadas → OK).
      const graphPath = typeof opts.graph === 'string' ? opts.graph : 'webmcp-graph.json';
      const status: StatusResult = {
        url,
        entries: results.map((r) => ({
          name: r.name,
          kind: 'tool' as const,
          selector: r.newSelector ?? r.oldSelector,
          ok: r.repaired,
        })),
      };
      const graph = buildGraph([{ path: cssPath, toolMap }], [status]);
      fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2), 'utf8');
      logger.info(`Grafo actualizado: ${chalk.bold(graphPath)}`);
    }
    if (repairedCount < results.length) process.exitCode = 1;
  });
}

/** Comando `inject`: auto-descubrimiento primero, comunidad como fallback. */
async function cmdInject(url: string, opts: { dir?: string; remote?: string }) {
  logger.title('WebMCPcss · inject');
  // 1) Resolver estilos: descubrimiento (meta/well-known) → comunidad.
  const resolved = await resolveWebMCPStyles(url, {
    dir: opts.dir,
    remoteBaseUrl: opts.remote,
  });
  if (!resolved) {
    logger.warn(`No hay WebMCP publicado ni estilos comunitarios para ${url}.`);
    process.exitCode = 1;
    return;
  }
  logger.success(
    `Estilos encontrados vía ${chalk.bold(resolved.origin)}: ${resolved.source}`,
  );
  // 2) Inyectarlos en la página.
  const browser = await launchBrowser(true);
  try {
    const page = await browser.newPage();
    await navigate(page, url);
    const toolMap = await injectWebMCP(page, resolved.css);
    console.log(JSON.stringify(toolMap, null, 2));
  } finally {
    await browser.close();
  }
}

/** Comando `discover`: comprueba si un sitio publica WebMCP (sin navegador). */
async function cmdDiscover(url: string) {
  logger.title('WebMCPcss · discover');
  const result = await discoverWebMCP(url);
  if (!result) {
    logger.warn(`${url} no publica WebMCP (ni meta tag ni .well-known/webmcp.json).`);
    logger.info(
      'Para publicarlo: <meta name="webmcp" content="/webmcp.css"> o /.well-known/webmcp.json',
    );
    process.exitCode = 1;
    return;
  }
  logger.success(`Encontrado vía ${chalk.bold(result.source)}: ${result.cssUrl}`);
  const toolMap = parseWebMCP(result.css);
  logger.info(
    `${Object.keys(toolMap.tools).length} herramienta(s), ${Object.keys(toolMap.context).length} dato(s) de contexto:`,
  );
  console.log(JSON.stringify(toolMap, null, 2));
}

/** Comando `dashboard`: interfaz web con herramientas, historial y estadísticas. */
async function cmdDashboard(opts: { port: string; css?: string }) {
  logger.title('WebMCPcss · dashboard');
  const port = parseInt(opts.port, 10);
  await startDashboard({ port, cssPath: opts.css });
  logger.info(`Abre http://localhost:${port} en tu navegador. Ctrl+C para salir.`);
  // Mantener el proceso vivo.
  await new Promise(() => undefined);
}

/** Comando `parse`: parsea un `.webmcp.css` y muestra el JSON (sin navegador). */
function cmdParse(cssPath: string) {
  console.log(JSON.stringify(parseWebMCPFile(cssPath), null, 2));
}

/** Comando `export`: exporta el .webmcp.css al formato de un agente. */
async function cmdExport(
  cssPath: string,
  opts: { format: string; output: string; url?: string },
) {
  logger.title('WebMCPcss · export');
  const toolMap = parseWebMCPFile(cssPath);
  const { files, note } = exportForAgent(opts.format, toolMap, {
    cssPath,
    url: opts.url,
  });
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(opts.output, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, 'utf8');
    console.log(`  ${chalk.green('✔')} ${dest}`);
  }
  logger.success(
    `Exportadas ${Object.keys(toolMap.tools).length} herramienta(s) en formato ${chalk.cyan(opts.format)}.`,
  );
  logger.info(note);
}

/** Construye el ejecutor real de herramientas para el servidor MCP. */
function buildMcpExecutor(url: string, cssPath: string): ToolExecutor {
  return async (toolName, args) => {
    let result: unknown;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(args ?? {})) params[k] = String(v);
    await withWebMCP(url, cssPath, async (webmcp) => {
      result = await webmcp.execute(toolName, params);
    });
    return result;
  };
}

/** Comando `mcp --serve`: servidor MCP por stdio (o REST con --http). */
async function cmdMcp(opts: {
  serve?: boolean;
  css?: string;
  url?: string;
  http?: boolean;
  port: string;
}) {
  if (!opts.serve) {
    console.log(
      'Usa: webmcpcss mcp --serve [--css <file>] [--url <url>] [--http -p 8090]',
    );
    return;
  }
  const cssPath = opts.css ?? 'webmcp.css';
  if (!fs.existsSync(cssPath)) {
    throw new Error(`No existe ${cssPath}. Indica el archivo con --css.`);
  }
  const cssSource = fs.readFileSync(cssPath, 'utf8');
  const toolMap = parseWebMCP(cssSource);
  const execute = opts.url ? buildMcpExecutor(opts.url, cssPath) : undefined;
  const options = {
    toolMap,
    cssSource,
    cssPath,
    url: opts.url,
    execute,
    version: '0.5.0',
  };

  if (opts.http) {
    const port = parseInt(opts.port, 10);
    const server = createMcpHttpServer(options);
    await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));
    logger.success(`Servidor HTTP en http://localhost:${port}`);
    logger.info(
      'Rutas: GET /api/tools · GET /api/graph · POST /api/call {"tool","args"}',
    );
    return new Promise<void>(() => undefined); // queda sirviendo
  }

  // Modo stdio: stdout es SOLO JSON-RPC; los avisos van a stderr.
  console.error(
    `[webmcpcss] MCP stdio listo · ${Object.keys(toolMap.tools).length} herramienta(s) de ${cssPath}` +
      (opts.url
        ? ` · ejecución real en ${opts.url}`
        : ' · sin --url (tools/call en dry-run)'),
  );
  await startMcpStdioServer(options);
}

/** Comando `run`: ejecuta una herramienta y escribe SOLO JSON en stdout. */
async function cmdRun(
  url: string,
  cssPath: string,
  toolName: string,
  opts: { args: string },
) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(opts.args) as Record<string, unknown>;
  } catch {
    throw new Error(`--args debe ser JSON válido; recibido: ${opts.args}`);
  }
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) params[k] = String(v);

  let result: unknown;
  await withWebMCP(url, cssPath, async (webmcp) => {
    result = await webmcp.execute(toolName, params);
  });
  // Salida limpia para que wrappers (CrewAI/AutoGen/LangGraph) la parseen.
  console.log(JSON.stringify(result));
}

const program = new Command();
program
  .name('webmcpcss')
  .description('WebMCPcss: WebMCP para cualquier web, con auto-reparación de selectores')
  .version('0.5.0')
  .option('--verbose', 'salida de depuración')
  .hook('preAction', (cmd) => setVerbose(Boolean(cmd.opts().verbose)));

program
  .command('generate')
  .description(
    'Graba interacciones y genera un .webmcp.css. Con --api, convierte un .webmcp.css en JS con registerTool()',
  )
  .argument('<url>', 'URL/HTML local (o ruta al .webmcp.css si usas --api)')
  .option('-o, --output <file>', 'archivo de salida', 'webmcp.css')
  .option('-t, --timeout <seconds>', 'segundos máximos de grabación', '120')
  .option('--auto', 'escaneo automático headless: sin grabación ni interacción manual')
  .option('--api', 'genera código JS para navigator.modelContext.registerTool()')
  .option('--ai', 'mejora nombres y descripciones con IA (requiere WEBMCPCSS_AI_API_KEY)')
  .action(cmdGenerate);

program
  .command('validate')
  .description('Valida que los selectores del .webmcp.css existan en la página')
  .argument('<url>', 'URL o ruta a un HTML local')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .option('--api', 'incluye las herramientas registradas vía navigator.modelContext')
  .option(
    '--save-status [file]',
    'guarda el resultado en JSON (def. .webmcp-status.json) para usarlo con graph',
  )
  .option(
    '--graph [file]',
    'genera el grafo de conocimiento tras validar (def. webmcp-graph.json)',
  )
  .action(cmdValidate);

program
  .command('repair')
  .description('Repara selectores rotos usando visión y actualiza el archivo')
  .argument('<url>', 'URL o ruta a un HTML local')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .option('--dry-run', 'muestra las reparaciones sin escribir el archivo')
  .option('--graph [file]', 'regenera el grafo tras reparar (def. webmcp-graph.json)')
  .action(cmdRepair);

program
  .command('discover')
  .description(
    'Comprueba si un sitio publica WebMCP (meta tag o .well-known), sin navegador',
  )
  .argument('<url>', 'URL del sitio')
  .action(cmdDiscover);

program
  .command('export')
  .description('Exporta el .webmcp.css al formato nativo de un agente IA')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .requiredOption(
    '-f, --format <format>',
    `formato de salida: ${EXPORT_FORMATS.join(', ')}`,
  )
  .option('-o, --output <dir>', 'carpeta de salida', 'webmcp-export')
  .option('--url <url>', 'URL del sitio (se incrusta en los archivos generados)')
  .action(cmdExport);

program
  .command('mcp')
  .description('Servidor MCP: stdio por defecto (Claude/Cursor/Goose) o REST con --http')
  .option('--serve', 'inicia el servidor')
  .option('--css <file>', 'archivo .webmcp.css a exponer', 'webmcp.css')
  .option('--url <url>', 'URL del sitio: habilita ejecución real en tools/call')
  .option('--http', 'modo HTTP REST en vez de stdio')
  .option('-p, --port <port>', 'puerto en modo --http', '8090')
  .action(cmdMcp);

program
  .command('run')
  .description('Ejecuta una herramienta WebMCP y devuelve el resultado como JSON')
  .argument('<url>', 'URL o ruta a un HTML local')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .argument('<tool>', 'nombre de la herramienta (ej. addToCart)')
  .option('--args <json>', 'argumentos en JSON (ej. \'{"quantity":"2"}\')', '{}')
  .action(cmdRun);

program
  .command('inject')
  .description(
    'Auto-descubre el WebMCP del sitio (o usa estilos comunitarios) y lo inyecta',
  )
  .argument('<url>', 'URL objetivo')
  .option('-d, --dir <dir>', 'carpeta local community-styles')
  .option('-r, --remote <baseUrl>', 'URL base remota de estilos comunitarios')
  .action(cmdInject);

program
  .command('dashboard')
  .description(
    'Arranca el dashboard web con herramientas activas, historial y estadísticas',
  )
  .option('-p, --port <port>', 'puerto de escucha', '3000')
  .option('-c, --css <file>', 'archivo .webmcp.css a mostrar')
  .action(cmdDashboard);

program
  .command('parse')
  .description('Parsea un .webmcp.css y muestra el tool map JSON (sin navegador)')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .action(cmdParse);

/* ------------------------------------------------------------------ */
/* Subcomando `tailwind`                                              */
/* ------------------------------------------------------------------ */

/** Orden de impresión de categorías en `tailwind inspect`. */
const TW_CATEGORY_ORDER: TailwindCategory[] = [
  'layout',
  'flexbox-grid',
  'spacing',
  'sizing',
  'typography',
  'colors',
  'backgrounds',
  'borders',
  'effects',
  'transforms',
  'transitions',
  'interactivity',
  'other',
];

/** Colores por categoría para la salida del inspector. */
const TW_CATEGORY_COLOR: Record<string, (s: string) => string> = {
  layout: chalk.cyan,
  'flexbox-grid': chalk.cyanBright,
  spacing: chalk.green,
  sizing: chalk.greenBright,
  typography: chalk.magenta,
  colors: chalk.yellow,
  backgrounds: chalk.yellowBright,
  borders: chalk.blue,
  effects: chalk.magentaBright,
  transforms: chalk.red,
  transitions: chalk.redBright,
  interactivity: chalk.white,
  other: chalk.gray,
};

/**
 * `webmcpcss tailwind inspect <url> <selector>`: inspecciona las clases
 * Tailwind de un elemento y las muestra agrupadas por categoría.
 */
async function cmdTwInspect(url: string, selector: string): Promise<void> {
  const browser = await launchBrowser(true);
  try {
    const page = await browser.newPage();
    await navigate(page, url);
    const classList = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      return el ? Array.from(el.classList) : null;
    }, selector);
    if (!classList) {
      logger.error(`No se encontró ningún elemento para el selector: ${selector}`);
      process.exitCode = 1;
      return;
    }
    const inspection = inspectClassList(classList);
    console.log(chalk.bold(`\nInspección Tailwind de ${chalk.underline(selector)}\n`));
    if (inspection.all.length === 0) {
      console.log(chalk.yellow('  El elemento no tiene clases Tailwind reconocibles.'));
    }
    for (const category of TW_CATEGORY_ORDER) {
      const classes = inspection.classes[category];
      if (!classes || classes.length === 0) continue;
      const paint = TW_CATEGORY_COLOR[category] ?? chalk.white;
      console.log(`  ${paint(category.padEnd(14))} ${classes.join(' ')}`);
    }
    if (inspection.unknown.length > 0) {
      console.log(
        `  ${chalk.gray('no-tailwind'.padEnd(14))} ${inspection.unknown.join(' ')}`,
      );
    }
    console.log(
      chalk.dim(
        `\n  ${inspection.all.length} clase(s) Tailwind, ${inspection.unknown.length} propia(s) del sitio.\n`,
      ),
    );
  } finally {
    await browser.close();
  }
}

/** Serializa los descriptores a un webmcp.css documental. */
function tailwindToolsToCss(tools: TailwindToolDescriptor[]): string {
  const bySelector = new Map<string, TailwindToolDescriptor[]>();
  for (const tool of tools) {
    const list = bySelector.get(tool.selector) ?? [];
    list.push(tool);
    bySelector.set(tool.selector, list);
  }
  let css = `/* Generado por WebMCPcss — herramientas de edición Tailwind. */\n\n`;
  for (const [selector, list] of bySelector) {
    const categories = [...new Set(list.map((t) => t.category))].join(' ');
    css += `${selector} {\n`;
    css += `  webmcp-tool: ${list[0].name};\n`;
    css += `  webmcp-description: "Editar clases Tailwind (${categories}) de este elemento";\n`;
    css += `  webmcp-categories: ${categories};\n`;
    css += `}\n\n`;
  }
  return css;
}

/**
 * `webmcpcss tailwind generate <url>`: escanea la página, genera herramientas
 * de edición Tailwind y escribe el script JS + un webmcp.css documental.
 */
async function cmdTwGenerate(
  url: string,
  opts: { output: string; maxElements: string; generic?: boolean },
): Promise<void> {
  const browser = await launchBrowser(true);
  try {
    const page = await browser.newPage();
    await navigate(page, url);
    const entries = await scanPage(page, { maxElements: Number(opts.maxElements) || 50 });
    if (entries.length === 0) {
      logger.warn('No se encontraron elementos con clases Tailwind.');
      return;
    }
    const tools = generateTailwindTools(entries, { includeGeneric: opts.generic });
    const jsPath = `${opts.output}.js`;
    const cssPath = `${opts.output}.webmcp.css`;
    fs.writeFileSync(jsPath, buildTailwindToolsScript(tools), 'utf8');
    fs.writeFileSync(cssPath, tailwindToolsToCss(tools), 'utf8');

    console.log(
      chalk.bold(
        `\n${entries.length} elemento(s) Tailwind → ${tools.length} herramienta(s):\n`,
      ),
    );
    for (const tool of tools) {
      const paint = TW_CATEGORY_COLOR[tool.category] ?? chalk.white;
      console.log(
        `  ${chalk.green('✔')} ${chalk.bold(tool.name)} ${paint(`[${tool.category}]`)} ${chalk.dim(tool.selector)}`,
      );
    }
    console.log(`\n  Script:     ${chalk.cyan(jsPath)}`);
    console.log(`  WebMCP CSS: ${chalk.cyan(cssPath)}`);
    console.log(
      chalk.dim(
        '\n  Incluye el script en tu página: <script src="' +
          path.basename(jsPath) +
          '"></script>\n',
      ),
    );
  } finally {
    await browser.close();
  }
}

/**
 * `webmcpcss tailwind export <url> -o <archivo>`: exporta el HTML (con las
 * clases Tailwind actuales del DOM) a HTML, JSX/TSX, Vue o Angular.
 */
async function cmdTwExport(
  url: string,
  opts: { selector: string; output: string; framework?: string; name: string },
): Promise<void> {
  const browser = await launchBrowser(true);
  try {
    const page = await browser.newPage();
    await navigate(page, url);
    const html = await page.evaluate((sel: string) => {
      const el = document.querySelector(sel);
      return el ? el.outerHTML : null;
    }, opts.selector);
    if (!html) {
      logger.error(`No se encontró ningún elemento para el selector: ${opts.selector}`);
      process.exitCode = 1;
      return;
    }
    const framework =
      (opts.framework as Framework) || frameworkFromExtension(opts.output);
    const formatted = formatForFramework(html, framework, opts.name);
    fs.writeFileSync(opts.output, formatted, 'utf8');
    console.log(
      `${chalk.green('✔')} Exportado ${chalk.bold(opts.selector)} como ${chalk.cyan(framework)} → ${chalk.cyan(opts.output)}`,
    );
  } finally {
    await browser.close();
  }
}

const tailwindCmd = program
  .command('tailwind')
  .description(
    'Herramientas de integración con Tailwind CSS (inspect, generate, export)',
  );

tailwindCmd
  .command('inspect')
  .description('Inspecciona las clases Tailwind de un elemento, agrupadas por categoría')
  .argument('<url>', 'URL o ruta local del HTML')
  .argument('<selector>', 'selector CSS del elemento (ej. ".card", "#header")')
  .action(cmdTwInspect);

tailwindCmd
  .command('generate')
  .description('Genera herramientas WebMCP de edición Tailwind para una página')
  .argument('<url>', 'URL o ruta local del HTML')
  .option('-o, --output <base>', 'base de los archivos de salida', 'webmcp-tailwind')
  .option('-m, --max-elements <n>', 'máximo de elementos a escanear', '50')
  .option('-g, --generic', 'añade además herramientas genéricas edit<Id>Classes')
  .action(cmdTwGenerate);

tailwindCmd
  .command('export')
  .description(
    'Exporta el HTML con las clases Tailwind actuales (HTML, JSX, Vue, Angular)',
  )
  .argument('<url>', 'URL o ruta local del HTML')
  .requiredOption(
    '-o, --output <file>',
    'archivo de salida (.html, .jsx, .tsx, .vue, .component.ts)',
  )
  .option('-s, --selector <selector>', 'elemento a exportar', 'body')
  .option('-f, --framework <fw>', 'forzar framework: html | react | vue | angular')
  .option('-n, --name <name>', 'nombre del componente generado', 'ExportedComponent')
  .action(cmdTwExport);

/* ------------------------------------------------------------------ */
/* Comando `graph` (Mapas de Contenido)                                */
/* ------------------------------------------------------------------ */

/** Recolecta archivos .webmcp.css de rutas (archivos o carpetas, recursivo). */
function collectWebmcpFiles(paths: string[]): string[] {
  const found: string[] = [];
  const visit = (p: string): void => {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) {
      logger.warn(`Ruta no encontrada: ${p}`);
      return;
    }
    const stat = fs.statSync(abs);
    if (stat.isFile()) {
      if (/\.css$/i.test(abs)) found.push(abs);
      return;
    }
    for (const entry of fs.readdirSync(abs)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const child = path.join(abs, entry);
      if (fs.statSync(child).isDirectory()) visit(child);
      else if (
        /(\.webmcp\.css|(^|\/)webmcp\.css)$/i.test(child) ||
        /webmcp.*\.css$/i.test(entry)
      )
        found.push(child);
    }
  };
  for (const p of paths) visit(p);
  return [...new Set(found)];
}

/**
 * `webmcpcss graph <paths...>`: construye el grafo de conocimiento y lo
 * exporta a JSON, vault de Obsidian y/o dashboard interactivo.
 */
async function cmdGraph(
  paths: string[],
  opts: {
    obsidian?: string;
    output?: string;
    dashboard?: boolean;
    port: string;
    withStatus?: boolean;
    statusFile?: string;
    fragility?: boolean;
    framework?: string;
  },
): Promise<void> {
  logger.title('WebMCPcss · graph');
  const files = collectWebmcpFiles(paths);
  if (files.length === 0) {
    logger.error('No se encontró ningún archivo .webmcp.css en las rutas indicadas.');
    process.exitCode = 1;
    return;
  }

  const parsed: ParsedFile[] = [];
  for (const file of files) {
    try {
      parsed.push({ path: file, toolMap: parseWebMCPFile(file) });
      logger.info(`Parseado: ${chalk.bold(path.relative(process.cwd(), file))}`);
    } catch (err) {
      logger.warn(
        `Ignorado ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Estado opcional desde archivo de validate --save-status.
  let statusResults: StatusResult[] | undefined;
  if (opts.withStatus || opts.statusFile) {
    const statusPath = opts.statusFile ?? '.webmcp-status.json';
    if (fs.existsSync(statusPath)) {
      const raw = JSON.parse(fs.readFileSync(statusPath, 'utf8')) as
        StatusResult | StatusResult[];
      statusResults = Array.isArray(raw) ? raw : [raw];
      logger.info(`Estado cargado de ${chalk.bold(statusPath)}`);
    } else {
      logger.warn(
        `No existe ${statusPath}. Genera uno con: webmcpcss validate <url> <css> --save-status`,
      );
    }
  }

  const graph: Graph = buildGraph(parsed, statusResults, {
    fragility: opts.fragility !== false,
    framework: opts.framework,
  });

  const m = graph.metadata;
  console.log(
    `\n  ${chalk.bold('Grafo:')} ${graph.nodes.length} nodos, ${graph.edges.length} aristas ` +
      chalk.gray(
        `(${m?.totalTools ?? 0} herramientas, ${m?.totalSelectors ?? 0} selectores, ${m?.totalPages ?? 0} páginas)`,
      ),
  );
  if (m?.fragilitySummary) {
    const f = m.fragilitySummary;
    console.log(
      `  ${chalk.bold('Fragilidad:')} ${chalk.green(`🟢 ${f.low ?? 0}`)} · ${chalk.yellow(`🟡 ${f.medium ?? 0}`)} · ${chalk.red(`🔴 ${f.high ?? 0}`)}`,
    );
    // Detalle de selectores frágiles en consola.
    for (const node of graph.nodes) {
      if (node.type !== 'selector') continue;
      const frag = node.metadata?.fragility as
        { level: string; reasons: string[]; suggestions: string[] } | undefined;
      if (!frag || frag.level === 'low') continue;
      const paint = frag.level === 'high' ? chalk.red : chalk.yellow;
      console.log(`\n  ${paint(`[${frag.level}]`)} ${chalk.bold(node.label)}`);
      for (const r of frag.reasons.slice(0, 3)) console.log(chalk.gray(`    · ${r}`));
      for (const s of frag.suggestions.slice(0, 2)) console.log(chalk.cyan(`    → ${s}`));
    }
  }
  if (m?.statusCounts) {
    console.log(
      `  ${chalk.bold('Estado:')} ${chalk.green(`✔ ${m.statusCounts.ok}`)} · ${chalk.red(`✖ ${m.statusCounts.broken}`)}`,
    );
  }
  console.log();

  if (opts.output) {
    fs.writeFileSync(opts.output, JSON.stringify(graph, null, 2), 'utf8');
    logger.success(`Grafo JSON: ${chalk.bold(opts.output)}`);
  }
  if (opts.obsidian) {
    const written = generateObsidianVault(graph, opts.obsidian, {
      fragility: opts.fragility !== false,
      framework: opts.framework,
    });
    logger.success(
      `Vault Obsidian: ${chalk.bold(opts.obsidian)} (${written.length} notas). Ábrelo con "Open folder as vault".`,
    );
  }
  if (opts.dashboard) {
    const port = Number(opts.port) || 3100;
    await serveGraphDashboard(graph, port);
    logger.success(
      `Dashboard del grafo en ${chalk.bold(`http://localhost:${port}`)} (Ctrl+C para salir)`,
    );
  } else if (!opts.output && !opts.obsidian) {
    // Sin destino explícito: escribe un HTML estático autónomo.
    const htmlPath = 'webmcp-graph.html';
    fs.writeFileSync(htmlPath, buildGraphHtml(graph), 'utf8');
    logger.success(
      `HTML estático del grafo: ${chalk.bold(htmlPath)} (ábrelo en el navegador)`,
    );
  }
}

program
  .command('graph')
  .description(
    'Construye el grafo de conocimiento (Mapas de Contenido): JSON, vault Obsidian y dashboard',
  )
  .argument('<paths...>', 'archivos .webmcp.css o carpetas (recursivo)')
  .option(
    '--obsidian <dir>',
    'exporta notas Markdown para Obsidian a la carpeta indicada',
  )
  .option('-o, --output <file>', 'guarda el grafo en JSON')
  .option('--dashboard', 'sirve el dashboard interactivo del grafo (Cytoscape.js)')
  .option('-p, --port <port>', 'puerto del dashboard', '3100')
  .option('--with-status', 'incluye estado de selectores desde .webmcp-status.json')
  .option('--status-file <file>', 'archivo JSON con resultados de validate --save-status')
  .option('--no-fragility', 'desactiva el análisis de fragilidad (activo por defecto)')
  .option(
    '--framework <fw>',
    'framework principal (react, vue, svelte, angular, tailwind...)',
  )
  .action(cmdGraph);

program.parseAsync(process.argv).catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

// Se exporta para pruebas internas.
export { eventsToToolMap, DomAdapter };
