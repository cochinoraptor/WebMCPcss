/**
 * Retro-WebMCP: proxy HTTP de compatibilidad.
 *
 * Reenvía las peticiones a un sitio antiguo y, en las respuestas HTML,
 * inyecta:
 * - `<link rel="webmcp" href="/.webmcp/webmcp.css">` + `<meta name="webmcp">`
 *   (descubrimiento estándar),
 * - un `<script>` con `window.__WEBMCP_GRAPH__` (agentes de navegador),
 * - opcionalmente registro en `document.modelContext`.
 *
 * Además sirve `/.webmcp/webmcp.css`, `/.webmcp/graph.json` y
 * `/.well-known/webmcp.json`. Implementado con `http`/`https`/`zlib` nativos
 * (sin http-proxy ni express).
 */
import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';
import { parseWebMCP } from '../parser';
import type { ToolMap } from '../types';
import { VERSION } from '../version';
import { buildRetroInjectScript } from './injector';

/** Opciones del proxy. */
export interface RetroProxyOptions {
  /** URL origen del sitio legacy (`https://sitio-antiguo.com`). */
  target: string;
  /** Contenido del `.webmcp.css` a inyectar. */
  css: string;
  /** Puerto local (def. 8080). */
  port?: number;
  /** Host local (def. 0.0.0.0). */
  host?: string;
  /** Registrar también en document.modelContext (def. true). */
  registerModelContext?: boolean;
  /** Cabeceras extra hacia el origen (cookies, auth…). */
  headers?: Record<string, string>;
}

/** Prefijo de las rutas propias del proxy. */
export const PROXY_PREFIX = '/.webmcp';

/**
 * Inyecta el bloque WebMCP en un documento HTML (antes de `</head>` o al
 * principio de `<body>`; si no hay ninguno, al inicio).
 * @param html HTML original.
 * @param toolMap Tool map parseado.
 * @param css CSS original.
 * @param registerModelContext Registrar en document.modelContext.
 */
export function injectWebMcpIntoHtml(
  html: string,
  toolMap: ToolMap,
  css: string,
  registerModelContext = true,
): string {
  const block = [
    `<!-- WebMCPcss retro proxy v${VERSION} -->`,
    `<link rel="webmcp" type="text/webmcp" href="${PROXY_PREFIX}/webmcp.css">`,
    `<meta name="webmcp" content="${PROXY_PREFIX}/webmcp.css">`,
    `<script data-webmcpcss="retro">${buildRetroInjectScript(toolMap, css, { registerModelContext })}</script>`,
  ].join('\n');
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}\n</head>`);
  if (/<body[^>]*>/i.test(html))
    return html.replace(/<body[^>]*>/i, (m) => `${m}\n${block}`);
  return `${block}\n${html}`;
}

/** Reescribe URLs absolutas del origen para que pasen por el proxy. */
export function rewriteAbsoluteUrls(
  html: string,
  target: string,
  proxyBase: string,
): string {
  const origin = new URL(target).origin;
  const protocolRelative = origin.replace(/^https?:/, '');
  return html
    .split(origin)
    .join(proxyBase)
    .replace(
      new RegExp(
        `(["'(=\\s])${protocolRelative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[/"')\\s?#]|$)`,
        'g',
      ),
      `$1${proxyBase}`,
    );
}

/** Descomprime un cuerpo según `content-encoding`. */
function decompress(body: Buffer, encoding: string | undefined): Buffer {
  switch ((encoding ?? '').toLowerCase()) {
    case 'gzip':
      return zlib.gunzipSync(body);
    case 'deflate':
      return zlib.inflateSync(body);
    case 'br':
      return zlib.brotliDecompressSync(body);
    default:
      return body;
  }
}

/**
 * Crea el servidor proxy (sin arrancarlo).
 * @param opts Opciones.
 */
export function createRetroProxy(opts: RetroProxyOptions): http.Server {
  const target = new URL(opts.target);
  const toolMap = parseWebMCP(opts.css);
  const client = target.protocol === 'https:' ? https : http;
  const register = opts.registerModelContext !== false;

  return http.createServer((req, res) => {
    const url = req.url ?? '/';
    const proxyBase = `http://${req.headers.host ?? `localhost:${opts.port ?? 8080}`}`;

    // Rutas propias.
    if (url === `${PROXY_PREFIX}/webmcp.css`) {
      res.writeHead(200, {
        'content-type': 'text/webmcp; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end(opts.css);
      return;
    }
    if (url === `${PROXY_PREFIX}/graph.json`) {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end(
        JSON.stringify(
          { source: opts.target, tools: toolMap.tools, context: toolMap.context },
          null,
          2,
        ),
      );
      return;
    }
    if (url === '/.well-known/webmcp.json') {
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end(
        JSON.stringify(
          {
            version: '1',
            css: `${PROXY_PREFIX}/webmcp.css`,
            origin: opts.target,
            proxy: `webmcpcss@${VERSION}`,
          },
          null,
          2,
        ),
      );
      return;
    }

    // Reenvío al origen.
    const headers: Record<string, string | string[] | undefined> = {
      ...req.headers,
      host: target.host,
      ...opts.headers,
    };
    delete headers['accept-encoding'];
    headers['accept-encoding'] = 'gzip, deflate';
    const upstream = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        method: req.method,
        path: url,
        headers,
      },
      (up) => {
        const chunks: Buffer[] = [];
        const type = String(up.headers['content-type'] ?? '');
        const isHtml = /text\/html/i.test(type);
        if (!isHtml) {
          const h = { ...up.headers };
          if (h.location)
            h.location = String(h.location).replace(target.origin, proxyBase);
          res.writeHead(up.statusCode ?? 502, h);
          up.pipe(res);
          return;
        }
        up.on('data', (c: Buffer) => chunks.push(c));
        up.on('end', () => {
          try {
            const raw = decompress(
              Buffer.concat(chunks),
              String(up.headers['content-encoding'] ?? ''),
            );
            let html = raw.toString('utf8');
            html = rewriteAbsoluteUrls(html, opts.target, proxyBase);
            html = injectWebMcpIntoHtml(html, toolMap, opts.css, register);
            const h = { ...up.headers };
            delete h['content-encoding'];
            delete h['content-length'];
            delete h['content-security-policy'];
            delete h['x-frame-options'];
            if (h.location)
              h.location = String(h.location).replace(target.origin, proxyBase);
            h['x-webmcp-proxy'] = `webmcpcss/${VERSION}`;
            res.writeHead(up.statusCode ?? 200, h);
            res.end(html);
          } catch (err) {
            res.writeHead(502, { 'content-type': 'text/plain' });
            res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`);
          }
        });
      },
    );
    upstream.on('error', (err) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`No se pudo contactar con ${opts.target}: ${err.message}`);
    });
    req.pipe(upstream);
  });
}

/**
 * Arranca el proxy.
 * @returns Servidor y URL local.
 */
export async function startRetroProxy(
  opts: RetroProxyOptions,
): Promise<{ server: http.Server; url: string }> {
  const server = createRetroProxy(opts);
  const port = opts.port ?? 8080;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, opts.host ?? '0.0.0.0', () => resolve());
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return { server, url: `http://localhost:${actualPort}` };
}
