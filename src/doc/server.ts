/**
 * Doc-MCP: servidor de documentación (`webmcpcss doc serve`).
 *
 * Sirve la documentación HTML con búsqueda y expone el modelo JSON, el
 * Markdown, `llms.txt` y `AGENTS.md`. Usa `http` nativo. Recarga el
 * `.webmcp.css` en cada petición (útil mientras se edita).
 */
import * as fs from 'fs';
import * as http from 'http';
import { parseWebMCPFile } from '../parser';
import { generateDocs, type DocOptions } from './generator';

/** Opciones del servidor. */
export interface DocServerOptions extends DocOptions {
  /** Ruta al `.webmcp.css`. */
  cssPath: string;
  /** Puerto (def. 3000). */
  port?: number;
  /** Host (def. 0.0.0.0). */
  host?: string;
}

/** Tipos MIME por archivo generado. */
const MIME: Record<string, string> = {
  'index.html': 'text/html; charset=utf-8',
  'README.md': 'text/markdown; charset=utf-8',
  'doc.json': 'application/json; charset=utf-8',
  'llms.txt': 'text/plain; charset=utf-8',
  'AGENTS.md': 'text/markdown; charset=utf-8',
};

/**
 * Crea el servidor HTTP de documentación (sin arrancarlo).
 * @param opts Opciones.
 */
export function createDocServer(opts: DocServerOptions): http.Server {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let file = url.pathname.replace(/^\/+/, '') || 'index.html';
    if (file === 'api/doc' || file === 'doc.json') file = 'doc.json';
    if (file === 'readme' || file === 'README.md') file = 'README.md';
    if (!(file in MIME)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('No encontrado');
      return;
    }
    try {
      if (!fs.existsSync(opts.cssPath)) throw new Error(`No existe ${opts.cssPath}`);
      const docs = generateDocs(parseWebMCPFile(opts.cssPath), opts);
      res.writeHead(200, { 'content-type': MIME[file], 'access-control-allow-origin': '*' });
      res.end(docs[file as keyof typeof docs]);
    } catch (err) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(`Error generando documentación: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

/**
 * Arranca el servidor de documentación.
 * @returns El servidor y la URL local.
 */
export async function startDocServer(opts: DocServerOptions): Promise<{ server: http.Server; url: string }> {
  const server = createDocServer(opts);
  const port = opts.port ?? 3000;
  const host = opts.host ?? '0.0.0.0';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return { server, url: `http://localhost:${actualPort}` };
}
