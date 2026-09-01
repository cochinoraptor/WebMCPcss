/**
 * Valida los estilos comunitarios: cada `community-styles/*.webmcp.css`
 * debe parsear; si declara `/* @validate-url: ... *​/` y hay navegador
 * disponible, se validan los selectores en vivo.
 *
 * Uso: `npm run validate:community` (tras `npm run build`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { validateToolMap } from '../src/core/validate';
import { parseWebMCPFile } from '../src/parser';

const DIR = path.join(__dirname, '..', '..', 'community-styles');

/**
 * Punto de entrada del script.
 */
async function main(): Promise<void> {
  if (!fs.existsSync(DIR)) {
    console.log('community-styles/ no existe: nada que validar');
    return;
  }
  const files = fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.webmcp.css'))
    .map((f) => path.join(DIR, f));
  if (files.length === 0) {
    console.log('community-styles/ vacío: nada que validar');
    return;
  }

  let failures = 0;
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    try {
      const map = parseWebMCPFile(file);
      const toolCount = Object.keys(map.tools).length;
      const ctxCount = Object.keys(map.context).length;
      console.log(`✔ ${rel} (${toolCount} herramientas, ${ctxCount} contextos)`);

      const css = fs.readFileSync(file, 'utf8');
      const urlMatch = css.match(/@validate-url:\s*(\S+)/);
      if (urlMatch) {
        await validateLive(urlMatch[1], map, rel);
      }
    } catch (err) {
      failures++;
      console.error(`✖ ${rel}: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
}

/**
 * Valida un tool map contra la URL declarada, si hay navegador disponible.
 */
async function validateLive(
  url: string,
  map: ReturnType<typeof parseWebMCPFile>,
  rel: string,
): Promise<void> {
  try {
    const puppeteer = (await import('puppeteer')).default;
    const { PuppeteerAdapter } = await import('../src/adapters/PuppeteerAdapter');
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      const report = await validateToolMap(new PuppeteerAdapter(page), map);
      const broken = report.entries.filter((e) => !e.ok);
      if (broken.length === 0) {
        console.log(`  ⚡ ${rel} en vivo: todo OK`);
      } else {
        for (const entry of broken) {
          console.error(
            `  ✖ ${rel} en vivo: ${entry.name} «${entry.selector}» sin elementos`,
          );
        }
        process.exitCode = 1;
      }
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.warn(
      `  ⚠ ${rel}: validación en vivo omitida (${err instanceof Error ? err.message : 'sin navegador'})`,
    );
  }
}

void main();
