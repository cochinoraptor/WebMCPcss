/**
 * Interfaz común de los motores de animación y utilidades compartidas.
 *
 * Los motores son **isomorfos**: no importan nada de Node y reciben el
 * `Window` sobre el que operan, de modo que funcionan igual en jsdom (tests)
 * y en un navegador real (inyectados por `runtime-bundle`).
 */
import {
  type AnimationConfig,
  type AnimationEngineId,
  type AnimationKeyframe,
  type BrowserCapabilities,
  type SandboxMode,
} from '../types';

/** Contexto de ejecución que el orquestador pasa a los motores. */
export interface EngineContext {
  /** Ventana (real o jsdom). */
  win: Window;
  /** Documento. */
  doc: Document;
  /** Capacidades detectadas. */
  capabilities: BrowserCapabilities;
  /** `add` cuando el resolutor decidió fusionar (solo motores que lo soporten). */
  composite?: 'replace' | 'add';
  /** Aislamiento solicitado. */
  sandbox?: SandboxMode;
  /** `prefers-reduced-motion` activo y respetado → aplicar estado final estático. */
  reducedMotion: boolean;
}

/** Animación en curso devuelta por un motor. */
export interface EngineRun {
  /** Propiedades CSS que anima (para el registro de conflictos). */
  properties: string[];
  /** Se resuelve cuando la animación termina (nunca, si es infinita). */
  finished: Promise<void>;
  /** Detiene y limpia la animación. Idempotente. */
  stop(): void;
  /** Información adicional (serializable). */
  details?: Record<string, unknown>;
}

/** Contrato de un motor de animación. */
export interface AnimationEngine {
  /** Identificador del motor. */
  readonly id: AnimationEngineId;
  /**
   * ¿Puede ejecutar esta configuración con estas capacidades?
   * @returns `true` o un motivo legible por el que no.
   */
  supports(config: AnimationConfig, capabilities: BrowserCapabilities): true | string;
  /** Propiedades CSS que animaría (sin ejecutar). */
  propertiesFor(config: AnimationConfig): string[];
  /** Ejecuta la animación sobre los elementos. */
  execute(
    config: AnimationConfig,
    elements: Element[],
    ctx: EngineContext,
  ): Promise<EngineRun>;
  /** Elimina cualquier rastro de este motor en el elemento. */
  cleanup(element: Element): Promise<void>;
}

/** Atributo con el identificador estable de un elemento animado. */
export const ELEMENT_ID_ATTR = 'data-webmcp-anim-id';
/** Prefijo de los identificadores de animaciones WAAPI creadas por WebMCPcss. */
export const ANIMATION_ID_PREFIX = 'webmcpcss:';
/** Claves de un fotograma que NO son propiedades CSS. */
const KEYFRAME_META = new Set(['offset', 'easing', 'composite', 'computedOffset']);

let idCounter = 0;

/**
 * Devuelve (creando si hace falta) un identificador estable para el elemento,
 * persistido en un atributo `data-*` para sobrevivir a serializaciones.
 */
export function ensureElementId(el: Element): string {
  let id = el.getAttribute(ELEMENT_ID_ATTR);
  if (!id) {
    id = `wa${++idCounter}`;
    el.setAttribute(ELEMENT_ID_ATTR, id);
  }
  return id;
}

/** `backgroundColor` → `background-color`. */
export function toKebab(prop: string): string {
  if (prop.startsWith('--')) return prop;
  return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^ms-/, '-ms-');
}

/** `background-color` → `backgroundColor`. */
export function toCamel(prop: string): string {
  if (prop.startsWith('--')) return prop;
  return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Convierte una duración (`1.5s`, `300ms`, número en ms) a milisegundos. */
export function toMs(value: string | number | undefined, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  const m = /^\s*([\d.]+)\s*(ms|s)?\s*$/i.exec(value);
  if (!m) return fallback;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return fallback;
  return (m[2] ?? 'ms').toLowerCase() === 's' ? n * 1000 : n;
}

/** Propiedades CSS (kebab-case) presentes en una lista de fotogramas. */
export function keyframeProperties(keyframes: AnimationKeyframe[]): string[] {
  const props = new Set<string>();
  for (const kf of keyframes) {
    for (const key of Object.keys(kf)) {
      if (KEYFRAME_META.has(key) || kf[key] === undefined) continue;
      props.add(toKebab(key));
    }
  }
  return [...props];
}

/** Transformación CSS final de una animación isométrica o 3D. */
export function buildTransform(config: AnimationConfig): string {
  const p = config.parameters;
  const parts: string[] = [];
  if (p.perspective) parts.push(`perspective(${p.perspective})`);
  if (config.type === 'isometric') {
    parts.push(`rotateX(${p.rotationX ?? '60deg'})`);
    if (p.rotationY) parts.push(`rotateY(${p.rotationY})`);
    parts.push(`rotateZ(${p.rotationZ ?? '-45deg'})`);
  } else {
    if (p.rotationX) parts.push(`rotateX(${p.rotationX})`);
    if (p.rotationY) parts.push(`rotateY(${p.rotationY})`);
    if (p.rotationZ) parts.push(`rotateZ(${p.rotationZ})`);
    if (!p.rotationX && !p.rotationY && !p.rotationZ && !p.translationZ && !p.scale) {
      parts.push('rotateY(25deg)');
    }
  }
  if (p.translationZ) parts.push(`translateZ(${p.translationZ})`);
  if (typeof p.scale === 'number') parts.push(`scale(${p.scale})`);
  return parts.join(' ');
}

/**
 * Fotogramas equivalentes a la animación (keyframes explícitos o generados
 * para `isometric`/`3d-transform`). Los nombres quedan en kebab-case.
 */
export function keyframesFor(config: AnimationConfig): AnimationKeyframe[] {
  if (config.type === 'keyframes') {
    return (config.parameters.keyframes ?? []).map((kf) => {
      const out: AnimationKeyframe = {};
      for (const [k, v] of Object.entries(kf)) {
        if (v === undefined) continue;
        out[KEYFRAME_META.has(k) ? k : toKebab(k)] = v;
      }
      return out;
    });
  }
  if (config.type === 'isometric' || config.type === '3d-transform') {
    const base: AnimationKeyframe = { transform: 'none' };
    const final: AnimationKeyframe = { transform: buildTransform(config) };
    if (config.type === 'isometric') {
      base['transform-style'] = 'preserve-3d';
      final['transform-style'] = 'preserve-3d';
    }
    return [base, final];
  }
  return [];
}

/**
 * Propiedades CSS que una configuración anima, con independencia del motor.
 * `parallax` y las escenas Three.js usan pseudo-propiedades estables.
 */
export function propertiesOf(config: AnimationConfig): string[] {
  switch (config.type) {
    case 'parallax':
      return ['transform'];
    case 'three-scene':
      return ['scene'];
    case 'isometric':
    case '3d-transform':
      return config.type === 'isometric'
        ? ['transform', 'transform-style']
        : ['transform'];
    case 'keyframes':
      return keyframeProperties(config.parameters.keyframes ?? []);
  }
}

/** Último estado de una lista de fotogramas (para `prefers-reduced-motion`). */
export function finalState(keyframes: AnimationKeyframe[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kf of keyframes) {
    for (const [k, v] of Object.entries(kf)) {
      if (KEYFRAME_META.has(k) || v === undefined) continue;
      out[toKebab(k)] = String(v);
    }
  }
  return out;
}

/** Aplica estilos inline a un elemento (helper común). */
export function applyInline(el: Element, styles: Record<string, string>): void {
  const style = (el as HTMLElement).style;
  if (!style) return;
  for (const [prop, value] of Object.entries(styles)) style.setProperty(prop, value);
}

/** Resuelve la lista de elementos de un selector dentro de un documento. */
export function queryAll(doc: Document, selector: string): Element[] {
  try {
    return Array.from(doc.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/** Promesa que nunca se resuelve (animaciones infinitas/continuas). */
export function never(): Promise<void> {
  return new Promise<void>(() => undefined);
}

/**
 * Crea un `Promise<void>` con su `resolve` accesible (equivalente a
 * `Promise.withResolvers`, que no existe en Node 18).
 */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
