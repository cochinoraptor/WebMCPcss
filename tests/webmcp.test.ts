/**
 * Tests de la clase `WebMCPcss`: ejecución, parámetros, confirmación,
 * contexto, reparación transparente y fallback a la API imperativa.
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { DomAdapter } from '../src/adapters/DomAdapter';
import type { PageAdapter } from '../src/adapters/PageAdapter';
import { WebMCPcss } from '../src/core/WebMCPcss';
import { parseWebMCP } from '../src/parser';
import type { ApiToolInfo } from '../src/types';

/** HTML de tienda similar a examples/shopping-cart. */
const STORE_HTML = `
<body>
  <div class="product" data-product>
    <span class="product-price">$9.500</span>
    <input id="qty-input" value="1" />
    <button class="btn-add" data-product-id="SKU-42">Agregar</button>
    <span class="cart-badge" hidden>0</span>
  </div>
  <div class="product" data-product>
    <span class="product-price">$34.900</span>
    <input id="qty-input-2" value="1" />
    <button class="btn-add" data-product-id="SKU-99">Agregar</button>
    <span class="cart-badge" hidden>0</span>
  </div>
</body>`;

const STORE_CSS = `
[data-product] .btn-add {
  webmcp-tool: 'addToCart';
  webmcp-param-productid: attr(data-product-id);
  webmcp-description: 'Añade al carrito';
}
.product-price { webmcp-context: 'price'; webmcp-format: 'currency'; }
`;

function store(): { webmcp: WebMCPcss; dom: JSDOM } {
  const dom = new JSDOM(STORE_HTML);
  const adapter = new DomAdapter(dom.window.document, 'store://local');
  return { webmcp: new WebMCPcss(parseWebMCP(STORE_CSS), adapter), dom };
}

describe('WebMCPcss.execute', () => {
  it('dispara el clic, resuelve parámetros declarados y confirma', async () => {
    const { webmcp, dom } = store();
    // La tienda confirma el carrito mostrando el badge.
    dom.window.document.addEventListener('click', (ev) => {
      const target = ev.target as dom.window.HTMLElement;
      if (target.classList.contains('btn-add')) {
        const badge = target.closest('.product')!.querySelector('.cart-badge')!;
        badge.removeAttribute('hidden');
      }
    });
    const result = await webmcp.execute('addToCart');
    expect(result.success).toBe(true);
    expect(result.via).toBe('css');
    expect(result.data?.params['productid']).toBe('SKU-42'); // primer botón
  });

  it('desambigua el elemento por los parámetros aportados', async () => {
    const { webmcp, dom } = store();
    const clicked: string[] = [];
    dom.window.document.addEventListener('click', (ev) => {
      const target = ev.target as dom.window.HTMLElement;
      if (target.classList.contains('btn-add')) {
        clicked.push(target.getAttribute('data-product-id') ?? '');
        const badge = target.closest('.product')!.querySelector('.cart-badge')!;
        badge.removeAttribute('hidden');
      }
    });
    const result = await webmcp.execute('addToCart', { productid: 'SKU-99' });
    expect(result.success).toBe(true);
    expect(result.data?.params['productid']).toBe('SKU-99');
    expect(clicked).toEqual(['SKU-99']);
  });

  it('falla si la confirmación configurada no aparece', async () => {
    const dom = new JSDOM(STORE_HTML);
    const css = parseWebMCP(`
      [data-product] .btn-add {
        webmcp-tool: 'addToCart';
        webmcp-confirmation: '.cart-badge:not([hidden])';
      }
    `);
    const webmcp = new WebMCPcss(css, new DomAdapter(dom.window.document));
    const result = await webmcp.execute('addToCart');
    expect(result.success).toBe(false);
    expect(result.data?.confirmed).toBe(false);
    expect(result.error).toContain('webmcp-confirmation');
  });

  it('repara el selector roto de forma transparente y reintenta', async () => {
    const { webmcp, dom } = store();
    // Rediseño: .btn-add → .buy-now
    for (const btn of dom.window.document.querySelectorAll('.btn-add')) {
      btn.className = 'buy-now';
    }
    webmcp.getToolMap().tools['addToCart'].selector = '[data-product] .btn-add';
    dom.window.document.addEventListener('click', (ev) => {
      const target = ev.target as dom.window.HTMLElement;
      if (target.classList.contains('buy-now')) {
        target
          .closest('.product')!
          .querySelector('.cart-badge')!
          .removeAttribute('hidden');
      }
    });
    const result = await webmcp.execute('addToCart');
    expect(result.success).toBe(true);
    expect(result.data?.repaired).toEqual({
      from: '[data-product] .btn-add',
      to: '[data-product] .buy-now',
    });
    // El mapa en memoria quedó actualizado.
    expect(webmcp.getToolMap().tools['addToCart'].selector).toBe(
      '[data-product] .buy-now',
    );
  });
});

describe('WebMCPcss.getContext', () => {
  it('lee el texto normalizado del primer elemento', async () => {
    const { webmcp } = store();
    expect(await webmcp.getContext('price')).toBe('$9.500');
  });

  it('devuelve null para contextos desconocidos o sin elementos', async () => {
    const { webmcp } = store();
    expect(await webmcp.getContext('no-existe')).toBeNull();
  });
});

describe('WebMCPcss: fallback a la API imperativa', () => {
  it('ejecuta vía api cuando la herramienta no está en el CSS', async () => {
    const adapter: PageAdapter = new DomAdapter(
      new JSDOM('<body></body>').window.document,
    );
    const apiAdapter = Object.assign(adapter, {
      listApiTools: async (): Promise<ApiToolInfo[]> => [
        { name: 'searchFlights', description: 'Busca vuelos' },
      ],
      invokeApiTool: async (name: string, args: Record<string, unknown>) => {
        if (name !== 'searchFlights') throw new Error('no registrada');
        return { results: args };
      },
    });
    const webmcp = new WebMCPcss({ tools: {}, context: {} }, apiAdapter);
    expect(await webmcp.listApiTools()).toEqual([
      { name: 'searchFlights', description: 'Busca vuelos' },
    ]);
    const result = await webmcp.execute('searchFlights', { from: 'BOG' });
    expect(result.via).toBe('api');
    expect(result.success).toBe(true);
  });

  it('herramienta desconocida sin fuente de API → error claro', async () => {
    const dom = new JSDOM('<body></body>');
    const webmcp = new WebMCPcss(
      { tools: {}, context: {} },
      new DomAdapter(dom.window.document),
    );
    const result = await webmcp.execute('nonsense');
    expect(result.success).toBe(false);
    expect(result.error).toContain('nonsense');
  });
});
