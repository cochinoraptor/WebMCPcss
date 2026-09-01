#!/usr/bin/env node
/**
 * CLI de WebMCPcss.
 *
 * Comandos: `parse`, `validate`, `repair`, `generate`, `discover`,
 * `inject` y `dashboard`. Todos aceptan URLs `http(s)://` o rutas locales
 * a HTML, y `--verbose`.
 */
import { Command } from 'commander';
import { JSDOM } from 'jsdom';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import puppeteer from 'puppeteer';

import { DomAdapter } from './adapters/DomAdapter';
import { PuppeteerAdapter } from './adapters/PuppeteerAdapter';
import type { PageAdapter } from './adapters/PageAdapter';
import { WebMCPApiAdapter } from './webmcp-api/WebMCPApiAdapter';
import { generateApiScript } from './webmcp-api/generator';
import { buildToolMapFromEvents, RECORDER_SHIM_SOURCE } from './core/recorder';
import { repairContext, repairTool } from './core/repair';
import { validateToolMap } from './core/validate';
import { parseWebMCPFile, stringifyWebMCP } from './parser';
import { discoverWebMCP, injectWebMCP } from './proxy';
import { startDashboard } from './dashboard/server';
import { loadAiConfig, suggestToolMetadata } from './utils/ai';
import { appendEvent } from './utils/history';
import { Logger } from './utils/logger';
import type { ToolMap, ValidationReport } from './types';

const program = new Command();
const pkg = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'),
) as { version: string };

program
  .name('webmcpcss')
  .description('Haz que cualquier sitio web sea nativo para agentes de IA')
  .version(pkg.version)
  .option('-v, --verbose', 'salida detallada');

/** Logger según la opción global `--verbose`. */
function logger(): Logger {
  return new Logger(Boolean(program.opts().verbose));
}

/**
 * Carga una página como adaptador: URL con navegador (Puppeteer) o archivo
 * HTML local (jsdom). `close()` libera los recursos.
 */
async function loadPage(
  target: string,
  opts: { withApi?: boolean } = {},
): Promise<{ adapter: PageAdapter; close: () => Promise<void> }> {
  if (/^https?:\/\//i.test(target)) {
    let browser;
    try {
      browser = await puppeteer.launch({ headless: true });
    } catch (err) {
      throw new Error(
        `No se pudo lanzar el navegador (${err instanceof Error ? err.message : err}). ` +
          'Si instalaste con PUPPETEER_SKIP_DOWNLOAD=true, reinstala puppeteer o ' +
          'valida contra un archivo HTML local.',
      );
    }
    const page = await browser.newPage();
    const adapter = opts.withApi
      ? await WebMCPApiAdapter.create(page)
      : new PuppeteerAdapter(page);
    await page.goto(target, { waitUntil: 'domcontentloaded' });
    return { adapter, close: () => browser!.close() };
  }
  const html = fs.readFileSync(target, 'utf8');
  const dom = new JSDOM(html, { url: `file://${path.resolve(target)}` });
  return {
    adapter: new DomAdapter(dom.window.document, target),
    close: async () => undefined,
  };
}

/**
 * Imprime un reporte de validación con ✔/✖ (y ⚡ para herramientas API).
 */
function printReport(report: ValidationReport, log: Logger): void {
  for (const entry of report.entries) {
    const icon = entry.ok ? chalk.green('✔') : chalk.red('✖');
    const kind = entry.kind === 'api' ? chalk.yellow(' ⚡ api') : '';
    log.info(
      `  ${icon} ${entry.type === 'context' ? 'context ' : 'tool    '} ` +
        `${entry.name}: «${entry.selector}» → ${entry.count} elementos${kind}`,
    );
  }
  log.info(
    report.ok
      ? chalk.green(`\n✔ ${report.target}: todo OK`)
      : chalk.red(
          `\n✖ ${report.target}: ${report.entries.filter((e) => !e.ok).length} entrada(s) rota(s)`,
        ),
  );
}

program
  .command('parse')
  .description('parsea un .webmcp.css a tool map JSON (sin navegador)')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .action((css: string) => {
    const map = parseWebMCPFile(css);
    logger().info(JSON.stringify(map, null, 2));
  });

program
  .command('validate')
  .description('valida que los selectores existan en la página')
  .argument('<target>', 'URL http(s):// o ruta a un HTML local')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .option('--api', 'incluir herramientas de navigator.modelContext (URL)')
  .action(async (target: string, css: string, opts: { api?: boolean }) => {
    const log = logger();
    const map = parseWebMCPFile(css);
    const { adapter, close } = await loadPage(target, { withApi: Boolean(opts.api) });
    try {
      const report = await validateToolMap(adapter, map);
      printReport(report, log);
      appendEvent({
        type: 'validate',
        target,
        ok: report.ok,
        details: { broken: report.entries.filter((e) => !e.ok).length },
      });
      if (!report.ok) process.exitCode = 1;
    } finally {
      await close();
    }
  });

program
  .command('repair')
  .description('repara automáticamente los selectores rotos (reescribe el archivo)')
  .argument('<target>', 'URL http(s):// o ruta a un HTML local')
  .argument('<css>', 'ruta al archivo .webmcp.css')
  .action(async (target: string, css: string) => {
    const log = logger();
    const map: ToolMap = parseWebMCPFile(css);
    const { adapter, close } = await loadPage(target);
    let changed = false;
    try {
      for (const name of Object.keys(map.tools)) {
        const count = (await adapter.queryAll(map.tools[name].selector)).length;
        if (count > 0) continue;
        const outcome = await repairTool(adapter, map, name);
        if (outcome.repaired && outcome.to) {
          log.info(
            chalk.green(
              `  ✔ ${name}: «${outcome.from}» → «${outcome.to}»` +
                `${outcome.ambiguous ? ' (empate: verificar webmcp-confirmation)' : ''}`,
            ),
          );
          changed = true;
        } else {
          log.info(
            chalk.red(`  ✖ ${name}: «${outcome.from}» sin reparar (${outcome.reason})`),
          );
        }
      }
      for (const name of Object.keys(map.context)) {
        const count = (await adapter.queryAll(map.context[name].selector)).length;
        if (count > 0) continue;
        const outcome = await repairContext(adapter, map, name);
        if (outcome.repaired && outcome.to) {
          log.info(
            chalk.green(`  ✔ context ${name}: «${outcome.from}» → «${outcome.to}»`),
          );
          changed = true;
        } else {
          log.info(
            chalk.red(
              `  ✖ context ${name}: «${outcome.from}» sin reparar (${outcome.reason})`,
            ),
          );
        }
      }
      if (changed) {
        fs.writeFileSync(css, stringifyWebMCP(map));
        log.info(chalk.green(`\n✔ ${css} reescrito con los selectores reparados`));
      } else {
        log.info('\nno hubo cambios que escribir');
      }
      const report = await validateToolMap(adapter, map);
      printReport(report, log);
      appendEvent({ type: 'repair', target, ok: report.ok, details: { changed } });
      if (!report.ok) process.exitCode = 1;
    } finally {
      await close();
    }
  });

program
  .command('generate')
  .description('genera un .webmcp.css grabando interacciones, o código JS con --api')
  .argument('[target]', 'URL del sitio a grabar')
  .option('-o, --output <file>', 'archivo de salida (defecto: stdout)')
  .option('--api <css>', 'convierte un .webmcp.css en código registerTool()')
  .option('--duration <seconds>', 'segundos de grabación interactiva', '15')
  .option('--ai', 'mejora nombres/descripciones con IA (requiere WEBMCPCSS_AI_API_KEY)')
  .option('--headless', 'graba sin abrir ventana visible')
  .action(
    async (
      target: string | undefined,
      opts: {
        output?: string;
        api?: string;
        duration: string;
        ai?: boolean;
        headless?: boolean;
      },
    ) => {
      const log = logger();
      if (opts.api) {
        const map = parseWebMCPFile(opts.api);
        const code = generateApiScript(map);
        if (opts.output) {
          fs.writeFileSync(opts.output, code);
          log.info(
            chalk.green(
              `✔ ${opts.output} generado (${Object.keys(map.tools).length} herramientas)`,
            ),
          );
        } else {
          log.info(code);
        }
        appendEvent({ type: 'generate', target: opts.api, ok: true });
        return;
      }
      if (!target) {
        log.error('indica una URL para grabar, o usa --api <css>');
        process.exitCode = 1;
        return;
      }
      log.info(
        chalk.cyan(`grabando interacciones en ${target} durante ${opts.duration}s...`),
      );
      log.info('interactúa con la página: cada clic/submit se registra como herramienta');
      const browser = await puppeteer.launch({ headless: Boolean(opts.headless) });
      try {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(RECORDER_SHIM_SOURCE);
        await page.goto(target, { waitUntil: 'domcontentloaded' });
        await new Promise((resolve) => setTimeout(resolve, Number(opts.duration) * 1000));
        const events = (await page.evaluate(() => {
          return (
            (window as unknown as { __WEBMCP_EVENTS__?: unknown[] }).__WEBMCP_EVENTS__ ??
            []
          );
        })) as Parameters<typeof buildToolMapFromEvents>[0];
        const map = buildToolMapFromEvents(events);
        if (opts.ai) {
          const config = loadAiConfig();
          if (!config) {
            log.warn(
              'WEBMCPCSS_AI_API_KEY no configurada: se omiten las sugerencias (ver .env.example)',
            );
          } else {
            const tools = Object.entries(map.tools).map(([name, tool]) => ({
              name,
              hint: `${tool.selector} · ${tool.description ?? ''}`,
            }));
            const suggestions = await suggestToolMetadata(tools, config);
            if (suggestions) {
              for (const s of suggestions) {
                const tool = map.tools[s.name];
                if (!tool) continue;
                if (s.suggestedName && s.suggestedName !== s.name) {
                  delete map.tools[s.name];
                  map.tools[s.suggestedName] = tool;
                }
                if (s.description) tool.description = s.description;
              }
              log.info(chalk.green('✔ sugerencias de IA aplicadas'));
            } else {
              log.warn(
                'la IA no respondió de forma utilizable; se conservan los nombres provisionales',
              );
            }
          }
        }
        const css = stringifyWebMCP(map);
        if (opts.output) {
          fs.writeFileSync(opts.output, css);
          log.info(
            chalk.green(
              `✔ ${opts.output} generado (${Object.keys(map.tools).length} herramientas)`,
            ),
          );
        } else {
          log.info(css);
        }
        appendEvent({
          type: 'generate',
          target,
          ok: true,
          details: { tools: Object.keys(map.tools).length },
        });
      } finally {
        await browser.close();
      }
    },
  );

program
  .command('discover')
  .description('comprueba si un sitio publica su WebMCP (sin navegador)')
  .argument('<url>', 'URL del sitio')
  .action(async (url: string) => {
    const log = logger();
    const result = await discoverWebMCP(url);
    if (result.found) {
      log.info(chalk.green(`✔ ${url} publica su WebMCP`));
      log.info(`  método: ${result.method}`);
      log.info(`  stylesheet: ${result.stylesheet}`);
    } else {
      log.info(chalk.yellow(`✖ ${url} no publica WebMCP (meta, link ni .well-known)`));
      process.exitCode = 1;
    }
    appendEvent({ type: 'discover', target: url, ok: result.found });
  });

program
  .command('inject')
  .description(
    'inyecta el WebMCP de un sitio (descubrimiento → comunidad) en un navegador',
  )
  .argument('<url>', 'URL del sitio')
  .option('--dir <directory>', 'directorio de estilos comunitarios', 'community-styles')
  .option('--json', 'salida JSON para agentes')
  .action(async (url: string, opts: { dir: string; json?: boolean }) => {
    const log = logger();
    const communityDir = fs.existsSync(opts.dir) ? opts.dir : undefined;
    const result = await injectWebMCP(url, { communityDir });
    appendEvent({ type: 'inject', target: url, ok: result.injected });
    if (opts.json) {
      log.info(JSON.stringify(result, null, 2));
    } else if (result.injected) {
      log.info(
        chalk.green(
          `✔ inyectado (${result.source}${result.path ? `: ${result.path}` : ''})`,
        ),
      );
      log.info(
        `  herramientas: ${Object.keys(result.toolMap?.tools ?? {}).join(', ') || '—'}`,
      );
    } else {
      log.info(
        chalk.yellow(`✖ sin WebMCP para ${url} (ni descubrimiento ni community-styles)`),
      );
      process.exitCode = 1;
    }
  });

program
  .command('dashboard')
  .description('dashboard web con herramientas, historial y estadísticas')
  .option('--port <number>', 'puerto HTTP', '3000')
  .option('--css <file>', 'archivo .webmcp.css a visualizar')
  .option(
    '--community-dir <directory>',
    'directorio de estilos comunitarios para la inyección por URL',
    'community-styles',
  )
  .action(async (opts: { port: string; css?: string; communityDir?: string }) => {
    const log = logger();
    const communityDir =
      opts.communityDir && fs.existsSync(opts.communityDir)
        ? opts.communityDir
        : undefined;
    const server = await startDashboard({
      port: Number(opts.port),
      cssPath: opts.css,
      communityDir,
    });
    const address = server.address();
    const url =
      typeof address === 'object' && address
        ? `http://${address.address === '::' ? 'localhost' : address.address}:${address.port}`
        : `http://localhost:${opts.port}`;
    log.info(chalk.green(`🛡️  dashboard: ${url}`));
    log.info('Ctrl+C para detener');
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(chalk.red(`error: ${err.message}`));
  process.exitCode = 1;
});
