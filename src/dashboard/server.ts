/**
 * Servidor del dashboard de WebMCPcss.
 *
 * Un servidor HTTP mínimo (sin dependencias externas, `node:http`) que
 * sirve una interfaz web con:
 * - Las herramientas activas del `.webmcp.css` cargado.
 * - El historial de ejecuciones/validaciones/reparaciones.
 * - Estadísticas agregadas.
 *
 * Endpoints:
 * - `GET /`           → interfaz web.
 * - `GET /api/state`  → JSON con tool map, historial y estadísticas.
 * - `POST /api/events`→ registra un evento externo en el historial.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { parseWebMCPFile } from '../parser';
import type { ToolMap } from '../types';
import {
  appendHistory,
  computeStats,
  defaultHistoryFile,
  readHistory,
  type HistoryEvent,
} from '../utils/history';
import { logger } from '../utils/logger';

/** Opciones del dashboard. */
export interface DashboardOptions {
  /** Puerto de escucha (por defecto 3000). */
  port?: number;
  /** Host de escucha (por defecto 0.0.0.0 para entornos remotos). */
  host?: string;
  /** Ruta a un `.webmcp.css` para mostrar sus herramientas. */
  cssPath?: string;
  /** Archivo de historial (por defecto `.webmcpcss/history.json`). */
  historyFile?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

/** Lee el tool map del CSS configurado (tolerante a errores). */
function loadToolMap(cssPath?: string): { toolMap: ToolMap | null; error?: string } {
  if (!cssPath) return { toolMap: null };
  try {
    return { toolMap: parseWebMCPFile(cssPath) };
  } catch (err) {
    return { toolMap: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Crea (sin arrancar) el servidor HTTP del dashboard.
 * @param options Opciones de configuración.
 */
export function createDashboardServer(options: DashboardOptions = {}): http.Server {
  const historyFile = options.historyFile ?? defaultHistoryFile();
  const publicDir = path.join(__dirname, 'public');

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');

    // API: estado completo.
    if (url.pathname === '/api/state' && req.method === 'GET') {
      const { toolMap, error } = loadToolMap(options.cssPath);
      const history = readHistory(historyFile);
      const body = JSON.stringify({
        cssPath: options.cssPath ?? null,
        parseError: error ?? null,
        toolMap,
        history: history.slice(-100).reverse(),
        stats: computeStats(history),
        now: new Date().toISOString(),
      });
      res.writeHead(200, { 'content-type': MIME['.json'] });
      res.end(body);
      return;
    }

    // API: registrar evento externo.
    if (url.pathname === '/api/events' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        try {
          const event = JSON.parse(raw) as Omit<HistoryEvent, 'ts'>;
          if (!event || typeof event.type !== 'string')
            throw new Error('evento inválido');
          const written = appendHistory(event, historyFile);
          res.writeHead(201, { 'content-type': MIME['.json'] });
          res.end(JSON.stringify(written));
        } catch (err) {
          res.writeHead(400, { 'content-type': MIME['.json'] });
          res.end(
            JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
          );
        }
      });
      return;
    }

    // Estáticos.
    const file = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
    const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(publicDir, safe);
    if (full.startsWith(publicDir) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      res.writeHead(200, {
        'content-type': MIME[path.extname(full)] ?? 'application/octet-stream',
      });
      res.end(fs.readFileSync(full));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('404');
  });
}

/**
 * Arranca el dashboard y devuelve el servidor escuchando.
 * @param options Opciones de configuración.
 */
export async function startDashboard(
  options: DashboardOptions = {},
): Promise<http.Server> {
  const port = options.port ?? 3000;
  const host = options.host ?? '0.0.0.0';
  const server = createDashboardServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  logger.success(`Dashboard WebMCPcss escuchando en http://${host}:${port}`);
  return server;
}
