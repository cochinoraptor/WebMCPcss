/**
 * Tests del módulo de Mapas de Contenido (grafo, fragilidad, Obsidian).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildGraph } from '../src/graph/builder';
import { analyzeFragility } from '../src/graph/fragility';
import { generateObsidianVault } from '../src/graph/obsidian';
import { buildGraphHtml } from '../src/graph/dashboard';
import {
  sanitizeFileName,
  uniqueFileNames,
  wikiLink,
  yamlEscape,
} from '../src/graph/utils';
import { parseWebMCP } from '../src/parser';
import type { ParsedFile, StatusResult } from '../src/graph/types';

/** Tool map de ejemplo compartido por varios tests. */
const CSS = `
#add-to-cart {
  webmcp-tool: addToCart;
  webmcp-description: "Añade el producto al carrito";
  webmcp-param-quantity: value(#qty-input);
  webmcp-confirmation: .cart-badge;
}
.coupon-form button {
  webmcp-tool: applyCoupon;
  webmcp-param-code: value(.coupon-form input);
}
#add-to-cart {
  webmcp-tool: buyNow;
}
`;

function parsedFixture(): ParsedFile[] {
  return [{ path: '/proyecto/shopping-cart/webmcp.css', toolMap: parseWebMCP(CSS) }];
}

/* ------------------------------------------------------------------ */
/* Utils                                                              */
/* ------------------------------------------------------------------ */

describe('graph/utils', () => {
  it('sanitizeFileName elimina caracteres inválidos en Windows/Linux/macOS', () => {
    expect(sanitizeFileName('#add-to-cart > button:nth-child(2)')).toBe(
      '-add-to-cart - button-nth-child(2)',
    );
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(sanitizeFileName('  con espacios.  ')).toBe('con espacios');
    expect(sanitizeFileName('###')).toBe('sin-nombre');
    expect(sanitizeFileName('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it('uniqueFileNames desambigua colisiones con sufijos', () => {
    const names = uniqueFileNames(['a#b', 'a*b', 'c']);
    expect(names.get('a#b')).toBe('a-b');
    expect(names.get('a*b')).toBe('a-b-2');
    expect(names.get('c')).toBe('c');
  });

  it('yamlEscape y wikiLink', () => {
    expect(yamlEscape('di "hola"')).toBe('"di \\"hola\\""');
    expect(wikiLink('nota', 'Alias')).toBe('[[nota|Alias]]');
    expect(wikiLink('nota')).toBe('[[nota]]');
  });
});

/* ------------------------------------------------------------------ */
/* Fragilidad                                                         */
/* ------------------------------------------------------------------ */

describe('graph/fragility — frameworks', () => {
  const cases: Array<[string, string, 'low' | 'medium' | 'high']> = [
    ['[data-v-7ba5bd90] .price', 'Vue (scoped)', 'high'],
    ['.svelte-1x8r9z2 button', 'Svelte', 'high'],
    ['[_ngcontent-c12] .item', 'Angular', 'high'],
    ['.sc-bdVaJa', 'styled-components', 'high'],
    ['.css-1q2w3e4', 'Emotion', 'high'],
    ['.Button__primary___a3xk9', 'CSS Modules', 'high'],
    ['.jss42 > span', 'JSS / MUI v4', 'high'],
    ['.MuiButton-containedPrimary', 'MUI v5', 'low'],
    ['.ant-btn-primary', 'Ant Design', 'low'],
    ['.btn-primary', 'Bootstrap', 'low'],
  ];
  it.each(cases)('detecta %s → %s (%s)', (selector, framework, level) => {
    const score = analyzeFragility(selector);
    expect(score.frameworks).toContain(framework);
    expect(score.level).toBe(level);
  });

  it('Tailwind como selector es frágil (medium)', () => {
    const score = analyzeFragility('.bg-blue-500.px-4');
    expect(score.frameworks).toContain('Tailwind CSS');
    expect(score.level).toBe('medium');
    expect(score.suggestions.join(' ')).toMatch(/data-tool/);
  });

  it('heurísticas estructurales: nth-child, cadenas largas, solo etiquetas', () => {
    expect(analyzeFragility('div > ul > li:nth-child(3) > button').level).toBe('high');
    expect(analyzeFragility('main section div span').level).toBe('high');
    const tagOnly = analyzeFragility('form button');
    expect(tagOnly.level).toBe('medium');
    expect(tagOnly.reasons.join(' ')).toMatch(/etiquetas/);
  });

  it('ids autogenerados (React useId, hashes) son high', () => {
    expect(analyzeFragility('#«r1»').level).toBe('high');
    expect(analyzeFragility('#input-38271').level).toBe('high');
  });

  it('selectores estables (id semántico, data-*) son low', () => {
    expect(analyzeFragility('#add-to-cart').level).toBe('low');
    const dataSel = analyzeFragility('[data-tool="buy"]');
    expect(dataSel.level).toBe('low');
    expect(dataSel.reasons.join(' ')).toMatch(/estable/);
  });

  it('framework declarado añade sugerencia aunque no se detecte', () => {
    const score = analyzeFragility('form button', 'vue');
    expect(score.suggestions.join(' ')).toMatch(/data-tool/);
  });

  it('nivel high siempre sugiere webmcp-fingerprint', () => {
    const score = analyzeFragility('.sc-bdVaJa');
    expect(score.suggestions.join(' ')).toMatch(/fingerprint/);
  });
});

/* ------------------------------------------------------------------ */
/* Builder                                                            */
/* ------------------------------------------------------------------ */

describe('graph/builder', () => {
  it('crea nodos tool/selector/param/page y aristas uses/requires/belongs-to', () => {
    const graph = buildGraph(parsedFixture());
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain('tool:addToCart');
    expect(ids).toContain('tool:applyCoupon');
    expect(ids).toContain('selector:#add-to-cart');
    expect(ids).toContain('param:addToCart.quantity');
    expect(ids).toContain('page:shopping-cart');
    expect(graph.edges).toContainEqual({
      source: 'tool:addToCart',
      target: 'selector:#add-to-cart',
      type: 'uses',
    });
    expect(graph.edges).toContainEqual({
      source: 'tool:addToCart',
      target: 'param:addToCart.quantity',
      type: 'requires',
    });
    expect(graph.edges).toContainEqual({
      source: 'tool:addToCart',
      target: 'page:shopping-cart',
      type: 'belongs-to',
    });
  });

  it('detecta selectores compartidos (shares-selector)', () => {
    const graph = buildGraph(parsedFixture());
    const shares = graph.edges.filter((e) => e.type === 'shares-selector');
    expect(shares).toHaveLength(1);
    expect([shares[0].source, shares[0].target].sort()).toEqual([
      'tool:addToCart',
      'tool:buyNow',
    ]);
  });

  it('incorpora estado de validación (has-status, statusCounts)', () => {
    const status: StatusResult = {
      url: 'https://tienda.test',
      entries: [
        { name: 'addToCart', kind: 'tool', selector: '#add-to-cart', ok: true },
        { name: 'applyCoupon', kind: 'tool', selector: '.coupon-form button', ok: false },
        { name: 'buyNow', kind: 'tool', selector: '#add-to-cart', ok: true },
      ],
    };
    const graph = buildGraph(parsedFixture(), [status]);
    expect(graph.nodes.map((n) => n.id)).toContain('status:ok');
    expect(graph.nodes.map((n) => n.id)).toContain('status:broken');
    expect(graph.edges).toContainEqual({
      source: 'tool:applyCoupon',
      target: 'status:broken',
      type: 'has-status',
    });
    expect(graph.metadata?.statusCounts).toEqual({ ok: 2, broken: 1 });
  });

  it('calcula metadata (totales y resumen de fragilidad)', () => {
    const graph = buildGraph(parsedFixture());
    expect(graph.metadata?.totalTools).toBe(3);
    expect(graph.metadata?.totalSelectors).toBe(2);
    expect(graph.metadata?.totalPages).toBe(1);
    const summary = graph.metadata?.fragilitySummary ?? {};
    expect(Object.values(summary).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('con fragility:false no analiza selectores', () => {
    const graph = buildGraph(parsedFixture(), undefined, { fragility: false });
    const sel = graph.nodes.find((n) => n.id === 'selector:#add-to-cart');
    expect(sel?.metadata?.fragility).toBeUndefined();
    expect(graph.metadata?.fragilitySummary).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* Obsidian                                                           */
/* ------------------------------------------------------------------ */

describe('graph/obsidian', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-vault-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('genera la estructura completa del vault', () => {
    const status: StatusResult = {
      entries: [{ name: 'addToCart', kind: 'tool', selector: '#add-to-cart', ok: true }],
    };
    const written = generateObsidianVault(buildGraph(parsedFixture(), [status]), tmp);
    expect(written.length).toBeGreaterThanOrEqual(7);
    expect(fs.existsSync(path.join(tmp, 'index.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'herramientas', 'addToCart.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'selectores', '-add-to-cart.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'paginas', 'shopping-cart.md'))).toBe(true);
    expect(fs.existsSync(path.join(tmp, 'estados', 'OK.md'))).toBe(true);
  });

  it('las notas de herramienta llevan frontmatter YAML y backlinks', () => {
    const note = fs.readFileSync(path.join(tmp, 'herramientas', 'addToCart.md'), 'utf8');
    expect(note).toMatch(/^---\ntype: tool\nname: "addToCart"/);
    expect(note).toContain('status: ok');
    expect(note).toContain('fragility: low');
    expect(note).toContain('> Añade el producto al carrito');
    expect(note).toContain('[[selectores/-add-to-cart|#add-to-cart]]');
    expect(note).toContain('[[paginas/shopping-cart|shopping-cart]]');
    expect(note).toContain('**quantity** — fuente: `value`');
    expect(note).toContain('## Comparte selector con');
    expect(note).toContain('[[herramientas/buyNow|buyNow]]');
  });

  it('las notas de selector incluyen fragilidad y herramientas que lo usan', () => {
    const note = fs.readFileSync(path.join(tmp, 'selectores', '-add-to-cart.md'), 'utf8');
    expect(note).toContain('type: selector');
    expect(note).toContain('## Fragilidad: 🟢 low');
    expect(note).toContain('[[herramientas/addToCart|addToCart]]');
    expect(note).toContain('[[herramientas/buyNow|buyNow]]');
  });

  it('index.md contiene estadísticas y enlaces a todas las notas', () => {
    const index = fs.readFileSync(path.join(tmp, 'index.md'), 'utf8');
    expect(index).toContain('| Herramientas | 3 |');
    expect(index).toContain('| Selectores | 2 |');
    expect(index).toContain('[[herramientas/applyCoupon|applyCoupon]]');
    expect(index).toContain('[[paginas/shopping-cart|shopping-cart]]');
  });
});

/* ------------------------------------------------------------------ */
/* Dashboard HTML                                                     */
/* ------------------------------------------------------------------ */

describe('graph/dashboard', () => {
  it('buildGraphHtml embebe el grafo y carga Cytoscape por CDN', () => {
    const html = buildGraphHtml(buildGraph(parsedFixture()));
    expect(html).toContain('cytoscape.min.js');
    expect(html).toContain('"tool:addToCart"');
    expect(html).toContain('exportJson');
    expect(html).toContain('exportPng');
    // El JSON embebido escapa < para evitar cierre prematuro del <script>.
    expect(html).not.toMatch(/var GRAPH = [^;]*<\/script/);
  });
});

/* ------------------------------------------------------------------ */
/* Integración CLI (requiere build previo: npm run build)              */
/* ------------------------------------------------------------------ */

const CLI = path.resolve(__dirname, '../dist/src/cli.js');

describe.skipIf(!fs.existsSync(CLI))('CLI graph (integración)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-cli-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('genera JSON y vault desde examples/shopping-cart', () => {
    const out = path.join(tmp, 'graph.json');
    const vault = path.join(tmp, 'vault');
    const stdout = execFileSync(
      'node',
      [
        CLI,
        'graph',
        'examples/shopping-cart/webmcp.css',
        '--output',
        out,
        '--obsidian',
        vault,
      ],
      { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' },
    );
    expect(stdout).toMatch(/Grafo:/);
    const graph = JSON.parse(fs.readFileSync(out, 'utf8')) as {
      nodes: Array<{ id: string }>;
    };
    expect(graph.nodes.map((n) => n.id)).toContain('tool:addToCart');
    expect(fs.existsSync(path.join(vault, 'index.md'))).toBe(true);
    expect(fs.existsSync(path.join(vault, 'herramientas', 'addToCart.md'))).toBe(true);
  });
});
