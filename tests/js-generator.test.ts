/**
 * Tests del generador de código JS para la API imperativa de WebMCP.
 * Verifica que el código generado sea funcional ejecutándolo en jsdom
 * con el shim de `navigator.modelContext` instalado.
 */
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { buildInputSchema, generateApiScript } from '../src/generator';
import { parseWebMCP } from '../src/parser';
import { installModelContextShim, readRegisteredTools } from '../src/webmcp-api';

const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'shopping-cart', 'webmcp.css'),
  'utf8',
);
const HTML = fs.readFileSync(
  path.join(__dirname, '..', 'examples', 'shopping-cart', 'index.html'),
  'utf8',
);

describe('buildInputSchema', () => {
  it('convierte params value() en propiedades del schema', () => {
    const map = parseWebMCP(CSS);
    const schema = buildInputSchema(map.tools.addToCart);
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties)).toEqual(['quantity']);
    expect(schema.required).toEqual(['quantity']);
  });

  it('los params de solo lectura (attr/text/literal) no son entradas', () => {
    const map = parseWebMCP(
      '.x { webmcp-tool: "t"; webmcp-param-a: attr(data-a); webmcp-param-b: "fijo"; }',
    );
    const schema = buildInputSchema(map.tools.t);
    expect(Object.keys(schema.properties)).toEqual([]);
  });
});

describe('generateApiScript', () => {
  it('genera un registerTool() por herramienta con nombre y descripción', () => {
    const map = parseWebMCP(CSS);
    const script = generateApiScript(map);
    expect(script).toContain('navigator.modelContext');
    expect((script.match(/mc\.registerTool\(/g) ?? []).length).toBe(2);
    expect(script).toContain('"addToCart"');
    expect(script).toContain('"applyCoupon"');
    expect(script).toContain('inputSchema');
  });

  it('el código generado es JavaScript sintácticamente válido', () => {
    const script = generateApiScript(parseWebMCP(CSS));
    // new Function lanza SyntaxError si el código es inválido.
    expect(() => new Function(script)).not.toThrow();
  });

  it('el código generado registra y EJECUTA herramientas reales en un DOM', async () => {
    const dom = new JSDOM(HTML, { runScripts: 'outside-only' });
    const win = dom.window as unknown as Window & { [k: string]: unknown };
    installModelContextShim(win);

    // Simular la lógica del carrito (jsdom no ejecuta el <script> embebido
    // con runScripts: 'outside-only').
    const doc = win.document;
    doc.querySelector('.btn-add')?.addEventListener('click', () => {
      const badge = doc.createElement('span');
      badge.className = 'cart-badge';
      doc.getElementById('cart-indicator')?.appendChild(badge);
    });

    // Ejecutar el script generado dentro de la ventana jsdom.
    const script = generateApiScript(parseWebMCP(CSS), { includeExample: false });
    dom.window.eval(script);

    const tools = readRegisteredTools(win);
    expect(tools.map((t) => t.name).sort()).toEqual(['addToCart', 'applyCoupon']);

    // Invocar la herramienta generada: debe rellenar cantidad, click y confirmar.
    const registry = win.__webmcpApiRegistry as {
      tools: Array<{ name: string; execute: (a: unknown) => Promise<unknown> }>;
    };
    const addToCart = registry.tools.find((t) => t.name === 'addToCart');
    const result = (await addToCart?.execute({ quantity: '4' })) as {
      content: Array<{ type: string; text: string }>;
    };
    const payload = JSON.parse(result.content[0].text) as Record<string, unknown>;
    expect(payload.quantity).toBe('4');
    expect(payload.productId).toBe('SKU-42');
    expect(payload.confirmed).toBe(true);
    expect((doc.getElementById('qty-input') as HTMLInputElement).value).toBe('4');
  });

  it('incluye trigger submit para herramientas de formulario', () => {
    const script = generateApiScript(parseWebMCP(CSS));
    expect(script).toContain("new Event('submit'");
  });
});
