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
 * - `webmcpcss prompt "<orden>"`       → modifica la página con lenguaje natural (v0.7.0).
 * - v1.0.0: `init`, `assist`, `design`, `retro`, `a11y`, `test`, `version`,
 *   `doc`, `security`, `recommend`, `web3` (ver `cli-v1.ts`).
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
  buildGraphSvg,
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
  scanSource,
  buildToolMapFromSource,
} from './generator';
import { publishToCommunity, validateForPublish } from './community';
import {
  createMcpHttpServer,
  EXPORT_FORMATS,
  exportForAgent,
  FlomnyMcpCore,
  registerCursorMcpServer,
  startMcpStdioServer,
  type PromptExecutor,
  type AnimateExecutor,
  type ToolExecutor,
} from './exporters';
import { VERSION } from './version';
import { registerV1Commands } from './cli-v1';
import { registerStandardCommands } from './cli-standard';
import { registerComponentCommands } from './cli-components';
import {
  declarativeToolsToToolMap,
  extractDeclarativeToolsFromDocument,
} from './standard';
import { createLlmClient, PromptManager, type PromptResult } from './prompt';
import {
  animateWithPage,
  parseAnimations,
  parseAnimationsFile,
  writeRuntimeScript,
  type AnimationMap,
  type ExecuteResult as AnimateResult,
} from './animation';
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
import type { RepairResult, ToolMap, ValidationReport } from './types';
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
 *  equivalente para `document.modelContext.registerTool()`.
 *  Con `--ai`, mejora nombres/descripciones con un modelo de lenguaje. */
async function cmdGenerate(
  url: string,
  opts: {
    output: string;
    timeout: string;
    api?: boolean;
    ai?: boolean;
    auto?: boolean;
    fromSource?: boolean;
  },
) {
  // Modo --from-source: análisis estático de componentes (v0.6.0, sin navegador).
  if (opts.fromSource) {
    logger.title('WebMCPcss · generate --from-source');
    const scan = scanSource(url);
    logger.info(
      `${scan.files.length} archivo(s) ${chalk.cyan(scan.framework)} · ` +
        `${scan.elements.length} elemento(s) interactivo(s)`,
    );
    for (const w of scan.warnings) logger.warn(w);
    const toolMap = buildToolMapFromSource(scan);
    if (Object.keys(toolMap.tools).length === 0) {
      logger.warn(
        'Ningún elemento con ancla estable (id/data-*/name). Añade data-tool a tus componentes.',
      );
      return;
    }
    if (opts.ai) {
      logger.info('Pidiendo sugerencias a la IA...');
      await enhanceToolMapWithAi(toolMap, url);
    }
    fs.writeFileSync(opts.output, serializeToolMap(toolMap), 'utf8');
    logger.success(
      `Generado ${chalk.bold(opts.output)} con ${Object.keys(toolMap.tools).length} herramienta(s) desde el código fuente.`,
    );
    return;
  }

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
      // v1.1.0: los formularios ya anotados con la API declarativa del
      // estándar (toolname/tooldescription) conservan su nombre y descripción.
      const declarative = (await page.evaluate(
        `(${extractDeclarativeToolsFromDocument.toString()})(document)`,
      )) as import('./standard').DeclarativeScan;
      let toolMap = buildAutoToolMap(scan);
      if (declarative.tools.length > 0) {
        logger.info(
          `API declarativa WebMCP: ${chalk.cyan(String(declarative.tools.length))} formulario(s) con toolname (${declarative.tools
            .map((t) => t.name)
            .join(', ')})`,
        );
        // Sustituye las tools autogeneradas que apuntan al mismo formulario.
        const declaredForms = new Set(declarative.tools.map((t) => t.formSelector));
        for (const [n, t] of Object.entries(toolMap.tools)) {
          if (t.trigger?.selector && declaredForms.has(t.trigger.selector))
            delete toolMap.tools[n];
        }
        toolMap = declarativeToolsToToolMap(declarative.tools, toolMap);
      }
      for (const w of declarative.warnings) logger.warn(w);
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
  opts: { format: string; output: string; url?: string; register?: boolean },
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
  if (opts.register) {
    if (opts.format !== 'cursor') {
      logger.warn(
        '--register solo aplica al formato cursor (~/.cursor/mcp.json); ignorado.',
      );
      return;
    }
    const { path: cfg, updated } = registerCursorMcpServer({
      cssPath: path.resolve(cssPath),
      url: opts.url,
    });
    logger.success(
      `Servidor webmcpcss ${updated ? 'actualizado' : 'registrado'} en ${chalk.bold(cfg)}. Reinicia Cursor.`,
    );
  }
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

/** Opciones comunes de LLM (CLI `prompt` y `mcp --serve`). */
interface LlmCliOptions {
  llm?: string;
  model?: string;
  llmBaseUrl?: string;
}

/** Construye el ejecutor de prompts en lenguaje natural para el servidor MCP. */
function buildPromptExecutor(
  defaultUrl: string | undefined,
  cssPath: string | undefined,
  llmOpts: LlmCliOptions,
): PromptExecutor {
  return async (args) => {
    const url = args.url ?? defaultUrl;
    if (!url)
      throw new Error('Falta la URL: arranca el servidor con --url o pásala en "url".');
    const toolMap =
      cssPath && fs.existsSync(cssPath) ? parseWebMCPFile(cssPath) : undefined;
    const llm = createLlmClient({
      provider: llmOpts.llm,
      model: llmOpts.model,
      baseUrl: llmOpts.llmBaseUrl,
    });
    const browser = await launchBrowser(true);
    try {
      const page = await browser.newPage();
      await navigate(page, url);
      const manager = new PromptManager(new PuppeteerAdapter(page), {
        toolMap,
        llm,
        url,
        title: await page.title(),
      });
      return await manager.run(args.prompt, {
        url,
        files: args.files,
        text: args.text,
        dryRun: args.dryRun,
        screenshotBase64: args.screenshot,
      });
    } finally {
      await browser.close();
    }
  };
}

/** Construye el ejecutor de animaciones declarativas para el servidor MCP (v0.8.0). */
function buildAnimateExecutor(defaultUrl: string | undefined): AnimateExecutor {
  return async (args) => {
    const url = args.url ?? defaultUrl;
    if (!url)
      throw new Error('Falta la URL: arranca el servidor con --url o pásala en "url".');
    const map = args.animationFile
      ? parseAnimationsFile(args.animationFile)
      : parseAnimations(args.css ?? '');
    const browser = await launchBrowser(true);
    try {
      const page = await browser.newPage();
      await navigate(page, url);
      return await animateWithPage(page, map, {
        url,
        strategy: args.strategy,
        engine: args.engine,
        dryRun: args.dryRun,
        screenshot: args.screenshot,
      });
    } finally {
      await browser.close();
    }
  };
}

/** Imprime el resultado de `animate` de forma legible. */
function printAnimateResult(map: AnimationMap, result: AnimateResult): void {
  for (const w of map.warnings) logger.warn(w);
  logger.info(`Plan (${result.plan.length} animación(es), por prioridad):`);
  for (const p of result.plan) {
    const engine = p.engine ? chalk.cyan(p.engine) : chalk.red('sin motor');
    console.log(
      `    ${chalk.bold(p.name)} ${chalk.gray(`[${p.type}, ${p.priority}]`)} → ${engine} ` +
        chalk.gray(`${p.selector} · ${p.properties.join(', ') || '-'} · ${p.strategy}`) +
        (p.unsupportedReason ? chalk.red(` (${p.unsupportedReason})`) : ''),
    );
  }
  const v = result.validation;
  if (v) {
    for (const e of v.entries) {
      for (const err of e.errors) logger.error(`${e.name}: ${err}`);
      for (const warn of e.warnings) logger.warn(`${e.name}: ${warn}`);
    }
    if (v.conflicts.length) {
      logger.info(`Conflictos previstos (${v.conflicts.length}):`);
      for (const c of v.conflicts) {
        console.log(
          `    ${chalk.bold(c.animation)} ⇄ ${c.conflictsWith} ${chalk.gray(`[${c.properties.join(', ')}]`)} → ${chalk.yellow(c.action)}` +
            (c.reason ? chalk.gray(` · ${c.reason}`) : ''),
        );
      }
    }
    if (v.capabilities) {
      const caps = v.capabilities;
      const libs = caps.libraries.map((l) => l.name + (l.version ? ` ${l.version}` : ''));
      logger.info(
        `Navegador: waapi=${caps.waapi} webgl=${caps.webgl} scrollTimeline=${caps.scrollTimeline}` +
          ` reducedMotion=${caps.reducedMotion}` +
          (libs.length ? ` · librerías: ${libs.join(', ')}` : ''),
      );
    }
  }
  if (result.result) {
    for (const o of result.result.outcomes) {
      const line = `${chalk.bold(o.name)}: ${o.message}`;
      if (o.status === 'executed' || o.status === 'dry-run') logger.success(line);
      else if (o.status === 'failed') logger.error(line);
      else logger.warn(line);
    }
    if (result.result.external.length) {
      logger.info(
        `Animaciones externas respetadas: ${result.result.external
          .map((e) => `${e.id} (${e.library})`)
          .join(', ')}`,
      );
    }
  }
  if (result.success) logger.success(result.message);
  else logger.error(result.message);
}

/** Opciones comunes de `animate` y `validate-conflicts`. */
interface AnimateCliOptions {
  url?: string;
  type?: string;
  conflictStrategy?: string;
  dryRun?: boolean;
  output?: string;
  screenshot?: string;
  json?: boolean;
  headless?: boolean;
  settle: string;
  sandbox?: boolean;
}

/** Parsea el archivo de animaciones y valida las opciones compartidas. */
function loadAnimationMap(animationFile: string, opts: AnimateCliOptions) {
  if (!fs.existsSync(animationFile)) throw new Error(`No existe ${animationFile}`);
  const map = parseAnimationsFile(animationFile);
  const names = Object.keys(map.animations);
  if (names.length === 0) {
    throw new Error(
      `${animationFile} no declara ninguna animación (webmcp-animation: "nombre")`,
    );
  }
  const strategies = ['replace', 'queue', 'ignore', 'merge'] as const;
  const strategy = opts.conflictStrategy as (typeof strategies)[number] | undefined;
  if (strategy && !strategies.includes(strategy)) {
    throw new Error(`--conflict-strategy debe ser ${strategies.join(' | ')}`);
  }
  const engines = ['css', 'waapi', 'three'] as const;
  const engine = opts.type as (typeof engines)[number] | undefined;
  if (engine && !engines.includes(engine)) {
    throw new Error(`--type debe ser ${engines.join(' | ')}`);
  }
  return { map, names, strategy, engine };
}

/**
 * Comando `validate-conflicts`: valida un archivo de animaciones contra una
 * página y simula los conflictos con las animaciones existentes (GSAP,
 * Framer Motion, CSS del sitio…) **sin ejecutar nada**. Equivale a
 * `animate --dry-run` pero con salida centrada en el informe y código de
 * salida 1 si hay errores bloqueantes.
 */
async function cmdValidateConflicts(
  animationFile: string,
  opts: AnimateCliOptions & { strict?: boolean },
) {
  if (!opts.json) logger.title('WebMCPcss · validate-conflicts');
  const { map, strategy, engine } = loadAnimationMap(animationFile, opts);
  const browser = await launchBrowser(opts.headless ?? true);
  let result: AnimateResult;
  try {
    const page = await browser.newPage();
    await navigate(page, opts.url ?? '');
    result = await animateWithPage(page, map, {
      url: opts.url,
      strategy,
      engine,
      dryRun: true,
      sandbox: opts.sandbox ? 'shadow' : undefined,
      historyFile: false,
    });
  } finally {
    await browser.close();
  }
  const validation = result.validation;
  const report = {
    file: animationFile,
    url: opts.url,
    ok: validation?.ok ?? false,
    strategy: strategy ?? 'queue',
    plan: result.plan,
    entries: validation?.entries ?? [],
    conflicts: validation?.conflicts ?? [],
    capabilities: validation?.capabilities,
    external: result.result?.external ?? [],
  };
  if (opts.output) {
    fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
    fs.writeFileSync(opts.output, JSON.stringify(report, null, 2), 'utf8');
  }
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printAnimateResult(map, { ...result, result: undefined });
    if (result.result?.external.length) {
      logger.info(
        `Animaciones externas detectadas: ${result.result.external
          .map((e) => `${e.id} (${e.library})`)
          .join(', ')}`,
      );
    }
    const n = report.conflicts.length;
    if (n === 0) logger.success('Sin conflictos previstos.');
    else
      logger.warn(
        `${n} conflicto(s) previsto(s). Ajusta webmcp-animation-priority/-conflict o usa --conflict-strategy.`,
      );
    if (opts.output) logger.info(`Informe guardado en ${chalk.bold(opts.output)}`);
  }
  if (!report.ok || (opts.strict && report.conflicts.length > 0)) process.exitCode = 1;
}

/** Comando `animate`: aplica animaciones declarativas a una página. */
async function cmdAnimate(animationFile: string, opts: AnimateCliOptions) {
  if (!opts.json) logger.title('WebMCPcss · animate');
  const { map, names, strategy, engine } = loadAnimationMap(animationFile, opts);

  // Sin --url: genera el runtime + el mapa JSON en --output (uso offline).
  if (!opts.url) {
    const outDir = opts.output ?? './webmcp-animation';
    fs.mkdirSync(outDir, { recursive: true });
    const runtime = writeRuntimeScript(path.join(outDir, 'webmcpcss-animation.js'));
    const mapFile = path.join(outDir, 'animations.json');
    fs.writeFileSync(mapFile, JSON.stringify(map, null, 2), 'utf8');
    const loader = path.join(outDir, 'index.html');
    fs.writeFileSync(
      loader,
      `<!doctype html>\n<!-- Ejemplo de uso del runtime generado por webmcpcss animate -->\n` +
        `<script src="webmcpcss-animation.js"></script>\n<script>\n` +
        `fetch('animations.json').then(r => r.json()).then(map => webmcpcss.animation.run(map, ${JSON.stringify(
          {
            strategy: strategy ?? 'queue',
            engine,
            sandbox: opts.sandbox ? 'shadow' : undefined,
          },
        )}));\n</script>\n`,
      'utf8',
    );
    if (opts.json) {
      console.log(JSON.stringify({ runtime, map: mapFile, animations: names }, null, 2));
    } else {
      for (const w of map.warnings) logger.warn(w);
      logger.success(`Runtime generado en ${chalk.bold(runtime)}`);
      logger.info(`Mapa de animaciones: ${mapFile} (${names.join(', ')})`);
      logger.info(
        `Incluye el script en tu página y llama a webmcpcss.animation.run(map)`,
      );
      logger.info('Añade --url <url> para aplicar las animaciones en un navegador real.');
    }
    return;
  }

  let result: AnimateResult;
  const browser = await launchBrowser(opts.headless ?? true);
  try {
    const page = await browser.newPage();
    await navigate(page, opts.url);
    result = await animateWithPage(page, map, {
      url: opts.url,
      strategy,
      engine,
      dryRun: opts.dryRun,
      sandbox: opts.sandbox ? 'shadow' : undefined,
      screenshot: !!opts.screenshot,
      settleMs: parseInt(opts.settle, 10) || 600,
    });
    if (opts.screenshot && result.screenshotBase64) {
      fs.mkdirSync(path.dirname(path.resolve(opts.screenshot)), { recursive: true });
      fs.writeFileSync(opts.screenshot, Buffer.from(result.screenshotBase64, 'base64'));
    }
  } finally {
    await browser.close();
  }
  const { screenshotBase64: _shot, ...serializable } = result;
  if (opts.output) {
    const outFile = opts.output.endsWith('.json')
      ? opts.output
      : path.join(opts.output, 'animate-result.json');
    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(serializable, null, 2), 'utf8');
    if (!opts.json) logger.info(`Resultado guardado en ${chalk.bold(outFile)}`);
  }
  if (opts.json) {
    console.log(JSON.stringify(serializable, null, 2));
  } else {
    printAnimateResult(map, result);
    if (opts.screenshot) logger.info(`Captura: ${opts.screenshot}`);
  }
  if (!result.success) process.exitCode = 1;
}

/** Imprime un resultado de `prompt` de forma legible. */
function printPromptResult(result: PromptResult): void {
  const a = result.action;
  logger.info(
    `Acción: ${chalk.cyan(a.action)} → ${chalk.bold(a.target || '(sin objetivo)')} ` +
      chalk.gray(`[${a.source}, confianza ${(a.confidence ?? 0).toFixed(2)}]`),
  );
  const params = Object.entries(a.parameters);
  if (params.length > 0) {
    for (const [k, v] of params) {
      console.log(
        `    ${chalk.gray(k + ':')} ${typeof v === 'string' ? v : JSON.stringify(v)}`,
      );
    }
  }
  if (result.match) {
    logger.info(
      `Elemento: ${chalk.bold(result.match.selector)} ` +
        chalk.gray(
          `(vía ${result.match.strategy}, ${result.match.confidence.toFixed(2)})`,
        ) +
        (result.match.tool ? chalk.magenta(` · herramienta ${result.match.tool}`) : '') +
        (result.match.text ? chalk.gray(` · "${result.match.text.slice(0, 50)}"`) : ''),
    );
  }
  if (result.dryRun) {
    logger.warn(
      'Modo dry-run: la página no se modificó. Añade --execute para aplicar la acción.',
    );
  } else if (result.outcome) {
    if (result.outcome.success) logger.success(result.outcome.message);
    else logger.error(result.outcome.message);
  }
  if (result.error && !result.outcome) logger.error(result.error);
  for (const s of result.suggestions ?? []) console.log(chalk.gray('  ' + s));
  if (result.evidence?.screenshot)
    logger.info(`Captura: ${chalk.bold(result.evidence.screenshot)}`);
  logger.debug(`Duración: ${result.durationMs} ms`);
}

/** Comando `prompt`: modifica una página con una orden en lenguaje natural. */
async function cmdPrompt(
  prompt: string,
  opts: LlmCliOptions & {
    url: string;
    css?: string;
    image?: string[];
    file?: string[];
    text?: string;
    execute?: boolean;
    dryRun?: boolean;
    output?: string;
    screenshot?: string;
    json?: boolean;
    headless?: boolean;
  },
) {
  if (!opts.json) logger.title('WebMCPcss · prompt');
  const dryRun = opts.dryRun || !opts.execute;
  const files = [...(opts.image ?? []), ...(opts.file ?? [])];
  const toolMap = opts.css ? parseWebMCPFile(opts.css) : undefined;
  const llm = createLlmClient({
    provider: opts.llm,
    model: opts.model,
    baseUrl: opts.llmBaseUrl,
  });
  if (!opts.json) {
    logger.info(
      llm
        ? `LLM: ${chalk.bold(`${llm.provider}/${llm.model}`)}`
        : 'LLM: no configurado → heurísticas locales (define WEBMCP_LLM_PROVIDER para usar un modelo).',
    );
  }

  const browser = await launchBrowser(opts.headless ?? true);
  let result: PromptResult;
  try {
    const page = await browser.newPage();
    await navigate(page, opts.url);
    const manager = new PromptManager(new PuppeteerAdapter(page), {
      toolMap,
      llm,
      url: opts.url,
      title: await page.title(),
    });
    result = await manager.run(prompt, {
      url: opts.url,
      files,
      text: opts.text,
      dryRun,
      screenshot: opts.screenshot,
    });
  } finally {
    await browser.close();
  }

  if (opts.output) {
    fs.mkdirSync(path.dirname(path.resolve(opts.output)), { recursive: true });
    fs.writeFileSync(opts.output, JSON.stringify(result, null, 2), 'utf8');
  }
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    printPromptResult(result);
    if (opts.output) logger.info(`Resultado guardado en ${chalk.bold(opts.output)}`);
  }
  if (!result.success) process.exitCode = 1;
}

/** Comando `mcp --serve`: servidor MCP por stdio (o REST con --http). */
async function cmdMcp(
  opts: LlmCliOptions & {
    serve?: boolean;
    css?: string;
    url?: string;
    http?: boolean;
    port: string;
    /** Commander convierte `--no-prompt` en `prompt: false`. */
    prompt?: boolean;
    animate?: boolean;
    noPrompt?: boolean;
    noAnimate?: boolean;
    flomny?: boolean;
    hub?: boolean;
    hubUrl?: string;
    hubOutput?: string;
    hubOffline?: boolean;
  },
) {
  if (!opts.serve) {
    console.log(
      'Usa: webmcpcss mcp --serve [--css <file>] [--url <url>] [--http -p 8090] [--flomny] [--hub]',
    );
    return;
  }
  const cssPath = opts.css ?? 'webmcp.css';
  const cssExists = fs.existsSync(cssPath);
  if (!cssExists && !opts.hub) {
    throw new Error(`No existe ${cssPath}. Indica el archivo con --css.`);
  }
  // Con --hub se puede arrancar sin CSS (solo descubrimiento/importación de componentes).
  const cssSource = cssExists ? fs.readFileSync(cssPath, 'utf8') : '';
  const toolMap = cssExists ? parseWebMCP(cssSource) : { tools: {}, context: {} };
  if (!cssExists) {
    console.error(
      `[webmcpcss] ${cssPath} no existe: servidor solo con herramientas del hub.`,
    );
  }
  const execute = opts.url ? buildMcpExecutor(opts.url, cssPath) : undefined;
  const prompt =
    opts.noPrompt || opts.prompt === false
      ? undefined
      : buildPromptExecutor(opts.url, cssPath, opts);
  const animate =
    opts.noAnimate || opts.animate === false ? undefined : buildAnimateExecutor(opts.url);
  const hub = opts.hub
    ? { hubUrl: opts.hubUrl, offline: opts.hubOffline, outputDir: opts.hubOutput }
    : undefined;
  const options = {
    toolMap,
    cssSource,
    cssPath,
    url: opts.url,
    execute,
    prompt,
    animate,
    hub,
    version: VERSION,
  };
  // --flomny: servidor dedicado con API de introspección (list_tools, get_tool_info…).
  const core = opts.flomny
    ? new FlomnyMcpCore({
        ...options,
        validateSelectors: opts.url
          ? async (url) => {
              let report: ValidationReport | undefined;
              await withWebMCP(url ?? opts.url ?? '', cssPath, async (webmcp) => {
                report = await webmcp.validate(url ?? opts.url);
              });
              return report as ValidationReport;
            }
          : undefined,
        suggestRepairs: opts.url
          ? async (url) => {
              let repairs: RepairResult[] = [];
              await withWebMCP(url ?? opts.url ?? '', cssPath, async (webmcp) => {
                repairs = await webmcp.repairAll();
              });
              return repairs;
            }
          : undefined,
      })
    : undefined;

  if (opts.http) {
    const port = parseInt(opts.port, 10);
    const server = createMcpHttpServer(core ?? options);
    await new Promise<void>((resolve) => server.listen(port, '0.0.0.0', resolve));
    logger.success(
      `Servidor HTTP en http://localhost:${port}${core ? ' (modo Flomny)' : ''}`,
    );
    logger.info(
      'Rutas: GET /api/tools · GET /api/graph · POST /api/call {"tool","args"}' +
        (prompt ? ' · POST /api/prompt {"prompt","files","dryRun"}' : '') +
        (animate
          ? ' · POST /api/animate {"animationFile"|"css","strategy","dryRun"}'
          : '') +
        (hub
          ? ' · GET /api/components[?category&library&search] · GET /api/components/:id'
          : ''),
    );
    return new Promise<void>(() => undefined); // queda sirviendo
  }

  // Modo stdio: stdout es SOLO JSON-RPC; los avisos van a stderr.
  console.error(
    `[webmcpcss] MCP stdio listo${core ? ' (Flomny: list_tools, get_tool_info, get_selector_status, suggest_repair, execute_prompt, apply_animation)' : ''} · ${Object.keys(toolMap.tools).length} herramienta(s) de ${cssPath}` +
      (prompt ? ' + webmcpcss_prompt' : '') +
      (animate ? ' + webmcpcss_animate' : '') +
      (hub ? ' + hub (list_components, get_component, import_component)' : '') +
      (opts.url
        ? ` · ejecución real en ${opts.url}`
        : ' · sin --url (tools/call en dry-run)'),
  );
  await startMcpStdioServer(core ?? options);
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

/** Comando `publish`: valida y abre un PR a community-styles/ del upstream. */
async function cmdPublish(cssPath: string, opts: { domain: string; token?: string }) {
  logger.title('WebMCPcss · publish');
  const css = fs.readFileSync(cssPath, 'utf8');
  const { tools, context } = validateForPublish(css);
  logger.info(`Validado: ${tools} herramienta(s), ${context} contexto(s).`);

  const token = opts.token ?? process.env.GITHUB_TOKEN;
  if (!token) {
    logger.warn('Sin token de GitHub: no puedo abrir el PR automáticamente.');
    console.log(`
Pasos manuales:
  1. Haz fork de https://github.com/cochinoraptor/WebMCPcss
  2. Copia tu archivo como community-styles/${opts.domain}.webmcp.css
  3. Abre un Pull Request a main

O vuelve a ejecutar con token: webmcpcss publish ${cssPath} --domain ${opts.domain} --token ghp_xxx
(también se lee de la variable de entorno GITHUB_TOKEN)`);
    return;
  }

  logger.info('Abriendo PR (fork → rama → commit → pull request)...');
  const result = await publishToCommunity({ domain: opts.domain, css, token });
  logger.success(`PR creado: ${chalk.bold(result.prUrl)}`);
  logger.info(`Rama ${result.branch} en ${result.fork} → ${result.path}`);
}

const program = new Command();
program
  .name('webmcpcss')
  .description('WebMCPcss: WebMCP para cualquier web, con auto-reparación de selectores')
  .version(VERSION)
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
  .option(
    '--from-source',
    'analiza código fuente React/Vue/Svelte (archivo o carpeta) sin navegador',
  )
  .option('--api', 'genera código JS para document.modelContext.registerTool()')
  .option('--ai', 'mejora nombres y descripciones con IA (requiere WEBMCPCSS_AI_API_KEY)')
  .action(cmdGenerate);

program
  .command('validate')
  .description('Valida que los selectores del .webmcp.css existan en la página')
  .argument('<url>', 'URL o ruta a un HTML local')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .option('--api', 'incluye las herramientas registradas vía document.modelContext')
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
  .option('--register', 'con --format cursor: registra el servidor en ~/.cursor/mcp.json')
  .action(cmdExport);

program
  .command('mcp')
  .description('Servidor MCP: stdio por defecto (Claude/Cursor/Goose) o REST con --http')
  .option('--serve', 'inicia el servidor')
  .option('--css <file>', 'archivo .webmcp.css a exponer', 'webmcp.css')
  .option('--url <url>', 'URL del sitio: habilita ejecución real en tools/call')
  .option('--http', 'modo HTTP REST en vez de stdio')
  .option('-p, --port <port>', 'puerto en modo --http', '8090')
  .option('--no-prompt', 'no exponer la herramienta webmcpcss_prompt (lenguaje natural)')
  .option('--no-animate', 'no exponer la herramienta webmcpcss_animate (animaciones)')
  .option(
    '--flomny',
    'servidor dedicado para Flomny: list_tools, get_tool_info, get_selector_status, suggest_repair, execute_prompt, apply_animation',
  )
  .option(
    '--hub',
    'exponer el Component Hub: list_components, get_component, import_component (+ GET /api/components)',
  )
  .option('--hub-url <url>', 'URL del hub (por defecto WEBMCPCSS_HUB_URL o el público)')
  .option(
    '--hub-output <dir>',
    'carpeta donde import_component escribe',
    'webmcp-components',
  )
  .option('--hub-offline', 'usar solo el catálogo empaquetado')
  .option(
    '--llm <provider>',
    'proveedor LLM para webmcpcss_prompt: ollama, openai, anthropic',
  )
  .option('--model <model>', 'modelo LLM (ej. llama3, gpt-4o-mini)')
  .option('--llm-base-url <url>', 'URL base del proveedor LLM')
  .action(cmdMcp);

program
  .command('prompt')
  .description(
    'Modifica una página con lenguaje natural: "sube esta imagen al carrusel", "oculta el popup"…',
  )
  .argument('<prompt>', 'orden en lenguaje natural (español o inglés)')
  .requiredOption('--url <url>', 'URL (o HTML local) del sitio a modificar')
  .option('--css <file>', 'archivo .webmcp.css: permite delegar en sus herramientas')
  .option('--image <file...>', 'imagen(es) a subir (ruta, URL o data-URI)')
  .option('--file <file...>', 'archivo(s) a subir (ruta, URL o data-URI)')
  .option('--text <text>', 'texto adicional (valor a escribir en un campo)')
  .option(
    '--llm <provider>',
    'proveedor LLM: ollama, openai, anthropic (def.: variables de entorno)',
  )
  .option(
    '--model <model>',
    'modelo LLM (ej. llama3, gpt-4o-mini, claude-3-5-haiku-latest)',
  )
  .option(
    '--llm-base-url <url>',
    'URL base del proveedor LLM (ej. http://localhost:11434)',
  )
  .option('--execute', 'aplica la acción (sin esta opción solo se interpreta: dry-run)')
  .option('--dry-run', 'fuerza el modo de solo interpretación')
  .option('--screenshot <file>', 'guarda una captura PNG tras ejecutar')
  .option('-o, --output <file>', 'guarda el resultado completo en JSON')
  .option('--json', 'imprime SOLO el JSON del resultado en stdout')
  .option('--no-headless', 'muestra el navegador')
  .action(cmdPrompt);

program
  .command('animate')
  .description(
    'Aplica animaciones declarativas (webmcp-animation-*) a una página; sin --url genera el runtime JS',
  )
  .argument('<animation-file>', 'archivo .webmcp.css con reglas webmcp-animation-*')
  .option('--url <url>', 'URL (o HTML local) donde aplicar las animaciones')
  .option('--type <engine>', 'forzar motor: css | waapi | three')
  .option(
    '--conflict-strategy <strategy>',
    'estrategia global de conflictos: replace | queue | ignore | merge (def.: queue)',
  )
  .option('--dry-run', 'muestra plan, validación y conflictos previstos sin ejecutar')
  .option(
    '-o, --output <path>',
    'con --url: JSON del resultado; sin --url: carpeta del runtime generado',
  )
  .option('--screenshot <file>', 'guarda una captura PNG tras animar')
  .option('--settle <ms>', 'espera antes de la captura', '600')
  .option(
    '--sandbox',
    'aísla las animaciones en un shadow root (webmcp-animation-sandbox: shadow por defecto)',
  )
  .option('--json', 'imprime SOLO el JSON del resultado en stdout')
  .option('--no-headless', 'muestra el navegador')
  .action(cmdAnimate);

program
  .command('validate-conflicts')
  .description(
    'Valida un archivo de animaciones contra una página y simula conflictos con las animaciones existentes (sin ejecutar)',
  )
  .argument('<animation-file>', 'archivo .webmcp.css con reglas webmcp-animation-*')
  .requiredOption('--url <url>', 'URL (o HTML local) de la página')
  .option('--type <engine>', 'forzar motor: css | waapi | three')
  .option(
    '--conflict-strategy <strategy>',
    'estrategia global: replace | queue | ignore | merge (def.: queue)',
  )
  .option('--sandbox', 'simula con aislamiento en shadow root')
  .option('--strict', 'código de salida 1 también si hay conflictos previstos')
  .option('-o, --output <file>', 'guarda el informe JSON')
  .option('--json', 'imprime SOLO el JSON del informe en stdout')
  .option('--no-headless', 'muestra el navegador')
  .option('--settle <ms>', '(sin efecto; compatibilidad con animate)', '0')
  .action(cmdValidateConflicts);

program
  .command('run')
  .description('Ejecuta una herramienta WebMCP y devuelve el resultado como JSON')
  .argument('<url>', 'URL o ruta a un HTML local')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .argument('<tool>', 'nombre de la herramienta (ej. addToCart)')
  .option('--args <json>', 'argumentos en JSON (ej. \'{"quantity":"2"}\')', '{}')
  .action(cmdRun);

program
  .command('publish')
  .description('Publica un .webmcp.css validado como PR a community-styles/ del upstream')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .requiredOption('-d, --domain <domain>', 'dominio del sitio (ej. tienda.com)')
  .option('--token <token>', 'token de GitHub (o variable GITHUB_TOKEN)')
  .action(cmdPublish);

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
    svg?: string;
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
      // Ruta relativa al cwd cuando es posible: el grafo y el vault quedan
      // portables (sin rutas absolutas de la máquina que los generó).
      const rel = path.relative(process.cwd(), file);
      const shown = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : file;
      parsed.push({ path: shown, toolMap: parseWebMCPFile(file) });
      logger.info(`Parseado: ${chalk.bold(shown)}`);
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

  if (m?.frameworkSummary && Object.keys(m.frameworkSummary).length > 0) {
    const fws = Object.entries(m.frameworkSummary)
      .sort((a, b) => b[1] - a[1])
      .map(([fw, n]) => `${fw} (${n})`);
    console.log(`  ${chalk.bold('Frameworks detectados:')} ${fws.join(' · ')}\n`);
  }
  if (opts.output) {
    fs.writeFileSync(opts.output, JSON.stringify(graph, null, 2), 'utf8');
    logger.success(`Grafo JSON: ${chalk.bold(opts.output)}`);
  }
  if (opts.svg) {
    fs.writeFileSync(opts.svg, buildGraphSvg(graph), 'utf8');
    logger.success(`Grafo SVG: ${chalk.bold(opts.svg)}`);
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
  } else if (!opts.output && !opts.obsidian && !opts.svg) {
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
  .option('--fragility', 'analiza la fragilidad de los selectores (activo por defecto)')
  .option('--no-fragility', 'desactiva el análisis de fragilidad')
  .option('--svg <file>', 'exporta el grafo como SVG estático (sin navegador)')
  .option(
    '--framework <fw>',
    'framework principal (react, vue, svelte, angular, tailwind...)',
  )
  .action(cmdGraph);

/* ------------------------------------------------------------------ */
/* v1.0.0: init, assist, design, retro, a11y, test, version, doc,       */
/* security, recommend, web3 (definidos en cli-v1.ts)                   */
/* ------------------------------------------------------------------ */
registerV1Commands(program, { launchBrowser, navigate });
registerStandardCommands(program, { launchBrowser, navigate });
registerComponentCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

// Se exporta para pruebas internas.
export { eventsToToolMap, DomAdapter };
