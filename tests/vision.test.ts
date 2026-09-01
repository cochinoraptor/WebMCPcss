/**
 * Tests del modo visión y las utilidades DOM puras.
 */
import { describe, expect, it } from 'vitest';
import type { ElementInfo } from '../src/adapters/PageAdapter';
import {
  hintsFromTool,
  scoreCandidate,
  selectorProposals,
  inferStableSelector,
} from '../src/core/vision';
import {
  isStableClass,
  parseSelectorScope,
  selectorWords,
  splitWords,
} from '../src/utils/dom';
import type { ToolDef } from '../src/types';

/** Huella de un botón de la carta del club (estructura real del fixture). */
function clubButton(overrides: Partial<ElementInfo> = {}): ElementInfo {
  return {
    tag: 'button',
    id: null,
    classes: ['quick-add-button'],
    attrs: { 'aria-label': 'Agregar Corona 330 ml al pedido' },
    text: '+',
    value: null,
    ...overrides,
  };
}

describe('utilidades DOM', () => {
  it('splitWords divide camelCase, kebab-case y snake_case', () => {
    expect(splitWords('addToCart')).toEqual(['add', 'to', 'cart']);
    expect(splitWords('btn-add')).toEqual(['btn', 'add']);
    expect(splitWords('qty_input')).toEqual(['qty', 'input']);
  });

  it('isStableClass rechaza hashes de build y acepta clases semánticas', () => {
    expect(isStableClass('btn-add')).toBe(true);
    expect(isStableClass('product-card')).toBe(true);
    expect(isStableClass('data-v-a4cce9c2')).toBe(false);
    expect(isStableClass('css-1q2w3e4r5t')).toBe(false);
    expect(isStableClass('jsx-123456')).toBe(false);
    expect(isStableClass('card-button2')).toBe(false); // sufijo tipo hash con dígito
    expect(isStableClass('')).toBe(false);
  });

  it('parseSelectorScope separa ámbito y objetivo', () => {
    expect(parseSelectorScope('.product-card .card-add')).toEqual({
      scope: '.product-card',
      target: '.card-add',
    });
    expect(parseSelectorScope('.card-add')).toEqual({ target: '.card-add' });
    // no corta dentro de :not() ni de valores con espacios
    expect(parseSelectorScope('div:not(.a .b) .btn')).toEqual({
      scope: 'div:not(.a .b)',
      target: '.btn',
    });
  });

  it('selectorWords extrae palabras de clases, ids y atributos', () => {
    expect(selectorWords('.card-add')).toEqual(['card', 'add']);
    expect(selectorWords('#qty-input')).toEqual(['qty', 'input']);
    expect(selectorWords('[data-product-id="SKU-42"]')).toContain('product');
  });
});

describe('visión: pistas y puntuación', () => {
  const tool: ToolDef = {
    selector: '.product-card .card-add',
    params: { product: { source: 'attr', value: 'aria-label' } },
    description: 'Agrega un producto de la carta al pedido',
    trigger: { event: 'click' },
  };

  it('deriva pistas del nombre, descripción, selector y params', () => {
    const hints = hintsFromTool('addToCart', tool);
    expect(hints.words).toContain('add');
    expect(hints.words).toContain('cart');
    expect(hints.words).toContain('agrega');
    expect(hints.words).toContain('pedido');
    expect(hints.requiredAttrs).toEqual(['aria-label']);
    expect(hints.tags).toContain('button');
  });

  it('puntúa el botón correcto y descarta los que no comparten huella', () => {
    const hints = hintsFromTool('addToCart', tool);
    const good = scoreCandidate(clubButton(), hints);
    const chip: ElementInfo = {
      tag: 'button',
      id: null,
      classes: ['cat-chip', 'active'],
      attrs: {},
      text: 'Todas',
      value: null,
    };
    expect(good).toBeGreaterThan(0);
    expect(scoreCandidate(chip, hints)).toBe(0);
  });

  it('la etiqueta sola no basta (lección del POC)', () => {
    const hints = { tags: ['button'], words: ['comprar'], requiredAttrs: [] };
    const generic: ElementInfo = {
      tag: 'button',
      id: null,
      classes: [],
      attrs: {},
      text: '+',
      value: null,
    };
    expect(scoreCandidate(generic, hints)).toBe(0);
  });
});

describe('visión: inferencia de selectores estables', () => {
  it('prioriza data-* sobre id, aria-label y clases', () => {
    const info: ElementInfo = {
      tag: 'button',
      id: 'buy-btn',
      classes: ['btn', 'btn-buy'],
      attrs: { 'data-product-id': 'SKU-42', 'aria-label': 'Comprar' },
      text: 'Comprar',
      value: null,
    };
    expect(selectorProposals(info)).toEqual([
      '[data-product-id="SKU-42"]',
      '#buy-btn',
      '[aria-label="Comprar"]',
      '.btn',
      '.btn-buy',
    ]);
    expect(inferStableSelector(info)).toBe('[data-product-id="SKU-42"]');
    expect(inferStableSelector(info, '.card')).toBe('.card [data-product-id="SKU-42"]');
  });

  it('ignora atributos de scope de Vue y valores vacíos', () => {
    const info: ElementInfo = {
      tag: 'button',
      id: null,
      classes: ['card-add'],
      attrs: { 'data-v-a4cce9c2': '' },
      text: '+',
      value: null,
    };
    expect(selectorProposals(info)).toEqual(['.card-add']);
  });

  it('escapa valores con comillas en los selectores de atributo', () => {
    const info: ElementInfo = {
      tag: 'button',
      id: null,
      classes: [],
      attrs: { 'aria-label': 'Agregar "La Roja" al pedido' },
      text: '+',
      value: null,
    };
    expect(selectorProposals(info)).toEqual([
      '[aria-label="Agregar \\"La Roja\\" al pedido"]',
    ]);
  });
});
