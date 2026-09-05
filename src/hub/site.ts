/**
 * Generador del **sitio estático** del Component Hub (HTML + CSS + JS vanilla,
 * sin frameworks ni dependencias). Produce, bajo la carpeta `site/`:
 *
 * ```
 * components/                     → inicio del hub
 * components/catalog/             → catálogo con filtros y búsqueda en vivo
 * components/search/              → búsqueda
 * components/favorites/           → favoritos (localStorage)
 * components/docs/…               → documentación (desde docs/hub/*.md)
 * components/about/               → acerca de
 * components/<id>/                → detalle: preview, editor en vivo, código, ejemplos
 * components/<id>/preview.html    → contenido del iframe de previsualización
 * components/<id>/<archivos>      → .webmcp.css, .html, component.json, preview.css
 * components/assets/…             → hub.css, hub.js, preview.css/js, index.js, runtime
 * api/components.json             → índice público para agentes y la CLI
 * api/schema/components.json      → JSON Schema del índice
 * ```
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseAnimations } from '../animation/parser';
import { VERSION } from '../version';
import { HUB_CSS, HUB_JS, PREVIEW_CSS, PREVIEW_JS } from './assets';
import {
  DEFAULT_HUB_URL,
  META_FILE,
  buildHubIndex,
  hubIndexSchema,
  loadHub,
  sortForCatalog,
} from './loader';
import { escapeHtml, renderMarkdownDoc, slugify } from './markdown';
import {
  CATEGORY_LABELS,
  HUB_CATEGORIES,
  HUB_LIBRARIES,
  LIBRARY_LABELS,
  type ComponentMeta,
  type HubCategory,
  type HubComponent,
  type HubIndex,
  type HubLibrary,
} from './types';

/** Opciones del generador. */
export interface BuildSiteOptions {
  /** Carpeta `components/` de origen. */
  componentsDir: string;
  /** Carpeta `site/` de destino (se escriben `components/` y `api/` dentro). */
  siteDir: string;
  /** Carpeta con `getting-started.md`, `component-usage.md`, `contributing.md`. */
  docsDir?: string;
  /** URL pública absoluta del sitio (sin barra final). */
  baseUrl?: string;
  /** Fecha fija para `generatedAt` (salida determinista en tests/CI). */
  generatedAt?: string;
  /** Código del runtime de animaciones (`buildRuntimeScript()`), si está disponible. */
  animationRuntime?: string;
  /** Repositorio para enlaces "ver en GitHub". */
  repoUrl?: string;
}

/** Resultado del generador. */
export interface BuildSiteResult {
  files: string[];
  components: number;
  warnings: string[];
  index: HubIndex;
}

/** Recursos CDN por librería para la previsualización. */
export const LIBRARY_ASSETS: Record<
  HubLibrary,
  { stylesheets: string[]; scripts: string[]; inlineHead?: string; note?: string }
> = {
  core: { stylesheets: [], scripts: [] },
  tailwind: {
    stylesheets: [],
    scripts: ['https://cdn.tailwindcss.com'],
    note: 'La previsualización usa el Play CDN de Tailwind; en producción compila tus utilidades como siempre.',
  },
  bootstrap: {
    stylesheets: [
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
    ],
    scripts: [
      'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
    ],
  },
  mui: {
    stylesheets: [
      'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
    ],
    scripts: [],
    note: 'La previsualización emula el DOM y los estilos que renderiza Material UI; en tu app React usa los componentes de @mui/material y pasa los atributos data-* como props.',
  },
  shadcn: {
    stylesheets: [],
    scripts: ['https://cdn.tailwindcss.com'],
    inlineHead: `<script>tailwind.config={darkMode:'class',theme:{extend:{colors:{border:'var(--border)',input:'var(--input)',ring:'var(--ring)',background:'var(--background)',foreground:'var(--foreground)',primary:{DEFAULT:'var(--primary)',foreground:'var(--primary-foreground)'},secondary:{DEFAULT:'var(--secondary)',foreground:'var(--secondary-foreground)'},destructive:{DEFAULT:'var(--destructive)',foreground:'#fff'},muted:{DEFAULT:'var(--muted)',foreground:'var(--muted-foreground)'},accent:{DEFAULT:'var(--accent)',foreground:'var(--accent-foreground)'},popover:{DEFAULT:'var(--popover)',foreground:'var(--popover-foreground)'},card:{DEFAULT:'var(--card)',foreground:'var(--card-foreground)'}},borderRadius:{lg:'var(--radius)',md:'calc(var(--radius) - 2px)',sm:'calc(var(--radius) - 4px)'}}}}</script>`,
    note: 'La previsualización usa el Play CDN de Tailwind con los tokens de tema de shadcn/ui (zinc); en tu proyecto ya existen en globals.css.',
  },
};

const REPO_URL = 'https://github.com/cochinoraptor/WebMCPcss';

/** Iconos SVG inline. */
const ICONS = {
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  copy: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
};

interface PageOptions {
  title: string;
  description: string;
  /** Profundidad respecto a `components/` (0 = components/index.html). */
  depth: number;
  active?: 'home' | 'catalog' | 'search' | 'favorites' | 'docs' | 'about';
  body: string;
  jsonLd?: unknown[];
  extraHead?: string;
  bodyAttrs?: string;
  /** Ruta canónica relativa a `components/` (para og:url). */
  pathRel: string;
  ctx: Ctx;
}

interface Ctx {
  baseUrl: string;
  hubUrl: string;
  repoUrl: string;
  index: HubIndex;
  components: HubComponent[];
}

/** Plantilla de página. */
function page(o: PageOptions): string {
  const rel = '../'.repeat(o.depth);
  const siteRoot = rel + '../';
  const nav = (id: PageOptions['active'], href: string, label: string) =>
    `<a href="${rel}${href}"${o.active === id ? ' aria-current="page"' : ''}>${label}</a>`;
  const jsonLd = (o.jsonLd ?? [])
    .map(
      (j) =>
        `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`,
    )
    .join('\n');
  const canonical = `${o.ctx.hubUrl}/${o.pathRel}`;
  return `<!doctype html>
<html lang="es" data-hub-base="${rel}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(o.title)} · WebMCPcss Component Hub</title>
<meta name="description" content="${escapeHtml(o.description)}">
<meta name="webmcp-hub" content="true">
<meta name="webmcp-hub-version" content="${VERSION}">
<meta name="webmcp-hub-index" content="${o.ctx.baseUrl}/api/components.json">
<meta name="generator" content="webmcpcss ${VERSION}">
<meta name="theme-color" content="#0b0e14">
<meta property="og:title" content="${escapeHtml(o.title)} · WebMCPcss Component Hub">
<meta property="og:description" content="${escapeHtml(o.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${o.ctx.baseUrl}/logo.png">
<link rel="canonical" href="${canonical}">
<link rel="alternate" type="application/json" title="Índice de componentes" href="${rel}../api/components.json">
<link rel="icon" type="image/png" href="${siteRoot}favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${rel}assets/hub.css">
${o.extraHead ?? ''}
${jsonLd}
</head>
<body${o.bodyAttrs ? ' ' + o.bodyAttrs : ''}>
<a class="skip" href="#main">Saltar al contenido</a>
<div class="grid-bg" aria-hidden="true"></div><div class="glow a" aria-hidden="true"></div><div class="glow b" aria-hidden="true"></div>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${rel}"><img src="${siteRoot}logo.png" alt="" width="30" height="30">WebMCP<em>css</em><span class="hub">Component Hub</span></a>
    <nav class="site-nav" aria-label="Principal">
      ${nav('home', '', 'Inicio')}
      ${nav('catalog', 'catalog/', 'Catálogo')}
      ${nav('search', 'search/', 'Buscar')}
      ${nav('favorites', 'favorites/', 'Favoritos <span class="n">(<span data-fav-count>0</span>)</span>')}
      ${nav('docs', 'docs/', 'Docs')}
      ${nav('about', 'about/', 'Acerca de')}
      <a class="gh" href="${o.ctx.repoUrl}" target="_blank" rel="noopener">GitHub ↗</a>
    </nav>
  </div>
</header>
<main id="main" class="wrap">
${o.body}
</main>
<footer>
  <div class="wrap">
    <span>WebMCPcss Component Hub · v${VERSION} · MIT</span>
    <nav aria-label="Pie">
      <a href="${siteRoot}">WebMCPcss</a>
      <a href="${rel}../api/components.json">API JSON</a>
      <a href="${o.ctx.repoUrl}/tree/main/components" target="_blank" rel="noopener">Fuente de los componentes</a>
      <a href="https://www.npmjs.com/package/webmcpcss" target="_blank" rel="noopener">npm</a>
    </nav>
  </div>
</footer>
<script src="${rel}assets/index.js" defer></script>
<script src="${rel}assets/hub.js" defer></script>
</body>
</html>
`;
}

/** Botón de copiar. */
function copyButton(text: string, label = 'Copiar', cls = 'btn small'): string {
  return `<button type="button" class="${cls}" data-copy="${escapeHtml(text)}" aria-label="${escapeHtml(label)}">${ICONS.copy} ${escapeHtml(label)}</button>`;
}

/** Botón de copiar el contenido de un elemento. */
function copyTargetButton(
  selector: string,
  label = 'Copiar',
  cls = 'btn small copy-abs',
): string {
  return `<button type="button" class="${cls}" data-copy-target="${escapeHtml(selector)}" aria-label="${escapeHtml(label)}">${ICONS.copy} ${escapeHtml(label)}</button>`;
}

/** Chips de filtro. */
function filterChips(index: HubIndex): string {
  const chips = (
    kind: 'category' | 'library',
    items: Array<{ id: string; label: string; count: number }>,
  ) =>
    items
      .map(
        (it) =>
          `<button type="button" class="chip" data-filter="${kind}" data-value="${it.id}" aria-pressed="false">${escapeHtml(it.label)}<span class="n">${it.count}</span></button>`,
      )
      .join('');
  return `<div class="toolbar" role="group" aria-label="Filtros">
  <div class="chips" aria-label="Categoría">${chips('category', index.categories)}</div>
</div>
<div class="toolbar" role="group" aria-label="Librería">
  <div class="chips">${chips('library', index.libraries)}</div>
  <button type="button" class="btn small" id="clear-filters">Limpiar filtros</button>
</div>`;
}

/** Caja de búsqueda. */
function searchBox(autofocus = false): string {
  return `<form class="search" role="search" onsubmit="return false">
  <label class="sr-only" for="search-input">Buscar componentes</label>
  ${ICONS.search}
  <input id="search-input" type="search" placeholder="Buscar: botón, checkout, tailwind, parallax…" autocomplete="off"${autofocus ? ' autofocus' : ''}>
</form>`;
}

/** Página de inicio. */
function homePage(ctx: Ctx): string {
  const { index } = ctx;
  const featuredIds = [
    'tailwind-button-primary',
    'core-checkout-form',
    'shadcn-product-card',
    'core-hero-section',
    'bootstrap-login-form',
    'core-parallax-scene',
  ];
  const featured = featuredIds
    .map((id) => index.components.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c));
  const tools = index.components.reduce((n, c) => n + c.tools.length, 0);
  const body = `
<section class="hero">
  <span class="eyebrow">Catálogo IA-First · v${VERSION}</span>
  <h1>Componentes que <em>hablan con agentes</em>, listos para tu librería.</h1>
  <p class="lead">Cada componente trae su HTML, su <code>.webmcp.css</code> (el contrato que describe qué puede hacer un agente) y metadatos para Tailwind, Bootstrap, Material UI, shadcn/ui o CSS puro. Previsualiza, edita en vivo, copia e importa con un comando.</p>
  <div class="actions">
    <a class="btn primary" href="catalog/">Explorar el catálogo</a>
    <a class="btn" href="docs/getting-started/">Empezar en 2 minutos</a>
    ${copyButton('npx webmcpcss components list', 'npx webmcpcss components list', 'btn mono')}
  </div>
  <div class="stats" aria-label="Cifras del hub">
    <div><strong>${index.components.length}</strong><span>componentes</span></div>
    <div><strong>${index.libraries.length}</strong><span>librerías</span></div>
    <div><strong>${index.categories.length}</strong><span>categorías</span></div>
    <div><strong>${tools}</strong><span>herramientas declaradas</span></div>
  </div>
</section>

<section class="section" aria-labelledby="h-cats">
  <h2 id="h-cats">Categorías</h2>
  <div class="tiles">
    ${index.categories
      .map(
        (c) =>
          `<a class="tile" href="catalog/?category=${c.id}"><strong>${escapeHtml(c.label)}</strong><span>${c.count} componentes</span></a>`,
      )
      .join('\n    ')}
  </div>
</section>

<section class="section" aria-labelledby="h-libs">
  <h2 id="h-libs">Librerías</h2>
  <div class="tiles">
    ${index.libraries
      .map(
        (l) =>
          `<a class="tile" href="catalog/?library=${l.id}"><strong>${escapeHtml(l.label)}</strong><span>${l.count} componentes</span></a>`,
      )
      .join('\n    ')}
  </div>
</section>

<section class="section" aria-labelledby="h-feat">
  <h2 id="h-feat">Destacados</h2>
  <div class="cards" id="featured-grid">
    ${featured.map((c) => cardStatic(c, '')).join('\n    ')}
  </div>
</section>

<section class="section" aria-labelledby="h-how">
  <h2 id="h-how">Cómo funciona</h2>
  <ol class="steps">
    <li><strong>Elige</strong> un componente y ajústalo en el editor en vivo (color, radio, animación).
      <pre><code>npx webmcpcss components list --library tailwind</code></pre></li>
    <li><strong>Impórtalo</strong>: se copian el HTML, el <code>.webmcp.css</code> y <code>component.json</code> a tu proyecto y se registra la versión.
      <pre><code>npx webmcpcss components import tailwind-button-primary --output ./src/components</code></pre></li>
    <li><strong>Sírvelo a los agentes</strong>: el contrato se expone por MCP, por <code>document.modelContext</code> o por la API declarativa de WebMCP.
      <pre><code>npx webmcpcss mcp --serve --css ./src/components/tailwind-button-primary/button-primary.webmcp.css --hub</code></pre></li>
    <li><strong>Mantenlo al día</strong> y comparte los tuyos.
      <pre><code>npx webmcpcss components update
npx webmcpcss components publish ./mi-boton.webmcp.css --name "Mi botón" --category buttons</code></pre></li>
  </ol>
</section>

<section class="section" aria-labelledby="h-agents">
  <h2 id="h-agents">Para agentes</h2>
  <p class="lead">Este sitio declara <code>&lt;meta name="webmcp-hub"&gt;</code>, JSON-LD y un índice legible por máquinas. Un agente MCP puede descubrir e importar componentes con las herramientas <code>list_components</code>, <code>get_component</code> e <code>import_component</code> del servidor <code>webmcpcss mcp --serve --hub</code>, o leer directamente:</p>
  <div class="import"><code>${ctx.baseUrl}/api/components.json</code>${copyButton(`${ctx.baseUrl}/api/components.json`)}</div>
</section>`;
  return page({
    title: 'Inicio',
    description: `Catálogo de ${index.components.length} componentes IA-First (botones, tarjetas, formularios, layout, animaciones e inteligentes) con contrato .webmcp.css para Tailwind, Bootstrap, MUI, shadcn/ui y CSS puro.`,
    depth: 0,
    active: 'home',
    body,
    pathRel: '',
    ctx,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'WebMCPcss Component Hub',
        url: `${ctx.hubUrl}/`,
        description:
          'Catálogo de componentes IA-First con contrato .webmcp.css para agentes.',
        potentialAction: {
          '@type': 'SearchAction',
          target: `${ctx.hubUrl}/search/?q={search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'webmcpcss',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Node.js 18+',
        softwareVersion: VERSION,
        license: 'https://opensource.org/licenses/MIT',
        downloadUrl: 'https://www.npmjs.com/package/webmcpcss',
        codeRepository: ctx.repoUrl,
      },
    ],
  });
}

/** Tarjeta estática (sin JS) para inicio/relacionados. */
function cardStatic(c: HubIndex['components'][number], rel: string): string {
  const tools = (c.tools.length ? c.tools : c.animations)
    .slice(0, 3)
    .map((t) => `<code>${escapeHtml(t.name)}</code>`)
    .join('');
  return `<article class="card" data-id="${c.id}">
  <div class="card-top"><div class="badges"><span class="badge cat">${escapeHtml(CATEGORY_LABELS[c.category])}</span><span class="badge lib">${escapeHtml(LIBRARY_LABELS[c.library])}</span></div>
  <button class="btn small icon fav" type="button" data-fav="${c.id}" data-name="${escapeHtml(c.name)}" aria-pressed="false"><span class="star" aria-hidden="true">☆</span></button></div>
  <h3><a href="${rel}${c.id}/">${escapeHtml(c.name)}</a></h3>
  <p>${escapeHtml(c.description)}</p>
  <div class="tools">${tools}</div>
</article>`;
}

/** Catálogo. */
function catalogPage(ctx: Ctx): string {
  const { index } = ctx;
  const body = `
<span class="eyebrow">Catálogo</span>
<h1>Todos los componentes</h1>
<p class="lead">Filtra por categoría y librería o busca en vivo. Los resultados se actualizan al escribir y la URL guarda tus filtros.</p>
<div class="toolbar">${searchBox()}</div>
${filterChips(index)}
<p class="results-meta" id="results-meta" aria-live="polite">${index.components.length} componentes</p>
<div class="cards" id="catalog-grid" aria-live="polite">
  ${sortForCatalog(ctx.components)
    .map((c) =>
      cardStatic(
        index.components.find((e) => e.id === c.id)!,
        '../',
      ),
    )
    .join('\n  ')}
</div>`;
  return page({
    title: 'Catálogo',
    description:
      'Catálogo completo con filtros por categoría y librería y búsqueda en vivo.',
    depth: 1,
    active: 'catalog',
    body,
    pathRel: 'catalog/',
    ctx,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'WebMCPcss Component Hub — catálogo',
        numberOfItems: index.components.length,
        itemListElement: index.components.map((c, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: c.name,
          url: `${ctx.hubUrl}/${c.id}/`,
        })),
      },
    ],
  });
}

/** Búsqueda. */
function searchPage(ctx: Ctx): string {
  const body = `
<span class="eyebrow">Búsqueda</span>
<h1>Encuentra un componente</h1>
<p class="lead">Busca por nombre, herramienta (<code>addToCart</code>), categoría, librería o etiqueta. También puedes usar la CLI: <code>npx webmcpcss components list --search "checkout"</code>.</p>
<div class="toolbar">${searchBox(true)}</div>
${filterChips(ctx.index)}
<p class="results-meta" id="results-meta" aria-live="polite"></p>
<div class="cards" id="catalog-grid" aria-live="polite"></div>`;
  return page({
    title: 'Buscar',
    description: 'Búsqueda en vivo de componentes IA-First.',
    depth: 1,
    active: 'search',
    body,
    pathRel: 'search/',
    ctx,
  });
}

/** Favoritos. */
function favoritesPage(ctx: Ctx): string {
  const body = `
<span class="eyebrow">Favoritos</span>
<h1>Tus componentes guardados</h1>
<p class="lead">Se guardan en tu navegador (localStorage). Copia el comando para importarlos todos de golpe.</p>
<div class="import" hidden><code id="favorites-import"></code>${copyTargetButton('#favorites-import', 'Copiar comando', 'btn small')}</div>
<div class="cards" id="favorites-grid" aria-live="polite" style="margin-top:16px"></div>`;
  return page({
    title: 'Favoritos',
    description: 'Componentes marcados como favoritos.',
    depth: 1,
    active: 'favorites',
    body,
    pathRel: 'favorites/',
    ctx,
    bodyAttrs: 'data-page="favorites"',
  });
}

/** Acerca de. */
function aboutPage(ctx: Ctx): string {
  const body = `
<article class="prose" style="max-width:820px">
<span class="eyebrow">Acerca de</span>
<h1>Un catálogo pensado para personas <em>y</em> agentes</h1>
<p>El <strong>WebMCPcss Component Hub</strong> reúne componentes de interfaz cuyo comportamiento para agentes de IA está declarado en un archivo <code>.webmcp.css</code>: qué herramientas expone (<code>webmcp-tool</code>), con qué parámetros, qué intención tienen, si requieren confirmación y qué datos de contexto publican. El mismo archivo es CSS válido, así que puede convivir con tu hoja de estilos.</p>
<h2>Qué encontrarás</h2>
<ul>
  <li><strong>Adaptadores</strong> para Tailwind CSS, Bootstrap 5, Material UI y shadcn/ui, más una versión <em>core</em> sin dependencias.</li>
  <li><strong>Componentes inteligentes</strong> con permisos, límites de uso, confirmación y animaciones declarativas (parallax, 2.5D con Three.js).</li>
  <li><strong>Metadatos</strong> (<code>component.json</code>) con controles del editor, ejemplos de prompts y componentes relacionados.</li>
</ul>
<h2>Cómo está hecho</h2>
<p>El sitio es 100 % estático y se genera con <code>npm run build:hub</code> a partir de la carpeta <a href="${ctx.repoUrl}/tree/main/components" target="_blank" rel="noopener"><code>components/</code></a> del repositorio, sin frameworks: HTML, CSS y JavaScript vanilla. Cada página incluye <code>&lt;meta name="webmcp-hub"&gt;</code>, JSON-LD y, si el navegador soporta WebMCP, registra en <code>document.modelContext</code> las herramientas <code>searchComponents</code>, <code>getComponent</code> y <code>toggleFavorite</code> para que un agente pueda navegar el catálogo.</p>
<h2>Accesibilidad</h2>
<p>Navegación por teclado (pestañas con flechas, enlace "saltar al contenido"), estados <code>aria-pressed</code>/<code>aria-selected</code>, regiones <code>aria-live</code> para los resultados y respeto de <code>prefers-reduced-motion</code>. Los componentes declaran <code>webmcp-accessibility</code> con sus requisitos mínimos.</p>
<h2>Licencia y contribuciones</h2>
<p>Todo el contenido es MIT. Publica tu componente con <code>npx webmcpcss components publish</code> (abre un Pull Request automáticamente) o lee la <a href="../docs/contributing/">guía de contribución</a>.</p>
<p><a class="btn" href="${ctx.repoUrl}" target="_blank" rel="noopener">Repositorio en GitHub ↗</a> <a class="btn" href="https://www.npmjs.com/package/webmcpcss" target="_blank" rel="noopener">webmcpcss en npm ↗</a></p>
</article>`;
  return page({
    title: 'Acerca de',
    description: 'Qué es el WebMCPcss Component Hub, cómo está hecho y cómo contribuir.',
    depth: 1,
    active: 'about',
    body,
    pathRel: 'about/',
    ctx,
  });
}

/** Documentos disponibles (orden del menú). */
const DOCS: Array<{ slug: string; file: string; title: string }> = [
  { slug: 'getting-started', file: 'getting-started.md', title: 'Primeros pasos' },
  { slug: 'component-usage', file: 'component-usage.md', title: 'Uso de componentes' },
  { slug: 'contributing', file: 'contributing.md', title: 'Contribuir' },
];

/** Páginas de documentación. */
function docsPages(
  ctx: Ctx,
  docsDir: string | undefined,
  out: Map<string, string>,
): void {
  const available = DOCS.filter(
    (d) => docsDir && fs.existsSync(path.join(docsDir, d.file)),
  );
  const sidebar = (
    active: string,
    toc: Array<{ level: number; text: string; id: string }>,
    depth: number,
  ) => `
<aside aria-label="Documentación">
  <h4>Guías</h4>
  ${available
    .map(
      (d) =>
        `<a href="${'../'.repeat(depth - 1)}${d.slug}/"${d.slug === active ? ' aria-current="page"' : ''}>${escapeHtml(d.title)}</a>`,
    )
    .join('\n  ')}
  ${
    toc.length
      ? `<h4>En esta página</h4><div class="toc">${toc
          .filter((h) => h.level === 2)
          .map((h) => `<a href="#${h.id}">${escapeHtml(h.text)}</a>`)
          .join('')}</div>`
      : ''
  }
  <h4>Más</h4>
  <a href="${'../'.repeat(depth)}../">Documentación general de WebMCPcss</a>
  <a href="${ctx.repoUrl}/blob/main/docs/hub.md" target="_blank" rel="noopener">docs/hub.md en GitHub</a>
</aside>`;

  // Índice de docs
  const indexBody = `
<div class="docs">
${sidebar('', [], 1)}
<article class="prose">
<span class="eyebrow">Documentación</span>
<h1>Documentación del Component Hub</h1>
<p>Guías cortas para instalar, usar y publicar componentes IA-First.</p>
<div class="tiles" style="margin-top:18px">
${available.map((d) => `<a class="tile" href="${d.slug}/"><strong>${escapeHtml(d.title)}</strong><span>docs/hub/${d.file}</span></a>`).join('\n')}
</div>
<h2>Referencia rápida de la CLI</h2>
<pre><code>webmcpcss components list [--category &lt;cat&gt;] [--library &lt;lib&gt;] [--search &lt;texto&gt;] [--json]
webmcpcss components import &lt;id...&gt; [--output &lt;dir&gt;] [--merge &lt;archivo.css&gt;] [--force]
webmcpcss components update [id...] [--dry-run]
webmcpcss components demo [--output &lt;dir&gt;] [--library &lt;lib&gt;]
webmcpcss components publish &lt;archivo.webmcp.css&gt; --name "Nombre" --category &lt;cat&gt; [--library &lt;lib&gt;] [--html &lt;archivo&gt;]
webmcpcss mcp --serve --hub   # añade list_components / get_component / import_component</code></pre>
</article>
</div>`;
  out.set(
    'docs/index.html',
    page({
      title: 'Documentación',
      description:
        'Guías del WebMCPcss Component Hub: primeros pasos, uso de componentes y contribución.',
      depth: 1,
      active: 'docs',
      body: indexBody,
      pathRel: 'docs/',
      ctx,
    }),
  );

  for (const d of available) {
    const md = fs.readFileSync(path.join(docsDir!, d.file), 'utf8');
    const { html, headings } = renderMarkdownDoc(md);
    const firstP = /<p>(.*?)<\/p>/.exec(html)?.[1]?.replace(/<[^>]+>/g, '') ?? d.title;
    const body = `
<div class="docs">
${sidebar(d.slug, headings, 2)}
<article class="prose">
<div class="crumbs"><a href="../">Docs</a><span>›</span><span>${escapeHtml(d.title)}</span></div>
${html}
</article>
</div>`;
    out.set(
      `docs/${d.slug}/index.html`,
      page({
        title: d.title,
        description: firstP.slice(0, 160),
        depth: 2,
        active: 'docs',
        body,
        pathRel: `docs/${d.slug}/`,
        ctx,
        jsonLd: [
          {
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: d.title,
            url: `${ctx.hubUrl}/docs/${d.slug}/`,
            isPartOf: {
              '@type': 'WebSite',
              name: 'WebMCPcss Component Hub',
              url: `${ctx.hubUrl}/`,
            },
          },
        ],
      }),
    );
  }
}

/** Controles del editor. */
function editorControls(c: HubComponent): string {
  const controls = c.controls ?? [];
  if (!controls.length) {
    return '<p class="results-meta">Este componente no declara controles de edición. Puedes seguir probando las animaciones.</p>';
  }
  return controls
    .map((ctl) => {
      const id = `ctl-${slugify(ctl.variable)}`;
      const num = parseFloat(ctl.default);
      const unit = ctl.unit ?? (ctl.default.replace(/^[\d.-]+/, '') || '');
      if (ctl.type === 'color') {
        return `<div class="control"><label for="${id}">${escapeHtml(ctl.label)} <output>${escapeHtml(ctl.default)}</output></label><input id="${id}" type="color" value="${escapeHtml(toHex(ctl.default))}" data-var="${ctl.variable}" data-default="${escapeHtml(toHex(ctl.default))}"></div>`;
      }
      if (ctl.type === 'range') {
        return `<div class="control"><label for="${id}">${escapeHtml(ctl.label)} <output>${escapeHtml(ctl.default)}</output></label><input id="${id}" type="range" min="${ctl.min ?? 0}" max="${ctl.max ?? 100}" step="${ctl.step ?? 1}" value="${Number.isFinite(num) ? num : 0}" data-var="${ctl.variable}" data-unit="${escapeHtml(unit)}" data-default="${Number.isFinite(num) ? num : 0}"></div>`;
      }
      if (ctl.type === 'select') {
        return `<div class="control"><label for="${id}">${escapeHtml(ctl.label)} <output>${escapeHtml(ctl.default)}</output></label><select id="${id}" data-var="${ctl.variable}" data-default="${escapeHtml(ctl.default)}">${(ctl.options ?? []).map((o) => `<option${o === ctl.default ? ' selected' : ''}>${escapeHtml(o)}</option>`).join('')}</select></div>`;
      }
      return `<div class="control"><label for="${id}">${escapeHtml(ctl.label)} <output>${escapeHtml(ctl.default)}</output></label><input id="${id}" type="text" value="${escapeHtml(ctl.default)}" data-var="${ctl.variable}" data-default="${escapeHtml(ctl.default)}"></div>`;
    })
    .join('\n');
}

/** Normaliza un color corto (#fff) a #ffffff para `<input type=color>`. */
function toHex(color: string): string {
  const m = /^#([0-9a-f]{3})$/i.exec(color.trim());
  if (m)
    return (
      '#' +
      m[1]
        .split('')
        .map((ch) => ch + ch)
        .join('')
    );
  return color.trim();
}

/** Selector raíz al que aplicar las variables en el CSS generado por el editor. */
function rootSelectorFor(c: HubComponent): string {
  if (c.library !== 'core') return ':root';
  const m = /<(\w+)[^>]*\bclass="([^"]+)"/.exec(c.htmlSource);
  const first = m?.[2].split(/\s+/)[0];
  return first && /^wm-[\w-]+$/.test(first) ? `.${first}` : ':root';
}

/** Tabla de herramientas. */
function toolsTable(c: HubComponent): string {
  if (!c.tools.length) return '';
  return `<h2 id="tools">Herramientas para agentes</h2>
<div class="table-wrap"><table>
<thead><tr><th>Herramienta</th><th>Descripción</th><th>Parámetros</th><th>Intención</th><th>Confirmación</th><th>Selector</th></tr></thead>
<tbody>${c.tools
    .map(
      (t) =>
        `<tr><td><code>${escapeHtml(t.name)}</code></td><td>${escapeHtml(t.description ?? '')}</td><td>${t.params.map((p) => `<code>${escapeHtml(p)}</code>`).join(' ') || '—'}</td><td>${t.intent ? `<span class="pill">${escapeHtml(t.intent)}</span>` : '—'}</td><td>${t.confirmation ? `<span class="pill ${t.confirmation === 'needed' ? 'needed' : t.confirmation === 'none' ? 'none' : ''}">${escapeHtml(t.confirmation)}</span>` : '—'}</td><td><code>${escapeHtml(t.selector)}</code></td></tr>`,
    )
    .join('')}</tbody></table></div>`;
}

/** Tabla de contexto y animaciones. */
function contextTable(c: HubComponent): string {
  const parts: string[] = [];
  if (c.context.length) {
    parts.push(`<h2 id="context">Contexto que publica</h2>
<div class="table-wrap"><table><thead><tr><th>Dato</th><th>Formato</th><th>Selector</th></tr></thead><tbody>${c.context
      .map(
        (x) =>
          `<tr><td><code>${escapeHtml(x.name)}</code></td><td>${escapeHtml(x.format ?? 'text')}</td><td><code>${escapeHtml(x.selector)}</code></td></tr>`,
      )
      .join('')}</tbody></table></div>`);
  }
  if (c.animations.length) {
    parts.push(`<h2 id="animations">Animaciones declaradas</h2>
<div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Selector</th></tr></thead><tbody>${c.animations
      .map(
        (a) =>
          `<tr><td><code>${escapeHtml(a.name)}</code></td><td>${escapeHtml(a.type)}</td><td><code>${escapeHtml(a.selector)}</code></td></tr>`,
      )
      .join('')}</tbody></table></div>
<p class="results-meta">Ejecútalas con <code>npx webmcpcss animate ${c.css} --url https://tu-sitio</code> o incluye el runtime en tu página (<code>npx webmcpcss animate ${c.css} -o ./public/webmcp-animation</code>).</p>`);
  }
  return parts.join('\n');
}

/** Ejemplos prompt/animate. */
function examplesSection(c: HubComponent): string {
  const prompts = c.promptExamples ?? [];
  const anims = c.animateExamples ?? [];
  if (!prompts.length && !anims.length) return '';
  const li = (text: string, cmd: string) =>
    `<li><code>${escapeHtml(text)}</code>${copyButton(cmd, 'Copiar comando', 'btn small icon')}</li>`;
  return `<h2 id="examples">Ejemplos con la CLI</h2>
<div class="examples">
  ${
    prompts.length
      ? `<div class="example"><h3><code>webmcpcss prompt</code> — lenguaje natural sobre el componente</h3><ul>${prompts
          .map((p) =>
            li(
              p,
              `npx webmcpcss prompt "${p.replace(/"/g, '\\"')}" --url https://tu-sitio --files ./${c.css}`,
            ),
          )
          .join('')}</ul></div>`
      : ''
  }
  ${
    anims.length
      ? `<div class="example"><h3><code>webmcpcss animate</code> — animaciones declarativas</h3><ul>${anims
          .map((a) =>
            li(
              a,
              `npx webmcpcss prompt "${a.replace(/"/g, '\\"')}" --url https://tu-sitio --files ./${c.css}`,
            ),
          )
          .join('')}</ul></div>`
      : ''
  }
</div>`;
}

/** Página de detalle. */
function detailPage(ctx: Ctx, c: HubComponent): string {
  const meta = c as HubComponent & {
    usage?: { framework: string; code: string };
    preview?: string;
  };
  const entry = ctx.index.components.find((e) => e.id === c.id)!;
  const related = (c.related ?? [])
    .map((id) => ctx.index.components.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => Boolean(e));
  const assets = LIBRARY_ASSETS[c.library];
  const animPresets = [
    ['none', 'Sin animación'],
    ...(c.animations.length ? [['declared', 'Declaradas en el .webmcp.css']] : []),
    ['fade-in', 'fade-in'],
    ['slide-up', 'slide-up'],
    ['pulse', 'pulse'],
    ['hover-glow', 'hover-glow'],
  ];
  const tabs: Array<{ id: string; label: string; content: string; copy?: boolean }> = [
    { id: 'css', label: c.css!, content: c.cssSource, copy: true },
    { id: 'html', label: 'HTML', content: c.htmlSource, copy: true },
    {
      id: 'meta',
      label: 'component.json',
      content: JSON.stringify(stripLoaded(c), null, 2),
      copy: true,
    },
  ];
  if (meta.usage)
    tabs.splice(2, 0, {
      id: 'usage',
      label: meta.usage.framework === 'react' ? 'React / JSX' : meta.usage.framework,
      content: meta.usage.code,
      copy: true,
    });
  const mergeCmd = `npx webmcpcss components import ${c.id} --merge ./webmcp.css`;
  const body = `
<div class="crumbs"><a href="../">Hub</a><span>›</span><a href="../catalog/">Catálogo</a><span>›</span><a href="../catalog/?category=${c.category}">${escapeHtml(CATEGORY_LABELS[c.category])}</a><span>›</span><span>${escapeHtml(c.name)}</span></div>
<div class="detail-head">
  <div>
    <h1>${escapeHtml(c.name)}</h1>
    <div class="badges"><span class="badge cat">${escapeHtml(CATEGORY_LABELS[c.category])}</span><span class="badge lib">${escapeHtml(LIBRARY_LABELS[c.library])}</span><span class="badge v">v${c.version}</span>${(c.tags ?? []).map((t) => `<span class="badge">${escapeHtml(t)}</span>`).join('')}</div>
    <p class="lead">${escapeHtml(c.description)}</p>
  </div>
  <div class="actions">
    <button class="btn" type="button" data-fav="${c.id}" data-name="${escapeHtml(c.name)}" aria-pressed="false"><span class="star" aria-hidden="true">☆</span> <span class="fav-text">Favorito</span></button>
    <a class="btn" href="preview.html" target="_blank" rel="noopener">Abrir preview ↗</a>
    <a class="btn" href="${ctx.repoUrl}/tree/main/components/${c.dir}" target="_blank" rel="noopener">Fuente ↗</a>
  </div>
</div>
<div class="import" aria-label="Comando de importación"><code>${escapeHtml(c.importCommand)}</code>${copyButton(c.importCommand, 'Copiar')}</div>

<div class="studio">
  <section class="preview-box" aria-labelledby="h-preview">
    <div class="preview-bar">
      <strong id="h-preview">Previsualización</strong>
      <span class="spacer"></span>
      <button class="btn small" type="button" data-viewport="desktop" aria-pressed="true">Escritorio</button>
      <button class="btn small" type="button" data-viewport="tablet" aria-pressed="false">Tablet</button>
      <button class="btn small" type="button" data-viewport="mobile" aria-pressed="false">Móvil</button>
    </div>
    <div class="preview-frame" id="preview-frame" data-viewport="desktop">
      <iframe id="preview" src="preview.html" title="Previsualización de ${escapeHtml(c.name)}" loading="lazy" sandbox="allow-scripts allow-same-origin allow-forms allow-popups"></iframe>
    </div>
    ${assets.note ? `<div class="preview-bar"><span>${escapeHtml(assets.note)}</span></div>` : ''}
  </section>
  <aside class="editor" aria-labelledby="h-editor">
    <h2 id="h-editor">Editor en vivo</h2>
    ${editorControls(c)}
    <div class="control"><label for="anim-select">Animación</label>
      <select id="anim-select">${animPresets.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join('')}</select></div>
    <div class="row"><button class="btn small" type="button" id="anim-replay">▶ Reproducir</button><button class="btn small" type="button" id="editor-reset">Restablecer</button></div>
    <div><label class="results-meta" for="override-css">CSS generado</label><pre><code id="override-css"></code></pre>${copyTargetButton('#override-css', 'Copiar CSS', 'btn small')}</div>
  </aside>
</div>

<section class="tabs" aria-label="Código">
  <div role="tablist" aria-label="Archivos del componente">
    ${tabs.map((t, i) => `<button role="tab" id="tab-${t.id}" aria-selected="${i === 0}" aria-controls="panel-${t.id}" tabindex="${i === 0 ? 0 : -1}">${escapeHtml(t.label)}</button>`).join('\n    ')}
  </div>
  ${tabs
    .map(
      (t, i) =>
        `<div role="tabpanel" id="panel-${t.id}" aria-labelledby="tab-${t.id}"${i === 0 ? '' : ' hidden'}>${t.copy ? copyTargetButton(`#code-${t.id}`) : ''}<pre><code id="code-${t.id}">${escapeHtml(t.content)}</code></pre></div>`,
    )
    .join('\n  ')}
</section>

<section class="section" aria-labelledby="h-use">
  <h2 id="h-use">Cómo usarlo</h2>
  <ol class="steps">
    <li>Importa el componente a tu proyecto (HTML + <code>.webmcp.css</code> + <code>component.json</code>):<pre><code>${escapeHtml(c.importCommand)} --output ./src/components</code></pre></li>
    <li>O añade solo el contrato a tu <code>webmcp.css</code> existente (bloque delimitado y actualizable):<pre><code>${escapeHtml(mergeCmd)}</code></pre></li>
    <li>Publícalo para los agentes: MCP (<code>webmcpcss mcp --serve --css ./webmcp.css</code>), <code>document.modelContext</code> (<code>webmcpcss standard compile ./webmcp.css --html index.html</code>) o exporta a tu agente favorito (<code>webmcpcss export --agent claude-code</code>).</li>
  </ol>
</section>

<section class="section">
${toolsTable(c)}
${contextTable(c)}
${examplesSection(c)}
</section>

${
  related.length
    ? `<section class="section" aria-labelledby="h-rel"><h2 id="h-rel">Mismo componente en otras librerías</h2><div class="tiles">${related
        .map(
          (r) =>
            `<a class="tile" href="../${r.id}/"><strong>${escapeHtml(LIBRARY_LABELS[r.library])}</strong><span>${escapeHtml(r.name)} · v${r.version}</span></a>`,
        )
        .join('')}</div></section>`
    : ''
}`;
  return page({
    title: `${c.name} (${LIBRARY_LABELS[c.library]})`,
    description: c.description,
    depth: 1,
    active: 'catalog',
    body,
    pathRel: `${c.id}/`,
    ctx,
    bodyAttrs: `data-component="${c.id}" data-root-selector="${escapeHtml(rootSelectorFor(c))}"`,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'SoftwareSourceCode',
        name: c.name,
        identifier: c.id,
        description: c.description,
        version: c.version,
        url: `${ctx.hubUrl}/${c.id}/`,
        codeRepository: `${ctx.repoUrl}/tree/main/components/${c.dir}`,
        programmingLanguage: ['CSS', 'HTML'],
        runtimePlatform: LIBRARY_LABELS[c.library],
        license: 'https://opensource.org/licenses/MIT',
        keywords: [c.category, c.library, ...(c.tags ?? [])].join(', '),
        isPartOf: {
          '@type': 'WebSite',
          name: 'WebMCPcss Component Hub',
          url: `${ctx.hubUrl}/`,
        },
        author: { '@type': 'Organization', name: c.author ?? 'WebMCPcss Team' },
        about: c.tools.map((t) => ({
          '@type': 'Action',
          name: t.name,
          description: t.description,
        })),
        installUrl: `${ctx.baseUrl}/api/components.json`,
        _webmcp: {
          importCommand: entry.importCommand,
          files: entry.files,
          tools: entry.tools,
        },
      },
    ],
  });
}

/** Quita del componente cargado los campos derivados (para mostrar `component.json`). */
function stripLoaded(c: HubComponent): ComponentMeta {
  const {
    dir: _d,
    cssPath: _p,
    cssSource: _s,
    htmlSource: _h,
    tools: _t,
    context: _c,
    animations: _a,
    hash: _x,
    importCommand: _i,
    ...meta
  } = c;
  return meta;
}

/** Contenido del iframe de previsualización. */
function previewHtml(c: HubComponent, hasRuntime: boolean): string {
  const meta = c as HubComponent & {
    preview?: string;
    assets?: { stylesheets?: string[]; scripts?: string[] };
  };
  const lib = LIBRARY_ASSETS[c.library];
  const stylesheets = [...lib.stylesheets, ...(meta.assets?.stylesheets ?? [])];
  const scripts = [...lib.scripts, ...(meta.assets?.scripts ?? [])];
  let animationsJson = '';
  if (c.animations.length) {
    try {
      const map = parseAnimations(c.cssSource);
      animationsJson = JSON.stringify(map).replace(/</g, '\\u003c');
    } catch {
      animationsJson = '';
    }
  }
  const kind =
    c.category === 'intelligent' && /hero|navbar|scene/.test(c.id)
      ? 'layout'
      : c.category;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview · ${escapeHtml(c.name)}</title>
<meta name="robots" content="noindex">
${scripts
  .filter((s) => /tailwindcss/.test(s))
  .map((s) => `<script src="${s}"></script>`)
  .join('\n')}
${lib.inlineHead ?? ''}
${stylesheets.map((s) => `<link rel="stylesheet" href="${s}">`).join('\n')}
<link rel="stylesheet" href="../assets/preview.css">
${meta.preview ? `<link rel="stylesheet" href="${meta.preview}">` : ''}
<link rel="stylesheet" href="${c.css}">
</head>
<body>
<div data-preview-root data-category="${c.category}" data-kind="${kind}">
${c.htmlSource}
</div>
${scripts
  .filter((s) => !/tailwindcss/.test(s))
  .map((s) => `<script src="${s}"></script>`)
  .join('\n')}
${hasRuntime && animationsJson ? `<script src="../assets/webmcp-animation.js"></script>\n<script>window.__WEBMCP_ANIMATIONS__ = ${animationsJson};</script>` : ''}
<script src="../assets/preview.js"></script>
</body>
</html>
`;
}

/** Sitemap. */
function sitemap(ctx: Ctx): string {
  const urls = [
    '',
    'catalog/',
    'search/',
    'favorites/',
    'docs/',
    ...DOCS.map((d) => `docs/${d.slug}/`),
    'about/',
    ...ctx.index.components.map((c) => `${c.id}/`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${ctx.hubUrl}/${u}</loc></url>`).join('\n')}
</urlset>
`;
}

/**
 * Genera el sitio completo del hub.
 * @returns Archivos escritos (relativos a `siteDir`) y avisos.
 */
export function buildHubSite(options: BuildSiteOptions): BuildSiteResult {
  const loaded = loadHub(options.componentsDir);
  if (loaded.errors.length) {
    throw new Error(`Catálogo inválido:\n- ${loaded.errors.join('\n- ')}`);
  }
  const baseUrl = (
    options.baseUrl ??
    process.env.WEBMCPCSS_HUB_URL ??
    DEFAULT_HUB_URL
  ).replace(/\/+$/, '');
  const index = buildHubIndex(loaded.components, {
    baseUrl,
    generatedAt: options.generatedAt,
  });
  const ctx: Ctx = {
    baseUrl,
    hubUrl: `${baseUrl}/components`,
    repoUrl: options.repoUrl ?? REPO_URL,
    index,
    components: loaded.components,
  };
  const files = new Map<string, string>();
  const hubDir = 'components';
  const put = (rel: string, content: string) =>
    files.set(rel.split(path.sep).join('/'), content);

  // API
  put('api/components.json', JSON.stringify(index, null, 2) + '\n');
  put('api/schema/components.json', JSON.stringify(hubIndexSchema(), null, 2) + '\n');

  // Recursos
  put(`${hubDir}/assets/hub.css`, HUB_CSS);
  put(`${hubDir}/assets/hub.js`, HUB_JS);
  put(`${hubDir}/assets/preview.css`, PREVIEW_CSS);
  put(`${hubDir}/assets/preview.js`, PREVIEW_JS);
  put(
    `${hubDir}/assets/index.js`,
    `window.__HUB_INDEX__ = ${JSON.stringify(index).replace(/</g, '\\u003c')};\n`,
  );
  const hasRuntime = Boolean(options.animationRuntime);
  if (options.animationRuntime)
    put(`${hubDir}/assets/webmcp-animation.js`, options.animationRuntime);
  else
    loaded.warnings.push(
      'Runtime de animaciones no disponible (ejecuta npm run build): las previews no reproducirán animaciones declaradas.',
    );

  // Páginas
  put(`${hubDir}/index.html`, homePage(ctx));
  put(`${hubDir}/catalog/index.html`, catalogPage(ctx));
  put(`${hubDir}/search/index.html`, searchPage(ctx));
  put(`${hubDir}/favorites/index.html`, favoritesPage(ctx));
  put(`${hubDir}/about/index.html`, aboutPage(ctx));
  const docs = new Map<string, string>();
  docsPages(ctx, options.docsDir, docs);
  for (const [rel, html] of docs) put(`${hubDir}/${rel}`, html);
  put(`${hubDir}/sitemap.xml`, sitemap(ctx));
  put(
    `${hubDir}/robots.txt`,
    `User-agent: *\nAllow: /\nSitemap: ${ctx.hubUrl}/sitemap.xml\n`,
  );

  // Componentes
  for (const c of loaded.components) {
    const dir = `${hubDir}/${c.id}`;
    put(`${dir}/index.html`, detailPage(ctx, c));
    put(`${dir}/preview.html`, previewHtml(c, hasRuntime));
    put(`${dir}/${c.css}`, c.cssSource);
    put(`${dir}/${c.html}`, c.htmlSource);
    put(`${dir}/${META_FILE}`, JSON.stringify(stripLoaded(c), null, 2) + '\n');
    const previewFile = (c as HubComponent & { preview?: string }).preview;
    if (previewFile) {
      const src = path.join(options.componentsDir, c.dir, previewFile);
      if (fs.existsSync(src)) put(`${dir}/${previewFile}`, fs.readFileSync(src, 'utf8'));
    }
  }

  // Escritura (limpia components/<id> obsoletos)
  const outHub = path.join(options.siteDir, hubDir);
  if (fs.existsSync(outHub)) {
    for (const entry of fs.readdirSync(outHub, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        !files.has(`${hubDir}/${entry.name}/index.html`) &&
        entry.name !== 'assets'
      ) {
        fs.rmSync(path.join(outHub, entry.name), { recursive: true, force: true });
      }
    }
  }
  for (const [rel, content] of files) {
    const abs = path.join(options.siteDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  return {
    files: [...files.keys()],
    components: loaded.components.length,
    warnings: loaded.warnings,
    index,
  };
}

/**
 * Comprueba que el sitio generado está al día (CI). Compara el índice JSON
 * (ignorando `generatedAt`) y las páginas HTML de los componentes.
 * @returns Lista de archivos desactualizados (vacía si todo está al día).
 */
export function checkHubSite(options: BuildSiteOptions): string[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcpcss-hub-'));
  try {
    const result = buildHubSite({ ...options, siteDir: tmp, generatedAt: '' });
    const stale: string[] = [];
    const strip = (s: string) =>
      s.replace(/"generatedAt":\s*"[^"]*"/, '"generatedAt":""');
    for (const rel of result.files) {
      if (rel.endsWith('webmcp-animation.js')) continue; // depende del build
      const current = path.join(options.siteDir, rel);
      if (!fs.existsSync(current)) {
        stale.push(rel);
        continue;
      }
      const a = strip(fs.readFileSync(current, 'utf8'));
      const b = strip(fs.readFileSync(path.join(tmp, rel), 'utf8'));
      if (a !== b) stale.push(rel);
    }
    return stale;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export { HUB_CATEGORIES, HUB_LIBRARIES };
export type { HubCategory };
