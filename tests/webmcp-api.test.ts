/**
 * Tests del módulo webmcp-api: shim de captura de registerTool y
 * generador de código (CSS → API).
 */
import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { buildInputSchema, generateApiScript } from '../src/webmcp-api/generator';
import { normalizeRegistered, WEBMCP_API_SHIM_SOURCE } from '../src/webmcp-api/shim';
import { parseWebMCP } from '../src/parser';

describe('shim de navigator.modelContext', () => {
  it('captura registerTool cuando la API no existe', () => {
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
    dom.window.eval(WEBMCP_API_SHIM_SOURCE);
    const mc = (
      dom.window.navigator as unknown as {
        modelContext: { registerTool: (def: unknown) => unknown };
      }
    ).modelContext;
    expect(mc).toBeDefined();
    mc.registerTool({
      name: 'searchFlights',
      description: 'Busca vuelos',
      inputSchema: { type: 'object' },
      execute: () => ({ ok: true }),
    });
    const registered = dom.window.eval('window.__WEBMCP_REGISTERED__') as unknown[];
    expect(registered).toHaveLength(1);
    expect(normalizeRegistered(registered)).toEqual([
      {
        name: 'searchFlights',
        description: 'Busca vuelos',
        inputSchema: { type: 'object' },
      },
    ]);
    // El handler queda invocable para el adaptador.
    const tools = dom.window.eval('window.__WEBMCP_TOOLS__') as Record<
      string,
      { execute: () => unknown }
    >;
    expect(tools['searchFlights'].execute()).toEqual({ ok: true });
  });

  it('es idempotente (instalarlo dos veces no duplica capturas)', () => {
    const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
    dom.window.eval(WEBMCP_API_SHIM_SOURCE);
    dom.window.eval(WEBMCP_API_SHIM_SOURCE);
    expect(normalizeRegistered(dom.window.eval('window.__WEBMCP_REGISTERED__'))).toEqual(
      [],
    );
  });

  it('normalizeRegistered filtra entradas inválidas', () => {
    expect(normalizeRegistered(null)).toEqual([]);
    expect(normalizeRegistered([{ noName: true }, { name: 'ok' }])).toEqual([
      { name: 'ok' },
    ]);
  });
});

describe('generador de código (CSS → API)', () => {
  const css = `
    [data-product] .btn-add {
      webmcp-tool: 'addToCart';
      webmcp-param-productid: attr(data-product-id);
      webmcp-param-quantity: value(#qty-input);
      webmcp-confirmation: '.cart-badge';
      webmcp-description: 'Añade al carrito';
    }
  `;

  it('buildInputSchema deriva el esquema de los parámetros', () => {
    const map = parseWebMCP(css);
    const schema = buildInputSchema(map.tools['addToCart']) as {
      type: string;
      properties: Record<string, { type: string }>;
    };
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(['productid', 'quantity']);
    expect(schema.properties['productid'].type).toBe('string');
  });

  it('genera un script registerTool por herramienta', () => {
    const map = parseWebMCP(css);
    const code = generateApiScript(map);
    expect(code).toContain('mc.registerTool({');
    expect(code).toContain('"addToCart"');
    expect(code).toContain('[data-product] .btn-add');
    expect(code).toContain('Añade al carrito');
    expect(code).toContain('.cart-badge');
    // Compila como JavaScript (sin ejecutarlo en navegador).
    expect(() => new Function(code)).not.toThrow();
  });

  it('el script generado funciona de verdad en jsdom', async () => {
    const dom = new JSDOM(
      `
      <body>
        <div class="product" data-product>
          <span class="product-price">$1</span>
          <input id="qty-input" value="3" />
          <button class="btn-add" data-product-id="SKU-1">add</button>
        </div>
      </body>
    `,
      { runScripts: 'outside-only' },
    );
    // navigator.modelContext simulado (el shim de captura serviría igual).
    dom.window.eval(`
      navigator.modelContext = {
        registerTool: function (def) { window.__registered = window.__registered || []; window.__registered.push(def); }
      };
    `);
    const map = parseWebMCP(css);
    dom.window.eval(generateApiScript(map));
    const tools = dom.window.eval('window.__registered') as {
      name: string;
      execute: (
        p: Record<string, string>,
      ) => Promise<{ success: boolean; params: Record<string, string> }>;
    }[];
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('addToCart');
    // Sin confirmación visible: success false pero los params se resolvieron.
    const result = tools[0].execute({});
    expect((await result).params['productid']).toBe('SKU-1');
    expect((await result).params['quantity']).toBe('3');
  });
});
