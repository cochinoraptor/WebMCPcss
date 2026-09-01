/**
 * Auto-descubrimiento de WebMCP: comprueba si un sitio publica su
 * `.webmcp.css` mediante `<meta name="webmcp">`, `<link rel="webmcp">` o
 * `/.well-known/webmcp.json` — sin navegador, solo `fetch`.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Resultado del descubrimiento sobre una URL. */
export interface DiscoveryResult {
  /** URL consultada. */
  url: string;
  /** `true` si el sitio publica su WebMCP. */
  found: boolean;
  /** Cómo se descubrió. */
  method?: 'meta' | 'link' | 'well-known';
  /** URL absoluta del `.webmcp.css` descubierto. */
  stylesheet?: string;
}

/** Tipos de `fetch` inyectable para pruebas. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Opciones de descubrimiento. */
export interface DiscoveryOptions {
  /** Timeout total en ms (defecto 8000). */
  timeoutMs?: number;
  /** Implementación de fetch inyectable (tests). */
  fetchImpl?: FetchLike;
}

/**
 * Descubre el `.webmcp.css` publicado por un sitio.
 *
 * Orden: meta tag → link tag → `/.well-known/webmcp.json`.
 *
 * @param url URL del sitio (`https://ejemplo.com` o con ruta).
 * @param opts Opciones (timeout, fetch inyectable).
 * @returns Resultado del descubrimiento.
 */
export async function discoverWebMCP(
  url: string,
  opts: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  const doFetch = opts.fetchImpl ?? ((u: string) => fetch(u));
  const timeoutMs = opts.timeoutMs ?? 8000;
  const signal =
    typeof AbortSignal !== 'undefined' ? AbortSignal.timeout(timeoutMs) : undefined;

  let html: string;
  try {
    const res = await doFetch(url, { signal, redirect: 'follow' });
    if (!res.ok) return { url, found: false };
    html = await res.text();
  } catch {
    return { url, found: false };
  }

  const meta = html.match(
    /<meta[^>]+name=["']?webmcp["']?[^>]+content=["']([^"']+)["']/i,
  );
  const link = html.match(/<link[^>]+rel=["']?webmcp["']?[^>]+href=["']([^"']+)["']/i);
  const linkAlt = html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']?webmcp["']?/i);

  let stylesheet: string | undefined;
  let method: DiscoveryResult['method'];
  if (meta) {
    stylesheet = meta[1];
    method = 'meta';
  } else if (link || linkAlt) {
    stylesheet = (link ?? linkAlt)![1];
    method = 'link';
  } else {
    try {
      const res = await doFetch(new URL('/.well-known/webmcp.json', url).toString(), {
        signal,
      });
      if (res.ok) {
        const json = (await res.json()) as { stylesheet?: string };
        if (json.stylesheet) {
          stylesheet = json.stylesheet;
          method = 'well-known';
        }
      }
    } catch {
      // sin well-known: no publica WebMCP
    }
  }

  if (!stylesheet) return { url, found: false };
  return { url, found: true, method, stylesheet: new URL(stylesheet, url).toString() };
}

/**
 * Resuelve el CSS de WebMCP para una URL: primero auto-descubrimiento
 * (el sitio es dueño de su mapa) y, si no, estilos comunitarios
 * (`community-styles/<dominio>.webmcp.css` con cadena de subdominios).
 *
 * @param url URL del sitio.
 * @param communityDir Directorio de estilos comunitarios.
 * @param opts Opciones (timeout, fetch inyectable).
 * @returns Origen (`discovery` | `community` | `none`) y CSS si se encontró.
 */
export async function resolveWebMCPStyles(
  url: string,
  communityDir?: string,
  opts: DiscoveryOptions = {},
): Promise<{
  source: 'discovery' | 'community' | 'none';
  css?: string;
  path?: string;
  domain: string;
  discovery?: DiscoveryResult;
}> {
  const domain = domainOf(url);
  const doFetch = opts.fetchImpl ?? ((u: string) => fetch(u));

  const discovery = await discoverWebMCP(url, opts);
  if (discovery.found && discovery.stylesheet) {
    try {
      const res = await doFetch(discovery.stylesheet);
      if (res.ok) {
        const css = await res.text();
        if (css.trim()) {
          return { source: 'discovery', css, domain, discovery };
        }
      }
    } catch {
      // descubrimiento declarado pero ilegible: caer a comunidad
    }
  }

  if (communityDir) {
    const found = findCommunityStyle(communityDir, url);
    if (found) {
      return {
        source: 'community',
        css: fs.readFileSync(found, 'utf8'),
        path: found,
        domain,
        discovery,
      };
    }
  }

  return { source: 'none', domain, discovery };
}

/**
 * Busca el estilo comunitario para una URL probando la cadena de
 * subdominios: `a.b.ejemplo.com` → `b.ejemplo.com` → `ejemplo.com`.
 *
 * @param dir Directorio `community-styles/`.
 * @param url URL del sitio.
 * @returns Ruta al archivo encontrado, o `undefined`.
 */
export function findCommunityStyle(dir: string, url: string): string | undefined {
  const domain = domainOf(url);
  const labels = domain.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    const file = path.join(dir, `${candidate}.webmcp.css`);
    if (fs.existsSync(file)) return file;
  }
  return undefined;
}

/**
 * Extrae el dominio (sin `www.`, sin protocolo ni ruta) de una URL.
 */
function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/^www\./, '')
      .toLowerCase();
  }
}
