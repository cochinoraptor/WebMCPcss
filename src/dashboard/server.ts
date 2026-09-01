/**
 * Dashboard web (`webmcpcss dashboard`): servidor HTTP sin dependencias
 * que muestra el tool map, el historial de eventos y estadísticas.
 *
 * Endpoints: `GET /` (UI), `GET /api/state`, `POST /api/events`.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { parseWebMCPFile } from '../parser';
import type { ToolMap } from '../types';
import {
  appendEvent,
  historyStats,
  loadHistory,
  type HistoryEvent,
} from '../utils/history';

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
    res.writeHead(404);
    res.end('not found');
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
