/**
 * Validación estática de configuraciones de animación (coherencia tipo ↔
 * parámetros). Módulo **isomorfo** (sin PostCSS ni `fs`) para poder
 * incluirse en el runtime del navegador; el parser lo envuelve en
 * `WebMCPParseError` con número de línea.
 */
import type { AnimationConfig } from './types';

/** Error de configuración de una animación. */
export class AnimationConfigError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(message);
    this.name = 'AnimationConfigError';
  }
}

/**
 * Convierte una duración CSS (`1.5s`, `300ms`) o un número (ms) a milisegundos.
 * @returns Milisegundos o `null` si no es válida.
 */
export function parseDuration(value: string | number | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? value : null;
  const m = /^\s*([\d.]+)\s*(ms|s)?\s*$/i.exec(value);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return (m[2] ?? 'ms').toLowerCase() === 's' ? n * 1000 : n;
}

/**
 * Comprueba la coherencia de una configuración. Los problemas graves lanzan
 * {@link AnimationConfigError}; los leves se añaden a `warnings`.
 *
 * @param config Configuración a validar.
 * @param warnings Lista donde acumular avisos no bloqueantes.
 */
export function validateConfig(config: AnimationConfig, warnings: string[]): void {
  const p = config.parameters;
  const where = `"${config.name}"`;
  const fail = (msg: string): never => {
    throw new AnimationConfigError(`${where}: ${msg}`, config.line);
  };
  switch (config.type) {
    case 'parallax':
      if (!p.layers || p.layers.length === 0) {
        fail(
          'una animación parallax requiere "layers" (webmcp-animation-layers o params.layers)',
        );
      }
      for (const layer of p.layers ?? []) {
        if (
          !layer.selector ||
          typeof layer.speed !== 'number' ||
          !Number.isFinite(layer.speed)
        ) {
          fail('cada capa necesita "selector" y "speed" numérico');
        }
        if (layer.speed < 0 || layer.speed > 1) {
          warnings.push(
            `${where}: la capa ${layer.selector} tiene speed ${layer.speed} fuera de 0–1.`,
          );
        }
      }
      if (config.engine === 'three') {
        warnings.push(
          `${where}: parallax con motor three se ejecutará como escena 2.5D.`,
        );
      }
      break;
    case 'keyframes':
      if (!Array.isArray(p.keyframes) || p.keyframes.length === 0) {
        fail(
          'una animación keyframes requiere "keyframes" (array con al menos un fotograma)',
        );
      }
      for (const kf of p.keyframes ?? []) {
        if (!kf || typeof kf !== 'object') fail('cada fotograma debe ser un objeto');
        if (kf.offset !== undefined && (kf.offset < 0 || kf.offset > 1)) {
          fail(`offset ${String(kf.offset)} fuera de 0–1`);
        }
      }
      if (config.engine === 'three')
        fail('el motor three no soporta keyframes DOM; usa css o waapi');
      break;
    case 'three-scene':
      if (
        !p.sceneConfig ||
        !Array.isArray(p.sceneConfig.layers) ||
        !p.sceneConfig.layers.length
      ) {
        fail(
          'una animación three-scene requiere "sceneConfig.layers" (webmcp-animation-scene)',
        );
      }
      if (config.engine && config.engine !== 'three' && config.engine !== 'auto') {
        fail('three-scene solo puede ejecutarse con el motor three');
      }
      break;
    case 'isometric':
    case '3d-transform':
      if (config.engine === 'three') {
        fail(`${config.type} usa transformaciones CSS; el motor three no aplica`);
      }
      if (
        config.type === '3d-transform' &&
        !p.rotationX &&
        !p.rotationY &&
        !p.rotationZ &&
        !p.translationZ &&
        p.scale === undefined
      ) {
        warnings.push(
          `${where}: 3d-transform sin rotación/traslación; se aplicará rotateY(25deg) por defecto.`,
        );
      }
      break;
    default:
      fail(`tipo desconocido "${String((config as { type: unknown }).type)}"`);
  }
  if (p.duration !== undefined && parseDuration(p.duration) === null) {
    fail(`duración inválida "${String(p.duration)}"`);
  }
  if (p.delay !== undefined && parseDuration(p.delay) === null) {
    fail(`retardo inválido "${String(p.delay)}"`);
  }
  if (
    p.iterations !== undefined &&
    p.iterations !== 'infinite' &&
    (typeof p.iterations !== 'number' || p.iterations < 0)
  ) {
    fail(`iteraciones inválidas "${String(p.iterations)}"`);
  }
  if (config.sandbox === 'shadow' && config.type !== 'three-scene') {
    warnings.push(
      `${where}: el sandbox shadow solo aísla motores con nodos propios (three-scene).`,
    );
  }
}
