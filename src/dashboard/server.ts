/**
 * Dashboard web (`webmcpcss dashboard`): servidor HTTP sin dependencias
 * que muestra el tool map, el historial de eventos y estadísticas, y
 * permite inyectar WebMCP en cualquier URL desde la UI.
 *
 * Endpoints: `GET /` (UI), `GET /api/state`, `POST /api/events` y
 * `POST /api/inject` (inyección por URL).
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { parseWebMCPFile } from '../parser';
import { injectWebMCP, type InjectResult } from '../proxy';
import type { ToolMap } from '../types';
import {
  appendEvent,
  historyStats,
  loadHistory,
  type HistoryEvent,
} from '../utils/history';

/** Función de inyección (inyectable para pruebas). */
export type InjectFn = (
  url: string,
  opts: { communityDir?: string },
) => Promise<InjectResult>;

/** Opciones del servidor de dashboard. */
export interface DashboardOptions {
  /** Puerto TCP (defecto 3000). */
  port?: number;
  /** Host de escucha (defecto localhost). */
  host?: string;
  /** Ruta al `.webmcp.css` a visualizar. */
  cssPath?: string;
  /** Directorio del historial (defecto: cwd). */
  cwd?: string;
  /** Directorio de estilos comunitarios (defecto: `community-styles/` si existe). */
  communityDir?: string;
  /** Implementación de inyección (defecto: {@link injectWebMCP}; pruebas). */
  injectImpl?: InjectFn;
}

/**
 * Arranca el dashboard.
 *
 * @param opts Opciones (puerto, CSS, historial).
 * @returns Servidor HTTP ya escuchando.
 */
export function startDashboard(opts: DashboardOptions = {}): Promise<http.Server> {
  const port = opts.port ?? 3000;
  const host = opts.host ?? '127.0.0.1';
  const cwd = opts.cwd ?? process.cwd();
  const inject: InjectFn = opts.injectImpl ?? injectWebMCP;

  /** Directorio comunitario efectivo: opción o `community-styles/` si existe. */
  const communityDir = (): string | undefined => {
    if (opts.communityDir !== undefined) return opts.communityDir;
    const def = path.join(cwd, 'community-styles');
    return fs.existsSync(def) ? def : undefined;
  };

  const readState = () => {
    let toolMap: ToolMap = { tools: {}, context: {} };
    if (opts.cssPath && fs.existsSync(opts.cssPath)) {
      try {
        toolMap = parseWebMCPFile(opts.cssPath);
      } catch {
        // CSS ilegible: se muestra el mapa vacío con el error en el historial
      }
    }
    const history = loadHistory(cwd);
    return { toolMap, history, stats: historyStats(history) };
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (
      req.method === 'GET' &&
      (url.pathname === '/' || url.pathname === '/index.html')
    ) {
      const file = path.join(__dirname, 'public', 'index.html');
      try {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(file));
      } catch {
        res.writeHead(500);
        res.end('dashboard assets no encontrados');
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(readState()));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/events') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        if (body.length > 64 * 1024) req.destroy();
      });
      req.on('end', () => {
        try {
          const event = JSON.parse(body) as HistoryEvent;
          const stored = appendEvent(event, cwd);
          res.writeHead(201, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(stored));
        } catch {
          res.writeHead(400);
          res.end('{"error":"evento inválido"}');
        }
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/inject') {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
        if (body.length > 16 * 1024) req.destroy();
      });
      req.on('end', () => {
        void (async () => {
          let target: string;
          try {
            const parsed = JSON.parse(body) as { url?: unknown };
            if (
              typeof parsed.url !== 'string' ||
              !/^https?:\/\//i.test(parsed.url.trim())
            ) {
              res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ error: 'url inválida: se espera http(s)://' }));
              return;
            }
            target = parsed.url.trim();
          } catch {
            res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'cuerpo JSON inválido' }));
            return;
          }
          try {
            const result = await inject(target, { communityDir: communityDir() });
            appendEvent(
              {
                type: 'inject',
                target,
                ok: result.injected,
                details: {
                  source: result.source,
                  tools: Object.keys(result.toolMap?.tools ?? {}).length,
                },
              },
              cwd,
            );
            res.writeHead(result.injected ? 200 : 422, {
              'content-type': 'application/json; charset=utf-8',
            });
            res.end(JSON.stringify(result));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            appendEvent({ type: 'error', target, ok: false, details: { message } }, cwd);
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: message }));
          }
        })();
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
