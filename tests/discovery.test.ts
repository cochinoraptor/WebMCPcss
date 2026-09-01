/**
 * Tests del auto-descubrimiento y los estilos comunitarios.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  discoverWebMCP,
  findCommunityStyle,
  resolveWebMCPStyles,
  type FetchLike,
} from '../src/proxy/discovery';

/** fetch falso con respuestas programadas por URL. */
function fakeFetch(routes: Record<string, { status?: number; body: string }>): FetchLike {
  return async (url: string) => {
    const route = routes[url];
    if (!route) {
      return new Response('not found', { status: 404 });
    }
    return new Response(route.body, { status: route.status ?? 200 });
  };
}

describe('discoverWebMCP', () => {
  const URL_ = 'https://tienda.example.com';

  it('detecta <meta name="webmcp">', async () => {
    const fetchImpl = fakeFetch({
      [URL_]: {
        body: '<html><head><meta name="webmcp" content="/webmcp.css"></head></html>',
      },
    });
    const result = await discoverWebMCP(URL_, { fetchImpl });
    expect(result.found).toBe(true);
    expect(result.method).toBe('meta');
    expect(result.stylesheet).toBe('https://tienda.example.com/webmcp.css');
  });

  it('detecta <link rel="webmcp">', async () => {
    const fetchImpl = fakeFetch({
      [URL_]: {
        body: '<html><head><link rel="webmcp" href="/assets/map.css"></head></html>',
      },
    });
    const result = await discoverWebMCP(URL_, { fetchImpl });
    expect(result.found).toBe(true);
    expect(result.method).toBe('link');
    expect(result.stylesheet).toBe('https://tienda.example.com/assets/map.css');
  });

  it('cae a /.well-known/webmcp.json', async () => {
    const fetchImpl = fakeFetch({
      [URL_]: { body: '<html><head></head></html>' },
      'https://tienda.example.com/.well-known/webmcp.json': {
        body: JSON.stringify({ stylesheet: '/webmcp.css' }),
      },
    });
    const result = await discoverWebMCP(URL_, { fetchImpl });
    expect(result.found).toBe(true);
    expect(result.method).toBe('well-known');
  });

  it('no encontrado cuando el sitio no publica nada', async () => {
    const fetchImpl = fakeFetch({
      [URL_]: { body: '<html><head></head></html>' },
    });
    const result = await discoverWebMCP(URL_, { fetchImpl });
    expect(result.found).toBe(false);
  });

  it('tolera fallos de red devolviendo found: false', async () => {
    const failing: FetchLike = async () => {
      throw new Error('network down');
    };
    const result = await discoverWebMCP('https://caido.example.com', {
      fetchImpl: failing,
    });
    expect(result.found).toBe(false);
  });
});

describe('estilos comunitarios', () => {
  function communityDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-'));
    fs.writeFileSync(
      path.join(dir, 'example.com.webmcp.css'),
      '.b { webmcp-tool: "t"; }',
    );
    fs.writeFileSync(
      path.join(dir, 'tienda.example.com.webmcp.css'),
      '.b2 { webmcp-tool: "t2"; }',
    );
    return dir;
  }

  it('resuelve la cadena de subdominios (sub → dominio)', () => {
    const dir = communityDir();
    expect(findCommunityStyle(dir, 'https://tienda.example.com/menu')).toBe(
      path.join(dir, 'tienda.example.com.webmcp.css'),
    );
    expect(findCommunityStyle(dir, 'https://www.example.com')).toBe(
      path.join(dir, 'example.com.webmcp.css'),
    );
    expect(findCommunityStyle(dir, 'https://otrono-relacionado.net')).toBeUndefined();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('resolveWebMCPStyles prefiere el descubrimiento sobre la comunidad', async () => {
    const dir = communityDir();
    const url = 'https://tienda.example.com';
    const fetchImpl = fakeFetch({
      [url]: { body: '<meta name="webmcp" content="/map.css">' },
      [`${url}/map.css`]: { body: '.descubrimiento { webmcp-tool: "official"; }' },
    });
    const resolved = await resolveWebMCPStyles(url, dir, { fetchImpl });
    expect(resolved.source).toBe('discovery');
    expect(resolved.css).toContain('official');

    // Sin descubrimiento: cae a community-styles.
    const fetch404 = fakeFetch({ [url]: { body: '<html></html>' } });
    const fallback = await resolveWebMCPStyles(url, dir, { fetchImpl: fetch404 });
    expect(fallback.source).toBe('community');
    expect(fallback.css).toContain('t2');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
