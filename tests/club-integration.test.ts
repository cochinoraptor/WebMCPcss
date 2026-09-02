/**
 * Test de integración contra el DOM renderizado real de una SPA Vue
 * (carta de productos con clases scoped `data-v-*`).
 *
 * Fixtures y escenarios aportados por @ctangarife en el PR #2
 * (github.com/cochinoraptor/WebMCPcss/pull/2), adaptados a la API de esta
 * base de código. Reproduce el bucle completo:
 * parse → validate → getContext → rediseño que rompe el selector →
 * repair por huella → retry, e incorpora la lección del POC original:
 * la etiqueta sola no basta para identificar un candidato.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { DomAdapter } from '../src/adapters/dom-adapter';
import { WebMCPcss } from '../src/core';
import { parseWebMCP } from '../src/parser';
import { analyzeFragility } from '../src/graph';
import type { ToolMap } from '../src/types';

const FIXTURES = join(__dirname, 'fixtures');
const css = readFileSync(join(FIXTURES, 'club.webmcp.css'), 'utf8');
const html = readFileSync(join(FIXTURES, 'club-menu.html'), 'utf8');

const CARDS = 10; // tarjetas de producto en el fixture
const CHIPS = 10; // chips de categoría

/** DOM aislado por test. */
function menuDom(): { dom: JSDOM; adapter: DomAdapter } {
  const dom = new JSDOM(html);
  return { dom, adapter: new DomAdapter(dom.window.document) };
}

/** Huella realista de los botones de añadir (como la capturaría generate). */
function withFingerprint(map: ToolMap): ToolMap {
  map.tools['addToCart'].fingerprint = {
    tag: 'button',
    text: '+',
    attrs: { 'aria-label': 'Agregar Club colombia dorada 330 ml lata al pedido' },
  };
  return map;
}

describe('Integración SPA Vue real (fixtures del PR #2 de @ctangarife)', () => {
  it('parse: el CSS del POC produce el tool map esperado', () => {
    const map = parseWebMCP(css);
    expect(Object.keys(map.tools).sort()).toEqual(['addToCart', 'filterMenu']);
    expect(map.tools['addToCart'].selector).toBe('.product-card .card-add');
    expect(map.tools['addToCart'].params['product']).toMatchObject({
      source: 'attr',
      value: 'aria-label',
    });
    expect(map.tools['addToCart'].confirmation).toBe('.cart-badge, [class*=badge]');
    expect(map.context['price']).toMatchObject({
      selector: '.product-card .card-price',
      format: 'currency',
    });
    expect(map.tools['filterMenu'].params['category']).toMatchObject({ source: 'text' });
  });

  it('validate: herramientas y contextos resuelven en el DOM real', async () => {
    const { adapter, dom } = menuDom();
    const webmcp = new WebMCPcss(parseWebMCP(css), adapter);
    const report = await webmcp.validate();
    // La confirmación (.cart-badge) es diferida: no cuenta como fallo.
    expect(report.failed).toBe(0);
    const doc = dom.window.document;
    expect(doc.querySelectorAll('.product-card .card-add')).toHaveLength(CARDS);
    expect(doc.querySelectorAll('.cat-chip')).toHaveLength(CHIPS);
  });

  it('getContext: lee los precios reales de la carta', async () => {
    const { adapter, dom } = menuDom();
    const webmcp = new WebMCPcss(parseWebMCP(css), adapter);
    // Nuestro getContext normaliza format:currency (sin símbolo).
    expect(await webmcp.getContext('price')).toBe('9.500'); // Club dorada
    const prices = dom.window.document.querySelectorAll('.card-price');
    expect(prices).toHaveLength(CARDS);
    expect(prices[1].textContent).toContain('$34.900'); // Chouffe Blonde
  });

  it('rediseño → selector roto → repair por huella → retry OK', async () => {
    const { adapter, dom } = menuDom();
    const map = withFingerprint(parseWebMCP(css));
    const doc = dom.window.document;

    // Rediseño simulado: .card-add pasa a llamarse .quick-add-button.
    for (const btn of Array.from(doc.querySelectorAll('.card-add'))) {
      btn.className = 'quick-add-button';
    }
    map.tools['addToCart'].selector = '.product-card .card-add';

    const webmcp = new WebMCPcss(map, adapter);
    const before = await webmcp.validate();
    expect(before.entries.find((e) => e.name === 'addToCart')?.ok).toBe(false);

    const results = await webmcp.repairAll();
    const outcome = results.find((r) => r.name === 'addToCart');
    expect(outcome?.repaired).toBe(true);
    // El selector inferido debe resolver a los 10 botones nuevos.
    const repairedSel = map.tools['addToCart'].selector;
    expect(doc.querySelectorAll(repairedSel)).toHaveLength(CARDS);

    const after = await webmcp.validate();
    expect(after.entries.find((e) => e.name === 'addToCart')?.ok).toBe(true);
  });

  it('lección del POC: la etiqueta sola no identifica al candidato', async () => {
    const { adapter, dom } = menuDom();
    const map = withFingerprint(parseWebMCP(css));
    const doc = dom.window.document;

    // Rediseño hostil: además del renombrado aparece OTRA familia de
    // botones "+" por tarjeta (notas), con aria-label distinto.
    for (const btn of Array.from(doc.querySelectorAll('.card-add'))) {
      btn.className = 'quick-add-button';
    }
    for (const card of Array.from(doc.querySelectorAll('.product-card'))) {
      card.insertAdjacentHTML(
        'beforeend',
        '<button class="quick-add-note" aria-label="Añadir nota interna">+</button>',
      );
    }
    map.tools['addToCart'].selector = '.product-card .card-add';

    const webmcp = new WebMCPcss(map, adapter);
    const results = await webmcp.repairAll();
    const outcome = results.find((r) => r.name === 'addToCart');
    // La huella (aria-label "Agregar … al pedido") desambigua: debe elegir
    // la familia correcta, no la de notas.
    expect(outcome?.repaired).toBe(true);
    const sel = map.tools['addToCart'].selector;
    expect(sel).not.toContain('quick-add-note');
    const matched = Array.from(doc.querySelectorAll(sel));
    expect(matched.length).toBeGreaterThan(0);
    expect(
      matched.every((el) => el.getAttribute('aria-label')?.startsWith('Agregar')),
    ).toBe(true);
  });

  it('fragilidad: el grafo marca data-v-* como high y las clases del POC como low', () => {
    // Conexión con el módulo graph (v0.4.0): el fixture demuestra por qué.
    expect(analyzeFragility('[data-v-ffd11f8a] .cat-chip').level).toBe('high');
    expect(analyzeFragility('.product-card .card-add').level).toBe('low');
  });
});
