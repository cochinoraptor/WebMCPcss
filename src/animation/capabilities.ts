/**
 * Detección de capacidades del navegador y de librerías de animación de
 * terceros. Código isomorfo (jsdom o navegador real).
 */
import type { BrowserCapabilities, ExternalLibrary } from './types';

/** Ventana con los globales que inspeccionamos (todos opcionales). */
type AnyWindow = Window & Record<string, unknown>;

/** Librerías conocidas: global → identificador legible. */
const KNOWN_LIBRARIES: Array<{
  global: string;
  id: string;
  name: string;
  version?: string;
}> = [
  { global: 'gsap', id: 'gsap', name: 'GSAP', version: 'version' },
  { global: 'TweenMax', id: 'gsap', name: 'GSAP (TweenMax)', version: 'version' },
  { global: 'anime', id: 'anime', name: 'Anime.js', version: 'version' },
  { global: 'Motion', id: 'motion', name: 'Motion One' },
  { global: 'FramerMotion', id: 'framer-motion', name: 'Framer Motion' },
  { global: 'Velocity', id: 'velocity', name: 'Velocity.js', version: 'version' },
  { global: 'lottie', id: 'lottie', name: 'Lottie', version: 'version' },
  { global: 'bodymovin', id: 'lottie', name: 'Lottie (bodymovin)', version: 'version' },
  { global: 'ScrollMagic', id: 'scrollmagic', name: 'ScrollMagic', version: 'version' },
  { global: 'AOS', id: 'aos', name: 'AOS' },
  { global: 'THREE', id: 'three', name: 'Three.js', version: 'REVISION' },
  { global: 'Popmotion', id: 'popmotion', name: 'Popmotion' },
  { global: 'mojs', id: 'mojs', name: 'mo.js', version: 'revision' },
];

/**
 * Detecta librerías de animación presentes como globales de la ventana.
 * @param win Ventana a inspeccionar.
 */
export function detectLibraries(win: Window): ExternalLibrary[] {
  const w = win as AnyWindow;
  const found = new Map<string, ExternalLibrary>();
  for (const lib of KNOWN_LIBRARIES) {
    const value = w[lib.global];
    if (value === undefined || value === null) continue;
    if (found.has(lib.id)) continue;
    const entry: ExternalLibrary = { id: lib.id, name: lib.name };
    if (lib.version && (typeof value === 'object' || typeof value === 'function')) {
      const v = (value as Record<string, unknown>)[lib.version];
      if (typeof v === 'string' || typeof v === 'number') entry.version = String(v);
    }
    found.set(lib.id, entry);
  }
  return [...found.values()];
}

/** `CSS.supports` con tolerancia a entornos sin `CSS`. */
function supports(win: Window, prop: string, value: string, fallback: boolean): boolean {
  const css = (win as AnyWindow).CSS as
    { supports?: (p: string, v: string) => boolean } | undefined;
  if (css && typeof css.supports === 'function') {
    try {
      return css.supports(prop, value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Detecta las capacidades relevantes para elegir motor de animación.
 * Nunca lanza: cada comprobación degrada a un valor conservador.
 *
 * @param win Ventana (real o jsdom).
 * @param overrides Valores forzados (útil en tests o para desactivar WebGL).
 */
export function detectCapabilities(
  win: Window,
  overrides: Partial<BrowserCapabilities> = {},
): BrowserCapabilities {
  const w = win as AnyWindow;
  const elementProto = (w.Element as { prototype?: Record<string, unknown> } | undefined)
    ?.prototype;
  const waapi = typeof elementProto?.animate === 'function';
  const hasWebGLCtor = 'WebGLRenderingContext' in w || 'WebGL2RenderingContext' in w;
  let webgl = false;
  if (hasWebGLCtor) {
    try {
      const canvas = win.document.createElement('canvas');
      webgl = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
      webgl = false;
    }
  }
  let reducedMotion = false;
  try {
    reducedMotion =
      typeof win.matchMedia === 'function' &&
      win.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    reducedMotion = false;
  }
  const caps: BrowserCapabilities = {
    waapi,
    webgl,
    scrollTimeline: 'ScrollTimeline' in w,
    cssAnimations: supports(win, 'animation-name', 'x', 'AnimationEvent' in w || true),
    preserve3d: supports(win, 'transform-style', 'preserve-3d', true),
    reducedMotion,
    three: !!w.THREE,
    shadowDom: typeof elementProto?.attachShadow === 'function',
    libraries: detectLibraries(win),
  };
  return { ...caps, ...overrides };
}
