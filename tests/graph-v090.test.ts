/**
 * Tests v0.9.0 del módulo de grafo: patrones de fragilidad ampliados
 * (CSS Modules Next/Vite, Astro, Element Plus, aria-*), alias
 * `framework`, resumen de frameworks, frontmatter enriquecido del vault
 * Obsidian, dashboard con filtros y exportación SVG.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  analyzeFragility,
  buildGraph,
  buildGraphHtml,
  buildGraphSvg,
  generateObsidianVault,
  serveGraphDashboard,
  summarizeFrameworks,
  type StatusResult,
} from '../src/graph';
import { parseWebMCP } from '../src/parser';

const CSS = `
#add-to-cart { webmcp-tool: "addToCart"; webmcp-param-quantity: value(#qty); }
.styles_button__3xK9z { webmcp-tool: "nextBuy"; webmcp-description: "Botón Next.js"; }
._button_1x9j8k { webmcp-tool: "viteBuy"; }
.btn[data-v-abc1234] { webmcp-tool: "vueBuy"; }
[aria-label="Buscar"] { webmcp-tool: "search"; }
.total { webmcp-context: "total"; webmcp-format: "currency"; }
`;

const files = [{ path: 'shop/checkout.webmcp.css', toolMap: parseWebMCP(CSS) }];
const status: StatusResult[] = [
  {
    url: 'https://shop.test',
    entries: [
      { name: 'addToCart', kind: 'tool', selector: '#add-to-cart', ok: true },
      { name: 'nextBuy', kind: 'tool', selector: '.styles_button__3xK9z', ok: false },
    ],
  },
];

describe('analyzeFragility · patrones v0.9.0', () => {
  it('detecta CSS Modules de Next.js (nombre_local__hash) como high', () => {
    const s = analyzeFragility('.styles_button__3xK9z');
    expect(s.level).toBe('high');
    expect(s.framework).toBe('CSS Modules (Next.js)');
    expect(s.suggestions.join(' ')).toMatch(/data-tool/);
  });

  it('detecta CSS Modules de Vite (_local_hash) como high', () => {
    expect(analyzeFragility('._button_1x9j8k').framework).toBe('CSS Modules (Vite)');
    expect(analyzeFragility('._button_1x9j8k').level).toBe('high');
  });

  it('no confunde BEM ni utilidades con guion bajo con hashes', () => {
    expect(analyzeFragility('.card__title').level).toBe('low');
    expect(analyzeFragility('.header__logo--large').level).toBe('low');
    expect(analyzeFragility('._hidden_mobile').level).toBe('low');
    expect(analyzeFragility('.nav_item__title').framework).toBeUndefined();
  });

  it('detecta Astro (astro-* y data-astro-cid-*) como high', () => {
    expect(analyzeFragility('.astro-J7PV25F6').framework).toBe('Astro');
    const s = analyzeFragility('[data-astro-cid-j7pv25f6] button');
    expect(s.level).toBe('high');
    // data-astro-cid-* NO cuenta como data-* estable.
    expect(s.reasons.join(' ')).not.toMatch(/patrón más estable/);
  });

  it('design systems: Element Plus, MUI (.Mui-*) y Ant Design son low con framework', () => {
    expect(analyzeFragility('.el-button').framework).toBe('Element Plus');
    expect(analyzeFragility('.el-button').level).toBe('low');
    expect(analyzeFragility('.Mui-selected').framework).toBe('MUI v5');
    expect(analyzeFragility('.ant-btn-primary').framework).toBe('Ant Design');
  });

  it('aria-* e ids semánticos se reconocen como señales estables', () => {
    const aria = analyzeFragility('[aria-label="Buscar"]');
    expect(aria.level).toBe('low');
    expect(aria.reasons.join(' ')).toMatch(/aria-\*/);
    const id = analyzeFragility('#checkout-btn');
    expect(id.reasons.join(' ')).toMatch(/id semántico/);
    expect(id.framework).toBeUndefined();
  });

  it('el alias framework coincide con frameworks[0] y se omite si no hay ninguno', () => {
    const vue = analyzeFragility('.btn[data-v-abc1234]');
    expect(vue.frameworks[0]).toBe('Vue (scoped)');
    expect(vue.framework).toBe(vue.frameworks[0]);
    expect('framework' in analyzeFragility('#ok')).toBe(false);
  });

  it('summarizeFrameworks cuenta selectores por framework', () => {
    const summary = summarizeFrameworks([
      analyzeFragility('.btn[data-v-abc1234]'),
      analyzeFragility('.btn.btn-primary'),
      analyzeFragility('.sc-1x9j8k'),
    ]);
    expect(summary['Vue (scoped)']).toBe(1);
    expect(summary.Bootstrap).toBe(2);
    expect(summary['styled-components']).toBe(1);
  });
});

describe('buildGraph · frameworkSummary', () => {
  it('agrega frameworkSummary a los metadatos cuando hay fragilidad', () => {
    const graph = buildGraph(files, status);
    expect(graph.metadata?.frameworkSummary).toEqual({
      'CSS Modules (Next.js)': 1,
      'CSS Modules (Vite)': 1,
      'Vue (scoped)': 1,
      Bootstrap: 1,
    });
    expect(graph.metadata?.statusCounts).toEqual({ ok: 1, broken: 1 });
  });

  it('sin fragilidad no incluye frameworkSummary', () => {
    const graph = buildGraph(files, undefined, { fragility: false });
    expect(graph.metadata?.frameworkSummary).toBeUndefined();
  });
});

describe('generateObsidianVault · frontmatter v0.9.0', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-vault-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('las notas de selector llevan framework, suggestions y etiqueta del framework', () => {
    const graph = buildGraph(files, status);
    const written = generateObsidianVault(graph, dir);
    const selNote = written.find(
      (f) => f.includes(`selectores${path.sep}`) && /styles_button/.test(f),
    );
    expect(selNote).toBeDefined();
    const md = fs.readFileSync(selNote!, 'utf8');
    expect(md).toMatch(/^fragility: high$/m);
    expect(md).toMatch(/^framework: "CSS Modules \(Next\.js\)"$/m);
    expect(md).toMatch(/^suggestions:\n {2}- "/m);
    expect(md).toMatch(/tags: \[webmcp, selector, fragilidad-high, css-modules\]/);
  });

  it('las notas de herramienta heredan el framework del selector', () => {
    const graph = buildGraph(files, status);
    generateObsidianVault(graph, dir);
    const md = fs.readFileSync(path.join(dir, 'herramientas', 'nextBuy.md'), 'utf8');
    expect(md).toMatch(/^framework: "CSS Modules \(Next\.js\)"$/m);
    expect(md).toMatch(/^status: broken$/m);
    expect(md).toMatch(/tags: \[webmcp, tool, broken, css-modules\]/);
  });

  it('index.md incluye la tabla de frameworks detectados', () => {
    const graph = buildGraph(files, status);
    generateObsidianVault(graph, dir);
    const md = fs.readFileSync(path.join(dir, 'index.md'), 'utf8');
    expect(md).toMatch(/## Frameworks detectados/);
    expect(md).toMatch(/\| Vue \(scoped\) \| 1 \|/);
  });

  it('selectores estables no añaden framework al frontmatter', () => {
    const graph = buildGraph(files, status);
    generateObsidianVault(graph, dir);
    const md = fs.readFileSync(path.join(dir, 'herramientas', 'addToCart.md'), 'utf8');
    expect(md).not.toMatch(/^framework:/m);
    expect(md).toMatch(/^fragility: low$/m);
  });
});

describe('dashboard · filtros y exportación', () => {
  const graph = buildGraph(files, status);

  it('el HTML incluye filtros de estado, página y framework, panel de frameworks y exportar SVG', () => {
    const html = buildGraphHtml(graph);
    expect(html).toContain('id="statusFilters"');
    expect(html).toContain('id="pageFilter"');
    expect(html).toContain('id="frameworkFilter"');
    expect(html).toContain('id="frameworks"');
    expect(html).toContain('id="exportSvg"');
    expect(html).toContain('"frameworkSummary":{"CSS Modules (Next.js)":1');
    expect(html).toContain('function buildSvg()');
  });

  it('buildGraphSvg produce un SVG válido con un nodo por elemento del grafo', () => {
    const svg = buildGraphSvg(graph, { width: 800, height: 600 });
    expect(svg.startsWith('<?xml version="1.0"')).toBe(true);
    expect(svg).toContain('viewBox="0 0 800 600"');
    expect((svg.match(/<circle /g) ?? []).length).toBe(graph.nodes.length);
    expect((svg.match(/<line /g) ?? []).length).toBe(graph.edges.length);
    // El selector Next.js frágil se pinta en rojo y el estado roto en rojo.
    expect(svg).toContain('fill="#dc2626"');
    expect(svg).toMatch(/&lt;|&amp;|&quot;|styles_button__3xK9z/);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('escapa caracteres XML en etiquetas de nodos', () => {
    const g = buildGraph([
      {
        path: 'x.webmcp.css',
        toolMap: parseWebMCP('a[title="<b>&"] { webmcp-tool: "t"; }'),
      },
    ]);
    const svg = buildGraphSvg(g);
    expect(svg).toContain('&lt;b&gt;&amp;');
    expect(svg).not.toContain('<b>&');
  });

  it('serveGraphDashboard sirve /api/graph.svg', async () => {
    const server = await serveGraphDashboard(graph, 0, '127.0.0.1');
    const port = (server.address() as { port: number }).port;
    const body = await new Promise<{ status: number; type: string; text: string }>(
      (resolve, reject) => {
        http
          .get(`http://127.0.0.1:${port}/api/graph.svg`, (res) => {
            let text = '';
            res.on('data', (c) => (text += c));
            res.on('end', () =>
              resolve({
                status: res.statusCode ?? 0,
                type: String(res.headers['content-type']),
                text,
              }),
            );
          })
          .on('error', reject);
      },
    );
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    expect(body.status).toBe(200);
    expect(body.type).toContain('image/svg+xml');
    expect(body.text).toContain('<svg');
  });
});
