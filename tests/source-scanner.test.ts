/**
 * Tests del generador desde código fuente (v0.6.0).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildToolMapFromSource,
  parseAttributes,
  scanSource,
  scanSourceCode,
  selectorFromAttrs,
} from '../src/generator';
import { serializeToolMap, parseWebMCP } from '../src/parser';

const REACT_COMPONENT = `
export function Checkout() {
  const [qty, setQty] = useState(1);
  return (
    <div className="checkout">
      <input id="qty-input" type="number" name="quantity" onChange={e => setQty(e.target.value)} />
      <button data-testid="buy-now" className={styles.buy} onClick={handleBuy}>
        Comprar ahora
      </button>
      <button onClick={handleDynamic} {...props}>Sin ancla</button>
      <a href="/cart" id="view-cart">Ver carrito</a>
    </div>
  );
}
`;

const VUE_COMPONENT = `
<template>
  <form id="newsletter-form" @submit="subscribe">
    <input name="email" placeholder="Tu correo" v-model="email" />
    <button type="submit">Suscribirme</button>
  </form>
</template>
<script>
export default { data: () => ({ email: '' }) };
</script>
`;

const SVELTE_COMPONENT = `
<script>
  let count = 0;
</script>
<button data-tool="increment" on:click={() => count++}>Sumar</button>
<style>button { color: red; }</style>
`;

describe('parseAttributes', () => {
  it('extrae literales y convierte className → class', () => {
    const { attrs } = parseAttributes(' id="a" className="btn primary" type="submit"');
    expect(attrs).toEqual({ id: 'a', class: 'btn primary', type: 'submit' });
  });

  it('detecta handlers de React, Vue y Svelte', () => {
    expect(parseAttributes(' onClick={fn}').handler).toBe('onClick');
    expect(parseAttributes(' @submit="go"').handler).toBe('@submit');
    expect(parseAttributes(' on:click={fn}').handler).toBe('on:click');
  });

  it('ignora valores dinámicos {expr}', () => {
    const { attrs } = parseAttributes(' className={styles.buy} id="ok"');
    expect(attrs).toEqual({ id: 'ok' });
  });
});

describe('selectorFromAttrs', () => {
  it('prioriza data-* sobre id, name y clase', () => {
    expect(selectorFromAttrs('button', { 'data-testid': 'x', id: 'y' })).toBe(
      '[data-testid="x"]',
    );
    expect(selectorFromAttrs('button', { id: 'y', name: 'z' })).toBe('#y');
    expect(selectorFromAttrs('input', { name: 'email' })).toBe('input[name="email"]');
    expect(selectorFromAttrs('button', { class: 'btn primary' })).toBe(
      'button.btn.primary',
    );
    expect(selectorFromAttrs('button', {})).toBe('');
  });
});

describe('scanSourceCode', () => {
  it('React: encuentra elementos y marca los que no tienen ancla', () => {
    const els = scanSourceCode(REACT_COMPONENT, 'Checkout.tsx');
    const buy = els.find((e) => e.selector === '[data-testid="buy-now"]');
    expect(buy?.text).toBe('Comprar ahora');
    expect(buy?.handler).toBe('onClick');
    const dynamic = els.find((e) => e.warning);
    expect(dynamic?.warning).toContain('sin ancla estable');
    expect(els.some((e) => e.selector === '#view-cart')).toBe(true);
  });

  it('Vue: solo analiza el <template>', () => {
    const els = scanSourceCode(VUE_COMPONENT, 'Newsletter.vue');
    expect(els.some((e) => e.selector === '#newsletter-form')).toBe(true);
    expect(els.some((e) => e.selector === 'input[name="email"]')).toBe(true);
    // Nada del <script>.
    expect(els.every((e) => e.tag !== 'script')).toBe(true);
  });

  it('Svelte: detecta on:click y data-tool', () => {
    const els = scanSourceCode(SVELTE_COMPONENT, 'Counter.svelte');
    const btn = els.find((e) => e.tag === 'button');
    expect(btn?.selector).toBe('[data-tool="increment"]');
    expect(btn?.text).toBe('Sumar');
  });
});

describe('scanSource + buildToolMapFromSource (integración fs)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-src-'));
  fs.writeFileSync(path.join(dir, 'Checkout.tsx'), REACT_COMPONENT);
  fs.mkdirSync(path.join(dir, 'components'));
  fs.writeFileSync(path.join(dir, 'components', 'Newsletter.vue'), VUE_COMPONENT);
  fs.writeFileSync(path.join(dir, 'Counter.svelte'), SVELTE_COMPONENT);
  fs.writeFileSync(path.join(dir, 'ignore.txt'), 'nada');

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('recorre carpetas recursivamente y detecta el framework dominante', () => {
    const scan = scanSource(dir);
    expect(scan.files).toHaveLength(3);
    expect(['react', 'vue', 'svelte']).toContain(scan.framework);
    expect(scan.warnings.length).toBeGreaterThan(0);
  });

  it('genera un tool map válido y re-parseable', () => {
    const scan = scanSource(dir);
    const map = buildToolMapFromSource(scan);
    const names = Object.keys(map.tools);
    expect(names).toContain('comprarAhora');
    expect(names).toContain('sumar');
    // El form Vue agrupa el input email como parámetro.
    const form = Object.values(map.tools).find((t) => t.selector === '#newsletter-form');
    expect(form?.trigger?.event).toBe('submit');
    expect(Object.values(form?.params ?? {})[0]).toEqual({
      source: 'value',
      selector: 'input[name="email"]',
    });
    // Round-trip.
    const reparsed = parseWebMCP(serializeToolMap(map));
    expect(Object.keys(reparsed.tools).sort()).toEqual(names.sort());
  });

  it('los inputs no generan herramientas propias', () => {
    const map = buildToolMapFromSource(scanSource(dir));
    expect(Object.values(map.tools).every((t) => !t.selector.startsWith('input['))).toBe(
      true,
    );
  });
});
