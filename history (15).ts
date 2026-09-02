/**
 * Historial de eventos de WebMCPcss.
 *
 * Los comandos del CLI (validate, repair, execute) registran eventos en un
 * archivo JSON local que el dashboard (`webmcpcss dashboard`) lee para
 * mostrar estadísticas en tiempo real.
 */
import * as fs from 'fs';
import * as path from 'path';

/** Evento del historial. */
export interface HistoryEvent {
  /** Timestamp ISO 8601. */
  ts: string;
  /** Tipo de evento. */
  type: 'validate' | 'repair' | 'execute';
  /** URL o página asociada. */
  url?: string;
  /** Nombre de herramienta (si aplica). */
  tool?: string;
  /** ¿Fue exitoso? */
  ok: boolean;
  /** Detalles adicionales (selectores reparados, conteos...). */
  details?: Record<string, unknown>;
}

/** Máximo de eventos conservados en el archivo. */
const MAX_EVENTS = 500;

/** Ruta por defecto del archivo de historial. */
export function defaultHistoryFile(): string {
  return path.join(process.cwd(), '.webmcpcss', 'history.json');
}

/**
 * Lee el historial completo (más reciente al final).
 * @param file Ruta del archivo (por defecto `.webmcpcss/history.json`).
 * @returns Lista de eventos; vacía si no existe o está corrupto.
 */
export function readHistory(file: string = defaultHistoryFile()): HistoryEvent[] {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const data: unknown = JSON.parse(raw);
    return Array.isArray(data) ? (data as HistoryEvent[]) : [];
  } catch {
    return [];
  }
}

/**
 * Añade un evento al historial (creando el archivo si no existe) y recorta
 * a {@link MAX_EVENTS} entradas.
 *
 * @param event Evento sin timestamp (se añade automáticamente).
 * @param file Ruta del archivo.
 * @returns El evento completo escrito.
 */
export function appendHistory(
  event: Omit<HistoryEvent, 'ts'>,
  file: string = defaultHistoryFile(),
): HistoryEvent {
  const full: HistoryEvent = { ts: new Date().toISOString(), ...event };
  const events = readHistory(file);
  events.push(full);
  const trimmed = events.slice(-MAX_EVENTS);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(trimmed, null, 2), 'utf8');
  return full;
}

/**
 * Calcula estadísticas agregadas del historial.
 * @param events Eventos leídos con {@link readHistory}.
 */
export function computeStats(events: HistoryEvent[]): {
  total: number;
  executions: { total: number; ok: number; failed: number };
  repairs: { total: number; ok: number; failed: number };
  validations: { total: number; ok: number; failed: number };
} {
  const bucket = (type: HistoryEvent['type']) => {
    const of = events.filter((e) => e.type === type);
    return {
      total: of.length,
      ok: of.filter((e) => e.ok).length,
      failed: of.filter((e) => !e.ok).length,
    };
  };
  return {
    total: events.length,
    executions: bucket('execute'),
    repairs: bucket('repair'),
    validations: bucket('validate'),
  };
}
