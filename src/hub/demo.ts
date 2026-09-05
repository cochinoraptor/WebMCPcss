/**
 * `webmcpcss components demo`: genera un **sitio de demostración** estático
 * con componentes del hub: `index.html` con todos los componentes, un
 * `webmcp.css` unificado (contratos concatenados), los archivos de cada
 * componente y, si está disponible, el runtime de animaciones. Sirve para
 * probar un agente de punta a punta (`webmcpcss mcp --serve --css demo/webmcp.css`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseAnimations } from '../animation/parser';
import { buildRuntimeScript } from '../animation/runtime-bundle';
import { VERSION } from '../version';
import { LIBRARY_ASSETS } from './site';
import { escapeHtml } from './markdown';
import {
  fetchComponent,
  fetchHubIndex,
  mergeMarker,
  type ComponentFiles,
  type HubClientOptions,
} from './client';
import { CATEGORY_LABELS, LIBRARY_LABELS, type HubLibrary } from './types';

/** Opciones de la demo. */
export interface DemoOptions extends HubClientOptions {
  /** Carpeta destino. */
  output: string;
  /** Librería de los componentes (por defecto `core`). */
  library?: HubLibrary;
  /** Ids concretos (si se indican, se ignora `library`). */
  ids?: string[];
  /** Runtime de animaciones (se intenta cargar del build si falta). */
  animationRuntime?: string;
}

/** Resultado de la demo. */
export interface DemoResult {
  dir: string;
  files: string[];
  components: string[];
  source: 'remote' | 'bundled';
}

/** Intenta cargar el runtime compilado (sin fallar si no hay build). */
function tryRuntime(): string | undefined {
  try {
    return buildRuntimeScript();
  } catch {
    return undefined;
  }
}

/**
 * Genera la demo.
 * @returns Carpeta, archivos escritos e ids incluidos.
 */
export async function buildDemoSite(options: DemoOptions): Promise<DemoResult> {
  const resolved = await fetchHubIndex(options);
  const library = options.library ?? 'core';
  const ids =
    options.ids && options.ids.length
      ? options.ids
      : resolved.index.components
          .filter((c) => c.library === library)
          .sort(
            (a, b) =>
              a.category.localeCompare(b.category) || a.name.localeCompare(b.name),
          )
          .map((c) => c.id);
  if (!ids.length) throw new Error(`No hay componentes para la librería "${library}".`);

  const files: ComponentFiles[] = [];
  for (const id of ids) files.push(await fetchComponent(id, options, resolved));

  const dir = path.resolve(options.output);
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const write = (rel: string, content: string): void => {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content.endsWith('\n') ? content : content + '\n', 'utf8');
    written.push(rel.split(path.sep).join('/'));
  };

  // Archivos por componente + contrato unificado.
  const merged: string[] = [
    `/* WebMCPcss demo · contratos de ${files.length} componente(s) · generado por webmcpcss ${VERSION} */`,
  ];
  const previews = new Set<string>();
  for (const f of files) {
    const base = `components/${f.entry.id}`;
    write(`${base}/${f.meta.css ?? 'component.webmcp.css'}`, f.css);
    write(`${base}/${f.meta.html ?? 'component.html'}`, f.html);
    write(`${base}/component.json`, JSON.stringify(f.meta, null, 2));
    const previewName = (f.meta as { preview?: string }).preview;
    if (f.preview && previewName) {
      write(`${base}/${previewName}`, f.preview);
      previews.add(`${base}/${previewName}`);
    }
    merged.push(
      '',
      mergeMarker(f.entry.id, f.entry.version),
      f.css.trim(),
      `/* @end webmcpcss-component ${f.entry.id} */`,
    );
  }
  const mergedCss = merged.join('\n') + '\n';
  write('webmcp.css', mergedCss);

  // Animaciones declaradas (mapa para el runtime).
  let animationsJson = '';
  try {
    const map = parseAnimations(mergedCss);
    if (Object.keys(map.animations).length)
      animationsJson = JSON.stringify(map).replace(/</g, '\\u003c');
  } catch {
    animationsJson = '';
  }
  const runtime = options.animationRuntime ?? tryRuntime();
  if (runtime && animationsJson) write('webmcp-animation.js', runtime);

  // Librerías usadas.
  const libs = new Set<HubLibrary>(files.map((f) => f.entry.library));
  const head: string[] = [];
  for (const lib of libs) {
    const a = LIBRARY_ASSETS[lib];
    for (const s of a.scripts.filter((x) => /tailwindcss/.test(x)))
      head.push(`<script src="${s}"></script>`);
    if (a.inlineHead) head.push(a.inlineHead);
    for (const s of a.stylesheets) head.push(`<link rel="stylesheet" href="${s}">`);
  }
  const bodyScripts: string[] = [];
  for (const lib of libs) {
    for (const s of LIBRARY_ASSETS[lib].scripts.filter((x) => !/tailwindcss/.test(x)))
      bodyScripts.push(`<script src="${s}"></script>`);
  }

  const sections = files
    .map((f) => {
      const previewName = (f.meta as { preview?: string }).preview;
      return `<section class="demo-block" id="${f.entry.id}" aria-labelledby="h-${f.entry.id}">
  <header>
    <h2 id="h-${f.entry.id}">${escapeHtml(f.entry.name)} <small>${escapeHtml(LIBRARY_LABELS[f.entry.library])} · ${escapeHtml(CATEGORY_LABELS[f.entry.category])} · v${f.entry.version}</small></h2>
    <p>${escapeHtml(f.entry.description)}</p>
    <p class="tools">${f.entry.tools.map((t) => `<code>${escapeHtml(t.name)}</code>`).join(' ')}${f.entry.animations.map((a) => `<code>⟳ ${escapeHtml(a.name)}</code>`).join(' ')}</p>
  </header>
  <div class="demo-stage" data-library="${f.entry.library}">
${previewName ? `    <link rel="stylesheet" href="components/${f.entry.id}/${previewName}">\n` : ''}    <link rel="stylesheet" href="components/${f.entry.id}/${f.meta.css}">
${f.html}
  </div>
</section>`;
    })
    .join('\n\n');

  const indexHtml = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo WebMCPcss · ${files.length} componentes (${[...libs].map((l) => LIBRARY_LABELS[l]).join(', ')})</title>
<meta name="description" content="Sitio de demostración generado con webmcpcss components demo: componentes IA-First con contrato .webmcp.css.">
<meta name="webmcp-hub" content="demo">
<link rel="stylesheet" type="text/css" href="webmcp.css">
${head.join('\n')}
<style>
  :root { color-scheme: light; }
  body { margin: 0; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; background: #f3f4f8; color: #111827; }
  .demo-header { padding: 28px 24px; background: #0b0e14; color: #e8ebf3; }
  .demo-header h1 { margin: 0 0 6px; font-size: 24px; }
  .demo-header p { margin: 0; color: #98a2b8; font-size: 14px; }
  .demo-header code { color: #4fd1c5; }
  .demo-nav { display: flex; flex-wrap: wrap; gap: 6px; padding: 12px 24px; background: #fff; border-bottom: 1px solid #e5e7eb; position: sticky; top: 0; z-index: 10; }
  .demo-nav a { font-size: 13px; color: #374151; text-decoration: none; padding: 4px 10px; border: 1px solid #e5e7eb; border-radius: 999px; }
  .demo-nav a:hover { border-color: #7c6cf0; color: #7c6cf0; }
  main { max-width: 1080px; margin: 0 auto; padding: 24px; display: grid; gap: 28px; }
  .demo-block { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; overflow: hidden; }
  .demo-block > header { padding: 16px 20px; border-bottom: 1px solid #eef0f4; }
  .demo-block h2 { margin: 0 0 4px; font-size: 18px; }
  .demo-block h2 small { font-weight: 500; color: #6b7280; font-size: 12px; margin-left: 8px; }
  .demo-block header p { margin: 0; color: #6b7280; font-size: 14px; }
  .demo-block .tools { margin-top: 6px; }
  .demo-block .tools code { font-size: 12px; background: #eef2ff; color: #4338ca; padding: 1px 6px; border-radius: 6px; }
  .demo-stage { padding: 24px; display: flex; justify-content: center; }
  .demo-stage > * { max-width: 100%; }
  .demo-log { position: fixed; right: 16px; bottom: 16px; max-width: 360px; background: #111827; color: #fff; padding: 10px 14px; border-radius: 10px; font-size: 13px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  .demo-log.show { opacity: 1; }
  footer { text-align: center; color: #6b7280; font-size: 13px; padding: 20px; }
</style>
</head>
<body>
<header class="demo-header">
  <h1>Demo WebMCPcss · Component Hub</h1>
  <p>${files.length} componente(s) con contrato IA-First. Sirve el contrato unificado a los agentes: <code>npx webmcpcss mcp --serve --css ./webmcp.css --url http://localhost:PUERTO</code></p>
</header>
<nav class="demo-nav" aria-label="Componentes">
${files.map((f) => `  <a href="#${f.entry.id}">${escapeHtml(f.entry.name)}</a>`).join('\n')}
</nav>
<main>
${sections}
</main>
<footer>Generado con <code>webmcpcss components demo</code> · v${VERSION} · MIT</footer>
<div class="demo-log" id="demo-log" role="status" aria-live="polite"></div>
${bodyScripts.join('\n')}
${runtime && animationsJson ? `<script src="webmcp-animation.js"></script>\n<script>window.__WEBMCP_ANIMATIONS__ = ${animationsJson};</script>` : ''}
<script>
(function () {
  var log = document.getElementById('demo-log');
  function show(msg) { log.textContent = msg; log.classList.add('show'); clearTimeout(log._t); log._t = setTimeout(function () { log.classList.remove('show'); }, 2200); }
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-tool]');
    if (!el) return;
    if (el.tagName === 'A') ev.preventDefault();
    show('Herramienta → ' + el.getAttribute('data-tool'));
  });
  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    show('Formulario → ' + (ev.target.getAttribute('toolname') || 'submit'));
  });
  if (window.__WEBMCP_ANIMATIONS__ && window.webmcpcss && window.webmcpcss.animation) {
    window.addEventListener('load', function () {
      try { window.webmcpcss.animation.run(window.__WEBMCP_ANIMATIONS__, { strategy: 'queue' }); } catch (e) { /* motor no disponible */ }
    });
  }
})();
</script>
</body>
</html>
`;
  write('index.html', indexHtml);
  write(
    'README.md',
    `# Demo WebMCPcss\n\nGenerada con \`webmcpcss components demo\` (v${VERSION}).\n\n- \`index.html\` — todos los componentes.\n- \`webmcp.css\` — contratos concatenados (bloques \`@webmcpcss-component\`).\n- \`components/<id>/\` — archivos de cada componente.\n${runtime && animationsJson ? '- `webmcp-animation.js` — runtime de animaciones.\n' : ''}\n## Probar con un agente\n\n\`\`\`bash\nnpx serve .                      # o cualquier servidor estático\nnpx webmcpcss mcp --serve --css ./webmcp.css --url http://localhost:3000\n\`\`\`\n\nComponentes: ${files.map((f) => `\`${f.entry.id}\``).join(', ')}.\n`,
  );
  return {
    dir,
    files: written,
    components: files.map((f) => f.entry.id),
    source: resolved.source,
  };
}
