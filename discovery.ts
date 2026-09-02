/**
 * Auto-descubrimiento de archivos `.webmcp.css`.
 *
 * Permite a un agente saber si un sitio publica WebMCP **sin** navegar la
 * página con un navegador completo. Dos mecanismos, en orden:
 *
 * 1. **Meta tag / link en el HTML**:
 *    `<meta name="webmcp" content="/webmcp.css">` o
 *    `<link rel="webmcp" href="/webmcp.css">`
 * 2. **Well-known**: `GET /.well-known/webmcp.json` con el formato
 *    `{ "stylesheet": "/webmcp.css" }` (o `"stylesheets": ["...", ...]`).
 *
 * Todas las funciones aceptan un `fetchFn` inyectable para poder testearse
 * sin red.
 */
import { logger } from '../utils/logger';

/** Firma mínima de fetch que necesitamos (inyectable en tests). */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** Resultado de un descubrimiento exitoso. */
export interface DiscoveryResult {
  /** Mecanismo que encontró el archivo. */
  source: 'meta' | 'link' | 'well-known';
  /** URL absoluta del `.webmcp.css`. */
  cssUrl: string;
  /** Contenido del archivo. */
  css: string;
}

/** Opciones de descubrimiento. */
export interface DiscoveryOptions {
  /** Implementación de fetch (por defecto, la global). */
  fetchFn?: FetchLike;
}

/**
 * Extrae la URL del `.webmcp.css` declarada en el HTML mediante
 * `<meta name="webmcp" content="...">` o `<link rel="webmcp" href="...">`.
 * Tolera atributos en cualquier orden y comillas simples/dobles.
 *
 * @param html HTML de la página.
 * @param baseUrl URL base para resolver rutas relativas.
 * @returns `{ url, source }` o `null` si no hay declaración.
 */
export function extractDeclaredStylesheet(
  html: string,
  baseUrl: string,
): { url: string; source: 'meta' | 'link' } | null {
  // <meta ... name="webmcp" ... content="..."> (atributos en cualquier orden)
  const metaTag = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = metaTag.exec(html)) !== null) {
    const tag = m[0];
    if (/\bname\s*=\s*["']?webmcp["']?/i.test(tag)) {
      const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (content) return { url: new URL(content[1], baseUrl).href, source: 'meta' };
    }
  }
  // <link ... rel="webmcp" ... href="...">
  const linkTag = /<link\b[^>]*>/gi;
  while ((m = linkTag.exec(html)) !== null) {
    const tag = m[0];
    if (/\brel\s*=\s*["']?webmcp["']?/i.test(tag)) {
      const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
      if (href) return { url: new URL(href[1], baseUrl).href, source: 'link' };
    }
  }
  return null;
}

/**
 * Parsea el cuerpo de `/.well-known/webmcp.json` y devuelve las rutas de
 * stylesheets declaradas. Formatos aceptados:
 * - `{ "stylesheet": "/webmcp.css" }`
 * - `{ "stylesheets": ["/a.css", "/b.css"] }`
 *
 * @param raw JSON crudo.
 * @returns Lista de rutas (posiblemente vacía si el formato es inválido).
 */
export function parseWellKnown(raw: string): string[] {
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return [];
    const obj = data as { stylesheet?: unknown; stylesheets?: unknown };
    if (typeof obj.stylesheet === 'string') return [obj.stylesheet];
    if (Array.isArray(obj.stylesheets)) {
      return obj.stylesheets.filter((s): s is string => typeof s === 'string');
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Intenta descubrir el `.webmcp.css` de un sitio:
 * 1. Descarga el HTML y busca el meta tag / link.
 * 2. Si no hay, consulta `/.well-known/webmcp.json`.
 * 3. Descarga y devuelve el CSS del primer mecanismo que funcione.
 *
 * @param url URL de la página o del sitio.
 * @param options Opciones (fetch inyectable).
 * @returns El resultado del descubrimiento, o `null` si el sitio no publica WebMCP.
 */
export async function discoverWebMCP(
  url: string,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult | null> {
  const fetchFn: FetchLike = options.fetchFn ?? (fetch as unknown as FetchLike);
  const target = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;

  // 1) Meta tag / link en el HTML.
  try {
    const res = await fetchFn(target);
    if (res.ok) {
      const html = await res.text();
      const declared = extractDeclaredStylesheet(html, target);
      if (declared) {
        const cssRes = await fetchFn(declared.url);
        if (cssRes.ok) {
          logger.debug(`discovery: ${declared.source} → ${declared.url}`);
          return {
            source: declared.source,
            cssUrl: declared.url,
            css: await cssRes.text(),
          };
        }
      }
    }
  } catch (err) {
    logger.debug(
      `discovery: fallo leyendo HTML (${err instanceof Error ? err.message : err})`,
    );
  }

  // 2) Well-known.
  try {
    const origin = new URL(target).origin;
    const wkUrl = `${origin}/.well-known/webmcp.json`;
    const wkRes = await fetchFn(wkUrl);
    if (wkRes.ok) {
      const paths = parseWellKnown(await wkRes.text());
      for (const p of paths) {
        const cssUrl = new URL(p, origin).href;
        const cssRes = await fetchFn(cssUrl);
        if (cssRes.ok) {
          logger.debug(`discovery: well-known → ${cssUrl}`);
          return { source: 'well-known', cssUrl, css: await cssRes.text() };
        }
      }
    }
  } catch (err) {
    logger.debug(
      `discovery: fallo well-known (${err instanceof Error ? err.message : err})`,
    );
  }

  return null;
}
