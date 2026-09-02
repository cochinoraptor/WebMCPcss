/**
 * Tests del parser de `.webmcp.css`.
 */
import { describe, expect, it } from 'vitest';
import {
  parseParamValue,
  parseTriggerValue,
  parseWebMCP,
  serializeToolMap,
  WebMCPParseError,
} from '../src/parser';

const EXAMPLE_CSS = `
/* webmcp.css - Ejemplo para un carrito de compras */

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

describe('parseWebMCP', () => {
  it('extrae herramientas con sus selectores', () => {
    const map = parseWebMCP(EXAMPLE_CSS);
    expect(Object.keys(map.tools)).toEqual(['addToCart', 'applyCoupon']);
    expect(map.tools.addToCart.selector).toBe('[data-product] .btn-add');
    expect(map.tools.applyCoupon.selector).toBe('.coupon-form input[type="text"]');
  });

  it('parsea parámetros attr() y value() con la estructura JSON esperada', () => {
    const map = parseWebMCP(EXAMPLE_CSS);
    expect(map.tools.addToCart.params.productId).toEqual({
      source: 'attr',
      value: 'data-product-id',
    });
    expect(map.tools.addToCart.params.quantity).toEqual({
      source: 'value',
      selector: '#qty-input',
    });
    // value() sin argumento apunta al propio elemento.
    expect(map.tools.applyCoupon.params.code).toEqual({ source: 'value' });
  });

  it('parsea confirmación y trigger', () => {
    const map = parseWebMCP(EXAMPLE_CSS);
    expect(map.tools.addToCart.confirmation).toBe('.cart-badge');
    expect(map.tools.applyCoupon.trigger).toEqual({
      event: 'submit',
      selector: '.coupon-form',
    });
  });

  it('parsea datos de contexto con formato', () => {
    const map = parseWebMCP(EXAMPLE_CSS);
    expect(map.context.price).toEqual({
      selector: '.product-price',
      format: 'currency',
    });
  });

  it('ignora reglas CSS sin propiedades webmcp-*', () => {
    const map = parseWebMCP('.foo { color: red; } .bar { margin: 0; }');
    expect(map.tools).toEqual({});
    expect(map.context).toEqual({});
  });

  it('soporta selectores con clases, IDs, atributos y combinadores', () => {
    const css = `
      #main > .list li[data-id] a.link { webmcp-tool: "open"; }
    `;
    const map = parseWebMCP(css);
    expect(map.tools.open.selector).toBe('#main > .list li[data-id] a.link');
  });

  it('lanza error si una regla mezcla tool y context', () => {
    expect(() => parseWebMCP('.x { webmcp-tool: "a"; webmcp-context: "b"; }')).toThrow(
      WebMCPParseError,
    );
  });

  it('lanza error con CSS inválido', () => {
    expect(() => parseWebMCP('.x { webmcp-tool: ')).toThrow(WebMCPParseError);
  });

  it('parsea valores literales de parámetros', () => {
    const map = parseWebMCP('.x { webmcp-tool: "t"; webmcp-param-mode: "fast"; }');
    expect(map.tools.t.params.mode).toEqual({ source: 'literal', value: 'fast' });
  });
});

describe('parseParamValue', () => {
  it('parsea attr(), value(), text() y literales', () => {
    expect(parseParamValue('attr(data-x)')).toEqual({ source: 'attr', value: 'data-x' });
    expect(parseParamValue('value(#q)')).toEqual({ source: 'value', selector: '#q' });
    expect(parseParamValue('value()')).toEqual({ source: 'value' });
    expect(parseParamValue('text(.price)')).toEqual({
      source: 'text',
      selector: '.price',
    });
    expect(parseParamValue('"hola"')).toEqual({ source: 'literal', value: 'hola' });
  });

  it('lanza error si attr() no tiene argumento', () => {
    expect(() => parseParamValue('attr()')).toThrow(WebMCPParseError);
  });
});

describe('parseTriggerValue', () => {
  it('parsea evento simple y evento con objetivo', () => {
    expect(parseTriggerValue('"click"')).toEqual({ event: 'click' });
    expect(parseTriggerValue('"submit" on .form')).toEqual({
      event: 'submit',
      selector: '.form',
    });
  });
});

describe('serializeToolMap', () => {
  it('hace roundtrip: parse → serialize → parse produce el mismo tool map', () => {
    const original = parseWebMCP(EXAMPLE_CSS);
    const css = serializeToolMap(original);
    const reparsed = parseWebMCP(css);
    expect(reparsed).toEqual(original);
  });

  it('serializa fingerprints y los recupera', () => {
    const map = parseWebMCP('.btn { webmcp-tool: "go"; }');
    map.tools.go.fingerprint = { tag: 'button', text: 'Ir', attrs: { id: 'go' } };
    const reparsed = parseWebMCP(serializeToolMap(map));
    expect(reparsed.tools.go.fingerprint).toEqual({
      tag: 'button',
      text: 'Ir',
      attrs: { id: 'go' },
    });
  });
});

describe('CSS anidado (Mejora 4)', () => {
  it('resuelve reglas anidadas como selectores descendientes', () => {
    const map = parseWebMCP(`
      .container {
        .btn { webmcp-tool: "nestedClick"; }
      }
    `);
    expect(map.tools.nestedClick.selector).toBe('.container .btn');
  });

  it('soporta & (referencia al padre)', () => {
    const map = parseWebMCP(`
      .card {
        &.active > button { webmcp-tool: "activate"; }
      }
    `);
    expect(map.tools.activate.selector).toBe('.card.active > button');
  });

  it('soporta anidamiento de varios niveles', () => {
    const map = parseWebMCP(`
      #app { .list { li { webmcp-tool: "pick"; } } }
    `);
    expect(map.tools.pick.selector).toBe('#app .list li');
  });
});

describe('variables CSS (Mejora 4)', () => {
  it('sustituye var(--x) en selectores de parámetros', () => {
    const map = parseWebMCP(`
      :root { --qty-field: #qty-input; }
      .btn-add {
        webmcp-tool: "addToCart";
        webmcp-param-quantity: value(var(--qty-field));
      }
    `);
    expect(map.tools.addToCart.params.quantity).toEqual({
      source: 'value',
      selector: '#qty-input',
    });
  });

  it('usa el fallback cuando la variable no existe', () => {
    const map = parseWebMCP(`
      .x { webmcp-tool: "t"; webmcp-param-q: value(var(--nope, #fallback)); }
    `);
    expect(map.tools.t.params.q).toEqual({ source: 'value', selector: '#fallback' });
  });

  it('resuelve variables que referencian otras variables', () => {
    const map = parseWebMCP(`
      :root { --a: #real; --b: var(--a); }
      .x { webmcp-tool: "t"; webmcp-param-q: value(var(--b)); }
    `);
    expect(map.tools.t.params.q.selector).toBe('#real');
  });
});

describe('@import (Mejora 4)', () => {
  const files: Record<string, string> = {
    'base.css': '.base-btn { webmcp-tool: "baseTool"; }',
    'vars.css': ':root { --sel: #imported; }',
    'ciclo.css': '@import "ciclo.css";',
  };
  const resolveImport = (spec: string) => {
    if (!(spec in files)) throw new Error(`no existe: ${spec}`);
    return files[spec];
  };

  it('combina herramientas del archivo importado', () => {
    const map = parseWebMCP('@import "base.css";\n.local { webmcp-tool: "localTool"; }', {
      resolveImport,
    });
    expect(Object.keys(map.tools).sort()).toEqual(['baseTool', 'localTool']);
  });

  it('las variables importadas quedan disponibles', () => {
    const map = parseWebMCP(
      '@import "vars.css";\n.x { webmcp-tool: "t"; webmcp-param-q: value(var(--sel)); }',
      { resolveImport },
    );
    expect(map.tools.t.params.q.selector).toBe('#imported');
  });

  it('detecta @import circular', () => {
    expect(() => parseWebMCP('@import "ciclo.css";', { resolveImport })).toThrow(
      /circular/,
    );
  });

  it('sin resolveImport, los @import se ignoran con seguridad', () => {
    const map = parseWebMCP('@import "x.css";\n.a { webmcp-tool: "a"; }');
    expect(Object.keys(map.tools)).toEqual(['a']);
  });
});

describe('alias data() y aria()', () => {
  it('data(x) equivale a attr(data-x)', () => {
    expect(parseParamValue('data(product-id)')).toEqual({
      source: 'attr',
      value: 'data-product-id',
    });
  });

  it('aria(x) equivale a attr(aria-x)', () => {
    expect(parseParamValue('aria(label)')).toEqual({
      source: 'attr',
      value: 'aria-label',
    });
  });

  it('data() y aria() vacíos lanzan error', () => {
    expect(() => parseParamValue('data()')).toThrow(WebMCPParseError);
    expect(() => parseParamValue('aria()')).toThrow(WebMCPParseError);
  });
});
