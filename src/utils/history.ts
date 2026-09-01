/**
 * Historial de eventos (`.webmcpcss/history.json`): lo alimentan
 * `validate` y `repair` y lo lee el dashboard.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Evento del historial. */
export interface HistoryEvent {
  /** Marca temporal ISO (la rellena `appendEvent` si falta). */
  ts?: string;
  /** Tipo de evento. */
  type: 'validate' | 'repair' | 'generate' | 'discover' | 'inject' | 'error';
  /** Objetivo (URL o archivo). */
  target?: string;
  /** Resultado general. */
  ok?: boolean;
  /** Detalles libres (selector reparado, entradas validadas...). */
  details?: Record<string, unknown>;
}

/** Máximo de eventos conservados en el archivo. */
const MAX_EVENTS = 500;

/**
 * Ruta del historial para un directorio de proyecto.
 *
 * @param dir Directorio de trabajo (defecto: cwd).
 * @returns Ruta absoluta de `.webmcpcss/history.json`.
 */
export function historyPath(dir: string = process.cwd()): string {
  return path.join(dir, '.webmcpcss', 'history.json');
}

/**
 * Carga el historial de un directorio (vacío si no existe).
 *
 * @param dir Directorio de trabajo.
 * @returns Eventos ordenados del más antiguo al más reciente.
 */
export function loadHistory(dir: string = process.cwd()): HistoryEvent[] {
  try {
    const raw = JSON.parse(fs.readFileSync(historyPath(dir), 'utf8')) as {
      events?: HistoryEvent[];
    };
    return Array.isArray(raw.events) ? raw.events : [];
  } catch {
    return [];
  }
}

/**
 * Añade un evento al historial (crea el directorio si hace falta y recorta
 * a {@link MAX_EVENTS} entradas).
 *
 * @param event Evento a registrar.
 * @param dir Directorio de trabajo.
 * @returns Evento tal como quedó guardado.
 */
export function appendEvent(
  event: HistoryEvent,
  dir: string = process.cwd(),
): HistoryEvent {
  const file = historyPath(dir);
  const stored: HistoryEvent = { ...event, ts: event.ts ?? new Date().toISOString() };
  const events = [...loadHistory(dir), stored].slice(-MAX_EVENTS);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ events }, null, 2));
  return stored;
}

/**
 * Estadísticas agregadas del historial para el dashboard.
 *
 * @param events Eventos cargados.
 * @returns Contadores por tipo y total.
 */
export function historyStats(events: HistoryEvent[]): Record<string, number> {
  const stats: Record<string, number> = { total: events.length };
  for (const event of events) {
    stats[event.type] = (stats[event.type] ?? 0) + 1;
  }
  return stats;
}
