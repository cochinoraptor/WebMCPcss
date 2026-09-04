#!/usr/bin/env node
/**
 * Demo de `webmcpcss prompt`: aplica una secuencia de órdenes en lenguaje
 * natural sobre la tienda de ejemplo (examples/shopping-cart) usando la API
 * de librería, y guarda una captura tras cada paso.
 *
 * Uso (desde la raíz del repositorio, tras `npm run build`):
 *   node examples/prompt/run-demo.js            # heurística, sin LLM
 *   WEBMCP_LLM_PROVIDER=ollama node examples/prompt/run-demo.js
 *
 * Salida: examples/prompt/output/NN-<accion>.png + resultados.json
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const puppeteer = require('puppeteer');
const {
  parseWebMCPFile,
  PuppeteerAdapter,
  PromptManager,
  createLlmClient,
} = require('../../dist/src');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGE = `file://${path.join(ROOT, 'examples', 'shopping-cart', 'index.html')}`;
const CSS = path.join(ROOT, 'examples', 'shopping-cart', 'webmcp.css');
const OUT = path.join(__dirname, 'output');

/** Órdenes a ejecutar en orden. `files` se usa para las acciones de subida. */
const STEPS = [
  { prompt: 'cambia el color del botón Añadir al carrito a verde' },
  { prompt: 'pon la cantidad en 3' },
  { prompt: 'escribe "DESCUENTO10" en el campo cupón' },
  { prompt: 'haz el título más grande' },
  { prompt: 'mueve el precio debajo del botón Añadir al carrito' },
  { prompt: 'oculta el header' },
  { prompt: 'haz clic en Añadir al carrito' }, // → herramienta addToCart del .webmcp.css
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const llm = createLlmClient(); // null si no hay WEBMCP_LLM_PROVIDER → heurística
  console.log(
    `LLM: ${llm ? `${llm.provider}/${llm.model}` : 'ninguno (intérprete heurístico)'}`,
  );

  const browser = await puppeteer.launch({ headless: true });
  const results = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1100, height: 800 });
    await page.goto(PAGE, { waitUntil: 'load' });

    const manager = new PromptManager(new PuppeteerAdapter(page), {
      toolMap: parseWebMCPFile(CSS),
      llm,
      url: PAGE,
      title: await page.title(),
    });

    for (const [i, step] of STEPS.entries()) {
      const n = String(i + 1).padStart(2, '0');
      const r = await manager.run(step.prompt, {
        files: step.files,
        historyFile: path.join(os.tmpdir(), 'webmcpcss-demo-history.json'),
      });
      const shot = path.join(OUT, `${n}-${r.action.action}.png`);
      await page.screenshot({ path: shot });
      const mark = r.success ? '✔' : '✖';
      console.log(
        `${mark} [${n}] "${step.prompt}" → ${r.action.action} ` +
          `(${r.match ? r.match.selector + ' vía ' + r.match.strategy : 'sin elemento'}) ` +
          `${r.outcome ? r.outcome.message : r.error || ''}`,
      );
      if (!r.success && r.suggestions && r.suggestions.length) {
        console.log(`    Sugerencias: ${r.suggestions.join(' | ')}`);
      }
      results.push({ step: i + 1, prompt: step.prompt, result: r, screenshot: shot });
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(OUT, 'resultados.json'), JSON.stringify(results, null, 2));
  const ok = results.filter((r) => r.result.success).length;
  console.log(`\n${ok}/${results.length} órdenes aplicadas. Capturas en ${OUT}`);
  process.exitCode = ok === results.length ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
