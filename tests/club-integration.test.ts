/**
 * Test de integración: puerto del POC original (`~/develop/webmcp-poc/sim_webmcp.py`)
 * ejecutado contra una copia recortada del DOM renderizado real de la carta
 * de Club Estantería (tests/fixtures/club-menu.html).
 *
 * Reproduce el bucle completo: parse(.webmcp.css) → tool map JSON →
 * validate contra el DOM → getContext(currency) → rediseño que rompe el
 * selector → repair por huella (modo visión) → retry.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { JSDOM } from 'jsdom';
import { DomAdapter } from '../src/adapters/DomAdapter';
import { parseWebMCP } from '../src/parser';
import { repairTool } from '../src/core/repair';
import { validateToolMap } from '../src/core/validate';

const FIXTURES = join(__dirname, 'fixtures');
const css = readFileSync(join(FIXTURES, 'club.webmcp.css'), 'utf8');
const html = readFileSync(join(FIXTURES, 'club-menu.html'), 'utf8');

/** Crea un DOM del fixture (aislado entre tests). */
function menuDom(): { dom: JSDOM; adapter: DomAdapter } {
  const dom = new JSDOM(html);
  return { dom, adapter: new DomAdapter(dom.window.document, 'club://menu') };
}

const CARDS = 10;
const CHIPS = 10;

describe('POC Club Estantería: bucle completo contra el DOM real', () => {
  it('1. parse: el CSS del POC produce el tool map esperado', () => {
    const map = parseWebMCP(css);
    expect(Object.keys(map.tools).sort()).toEqual(['addToCart', 'filterMenu']);
    expect(map.tools['addToCart'].selector).toBe('.product-card .card-add');
    expect(map.tools['addToCart'].params['product']).toEqual({
      source: 'attr',
      value: 'aria-label',
    });
    expect(map.tools['addToCart'].confirmation).toBe('.cart-badge, [class*=badge]');
    expect(map.context['price']).toEqual({
      selector: '.product-card .card-price',
      format: 'currency',
    });
    expect(map.tools['filterMenu'].params['category']).toEqual({ source: 'text' });
  });

  it('2. validate: todas las herramientas y contextos resuelven en el DOM real', async () => {
    const { adapter } = menuDom();
    const report = await validateToolMap(adapter, parseWebMCP(css));
    const byName = Object.fromEntries(report.entries.map((e) => [e.name, e]));
    expect(report.ok).toBe(true);
    expect(byName['addToCart'].count).toBe(CARDS);
    expect(byName['filterMenu'].count).toBe(CHIPS);
    expect(byName['price'].count).toBe(CARDS);
  });

  it('3. getContext: lee los precios reales de la carta', async () => {
    const { adapter, dom } = menuDom();
    const webmcp = new (await import('../src/core/WebMCPcss')).WebMCPcss(
      parseWebMCP(css),
      adapter,
    );
    const first = dom.window.document.querySelector(
      '.product-card .card-name',
    )?.textContent;
    expect(first).toContain('Club colombia dorada');
    // El primer precio del fixture real es $9.500 (Club dorada).
    expect(await webmcp.getContext('price')).toBe('$9.500');
    // Todos los precios terminan en formato de moneda pesosa.
    const prices = dom.window.document.querySelectorAll('.card-price');
    expect(prices.length).toBe(CARDS);
    expect(prices[1].textContent).toContain('$34.900'); // Chouffe Blonde
  });

  it('4. rediseño → selector roto → repair por huella → retry', async () => {
    const { adapter, dom } = menuDom();
    const map = parseWebMCP(css);

    // Rediseño simulado: .card-add pasa a llamarse .quick-add-button
    // (exactamente como en el POC).
    for (const btn of dom.window.document.querySelectorAll('.card-add')) {
      btn.className = 'quick-add-button';
    }
    map.tools['addToCart'].selector = '.product-card .quick-add-button-NO';

    const brokenReport = await validateToolMap(adapter, map);
    const broken = brokenReport.entries.find((e) => e.name === 'addToCart');
    expect(broken?.ok).toBe(false);
    expect(broken?.count).toBe(0);

    // Modo visión: huella = botones con aria-label "Agregar …" y texto "+"
    // dentro del scope .product-card. Debe inferir el selector estable nuevo.
    const outcome = await repairTool(adapter, map, 'addToCart');
    expect(outcome.repaired).toBe(true);
    expect(outcome.to).toBe('.product-card .quick-add-button');
    expect(outcome.ambiguous).toBeFalsy();

    // Retry: la validación vuelve a estar OK con los 10 botones.
    const retryReport = await validateToolMap(adapter, map);
    const repaired = retryReport.entries.find((e) => e.name === 'addToCart');
    expect(repaired?.ok).toBe(true);
    expect(repaired?.count).toBe(CARDS);
  });

  it('lección del POC: familias empatadas no se reparan a ciegas sin confirmación', async () => {
    const { adapter, dom } = menuDom();
    const map = parseWebMCP(css);
    const doc = dom.window.document;

    // Rediseño hostil: los botones pasan a .quick-add-button y además el
    // rediseño introduce una SEGUNDA familia con la misma huella y el mismo
    // número de elementos (el caso "213 candidatos para 212 tarjetas" del
    // POC: dos familias indistinguibles).
    for (const btn of doc.querySelectorAll('.card-add')) {
      btn.className = 'quick-add-button';
    }
    for (const card of doc.querySelectorAll('.product-card')) {
      card.insertAdjacentHTML(
        'beforeend',
        '<button class="quick-add-note" aria-label="Agregar nota al pedido">+</button>',
      );
    }
    map.tools['addToCart'].selector = '.product-card .card-add-ROTO';
    map.tools['addToCart'].confirmation = undefined;

    // Sin confirmación: el empate entre familias bloquea la reparación.
    const outcome = await repairTool(adapter, map, 'addToCart');
    expect(outcome.repaired).toBe(false);
    expect(outcome.reason).toBe('ambiguous');
    expect(outcome.ambiguous).toBe(true);
    expect(map.tools['addToCart'].selector).toBe('.product-card .card-add-ROTO');

    // Con confirmación (allowAmbiguous) se acepta la familia mayor,
    // marcando el empate para verificar la confirmación tras la acción.
    const outcome2 = await repairTool(adapter, map, 'addToCart', {
      allowAmbiguous: true,
    });
    expect(outcome2.repaired).toBe(true);
    expect(outcome2.ambiguous).toBe(true);
    expect(outcome2.to).toBe('.product-card .quick-add-button');
  });
});
