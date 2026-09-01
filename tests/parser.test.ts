/**
 * Tests del parser: `.webmcp.css` ⇄ ToolMap.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseParamSource,
  parseTrigger,
  parseWebMCP,
  parseWebMCPFile,
  stringifyWebMCP,
} from '../src/parser';

describe('parseWebMCP', () => {
  it('parsea herramientas planas con todos sus metadatos', () => {
    const map = parseWebMCP(`
      [data-product] .btn-add {
        webmcp-tool: 'addToCart';
        webmcp-param-productid: attr(data-product-id);
        webmcp-param-quantity: value(#qty-input);
        webmcp-trigger: 'click';
        webmcp-confirmation: '.cart-badge';
        webmcp-description: 'Añade al carrito';
      }
    `);
    const tool = map.tools['addToCart'];
    expect(tool).toBeDefined();
    expect(tool.selector).toBe('[data-product] .btn-add');
    expect(tool.params['productid']).toEqual({
      source: 'attr',
      value: 'data-product-id',
    });
    expect(tool.params['quantity']).toEqual({ source: 'value', selector: '#qty-input' });
    expect(tool.trigger).toEqual({ event: 'click' });
    expect(tool.confirmation).toBe('.cart-badge');
    expect(tool.description).toBe('Añade al carrito');
  });

  it('parsea contextos con formato', () => {
    const map = parseWebMCP(`
      .product-price { webmcp-context: 'price'; webmcp-format: 'currency'; }
      .stock { webmcp-context: 'stock'; }
    `);
    expect(map.context['price']).toEqual({
      selector: '.product-price',
      format: 'currency',
    });
    expect(map.context['stock'].format).toBe('text');
  });

  it('acepta las declaraciones en cualquier orden dentro de la regla', () => {
    const map = parseWebMCP(`
      .btn {
        webmcp-param-label: attr(aria-label);
        webmcp-tool: 'doThing';
      }
    `);
    expect(map.tools['doThing'].params['label']).toEqual({
      source: 'attr',
      value: 'aria-label',
    });
  });

  it('resuelve reglas anidadas con & y descendientes', () => {
    const map = parseWebMCP(`
      [data-product] {
        .btn-add {
          webmcp-tool: 'addToCart';
          webmcp-param-quantity: value(var(--qty-field));
        }
        &.featured .btn-add {
          webmcp-tool: 'addFeatured';
        }
      }
    `);
    expect(map.tools['addToCart'].selector).toBe('[data-product] .btn-add');
    expect(map.tools['addFeatured'].selector).toBe('[data-product].featured .btn-add');
  });

  it('resuelve variables CSS con fallback y encadenadas', () => {
    const map = parseWebMCP(`
      :root { --qty: #qty-input; --campo: var(--qty); }
      .btn {
        webmcp-tool: 'buy';
        webmcp-param-q: value(var(--campo));
        webmcp-param-w: text(var(--missing, .fallback));
      }
    `);
    expect(map.tools['buy'].params['q']).toEqual({
      source: 'value',
      selector: '#qty-input',
    });
    expect(map.tools['buy'].params['w']).toEqual({
      source: 'text',
      selector: '.fallback',
    });
  });

  it('convierte kebab-case de parámetros a camelCase', () => {
    const map = parseWebMCP(`
      .x { webmcp-tool: 't'; webmcp-param-mi-param-largo: attr(data-id); }
    `);
    expect(Object.keys(map.tools['t'].params)).toEqual(['miParamLargo']);
  });

  it('parsea triggers con "on <selector>"', () => {
    const map = parseWebMCP(`
      .x { webmcp-tool: 'search'; webmcp-trigger: 'submit' on .form; }
    `);
    expect(map.tools['search'].trigger).toEqual({ event: 'submit', on: '.form' });
  });

  it('interpreta las fuentes de parámetros y sus alias', () => {
    expect(parseParamSource('attr(data-product-id)')).toEqual({
      source: 'attr',
      value: 'data-product-id',
    });
    expect(parseParamSource('data(product-id)')).toEqual({
      source: 'attr',
      value: 'data-product-id',
    });
    expect(parseParamSource('aria(label)')).toEqual({
      source: 'attr',
      value: 'aria-label',
    });
    expect(parseParamSource('value()')).toEqual({ source: 'value' });
    expect(parseParamSource('value(#qty)')).toEqual({
      source: 'value',
      selector: '#qty',
    });
    expect(parseParamSource('text()')).toEqual({ source: 'text' });
    expect(parseParamSource("'literal'")).toEqual({
      source: 'literal',
      value: 'literal',
    });
  });

  it('parsea triggers simples y tolerantes', () => {
    expect(parseTrigger('"click"')).toEqual({ event: 'click' });
    expect(parseTrigger('submit')).toEqual({ event: 'submit' });
  });
});

describe('parseWebMCPFile (@import)', () => {
  function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-test-'));
  }

  it('resuelve @import relativos con guardia anti-ciclos', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'base.webmcp.css'),
      `
      @import 'tools.webmcp.css';
      .price { webmcp-context: 'price'; webmcp-format: 'currency'; }
    `,
    );
    fs.writeFileSync(
      path.join(dir, 'tools.webmcp.css'),
      `
      @import 'base.webmcp.css'; /* ciclo: debe ignorarse */
      .btn { webmcp-tool: 'addToCart'; webmcp-param-id: data(product-id); }
    `,
    );
    const map = parseWebMCPFile(path.join(dir, 'base.webmcp.css'));
    expect(map.tools['addToCart']).toBeDefined();
    expect(map.context['price']).toBeDefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ignora @import de archivos inexistentes sin romper el parseo', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'a.webmcp.css');
    fs.writeFileSync(file, `@import 'no-existe.css';\n.b { webmcp-tool: 'x'; }`);
    const map = parseWebMCPFile(file);
    expect(map.tools['x']).toBeDefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('stringifyWebMCP (round-trip)', () => {
  it('serializa y recupera el mismo tool map', () => {
    const css = `
      [data-product] .btn-add {
        webmcp-tool: 'addToCart';
        webmcp-param-productid: attr(data-product-id);
        webmcp-param-quantity: value(#qty-input);
        webmcp-confirmation: '.cart-badge, [class*=badge]';
        webmcp-description: 'Añade al carrito';
      }
      .product-price { webmcp-context: 'price'; webmcp-format: 'currency'; }
      .form { webmcp-tool: 'search'; webmcp-trigger: 'submit' on .search-form; }
    `;
    const map = parseWebMCP(css);
    const css2 = stringifyWebMCP(map);
    const map2 = parseWebMCP(css2);
    expect(map2).toEqual(map);
  });

  it('omite el trigger cuando es el click por defecto', () => {
    const css = `.b { webmcp-tool: 't'; }`;
    const out = stringifyWebMCP(parseWebMCP(css));
    expect(out).not.toContain('webmcp-trigger');
  });
});
