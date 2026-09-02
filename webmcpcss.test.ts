/**
 * Tests de la clase WebMCPcss y la lógica de auto-reparación.
 * Usa jsdom (vía DomAdapter) para no depender de un navegador real.
 */
// @vitest-environment node
import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';
import { DomAdapter } from '../src/adapters/dom-adapter';
import { WebMCPcss } from '../src/core';
import { repairToolMap } from '../src/core/repair';
import { findBestCandidate, humanize, tokenSimilarity } from '../src/core/vision';
import { parseWebMCP } from '../src/parser';
import type { ToolMap } from '../src/types';

const WEBMCP_CSS = `
[data-product] .btn-add {
  webmcp-tool: "addToCart";
  webmcp-param-productId: attr(data-product-id);
  webmcp-param-quantity: value(#qty-input);
  webmcp-confirmation: ".cart-badge";
}
.coupon-form input[type="text"] {
  webmcp-tool: "applyCoupon";
  webmcp-param-code: value();
  webmcp-trigger: "submit" on .coupon-form;
}
.product-price {
  webmcp-context: "price";
  webmcp-format: "currency";
}
`;

/** Página original: los selectores del CSS funcionan. */
const PAGE_V1 = `<!doctype html><html><body>
  <span id="cart-indicator"></span>
  <section data-product data-product-id="SKU-42">
    <div class="product-price">$249.900</div>
    <input type="number" id="qty-input" value="1" />
    <button class="btn-add" data-action="add-to-cart">Añadir al carrito</button>
  </section>
  <form class="coupon-form">
    <input type="text" id="coupon-code" name="coupon" />
  </form>
</body></html>`;

/**
 * Página rediseñada: `.btn-add` ya no existe (ahora `.buy-button`) y
 * `.product-price` pasó a ser `.price-tag`, pero los data-* y el texto
 * visible se conservan.
 */
const PAGE_V2 = `<!doctype html><html><body>
  <span id="cart-indicator"></span>
  <section class="pdp" data-product data-product-id="SKU-42">
    <div class="price-tag">$249.900</div>
    <input type="number" id="qty-input" value="1" />
    <button class="buy-button" data-action="add-to-cart">Añadir al carrito</button>
  </section>
  <form class="coupon-form">
    <input type="text" id="coupon-code" name="coupon" />
  </form>
</body></html>`;

/** Crea un DOM con lógica de carrito funcional (badge de confirmación). */
function makeDom(html: string): JSDOM {
  const dom = new JSDOM(html, { runScripts: 'outside-only' });
  const doc = dom.window.document;
  const addBtn = doc.querySelector('[data-action="add-to-cart"]');
  addBtn?.addEventListener('click', () => {
    if (!doc.querySelector('.cart-badge')) {
      const badge = doc.createElement('span');
      badge.className = 'cart-badge';
      badge.textContent = '1';
      doc.getElementById('cart-indicator')?.appendChild(badge);
    }
  });
  doc.querySelector('.coupon-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
  });
  return dom;
}

describe('WebMCPcss.execute (selectores intactos)', () => {
  let toolMap: ToolMap;
  let webmcp: WebMCPcss;

  beforeEach(() => {
    toolMap = parseWebMCP(WEBMCP_CSS);
    webmcp = new WebMCPcss(toolMap, new DomAdapter(makeDom(PAGE_V1).window.document));
  });

  it('ejecuta addToCart: rellena cantidad, hace click y confirma', async () => {
    const result = await webmcp.execute('addToCart', { quantity: '3' });
    expect(result.success).toBe(true);
    expect(result.repaired).toBe(false);
    expect(result.data?.productId).toBe('SKU-42');
    expect(result.data?.quantity).toBe('3');
    expect(result.data?.confirmed).toBe(true);
  });

  it('ejecuta applyCoupon con trigger submit', async () => {
    const result = await webmcp.execute('applyCoupon', { code: 'DESCUENTO10' });
    expect(result.success).toBe(true);
    expect(result.data?.code).toBe('DESCUENTO10');
  });

  it('lee contexto con formato currency', async () => {
    const price = await webmcp.getContext('price');
    expect(price).toBe('249.900');
  });

  it('falla con herramienta desconocida', async () => {
    const result = await webmcp.execute('noExiste');
    expect(result.success).toBe(false);
    expect(result.error).toContain('noExiste');
  });
});

describe('WebMCPcss auto-reparación (página rediseñada)', () => {
  let toolMap: ToolMap;
  let webmcp: WebMCPcss;

  beforeEach(() => {
    toolMap = parseWebMCP(WEBMCP_CSS);
    // Huella capturada en la versión anterior del sitio (como haría generate/validate).
    toolMap.tools.addToCart.fingerprint = {
      tag: 'button',
      text: 'Añadir al carrito',
      attrs: { 'data-action': 'add-to-cart' },
    };
    webmcp = new WebMCPcss(toolMap, new DomAdapter(makeDom(PAGE_V2).window.document));
  });

  it('repara el selector roto, actualiza el toolMap en memoria y reintenta', async () => {
    const result = await webmcp.execute('addToCart', { quantity: '2' });
    expect(result.success).toBe(true);
    expect(result.repaired).toBe(true);
    // El nuevo selector debe ser estable (data-* priorizado).
    expect(result.newSelector).toBe('[data-action="add-to-cart"]');
    // El toolMap en memoria queda actualizado.
    expect(toolMap.tools.addToCart.selector).toBe('[data-action="add-to-cart"]');
    expect(result.data?.confirmed).toBe(true);
  });

  it('repara un selector de contexto roto por texto', async () => {
    toolMap.context.price.fingerprint = { tag: 'div', text: '$249.900' };
    const price = await webmcp.getContext('price');
    expect(price).toBe('249.900');
    expect(toolMap.context.price.selector).not.toBe('.product-price');
  });

  it('devuelve error si no hay candidato razonable', async () => {
    const map = parseWebMCP('.selector-inexistente { webmcp-tool: "fantasma"; }');
    map.tools.fantasma.fingerprint = {
      tag: 'video',
      text: 'zzzz qqqq xxxx wwww',
      attrs: { 'data-nope': 'nada' },
    };
    const g = new WebMCPcss(map, new DomAdapter(makeDom(PAGE_V2).window.document), {
      repairThreshold: 0.9,
    });
    const result = await g.execute('fantasma');
    expect(result.success).toBe(false);
    expect(result.error).toContain('reparar');
  });

  it('con autoRepair desactivado falla sin intentar reparación', async () => {
    const g = new WebMCPcss(toolMap, new DomAdapter(makeDom(PAGE_V2).window.document), {
      autoRepair: false,
    });
    const result = await g.execute('addToCart');
    expect(result.success).toBe(false);
    expect(result.error).toContain('auto-reparación desactivada');
  });
});

describe('repairToolMap', () => {
  it('repara todos los selectores rotos y no toca los válidos', async () => {
    const toolMap = parseWebMCP(WEBMCP_CSS);
    toolMap.tools.addToCart.fingerprint = {
      tag: 'button',
      text: 'Añadir al carrito',
      attrs: { 'data-action': 'add-to-cart' },
    };
    toolMap.context.price.fingerprint = { tag: 'div', text: '$249.900' };

    const adapter = new DomAdapter(makeDom(PAGE_V2).window.document);
    const results = await repairToolMap(adapter, toolMap);

    // addToCart y price estaban rotos; applyCoupon seguía válido.
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['addToCart', 'price']);
    expect(results.every((r) => r.repaired)).toBe(true);
    expect(toolMap.tools.applyCoupon.selector).toBe('.coupon-form input[type="text"]');
    expect(await adapter.exists(toolMap.tools.addToCart.selector)).toBe(true);
    expect(await adapter.exists(toolMap.context.price.selector)).toBe(true);
  });
});

describe('módulo de visión', () => {
  it('humanize convierte camelCase en palabras', () => {
    expect(humanize('addToCart')).toBe('add to cart');
    expect(humanize('apply-coupon')).toBe('apply coupon');
  });

  it('tokenSimilarity mide solapamiento de tokens', () => {
    expect(tokenSimilarity('añadir al carrito', 'Añadir al carrito')).toBe(1);
    expect(tokenSimilarity('add to cart', 'delete account')).toBe(0);
  });

  it('findBestCandidate respeta el umbral', () => {
    const candidates = [
      {
        selector: '.a',
        tag: 'button',
        text: 'Comprar ahora',
        attrs: {},
        visible: true,
      },
    ];
    expect(
      findBestCandidate(candidates, { text: 'zzz qqq', tags: ['video'] }, 0.9),
    ).toBeNull();
  });
});
