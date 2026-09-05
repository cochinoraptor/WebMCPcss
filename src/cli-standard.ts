/**
 * Comando `webmcpcss standard` (v1.1.0): alineación con el estándar WebMCP.
 *
 * - `standard scan <html|url>`: lee los atributos declarativos
 *   (`toolname`/`tooldescription`…) de una página y genera el `.webmcp.css`.
 * - `standard compile <css>`: convierte un `.webmcp.css` en atributos
 *   declarativos (parche JSON, HTML anotado o script en tiempo de ejecución).
 * - `standard check <url>`: comprueba en el navegador dónde expone la página
 *   `modelContext` (`document` / `navigator` obsoleto / ninguna), qué
 *   herramientas registra y qué formularios declara.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Page } from 'puppeteer';
import { parseWebMCPFile, serializeToolMap } from './parser';
import {
  applyDeclarativeToHtml,
  buildDeclarativeRuntimeScript,
  declarativeToolsToToolMap,
  extractDeclarativeTools,
  extractDeclarativeToolsFromDocument,
  modelContextLocation,
  toolMapToDeclarative,
  type DeclarativeScan,
} from './standard';
import { logger } from './utils/logger';
import { installModelContextShim, readRegisteredTools } from './webmcp-api';

/** Dependencias inyectadas desde cli.ts (navegador). */
export interface StandardDeps {
  launchBrowser(headless: boolean): Promise<Browser>;
  navigate(page: Page, url: string): Promise<void>;
}

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const writeOut = (file: string, content: string, quiet: boolean) => {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  if (quiet) console.error(`✔ Escrito ${file}`);
  else logger.success(`Escrito ${chalk.bold(file)}`);
};

/** Lee HTML de una ruta local o de una URL (sin navegador). */
async function readHtml(source: string): Promise<string> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source, { headers: { accept: 'text/html,*/*' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${source}`);
    return await res.text();
  }
  return fs.readFileSync(source, 'utf8');
}

/** Imprime un DeclarativeScan de forma legible. */
function printScan(scan: DeclarativeScan): void {
  if (scan.tools.length === 0) {
    logger.warn(
      'No hay formularios con toolname + tooldescription (API declarativa WebMCP).',
    );
  }
  for (const t of scan.tools) {
    console.log(
      `  ${chalk.green('✔')} ${chalk.bold(t.name)} ${chalk.dim(t.formSelector)}${t.autoSubmit ? chalk.yellow(' · toolautosubmit') : ''} — ${t.description}`,
    );
    for (const p of t.params) {
      console.log(
        `      ${chalk.cyan(p.name)} ${chalk.dim(`${p.inputType}${p.required ? ', required' : ''}`)}${p.description ? ` — ${p.description}` : ''}`,
      );
    }
  }
  for (const w of scan.warnings) logger.warn(w);
}

/**
 * Registra el comando `standard` con sus subcomandos.
 * @param program Instancia de commander.
 * @param deps Navegador.
 */
export function registerStandardCommands(program: Command, deps: StandardDeps): void {
  const std = program
    .command('standard')
    .description(
      'Estándar WebMCP: API declarativa (toolname/tooldescription) ⇄ .webmcp.css y comprobación de document.modelContext',
    );

  std
    .command('scan')
    .description(
      'Lee los atributos declarativos WebMCP de un HTML o URL (sin navegador) y genera el .webmcp.css',
    )
    .argument('<source>', 'archivo HTML o URL')
    .option('-o, --output <file>', 'archivo .webmcp.css de salida')
    .option('--merge <css>', '.webmcp.css existente con el que fusionar (el CSS gana)')
    .option('--json', 'salida JSON')
    .action(
      async (source: string, o: { output?: string; merge?: string; json?: boolean }) => {
        if (!o.json) logger.title('WebMCPcss · standard scan');
        const html = await readHtml(source);
        const scan = extractDeclarativeTools(html);
        const base = o.merge ? parseWebMCPFile(o.merge) : undefined;
        const map = declarativeToolsToToolMap(scan.tools, base);
        if (o.output) writeOut(o.output, serializeToolMap(map), !!o.json);
        if (o.json) return json({ source, ...scan, toolMap: map });
        printScan(scan);
        if (!o.output && scan.tools.length > 0) {
          console.log('');
          console.log(serializeToolMap(map));
        }
      },
    );

  std
    .command('compile')
    .description(
      'Convierte un .webmcp.css en atributos declarativos WebMCP (toolname, tooldescription, toolparamtitle…)',
    )
    .argument('<css>', 'archivo .webmcp.css')
    .option('--html <file>', 'HTML de entrada al que añadir los atributos')
    .option('-o, --output <file>', 'HTML anotado de salida (con --html) o parche JSON')
    .option(
      '--script <file>',
      'escribe un script que aplica los atributos en tiempo de ejecución',
    )
    .option('--force', 'sobrescribe atributos tool* ya presentes en el HTML')
    .option('--json', 'salida JSON')
    .action(
      (
        css: string,
        o: {
          html?: string;
          output?: string;
          script?: string;
          force?: boolean;
          json?: boolean;
        },
      ) => {
        if (!o.json) logger.title('WebMCPcss · standard compile');
        const map = parseWebMCPFile(css);
        const compilation = toolMapToDeclarative(map);
        let applied:
          { applied: string[]; notFound: string[]; fieldsNotFound: string[] } | undefined;
        if (o.html) {
          const res = applyDeclarativeToHtml(
            fs.readFileSync(o.html, 'utf8'),
            compilation,
            {
              force: o.force,
            },
          );
          applied = {
            applied: res.applied,
            notFound: res.notFound,
            fieldsNotFound: res.fieldsNotFound,
          };
          const out = o.output ?? o.html.replace(/(\.html?)?$/i, '.webmcp$1');
          writeOut(out, res.html, !!o.json);
        } else if (o.output) {
          writeOut(o.output, JSON.stringify(compilation, null, 2), !!o.json);
        }
        if (o.script)
          writeOut(o.script, buildDeclarativeRuntimeScript(compilation), !!o.json);
        if (o.json) return json({ css, ...compilation, ...(applied ?? {}) });
        for (const p of compilation.patches) {
          const attrs = Object.entries(p.formAttrs)
            .map(([k, v]) => (v === '' ? k : `${k}="${v}"`))
            .join(' ');
          console.log(
            `  ${chalk.green('✔')} ${chalk.bold(p.tool)} → ${chalk.dim(p.formSelector)}${p.inferred ? chalk.dim(' (closest form)') : ''}`,
          );
          console.log(`      <form ${chalk.cyan(attrs)}>`);
          for (const f of p.fieldAttrs) {
            const fa = Object.entries(f.attrs)
              .map(([k, v]) => `${k}="${v}"`)
              .join(' ');
            console.log(`      ${chalk.dim(f.selector)} ${chalk.cyan(fa)}`);
          }
          if (p.note) console.log(`      ${chalk.yellow('⚠')} ${p.note}`);
          if (p.skipped) console.log(`      ${chalk.yellow('⚠')} ${p.skipped}`);
        }
        if (compilation.imperativeOnly.length > 0) {
          logger.info(
            `Solo API imperativa (no son formularios): ${compilation.imperativeOnly.join(', ')} → webmcpcss generate --api ${css}`,
          );
        }
        if (applied) {
          logger.info(
            `HTML: ${applied.applied.length} formulario(s) anotado(s)${applied.notFound.length ? `; no encontrados: ${applied.notFound.join(', ')}` : ''}`,
          );
          if (applied.fieldsNotFound.length)
            logger.warn(
              `Campos sin localizar por id/name (añade id o name al campo): ${applied.fieldsNotFound.join(', ')}`,
            );
        }
      },
    );

  std
    .command('check')
    .description(
      'Comprueba en el navegador dónde expone la página modelContext, qué herramientas registra y qué formularios declara',
    )
    .argument('<url>', 'URL o archivo HTML')
    .option('--no-headless', 'muestra el navegador')
    .option('--json', 'salida JSON')
    .action(async (url: string, o: { headless: boolean; json?: boolean }) => {
      if (!o.json) logger.title('WebMCPcss · standard check');
      const browser = await deps.launchBrowser(o.headless);
      try {
        const page = await browser.newPage();
        // Antes de navegar: ¿la página encuentra la API por sí misma?
        await page.evaluateOnNewDocument(`(function(){
          var loc = (typeof document !== 'undefined' && document.modelContext) ? 'document'
            : (typeof navigator !== 'undefined' && navigator.modelContext) ? 'navigator' : 'none';
          window.__WEBMCP_NATIVE_LOCATION__ = loc;
        })()`);
        await page.evaluateOnNewDocument(installModelContextShim, undefined as never);
        await deps.navigate(page, url);
        const nativeLocation = (await page.evaluate(
          '(window.__WEBMCP_NATIVE_LOCATION__ || "none")',
        )) as 'document' | 'navigator' | 'none';
        const location = (await page.evaluate(
          `(${modelContextLocation.toString()})(window)`,
        )) as 'document' | 'navigator' | 'none';
        const registered = (await page.evaluate(
          readRegisteredTools,
          undefined as never,
        )) as Array<{ name: string; description?: string }>;
        const declarative = (await page.evaluate(
          `(${extractDeclarativeToolsFromDocument.toString()})(document)`,
        )) as DeclarativeScan;
        // Solo es un problema usar el alias obsoleto SIN el nombre canónico
        // (el patrón recomendado `document.modelContext || navigator.modelContext` es correcto).
        const usesLegacyName = (await page.evaluate(`(function(){
          var scripts = Array.prototype.slice.call(document.scripts);
          return scripts.some(function (s) {
            var t = s.textContent || '';
            return /navigator\\.modelContext/.test(t) && !/document\\.modelContext/.test(t);
          });
        })()`)) as boolean;
        const report = {
          url,
          nativeLocation,
          shimLocation: location,
          imperativeTools: registered,
          declarativeTools: declarative.tools,
          warnings: [
            ...declarative.warnings,
            ...(usesLegacyName
              ? [
                  'La página usa navigator.modelContext en scripts inline: obsoleto desde Chromium 150; usa document.modelContext (con fallback).',
                ]
              : []),
          ],
          agentReady: registered.length > 0 || declarative.tools.length > 0,
        };
        if (o.json) return json(report);
        const locMsg: Record<string, string> = {
          document: chalk.green('document.modelContext (canónico)'),
          navigator: chalk.yellow('solo navigator.modelContext (alias obsoleto)'),
          none: chalk.dim(
            'no disponible en este navegador (normal fuera de Chrome 146+ con WebMCP)',
          ),
        };
        logger.info(`API nativa: ${locMsg[nativeLocation]}`);
        logger.info(
          `Herramientas imperativas registradas por la página: ${chalk.bold(String(registered.length))}`,
        );
        for (const t of registered)
          console.log(
            `  ${chalk.green('✔')} ${chalk.bold(t.name)}${t.description ? ` — ${t.description}` : ''}`,
          );
        logger.info(
          `Formularios declarativos (toolname/tooldescription): ${chalk.bold(String(declarative.tools.length))}`,
        );
        printScan({ tools: declarative.tools, warnings: [] });
        for (const w of report.warnings) logger.warn(w);
        report.agentReady
          ? logger.success('La página expone herramientas WebMCP nativas.')
          : logger.warn(
              'La página no expone herramientas WebMCP: genera un contrato con `webmcpcss generate --auto` y publícalo con `generate --api` o `standard compile`.',
            );
      } finally {
        await browser.close();
      }
    });
}
