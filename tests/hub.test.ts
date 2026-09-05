/**
 * Tests del Component Hub (v1.2.0): catálogo, índice, sitio estático,
 * markdown, cliente (remoto simulado + empaquetado), MCP tools y publish.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HUB_CATEGORIES, HUB_LIBRARIES } from '../src/hub/types';
import {
  buildHubIndex,
  filterEntries,
  hubIndexSchema,
  loadComponent,
  loadHub,
  slugOf,
  validateMeta,
} from '../src/hub/loader';
import { buildHubSite, checkHubSite } from '../src/hub/site';
import {
  renderInline,
  renderMarkdownDoc,
  rewriteDocHref,
  slugify,
} from '../src/hub/markdown';
import {
  fetchComponent,
  fetchHubIndex,
  importComponent,
  listComponents,
  mergeIntoCss,
  prepareComponent,
  readLock,
  resolveHubUrl,
  slugFromName,
  updateComponents,
} from '../src/hub/client';
import { HUB_TOOL_NAMES, callHubTool } from '../src/hub/mcp-tools';
import { publishComponent } from '../src/hub/publish';
import { buildDemoSite } from '../src/hub/demo';
import { McpCore, createMcpHttpServer } from '../src/exporters/mcp-server';
import { parseWebMCP } from '../src/parser';

const ROOT = path.resolve(__dirname, '..');
const COMPONENTS = path.join(ROOT, 'components');
const DOCS = path.join(ROOT, 'docs', 'hub');

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `webmcpcss-${prefix}-`));
}

/** Servidor estático mínimo para simular GitHub Pages. */
function serveStatic(dir: string): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dir, p);
    if (
      !file.startsWith(dir) ||
      !fs.existsSync(file) ||
      fs.statSync(file).isDirectory()
    ) {
      res.writeHead(404);
      res.end('404');
      return;
    }
    res.writeHead(200, {
      'Content-Type': file.endsWith('.json')
        ? 'application/json'
        : 'text/plain; charset=utf-8',
    });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      }),
    ),
  );
}

describe('hub · catálogo (components/)', () => {
  const loaded = loadHub(COMPONENTS);

  it('carga todos los componentes sin errores', () => {
    expect(loaded.errors).toEqual([]);
    expect(loaded.components.length).toBeGreaterThanOrEqual(50);
  });

  it('cumple los criterios: ≥ 10 componentes (2 por categoría base) por librería', () => {
    for (const lib of HUB_LIBRARIES) {
      const ofLib = loaded.components.filter((c) => c.library === lib);
      expect(ofLib.length, lib).toBeGreaterThanOrEqual(10);
      for (const cat of ['buttons', 'cards', 'forms', 'layout'] as const) {
        expect(
          ofLib.filter((c) => c.category === cat).length,
          `${lib}/${cat}`,
        ).toBeGreaterThanOrEqual(2);
      }
    }
    expect(
      loaded.components.filter((c) => c.category === 'animations').length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      loaded.components.filter((c) => c.category === 'intelligent').length,
    ).toBeGreaterThanOrEqual(4);
  });

  it('todos tienen metadatos completos, contrato parseable e ids únicos', () => {
    const ids = new Set<string>();
    for (const c of loaded.components) {
      expect(ids.has(c.id), c.id).toBe(false);
      ids.add(c.id);
      expect(c.id.startsWith(`${c.library}-`)).toBe(true);
      expect(c.description.length).toBeGreaterThanOrEqual(15);
      expect(c.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(c.tools.length + c.context.length + c.animations.length).toBeGreaterThan(0);
      expect(c.importCommand).toBe(`npx webmcpcss components import ${c.id}`);
      expect(c.htmlSource.length).toBeGreaterThan(20);
      // El CSS del hub debe ser parseable por el motor real.
      expect(() => parseWebMCP(c.cssSource)).not.toThrow();
      // Todas las herramientas tienen descripción, intención y confirmación.
      for (const t of c.tools) {
        expect(t.description, `${c.id}/${t.name}`).toBeTruthy();
        expect(t.intent, `${c.id}/${t.name}`).toBeTruthy();
        expect(t.confirmation, `${c.id}/${t.name}`).toMatch(/^(needed|none)$/);
      }
    }
  });

  it('los componentes de la spec existen con sus herramientas', () => {
    const byId = new Map(loaded.components.map((c) => [c.id, c]));
    expect(byId.get('tailwind-button-primary')?.tools[0]?.name).toBe('clickButton');
    expect(byId.get('core-product-card')?.tools.map((t) => t.name)).toEqual([
      'addToCart',
      'viewDetails',
    ]);
    expect(byId.get('core-login-form')?.tools[0]?.params).toEqual(['email', 'password']);
    expect(byId.get('core-checkout-form')?.tools.map((t) => t.name)).toEqual([
      'placeOrder',
      'applyCoupon',
    ]);
    expect(byId.get('core-hero-section')?.animations.map((a) => a.type)).toEqual([
      'parallax',
      'keyframes',
    ]);
    expect(byId.get('core-parallax-scene')?.animations[0]?.type).toBe('three-scene');
    expect(byId.get('core-isometric-2-5d')?.animations[0]?.type).toBe('isometric');
    expect(byId.get('shadcn-navbar')?.tools.map((t) => t.name)).toEqual([
      'goHome',
      'openMenu',
      'signUp',
    ]);
    expect(byId.get('mui-contact-form')?.htmlSource).toContain('toolautosubmit');
    expect(byId.get('bootstrap-hero')?.context.map((x) => x.name)).toEqual([
      'heroTitle',
      'heroSubtitle',
    ]);
  });

  it('los formularios llevan la API declarativa WebMCP coherente con el contrato', () => {
    for (const c of loaded.components.filter((x) => x.category === 'forms')) {
      const m = /toolname="([^"]+)"/.exec(c.htmlSource);
      expect(m, c.id).toBeTruthy();
      expect(c.tools.map((t) => t.name)).toContain(m![1]);
      expect(c.htmlSource).toContain('tooldescription=');
      expect(c.htmlSource).toContain('toolparamtitle=');
    }
  });

  it('el índice público agrupa por categoría y librería', () => {
    const index = buildHubIndex(loaded.components, {
      baseUrl: 'https://example.test/',
      generatedAt: 'x',
    });
    expect(index.baseUrl).toBe('https://example.test');
    expect(index.generatedAt).toBe('x');
    expect(index.components.length).toBe(loaded.components.length);
    expect(index.categories.map((c) => c.id)).toEqual([...HUB_CATEGORIES]);
    expect(index.libraries.map((l) => l.id)).toEqual([...HUB_LIBRARIES]);
    const sum = index.categories.reduce((n, c) => n + c.count, 0);
    expect(sum).toBe(index.components.length);
    const entry = index.components.find((c) => c.id === 'tailwind-button-primary')!;
    expect(entry.files).toEqual({
      css: 'components/tailwind-button-primary/button-primary.webmcp.css',
      html: 'components/tailwind-button-primary/button-primary.html',
      meta: 'components/tailwind-button-primary/component.json',
      page: 'components/tailwind-button-primary/',
    });
    expect(entry.promptExamples.length).toBeGreaterThan(0);
    // El esquema JSON existe y enumera las categorías.
    const schema = hubIndexSchema() as {
      properties: {
        components: { items: { properties: { category: { enum: string[] } } } };
      };
    };
    expect(schema.properties.components.items.properties.category.enum).toEqual([
      ...HUB_CATEGORIES,
    ]);
  });

  it('filterEntries busca por texto, categoría, librería y etiqueta', () => {
    const index = buildHubIndex(loaded.components);
    expect(
      filterEntries(index.components, { library: 'tailwind' }).every(
        (c) => c.library === 'tailwind',
      ),
    ).toBe(true);
    expect(
      filterEntries(index.components, { category: 'forms', library: 'mui' })
        .map((c) => c.id)
        .sort(),
    ).toEqual(['mui-contact-form', 'mui-login-form']);
    const checkout = filterEntries(index.components, { search: 'checkout' });
    expect(checkout.map((c) => c.id)).toEqual(['core-checkout-form']);
    expect(
      filterEntries(index.components, { search: 'addToCart core' }).map((c) => c.id),
    ).toContain('core-product-card');
    expect(
      filterEntries(index.components, { tag: '2.5d' }).length,
    ).toBeGreaterThanOrEqual(2);
    expect(filterEntries(index.components, { search: 'zzz-nada' })).toEqual([]);
  });

  it('validateMeta y loadComponent detectan metadatos incorrectos', () => {
    expect(validateMeta({}, 'x').length).toBeGreaterThanOrEqual(5);
    expect(
      validateMeta(
        {
          id: 'tailwind-x-y',
          name: 'X',
          description: 'descripción suficientemente larga',
          category: 'buttons',
          library: 'core',
          version: '1.0.0',
        },
        'x',
      ),
    ).toEqual(['x: el id debe empezar por la librería: core-…']);
    expect(
      validateMeta(
        {
          id: 'core-a-b',
          name: 'X',
          description: 'descripción suficientemente larga',
          category: 'buttons',
          library: 'core',
          version: '1.0.0',
          controls: [{ variable: 'bad', label: 'l', type: 'select', default: '' }],
        },
        'x',
      ).length,
    ).toBe(2);
    expect(slugOf('tailwind-button-primary')).toBe('button-primary');
    expect(slugOf('sin-prefijo-valido')).toBe('sin-prefijo-valido');

    const dir = tmpDir('badcomp');
    const compDir = path.join(dir, 'core', 'broken');
    fs.mkdirSync(compDir, { recursive: true });
    fs.writeFileSync(path.join(compDir, 'component.json'), '{ no json');
    expect(loadComponent(compDir, dir).errors[0]).toMatch(/component.json inválido/);
    fs.writeFileSync(
      path.join(compDir, 'component.json'),
      JSON.stringify({
        id: 'core-broken',
        name: 'Broken',
        description: 'componente sin archivos css ni html',
        category: 'buttons',
        library: 'core',
        version: '1.0.0',
      }),
    );
    expect(loadComponent(compDir, dir).errors).toEqual([
      'core/broken: falta broken.webmcp.css',
      'core/broken: falta broken.html',
    ]);
    fs.writeFileSync(path.join(compDir, 'broken.webmcp.css'), '.a { color: red; }');
    fs.writeFileSync(
      path.join(compDir, 'broken.html'),
      '<div class="a">sin contrato</div>',
    );
    expect(loadComponent(compDir, dir).errors[0]).toMatch(
      /no declara ninguna herramienta/,
    );
    // Componente de animación sin webmcp-animation.
    fs.writeFileSync(
      path.join(compDir, 'component.json'),
      JSON.stringify({
        id: 'core-broken',
        name: 'Broken',
        description: 'componente de animación sin animación',
        category: 'animations',
        library: 'core',
        version: '1.0.0',
      }),
    );
    fs.writeFileSync(
      path.join(compDir, 'broken.webmcp.css'),
      '.a { webmcp-tool: "x"; webmcp-description: "y"; }',
    );
    expect(loadComponent(compDir, dir).errors[0]).toMatch(
      /debe declarar webmcp-animation/,
    );
    // Ids duplicados.
    const dup = path.join(dir, 'core', 'dup');
    fs.mkdirSync(dup, { recursive: true });
    for (const d of [compDir, dup]) {
      fs.writeFileSync(
        path.join(d, 'component.json'),
        JSON.stringify({
          id: 'core-same',
          name: 'Same',
          description: 'componente duplicado para la prueba',
          category: 'buttons',
          library: 'core',
          version: '1.0.0',
        }),
      );
      fs.writeFileSync(
        path.join(d, 'same.webmcp.css'),
        '.a { webmcp-tool: "x"; webmcp-description: "y"; }',
      );
      fs.writeFileSync(path.join(d, 'same.html'), '<button class="a">x</button>');
    }
    const res = loadHub(dir);
    expect(res.components.length).toBe(1);
    expect(res.errors[0]).toMatch(/id duplicado/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('hub · markdown', () => {
  it('convierte encabezados, listas, código, tablas, citas y enlaces', () => {
    const { html, headings } = renderMarkdownDoc(
      '# Título\n\nPárrafo con `code`, **negrita**, *cursiva* y [enlace](https://x.test) e [interno](../a/).\n\n## Sección A\n\n- uno\n- dos\n  continuación\n\n1. primero\n2. segundo\n\n```bash\nnpx webmcpcss <x>\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n> cita\n\n---\n\n### Sub\n',
    );
    expect(html).toContain('<h1 id="titulo">Título</h1>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<strong>negrita</strong>');
    expect(html).toContain('<em>cursiva</em>');
    expect(html).toContain(
      '<a href="https://x.test" target="_blank" rel="noopener">enlace</a>',
    );
    expect(html).toContain('<a href="../a/">interno</a>');
    expect(html).toContain('<ul><li>uno</li><li>dos continuación</li></ul>');
    expect(html).toContain('<ol><li>primero</li><li>segundo</li></ol>');
    expect(html).toContain(
      '<pre><code class="language-bash">npx webmcpcss &lt;x&gt;</code></pre>',
    );
    expect(html).toContain(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    );
    expect(html).toContain('<blockquote><p>cita</p></blockquote>');
    expect(html).toContain('<hr>');
    expect(headings).toEqual([
      { level: 2, text: 'Sección A', id: 'seccion-a' },
      { level: 3, text: 'Sub', id: 'sub' },
    ]);
    expect(slugify('¡Hola, Mundo! Ñandú')).toBe('hola-mundo-nandu');
    expect(renderInline('a <b> `x<y>`')).toBe('a &lt;b&gt; <code>x&lt;y&gt;</code>');
  });

  it('acepta cursiva con guiones bajos (Prettier) sin romper snake_case', () => {
    expect(renderInline('texto _IA-First_ y (_core_).')).toBe(
      'texto <em>IA-First</em> y (<em>core</em>).',
    );
    expect(renderInline('usa snake_case_var y __init__')).toBe(
      'usa snake_case_var y __init__',
    );
    expect(renderInline('`_no_` es código')).toBe('<code>_no_</code> es código');
  });

  it('reescribe enlaces entre guías (.md) a las rutas del sitio', () => {
    expect(rewriteDocHref('./component-usage.md')).toBe('../component-usage/');
    expect(rewriteDocHref('contributing.md#versionado')).toBe(
      '../contributing/#versionado',
    );
    expect(rewriteDocHref('../hub.md')).toBe('../hub.md');
    expect(rewriteDocHref('https://x.test/a.md')).toBe('https://x.test/a.md');
    expect(rewriteDocHref('../a/')).toBe('../a/');
    expect(renderInline('[Uso](./component-usage.md) y [doc](https://x.test/d.md)')).toBe(
      '<a href="../component-usage/">Uso</a> y <a href="https://x.test/d.md" target="_blank" rel="noopener">doc</a>',
    );
  });
});

describe('hub · sitio estático', () => {
  const out = tmpDir('site');
  let result: ReturnType<typeof buildHubSite>;

  beforeAll(() => {
    result = buildHubSite({
      componentsDir: COMPONENTS,
      siteDir: out,
      docsDir: DOCS,
      baseUrl: 'https://hub.test/base',
      generatedAt: '2026-01-01T00:00:00.000Z',
      animationRuntime: '/* runtime */',
    });
  });
  afterAll(() => fs.rmSync(out, { recursive: true, force: true }));

  it('genera páginas, api, assets y una página por componente', () => {
    expect(result.components).toBeGreaterThanOrEqual(50);
    for (const f of [
      'api/components.json',
      'api/schema/components.json',
      'components/index.html',
      'components/catalog/index.html',
      'components/search/index.html',
      'components/favorites/index.html',
      'components/about/index.html',
      'components/docs/index.html',
      'components/docs/getting-started/index.html',
      'components/docs/component-usage/index.html',
      'components/docs/contributing/index.html',
      'components/sitemap.xml',
      'components/robots.txt',
      'components/assets/hub.css',
      'components/assets/hub.js',
      'components/assets/index.js',
      'components/assets/preview.js',
      'components/assets/webmcp-animation.js',
      'components/tailwind-button-primary/index.html',
      'components/tailwind-button-primary/preview.html',
      'components/tailwind-button-primary/button-primary.webmcp.css',
      'components/tailwind-button-primary/button-primary.html',
      'components/tailwind-button-primary/component.json',
      'components/tailwind-button-primary/preview.css',
    ]) {
      expect(fs.existsSync(path.join(out, f)), f).toBe(true);
    }
    const index = JSON.parse(
      fs.readFileSync(path.join(out, 'api/components.json'), 'utf8'),
    );
    expect(index.baseUrl).toBe('https://hub.test/base');
    expect(index.generatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(index.components.length).toBe(result.components);
  });

  it('las páginas llevan meta webmcp-hub, JSON-LD y accesibilidad básica', () => {
    const home = fs.readFileSync(path.join(out, 'components/index.html'), 'utf8');
    expect(home).toContain('<meta name="webmcp-hub" content="true">');
    expect(home).toContain(
      '<meta name="webmcp-hub-index" content="https://hub.test/base/api/components.json">',
    );
    expect(home).toContain('"@type":"WebSite"');
    expect(home).toContain('<a class="skip" href="#main">');
    expect(home).toContain('<html lang="es"');
    expect(home).toContain('href="catalog/"');
    const detail = fs.readFileSync(
      path.join(out, 'components/tailwind-button-primary/index.html'),
      'utf8',
    );
    expect(detail).toContain('"@type":"SoftwareSourceCode"');
    expect(detail).toContain(
      'data-copy="npx webmcpcss components import tailwind-button-primary"',
    );
    expect(detail).toContain('role="tablist"');
    expect(detail).toContain('data-var="--wm-primary"');
    expect(detail).toContain('id="anim-select"');
    expect(detail).toContain('<iframe id="preview" src="preview.html"');
    expect(detail).toContain('Mismo componente en otras librerías');
    expect(detail).toContain(
      'webmcpcss prompt &quot;cambia el color del botón primario a verde&quot;',
    );
    const preview = fs.readFileSync(
      path.join(out, 'components/tailwind-button-primary/preview.html'),
      'utf8',
    );
    expect(preview).toContain('https://cdn.tailwindcss.com');
    expect(preview).toContain('button-primary.webmcp.css');
    expect(preview).toContain('data-tool="clickButton"');
    const scene = fs.readFileSync(
      path.join(out, 'components/core-parallax-scene/preview.html'),
      'utf8',
    );
    expect(scene).toContain('webmcp-animation.js');
    expect(scene).toContain('window.__WEBMCP_ANIMATIONS__');
    const docs = fs.readFileSync(
      path.join(out, 'components/docs/getting-started/index.html'),
      'utf8',
    );
    expect(docs).toContain('<h1 id="primeros-pasos">Primeros pasos</h1>');
    expect(docs).toContain('aria-current="page"');
    const catalog = fs.readFileSync(
      path.join(out, 'components/catalog/index.html'),
      'utf8',
    );
    expect(catalog).toContain('id="search-input"');
    expect(catalog).toContain('data-filter="library" data-value="tailwind"');
    expect(catalog).toContain('"@type":"ItemList"');
    const js = fs.readFileSync(path.join(out, 'components/assets/hub.js'), 'utf8');
    expect(js).toContain('localStorage.getItem(FAV_KEY)');
    expect(js).toContain('document.modelContext || navigator.modelContext');
    expect(js).toContain("name: 'searchComponents'");
  });

  it('checkHubSite detecta sitios al día y desactualizados', () => {
    const opts = {
      componentsDir: COMPONENTS,
      siteDir: out,
      docsDir: DOCS,
      baseUrl: 'https://hub.test/base',
      animationRuntime: '/* runtime */',
    };
    expect(checkHubSite(opts)).toEqual([]);
    fs.appendFileSync(path.join(out, 'components/about/index.html'), '<!-- cambio -->');
    fs.rmSync(path.join(out, 'components/catalog/index.html'));
    const stale = checkHubSite(opts);
    expect(stale).toContain('components/about/index.html');
    expect(stale).toContain('components/catalog/index.html');
  });

  it('elimina páginas de componentes que ya no existen', () => {
    const ghost = path.join(out, 'components', 'core-fantasma');
    fs.mkdirSync(ghost, { recursive: true });
    fs.writeFileSync(path.join(ghost, 'index.html'), 'x');
    buildHubSite({
      componentsDir: COMPONENTS,
      siteDir: out,
      baseUrl: 'https://hub.test/base',
      generatedAt: 'x',
    });
    expect(fs.existsSync(ghost)).toBe(false);
    expect(fs.existsSync(path.join(out, 'components/assets/hub.css'))).toBe(true);
  });
});

describe('hub · cliente (hub remoto simulado + empaquetado)', () => {
  const site = tmpDir('remote');
  const work = tmpDir('work');
  let server: http.Server;
  let hubUrl: string;
  const lockPath = path.join(work, '.webmcpcss', 'components.lock.json');

  beforeAll(async () => {
    buildHubSite({
      componentsDir: COMPONENTS,
      siteDir: site,
      baseUrl: 'http://placeholder',
      generatedAt: 'x',
    });
    const s = await serveStatic(site);
    server = s.server;
    hubUrl = s.url;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(site, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('resolveHubUrl prioriza argumento > entorno > por defecto', () => {
    const prev = process.env.WEBMCPCSS_HUB_URL;
    delete process.env.WEBMCPCSS_HUB_URL;
    expect(resolveHubUrl()).toBe('https://cochinoraptor.github.io/WebMCPcss');
    process.env.WEBMCPCSS_HUB_URL = 'https://env.test/hub/';
    expect(resolveHubUrl()).toBe('https://env.test/hub');
    expect(resolveHubUrl('https://arg.test/')).toBe('https://arg.test');
    if (prev === undefined) delete process.env.WEBMCPCSS_HUB_URL;
    else process.env.WEBMCPCSS_HUB_URL = prev;
  });

  it('descarga el índice remoto y lista con filtros', async () => {
    const { components, resolved } = await listComponents(
      { library: 'bootstrap', category: 'buttons' },
      { hubUrl },
    );
    expect(resolved.source).toBe('remote');
    expect(resolved.location).toBe(hubUrl);
    expect(components.map((c) => c.id).sort()).toEqual([
      'bootstrap-button-icon',
      'bootstrap-button-outline',
      'bootstrap-button-primary',
      'bootstrap-button-secondary',
    ]);
  });

  it('cae al catálogo empaquetado si el hub no responde o con offline', async () => {
    const bad = await fetchHubIndex({ hubUrl: 'http://127.0.0.1:9', timeoutMs: 500 });
    expect(bad.source).toBe('bundled');
    expect(bad.index.components.length).toBeGreaterThan(0);
    const off = await fetchHubIndex({ offline: true });
    expect(off.source).toBe('bundled');
    const files = await fetchComponent('core-pulse', { offline: true });
    expect(files.css).toContain('webmcp-animation: "pulse"');
    expect(files.preview).toContain('Previsualización del hub');
    await expect(fetchComponent('core-no-existe', { offline: true })).rejects.toThrow(
      /no encontrado/,
    );
    await expect(fetchComponent('mui-pulse', { offline: true })).rejects.toThrow(
      /Quizás: core-pulse/,
    );
  });

  it('importa desde el hub remoto, registra el lock y fusiona el contrato', async () => {
    const output = path.join(work, 'src', 'components');
    const merge = path.join(work, 'webmcp.css');
    const r = await importComponent('tailwind-button-primary', {
      hubUrl,
      output,
      lockPath,
      merge,
    });
    expect(r.source).toBe('remote');
    expect(r.skipped).toBeFalsy();
    expect(r.files.map((f) => path.basename(f)).sort()).toEqual([
      'button-primary.html',
      'button-primary.webmcp.css',
      'component.json',
      'preview.css',
    ]);
    expect(
      fs.readFileSync(
        path.join(output, 'tailwind-button-primary', 'button-primary.webmcp.css'),
        'utf8',
      ),
    ).toContain('webmcp-tool: "clickButton"');
    const lock = readLock(lockPath);
    expect(lock.hub).toBe(hubUrl);
    expect(lock.components['tailwind-button-primary'].version).toBe('1.0.0');
    const merged = fs.readFileSync(merge, 'utf8');
    expect(merged).toContain('/* @webmcpcss-component tailwind-button-primary v1.0.0 */');
    expect(merged).toContain('/* @end webmcpcss-component tailwind-button-primary */');
    expect(() => parseWebMCP(merged)).not.toThrow();

    // Segunda importación idéntica: se omite.
    const again = await importComponent('tailwind-button-primary', {
      hubUrl,
      output,
      lockPath,
    });
    expect(again.skipped).toBe(true);

    // Fusión de un segundo componente y reemplazo del primero (no duplica).
    await importComponent('core-product-card', { hubUrl, output, lockPath, merge });
    mergeIntoCss(
      merge,
      'tailwind-button-primary',
      '1.0.1',
      '.x { webmcp-tool: "clickButton"; }',
    );
    const merged2 = fs.readFileSync(merge, 'utf8');
    expect(merged2.match(/@webmcpcss-component tailwind-button-primary/g)?.length).toBe(
      1,
    );
    expect(merged2).toContain('v1.0.1');
    expect(merged2).toContain('@webmcpcss-component core-product-card');

    // Carpeta existente sin lock → error salvo --force.
    const stray = path.join(output, 'core-pulse');
    fs.mkdirSync(stray, { recursive: true });
    fs.writeFileSync(path.join(stray, 'x.txt'), 'x');
    await expect(
      importComponent('core-pulse', { hubUrl, output, lockPath }),
    ).rejects.toThrow(/--force/);
    const forced = await importComponent('core-pulse', {
      hubUrl,
      output,
      lockPath,
      force: true,
    });
    expect(forced.files.length).toBe(4);
  });

  it('update detecta cambios de versión/hash y reimporta', async () => {
    const output = path.join(work, 'src', 'components');
    // Simula una versión antigua instalada.
    const lock = readLock(lockPath);
    lock.components['tailwind-button-primary'].hash = 'obsoleto';
    lock.components['tailwind-button-primary'].version = '0.9.0';
    lock.components['core-desaparecido'] = {
      id: 'core-desaparecido',
      version: '1.0.0',
      hash: 'x',
      files: [path.join(output, 'core-desaparecido', 'a.css')],
      installedAt: 'x',
      source: hubUrl,
    };
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2));

    const dry = await updateComponents({ hubUrl, lockPath, dryRun: true });
    const byId = Object.fromEntries(dry.statuses.map((s) => [s.id, s]));
    expect(byId['tailwind-button-primary'].status).toBe('outdated');
    expect(byId['core-product-card'].status).toBe('up-to-date');
    expect(byId['core-desaparecido'].status).toBe('missing-remote');

    const applied = await updateComponents({
      hubUrl,
      lockPath,
      ids: ['tailwind-button-primary'],
    });
    expect(applied.statuses[0]).toMatchObject({
      id: 'tailwind-button-primary',
      status: 'updated',
      available: '1.0.0',
    });
    expect(readLock(lockPath).components['tailwind-button-primary'].hash).not.toBe(
      'obsoleto',
    );
    await expect(
      updateComponents({ hubUrl, lockPath, ids: ['core-nunca-instalado'] }),
    ).rejects.toThrow(/no está instalado/);
  });

  it('prepareComponent valida y genera metadatos + HTML mínimo', () => {
    const css = path.join(work, 'mi-boton.webmcp.css');
    fs.writeFileSync(
      css,
      '.reserva[data-tool="book"] { webmcp-tool: "bookTable"; webmcp-description: "Reserva una mesa"; webmcp-param-people: value(#people); }\n#people { webmcp-context: "people"; }',
    );
    const prepared = prepareComponent({
      cssPath: css,
      name: 'Botón de Reserva',
      category: 'buttons',
      library: 'tailwind',
      tags: ['reserva'],
    });
    expect(prepared.id).toBe('tailwind-boton-de-reserva');
    expect(prepared.dir).toBe('components/community/tailwind-boton-de-reserva');
    expect(prepared.summary).toEqual({ tools: 1, context: 1, animations: 0 });
    expect(prepared.meta.css).toBe('boton-de-reserva.webmcp.css');
    expect(prepared.html).toContain('data-tool="book"');
    expect(prepared.html).toContain('class="reserva"');
    expect(prepared.html).toContain('id="people"');
    expect(slugFromName('¡Éxito Total!')).toBe('exito-total');
    expect(() =>
      prepareComponent({ cssPath: css, name: 'X', category: 'nope', library: 'core' }),
    ).toThrow(/Categoría inválida/);
    expect(() =>
      prepareComponent({ cssPath: css, name: 'X', category: 'buttons', library: 'vue' }),
    ).toThrow(/Librería inválida/);
    expect(() =>
      prepareComponent({ cssPath: '/no/existe.css', name: 'X', category: 'buttons' }),
    ).toThrow(/No existe/);
    const empty = path.join(work, 'vacio.css');
    fs.writeFileSync(empty, '.a { color: red; }');
    expect(() =>
      prepareComponent({ cssPath: empty, name: 'Vacío', category: 'buttons' }),
    ).toThrow(/no declara ninguna herramienta/);
  });

  it('buildDemoSite genera index.html, webmcp.css unificado y archivos', async () => {
    const outDir = path.join(work, 'demo');
    const demo = await buildDemoSite({
      hubUrl,
      output: outDir,
      ids: ['core-button-primary', 'core-fade-in', 'tailwind-login-form'],
      animationRuntime: '/* rt */',
    });
    expect(demo.components).toEqual([
      'core-button-primary',
      'core-fade-in',
      'tailwind-login-form',
    ]);
    expect(demo.files).toContain('index.html');
    expect(demo.files).toContain('webmcp.css');
    expect(demo.files).toContain('webmcp-animation.js');
    expect(demo.files).toContain('components/core-fade-in/fade-in.webmcp.css');
    const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
    expect(html).toContain('https://cdn.tailwindcss.com');
    expect(html).toContain('id="core-fade-in"');
    expect(html).toContain('window.__WEBMCP_ANIMATIONS__');
    const css = fs.readFileSync(path.join(outDir, 'webmcp.css'), 'utf8');
    const map = parseWebMCP(css);
    expect(Object.keys(map.tools)).toEqual(['clickButton', 'login']);
    const byLib = await buildDemoSite({
      offline: true,
      output: path.join(work, 'demo2'),
      library: 'mui',
    });
    expect(byLib.components.every((id) => id.startsWith('mui-'))).toBe(true);
    expect(byLib.components.length).toBe(10);
    await expect(
      buildDemoSite({
        offline: true,
        output: path.join(work, 'demo3'),
        ids: ['core-inexistente'],
      }),
    ).rejects.toThrow(/no encontrado/);
  });

  it('herramientas MCP del hub: list / get / import', async () => {
    const opts = {
      hubUrl,
      outputDir: path.join(work, 'mcp-out'),
      lockPath: path.join(work, 'mcp.lock.json'),
    };
    const list = await callHubTool(
      'list_components',
      { library: 'shadcn', category: 'cards' },
      opts,
    );
    const listData = JSON.parse((list.content[0] as { text: string }).text);
    expect(list.isError).toBeFalsy();
    expect(listData.total).toBe(2);
    expect(listData.components[0].page).toMatch(/\/components\/shadcn-/);

    const get = await callHubTool('get_component', { id: 'core-checkout-form' }, opts);
    const getData = JSON.parse((get.content[0] as { text: string }).text);
    expect(getData.tools.map((t: { name: string }) => t.name)).toEqual([
      'placeOrder',
      'applyCoupon',
    ]);
    expect(getData.css).toContain('webmcp-permissions: "full"');
    const noSrc = JSON.parse(
      (
        await callHubTool(
          'get_component',
          { id: 'core-checkout-form', includeSource: false },
          opts,
        )
      ).content[0].text as string,
    );
    expect(noSrc.css).toBeUndefined();
    expect((await callHubTool('get_component', {}, opts)).isError).toBe(true);
    expect((await callHubTool('get_component', { id: 'core-nope' }, opts)).isError).toBe(
      true,
    );

    const imp = await callHubTool(
      'import_component',
      { id: 'shadcn-product-card' },
      opts,
    );
    const impData = JSON.parse((imp.content[0] as { text: string }).text);
    expect(impData.success).toBe(true);
    expect(
      fs.existsSync(
        path.join(opts.outputDir, 'shadcn-product-card', 'product-card.webmcp.css'),
      ),
    ).toBe(true);
    const ro = await callHubTool(
      'import_component',
      { id: 'shadcn-product-card' },
      { ...opts, readOnly: true },
    );
    expect(ro.isError).toBe(true);
    expect((ro.content[0] as { text: string }).text).toContain('solo lectura');
  });

  it('McpCore expone las tools del hub solo con la opción hub (+ rutas HTTP)', async () => {
    const toolMap = parseWebMCP(
      '.buy { webmcp-tool: "buyNow"; webmcp-description: "Compra"; }',
    );
    const without = new McpCore({ toolMap });
    expect(without.listTools().tools.map((t) => t.name)).toEqual(['buyNow']);
    expect((await without.callTool('list_components', {})).isError).toBe(true);
    expect((await without.callHub('list_components', {})).isError).toBe(true);

    const withHub = new McpCore({
      toolMap,
      hub: {
        hubUrl,
        outputDir: path.join(work, 'core-out'),
        lockPath: path.join(work, 'core.lock.json'),
      },
    });
    expect(withHub.hubEnabled).toBe(true);
    expect(withHub.listTools().tools.map((t) => t.name)).toEqual([
      'buyNow',
      ...HUB_TOOL_NAMES,
    ]);
    const viaRpc = await withHub.dispatch({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_components', arguments: { search: 'checkout' } },
    } as never);
    const rpcData = JSON.parse(
      (viaRpc as { content: Array<{ text: string }> }).content[0].text,
    );
    expect(rpcData.components.map((c: { id: string }) => c.id)).toEqual([
      'core-checkout-form',
    ]);

    const server = createMcpHttpServer(withHub);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const tools = (await (await fetch(`${base}/api/tools`)).json()) as {
        tools: Array<{ name: string }>;
      };
      expect(tools.tools.map((t) => t.name)).toContain('import_component');
      const list = (await (
        await fetch(`${base}/api/components?library=mui&category=layout`)
      ).json()) as { total: number; components: Array<{ id: string }> };
      expect(list.total).toBe(2);
      expect(list.components.map((c) => c.id).sort()).toEqual(['mui-hero', 'mui-navbar']);
      const one = (await (
        await fetch(`${base}/api/components/core-pulse?source=0`)
      ).json()) as { id: string; css?: string };
      expect(one.id).toBe('core-pulse');
      expect(one.css).toBeUndefined();
      const missing = await fetch(`${base}/api/components/core-nope`);
      expect(missing.status).toBe(404);
      const noHub = createMcpHttpServer(without);
      await new Promise<void>((r) => noHub.listen(0, '127.0.0.1', r));
      const res = await fetch(
        `http://127.0.0.1:${(noHub.address() as AddressInfo).port}/api/components`,
      );
      expect(res.status).toBe(404);
      noHub.closeAllConnections?.();
      await new Promise((r) => noHub.close(r));
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });
});

describe('hub · publish (API de GitHub simulada)', () => {
  let server: http.Server;
  let apiBase: string;
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> =
    [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
        calls.push({ method: req.method ?? '', url: req.url ?? '', body });
        const send = (status: number, data: unknown): void => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        };
        const url = req.url ?? '';
        if (url === '/user') return send(200, { login: 'maker' });
        if (url.endsWith('/forks')) return send(202, {});
        if (url === '/repos/maker/WebMCPcss') return send(200, { id: 1 });
        if (url.includes('/git/ref/heads/main'))
          return send(200, { object: { sha: 'abc' } });
        if (url.includes('/git/refs')) return send(201, { ref: 'ok' });
        if (url.includes('/contents/components/community/') && req.method === 'GET') {
          // El component.json "ya existe" para probar el update con sha.
          return url.includes('component.json')
            ? send(200, { sha: 'old' })
            : send(404, { message: 'Not Found' });
        }
        if (url.includes('/contents/components/community/') && req.method === 'PUT')
          return send(201, { commit: { sha: 'def' } });
        if (url.endsWith('/pulls'))
          return send(201, { html_url: 'https://github.com/up/repo/pull/42' });
        send(404, { message: `sin ruta: ${url}` });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  });

  it('hace fork → rama → 3 commits → PR', async () => {
    const dir = tmpDir('pub');
    const css = path.join(dir, 'c.webmcp.css');
    fs.writeFileSync(
      css,
      '[data-tool="go"] { webmcp-tool: "go"; webmcp-description: "Ir"; }',
    );
    const component = prepareComponent({
      cssPath: css,
      name: 'Ir ya',
      category: 'buttons',
      library: 'core',
    });
    const result = await publishComponent({ component, token: 'tok', apiBase });
    expect(result.prUrl).toBe('https://github.com/up/repo/pull/42');
    expect(result.fork).toBe('maker/WebMCPcss');
    expect(result.branch).toMatch(/^hub\/core-ir-ya-/);
    expect(result.files).toEqual([
      'components/community/core-ir-ya/component.json',
      'components/community/core-ir-ya/ir-ya.webmcp.css',
      'components/community/core-ir-ya/ir-ya.html',
    ]);
    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts.length).toBe(3);
    expect(puts[0].body?.sha).toBe('old'); // component.json existía → update
    expect(puts[1].body?.sha).toBeUndefined();
    expect(
      Buffer.from(String(puts[1].body?.content), 'base64').toString('utf8'),
    ).toContain('webmcp-tool: "go"');
    const pr = calls.find((c) => c.url.endsWith('/pulls'))!;
    expect(pr.body?.title).toBe('feat(hub): componente core-ir-ya');
    expect(pr.body?.head).toMatch(/^maker:hub\/core-ir-ya-/);
    fs.rmSync(dir, { recursive: true, force: true });
    await expect(
      publishComponent({
        component,
        token: 'tok',
        apiBase,
        upstream: { owner: 'x', repo: 'WebMCPcss', branch: 'nope' },
      }),
    ).rejects.toThrow(/GitHub API/);
  });
});
