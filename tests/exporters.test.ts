/**
 * Tests de los exportadores multi-agente v0.5.0.
 */
import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMATS,
  exportForAgent,
  snakeCase,
  toolMapToJsonSchemas,
} from '../src/exporters';
import { parseWebMCP } from '../src/parser';

const CSS = `
#add-to-cart {
  webmcp-tool: "addToCart";
  webmcp-description: "Añade el producto al carrito";
  webmcp-param-quantity: value(#qty-input);
  webmcp-param-productId: attr(data-product-id);
}
#search-form button {
  webmcp-tool: "searchProducts";
  webmcp-param-query: value(#search-input);
}
.total-price {
  webmcp-context: "cartTotal";
  webmcp-format: "currency";
}
`;

const toolMap = parseWebMCP(CSS);
const ctx = { cssPath: 'tienda.webmcp.css', url: 'https://tienda.com' };

describe('toolMapToJsonSchemas', () => {
  const schemas = toolMapToJsonSchemas(toolMap);

  it('genera un schema por herramienta', () => {
    expect(schemas.map((s) => s.name).sort()).toEqual(['addToCart', 'searchProducts']);
  });

  it('incluye las propiedades de los params', () => {
    const add = schemas.find((s) => s.name === 'addToCart')!;
    expect(Object.keys(add.inputSchema.properties).sort()).toEqual([
      'productId',
      'quantity',
    ]);
    expect(add.inputSchema.type).toBe('object');
  });

  it('usa la descripción declarada', () => {
    const add = schemas.find((s) => s.name === 'addToCart')!;
    expect(add.description).toBe('Añade el producto al carrito');
  });
});

describe('snakeCase', () => {
  it('convierte camelCase a snake_case', () => {
    expect(snakeCase('addToCart')).toBe('add_to_cart');
    expect(snakeCase('searchProducts2')).toBe('search_products2');
  });
});

describe('exportForAgent', () => {
  it('todos los formatos declarados producen archivos', () => {
    for (const format of EXPORT_FORMATS) {
      const { files, note } = exportForAgent(format, toolMap, ctx);
      expect(Object.keys(files).length, format).toBeGreaterThan(0);
      expect(note.length, format).toBeGreaterThan(10);
      for (const content of Object.values(files)) {
        expect(content.length, format).toBeGreaterThan(0);
      }
    }
  });

  it('lanza error con formato desconocido', () => {
    expect(() => exportForAgent('skynet', toolMap, ctx)).toThrow(/Formato desconocido/);
  });

  it('mcp-config: snippet mcpServers válido con css y url', () => {
    const { files } = exportForAgent('mcp-config', toolMap, ctx);
    const cfg = JSON.parse(files['mcp-config.json']);
    expect(cfg.mcpServers.webmcpcss.command).toBe('webmcpcss');
    expect(cfg.mcpServers.webmcpcss.args).toContain('tienda.webmcp.css');
    expect(cfg.mcpServers.webmcpcss.args).toContain('https://tienda.com');
  });

  it('claude-code: plugin.json + comandos slash', () => {
    const { files } = exportForAgent('claude-code', toolMap, ctx);
    const plugin = JSON.parse(files['.claude-plugin/plugin.json']);
    expect(plugin.name).toBe('webmcpcss');
    expect(files['commands/run.md']).toContain('addToCart');
    expect(files['commands/generate.md']).toContain('webmcpcss generate');
  });

  it('cursor: mcp.json parseable', () => {
    const { files } = exportForAgent('cursor', toolMap, ctx);
    expect(() => JSON.parse(files['mcp.json'])).not.toThrow();
    expect(files['README.md']).toContain('Cursor');
  });

  it('crewai: módulo Python con funciones snake_case y ALL_TOOLS', () => {
    const { files } = exportForAgent('crewai', toolMap, ctx);
    const py = files['webmcp_tools.py'];
    expect(py).toContain('def add_to_cart(');
    expect(py).toContain('def search_products(');
    expect(py).toContain('ALL_TOOLS = [add_to_cart, search_products]');
    expect(py).toContain('"webmcpcss", "run"');
    expect(py).toContain('WEBMCP_URL = "https://tienda.com"');
  });

  it('autogen: JSON parseable con schemas + módulo de registro', () => {
    const { files } = exportForAgent('autogen', toolMap, ctx);
    const data = JSON.parse(files['webmcp_tools.json']);
    expect(data.tools).toHaveLength(2);
    expect(data.tools[0].schema.type).toBe('object');
    expect(files['webmcp_autogen.py']).toContain('register_with_autogen');
  });

  it('langgraph: @tool por herramienta y grafo JSON', () => {
    const { files } = exportForAgent('langgraph', toolMap, ctx);
    expect(files['webmcp_langgraph.py']).toContain('@tool');
    expect(files['webmcp_langgraph.py']).toContain(
      'from langchain_core.tools import tool',
    );
    const graph = JSON.parse(files['webmcp_graph.json']);
    expect(graph.nodes).toHaveLength(2);
  });

  it('browser-inject: IIFE con __WEBMCP_GRAPH__ y selectores', () => {
    const { files } = exportForAgent('browser-inject', toolMap, ctx);
    const js = files['webmcp-inject.js'];
    expect(js).toContain('__WEBMCP_GRAPH__');
    expect(js).toContain('#add-to-cart');
    expect(js).toContain('navigator');
    // Debe ser JS sintácticamente válido.
    expect(() => new Function(js)).not.toThrow();
  });

  it('json-schema: esquemas genéricos parseables', () => {
    const { files } = exportForAgent('json-schema', toolMap, ctx);
    const data = JSON.parse(files['webmcp-schemas.json']);
    expect(data.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      'addToCart',
      'searchProducts',
    ]);
  });

  it('sin URL usa un placeholder editable', () => {
    const { files } = exportForAgent('crewai', toolMap, { cssPath: 'x.css' });
    expect(files['webmcp_tools.py']).toContain('CAMBIA-ESTA-URL');
  });
});
