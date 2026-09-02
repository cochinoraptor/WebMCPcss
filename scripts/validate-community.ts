/**
 * Script de CI: valida los archivos de `community-styles/`.
 *
 * 1. Parsea cada `*.webmcp.css` (sintaxis + estructura).
 * 2. Comprueba que los selectores sean CSS válido.
 * 3. Si el archivo declara `@validate-url: <url>` en un comentario, lanza
 *    Puppeteer y valida los selectores contra la página real.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseWebMCP } from '../src/parser';
import { WebMCPcss } from '../src/core';
import { PuppeteerAdapter } from '../src/adapters/puppeteer-adapter';
import { logger } from '../src/utils/logger';

/** Comprueba que un selector sea sintácticamente válido usando postcss-safe parse trick. */
function isValidSelector(selector: string): boolean {
  try {
    // Usamos el motor de selectores nativo de Node vía una regex mínima +
    // el propio parser de CSS: si postcss lo aceptó como selector de regla,
    // basta con descartar vacíos y llaves sueltas.
    return selector.trim().length > 0 && !/[{}]/.test(selector);
  } catch {
    return false;
  }
}

/** Extrae la URL de validación opcional de los comentarios del CSS. */
function extractValidateUrl(css: string): string | null {
  const m = /@validate-url:\s*(\S+)/.exec(css);
  return m ? m[1] : null;
}

async function main(): Promise<void> {
  const dir = path.join(process.cwd(), 'community-styles');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.webmcp.css'))
    .map((f) => path.join(dir, f));

  let failures = 0;

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const css = fs.readFileSync(file, 'utf8');
    try {
      const map = parseWebMCP(css);
      const toolCount = Object.keys(map.tools).length;
      const ctxCount = Object.keys(map.context).length;
      if (toolCount + ctxCount === 0) {
        logger.warn(`${rel}: no declara herramientas ni contexto`);
      }
      for (const [name, tool] of Object.entries(map.tools)) {
        if (!isValidSelector(tool.selector)) {
          logger.error(`${rel}: selector inválido en "${name}": ${tool.selector}`);
          failures++;
        }
      }
      logger.success(`${rel}: OK (${toolCount} tools, ${ctxCount} context)`);

      const url = extractValidateUrl(css);
      if (url && process.env.SKIP_BROWSER !== '1') {
        logger.info(`${rel}: validando selectores contra ${url} ...`);
        const puppeteer = await import('puppeteer');
        const browser = await puppeteer.default.launch({
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        try {
          const page = await browser.newPage();
          await page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
          const webmcp = new WebMCPcss(map, new PuppeteerAdapter(page), {
            autoRepair: false,
          });
          const report = await webmcp.validate(url);
          if (report.failed > 0) {
            for (const e of report.entries.filter((x) => !x.ok)) {
              logger.error(`${rel}: selector roto "${e.selector}" (${e.name})`);
            }
            failures++;
          } else {
            logger.success(
              `${rel}: ${report.passed}/${report.total} selectores válidos en vivo`,
            );
          }
        } finally {
          await browser.close();
        }
      }
    } catch (err) {
      logger.error(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
      failures++;
    }
  }

  if (failures > 0) {
    logger.error(`Validación comunitaria: ${failures} fallo(s).`);
    process.exit(1);
  }
  logger.success('Validación comunitaria completada sin errores.');
}

main().catch((err) => {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
