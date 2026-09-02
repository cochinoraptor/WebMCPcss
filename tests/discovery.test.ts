/**
 * Tests del auto-descubrimiento de archivos `.webmcp.css`
 * (meta tag, link rel y /.well-known/webmcp.json), sin red: se inyecta
 * un fetch simulado.
 */
import { describe, expect, it } from 'vitest';
import {
  discoverWebMCP,
  extractDeclaredStylesheet,
  parseWellKnown,
  resolveWebMCPStyles,
  type FetchLike,
} from '../src/proxy';

/** Crea un fetch simulado a partir de un mapa URL → respuesta. */
function mockFetch(routes: Record<string, string>): FetchLike {
  return async (url: string) => {
    const body = routes[url];
    return {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      text: async () => body ?? '',
    };
  };
}

const CSS = '.btn { webmcp-tool: "go"; }';

describe('extractDeclaredStylesheet', () => {
  it('encuentra <meta name="webmcp" content="...">', () => {
    const html = '<head><meta name="webmcp" content="/webmcp.css"></head>';
    expect(extractDeclaredStylesheet(html, 'https://ej.com/page')).toEqual({
      url: 'https://ej.com/webmcp.css',
      source: 'meta',
    });
  });

  it('tolera atributos en cualquier orden y comillas simples', () => {
    const html = "<meta content='/x/estilos.css' name='webmcp' />";
    expect(extractDeclaredStylesheet(html, 'https://ej.com')?.url).toBe(
      'https://ej.com/x/estilos.css',
    );
  });

  it('encuentra <link rel="webmcp" href="...">', () => {
    const html = '<link rel="webmcp" href="https://cdn.ej.com/w.css">';
    expect(extractDeclaredStylesheet(html, 'https://ej.com')).toEqual({
      url: 'https://cdn.ej.com/w.css',
      source: 'link',
    });
  });

  it('devuelve null si no hay declaración', () => {
    expect(
      extractDeclaredStylesheet('<meta name="viewport" content="x">', 'https://ej.com'),
    ).toBeNull();
  });
});

describe('parseWellKnown', () => {
  it('acepta { stylesheet: "..." }', () => {
    expect(parseWellKnown('{"stylesheet":"/webmcp.css"}')).toEqual(['/webmcp.css']);
  });

  it('acepta { stylesheets: [...] }', () => {
    expect(parseWellKnown('{"stylesheets":["/a.css","/b.css"]}')).toEqual([
      '/a.css',
      '/b.css',
    ]);
  });

  it('devuelve [] con JSON inválido o formato desconocido', () => {
    expect(parseWellKnown('no es json')).toEqual([]);
    expect(parseWellKnown('{"otra":"cosa"}')).toEqual([]);
    expect(parseWellKnown('{"stylesheets":[42]}')).toEqual([]);
  });
});

describe('discoverWebMCP', () => {
  it('descubre vía meta tag', async () => {
    const fetchFn = mockFetch({
      'https://ej.com': '<meta name="webmcp" content="/webmcp.css">',
      'https://ej.com/webmcp.css': CSS,
    });
    const result = await discoverWebMCP('https://ej.com', { fetchFn });
    expect(result).toEqual({
      source: 'meta',
      cssUrl: 'https://ej.com/webmcp.css',
      css: CSS,
    });
  });

  it('cae a .well-known cuando el HTML no declara nada', async () => {
    const fetchFn = mockFetch({
      'https://ej.com': '<html><body>hola</body></html>',
      'https://ej.com/.well-known/webmcp.json': '{"stylesheet":"/estilos/w.css"}',
      'https://ej.com/estilos/w.css': CSS,
    });
    const result = await discoverWebMCP('https://ej.com', { fetchFn });
    expect(result?.source).toBe('well-known');
    expect(result?.cssUrl).toBe('https://ej.com/estilos/w.css');
  });

  it('devuelve null si el sitio no publica WebMCP', async () => {
    const fetchFn = mockFetch({ 'https://ej.com': '<html></html>' });
    expect(await discoverWebMCP('https://ej.com', { fetchFn })).toBeNull();
  });

  it('añade https:// a dominios pelados', async () => {
    const fetchFn = mockFetch({
      'https://ej.com': '<meta name="webmcp" content="/w.css">',
      'https://ej.com/w.css': CSS,
    });
    expect(await discoverWebMCP('ej.com', { fetchFn })).not.toBeNull();
  });
});

describe('resolveWebMCPStyles', () => {
  it('prioriza el descubrimiento sobre los estilos comunitarios', async () => {
    const fetchFn = mockFetch({
      'https://ej.com': '<meta name="webmcp" content="/w.css">',
      'https://ej.com/w.css': CSS,
    });
    const resolved = await resolveWebMCPStyles('https://ej.com', { fetchFn });
    expect(resolved?.origin).toBe('meta');
    expect(resolved?.css).toBe(CSS);
  });

  it('cae a community-styles cuando no hay descubrimiento', async () => {
    const fetchFn = mockFetch({});
    const resolved = await resolveWebMCPStyles('https://example.com', {
      fetchFn,
      dir: 'community-styles',
    });
    expect(resolved?.origin).toBe('community');
    expect(resolved?.source).toContain('example.com.webmcp.css');
  });

  it('devuelve null sin descubrimiento ni comunidad', async () => {
    const resolved = await resolveWebMCPStyles('https://nadie-me-conoce.xyz', {
      fetchFn: mockFetch({}),
      dir: 'community-styles',
    });
    expect(resolved).toBeNull();
  });
});
