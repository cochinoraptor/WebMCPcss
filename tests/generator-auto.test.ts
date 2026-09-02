/**
 * Tests del generador automático v0.5.0: scanner (jsdom) + analyzer.
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  buildAutoToolMap,
  detectFramework,
  scanInteractiveElementsInPage,
} from '../src/generator';
import type { PageScan } from '../src/generator';

const SHOP_HTML = `<!DOCTYPE html>
<html>
<head><title>Mi Tienda</title></head>
<body data-reactroot="">
  <div id="__next">
    <form id="search-form" action="/search">
      <input type="text" name="q" placeholder="Buscar productos" />
      <button type="submit">Buscar</button>
    </form>
    <form action="/login" class="css-1x9j8k">
      <label for="user">Usuario</label>
      <input id="user" type="email" name="email" />
      <input type="password" name="password" placeholder="Contraseña" />
      <button type="submit">Iniciar sesión</button>
    </form>
    <button data-testid="add-to-cart" aria-label="Añadir al carrito">Añadir</button>
    <a href="/checkout" class="btn btn-primary">Ir al checkout</a>
    <a href="#" role="button" id="open-menu">Menú</a>
    <a href="/about">Solo un enlace normal</a>
  </div>
</body>
</html>`;

function scan(html: string): PageScan {
  const dom = new JSDOM(html);
  return scanInteractiveElementsInPage(dom.window.document);
}

describe('scanner (generate --auto)', () => {
  const result = scan(SHOP_HTML);

  it('detecta los formularios con sus campos', () => {
    expect(result.forms).toHaveLength(2);
    const search = result.forms[0];
    expect(search.selector).toBe('#search-form');
    expect(search.fields).toHaveLength(1);
    expect(search.fields[0].name).toBe('q');
    expect(search.submitText).toBe('Buscar');
  });

  it('asocia labels a los campos', () => {
    const login = result.forms[1];
    const email = login.fields.find((f) => f.name === 'email');
    expect(email?.label).toBe('Usuario');
  });

  it('prioriza selectores estables: data-* > id > name', () => {
    const addBtn = result.actions.find((a) => a.text === 'Añadir');
    expect(addBtn?.selector).toBe('[data-testid="add-to-cart"]');
    const menu = result.actions.find((a) => a.id === 'open-menu');
    expect(menu?.selector).toBe('#open-menu');
    const email = result.forms[1].fields.find((f) => f.name === 'email');
    expect(email?.selector).toBe('#user');
  });

  it('incluye enlaces de acción pero no enlaces normales', () => {
    const texts = result.actions.map((a) => a.text);
    expect(texts).toContain('Ir al checkout');
    expect(texts).toContain('Menú');
    expect(texts).not.toContain('Solo un enlace normal');
  });

  it('recoge marcadores de framework', () => {
    expect(result.frameworkMarkers).toContain('react');
    expect(result.frameworkMarkers).toContain('next');
    expect(result.frameworkMarkers).toContain('bootstrap');
  });

  it('captura el título de la página', () => {
    expect(result.title).toBe('Mi Tienda');
  });
});

describe('detectFramework', () => {
  it('ordena por prioridad con next/react primero', () => {
    const fws = detectFramework(scan(SHOP_HTML));
    expect(fws[0]).toBe('next');
    expect(fws).toContain('react');
  });

  it('devuelve unknown sin marcadores', () => {
    const fws = detectFramework(scan('<html><body><p>hola</p></body></html>'));
    expect(fws).toEqual(['unknown']);
  });
});

describe('buildAutoToolMap (analyzer)', () => {
  const map = buildAutoToolMap(scan(SHOP_HTML));

  it('nombra las herramientas con heurísticas semánticas', () => {
    expect(Object.keys(map.tools)).toContain('search');
    expect(Object.keys(map.tools)).toContain('login');
  });

  it('convierte los campos del formulario en params value(selector)', () => {
    const login = map.tools.login;
    const params = Object.values(login.params);
    expect(params.length).toBe(2);
    expect(params.every((p) => p.source === 'value' && p.selector)).toBe(true);
  });

  it('el trigger del formulario es submit sobre el form', () => {
    expect(map.tools.search.trigger).toEqual({
      event: 'submit',
      selector: '#search-form',
    });
  });

  it('crea herramientas de click para acciones sueltas con fingerprint', () => {
    const names = Object.keys(map.tools);
    const cart = names.find(
      (n) => map.tools[n].selector === '[data-testid="add-to-cart"]',
    );
    expect(cart).toBeDefined();
    expect(map.tools[cart!].fingerprint?.attrs?.['aria-label']).toBe('Añadir al carrito');
  });

  it('no repite nombres de herramienta', () => {
    const html = `<html><body>
      <button id="b1">Guardar</button>
      <button id="b2">Guardar</button>
      <button id="b3">Guardar</button>
    </body></html>`;
    const m = buildAutoToolMap(scan(html));
    expect(Object.keys(m.tools).sort()).toEqual(['guardar', 'guardar2', 'guardar3']);
  });

  it('genera un tool map serializable y re-parseable', async () => {
    const { serializeToolMap, parseWebMCP } = await import('../src/parser');
    const css = serializeToolMap(map);
    const reparsed = parseWebMCP(css);
    expect(Object.keys(reparsed.tools).sort()).toEqual(Object.keys(map.tools).sort());
  });
});
