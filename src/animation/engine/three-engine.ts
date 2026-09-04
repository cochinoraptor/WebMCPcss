/**
 * Motor Three.js: escenas 2.5D (capas/planos con profundidad, parallax de
 * cámara con ratón/scroll y rotación de sprites).
 *
 * Three.js **no** es dependencia del paquete: se usa `window.THREE` si la
 * página ya lo carga o se importa dinámicamente como módulo ESM desde una
 * URL (por defecto unpkg). En jsdom/Node el motor declara que no soporta la
 * ejecución (sin WebGL), pero sí participa en la planificación y en la
 * validación de conflictos. El `<canvas>` se monta dentro del elemento
 * objetivo o, en modo `sandbox: shadow`, en un Shadow DOM propio.
 */
import type { AnimationConfig, BrowserCapabilities, ThreeSceneConfig } from '../types';
import {
  type AnimationEngine,
  type EngineContext,
  type EngineRun,
  ensureElementId,
  never,
  propertiesOf,
  toMs,
} from './base-engine';

/** URL por defecto del módulo ESM de Three.js. */
export const DEFAULT_THREE_URL = 'https://unpkg.com/three@0.160.0/build/three.module.js';
/** Atributo del contenedor que crea este motor. */
export const THREE_HOST_ATTR = 'data-webmcp-three';

/** Subconjunto tipado de la API de Three.js que usamos (evita depender de @types/three). */
interface ThreeLike {
  Scene: new () => ThreeScene;
  OrthographicCamera: new (
    l: number,
    r: number,
    t: number,
    b: number,
    near: number,
    far: number,
  ) => ThreeCamera;
  PerspectiveCamera: new (
    fov: number,
    aspect: number,
    near: number,
    far: number,
  ) => ThreeCamera;
  WebGLRenderer: new (opts: { alpha: boolean; antialias: boolean }) => ThreeRenderer;
  PlaneGeometry: new (w: number, h: number) => unknown;
  MeshBasicMaterial: new (opts: Record<string, unknown>) => { dispose(): void };
  Mesh: new (geometry: unknown, material: unknown) => ThreeObject;
  TextureLoader: new () => { load(url: string): unknown };
  Color: new (c: string) => unknown;
}
interface ThreeObject {
  position: {
    x: number;
    y: number;
    z: number;
    set(x: number, y: number, z: number): void;
  };
  rotation: { z: number };
  userData: Record<string, unknown>;
  geometry?: { dispose(): void };
  material?: { dispose(): void };
}
interface ThreeScene {
  background: unknown;
  add(o: ThreeObject): void;
  remove(o: ThreeObject): void;
  children: ThreeObject[];
}
interface ThreeCamera extends ThreeObject {
  left: number;
  right: number;
  top: number;
  bottom: number;
  aspect: number;
  updateProjectionMatrix(): void;
  lookAt(x: number, y: number, z: number): void;
}
interface ThreeRenderer {
  domElement: HTMLCanvasElement;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  setPixelRatio(r: number): void;
  setClearColor(c: unknown, alpha: number): void;
  render(scene: ThreeScene, camera: ThreeCamera): void;
  dispose(): void;
}

/**
 * Obtiene Three.js: global `window.THREE` o import dinámico del módulo ESM.
 * @param win Ventana.
 * @param moduleUrl URL del módulo (por defecto {@link DEFAULT_THREE_URL}).
 */
export async function loadThree(
  win: Window,
  moduleUrl = DEFAULT_THREE_URL,
): Promise<ThreeLike> {
  const existing = (win as unknown as { THREE?: ThreeLike }).THREE;
  if (existing?.WebGLRenderer) return existing;
  // `new Function` evita que TypeScript/CommonJS reescriban el import dinámico.
  const importer = new Function('u', 'return import(u)') as (
    u: string,
  ) => Promise<ThreeLike>;
  let mod: ThreeLike;
  try {
    mod = await importer(moduleUrl);
  } catch (err) {
    throw new Error(
      `No se pudo cargar Three.js desde ${moduleUrl} (${(err as Error).message}). ` +
        'Incluye three en la página (window.THREE) o indica moduleUrl en sceneConfig.',
    );
  }
  const three = (mod as unknown as { default?: ThreeLike }).default ?? mod;
  if (!three?.WebGLRenderer) {
    throw new Error(`El módulo ${moduleUrl} no expone Three.js (falta WebGLRenderer)`);
  }
  return three;
}

/** Normaliza la configuración de escena con valores por defecto. */
export function normalizeScene(
  config: AnimationConfig,
): Required<
  Pick<
    ThreeSceneConfig,
    'background' | 'camera' | 'viewHeight' | 'interaction' | 'moduleUrl' | 'maxPixelRatio'
  >
> &
  ThreeSceneConfig {
  const scene = config.parameters.sceneConfig ?? { layers: [] };
  let layers = scene.layers;
  // Un parallax forzado a three se convierte en capas de escena.
  if (config.type === 'parallax' && (!layers || layers.length === 0)) {
    layers = (config.parameters.layers ?? []).map((l, i) => ({
      color: `hsl(${(i * 47) % 360} 60% 60%)`,
      position: { x: 0, y: 0, z: -i },
      parallax: 1 - l.speed,
    }));
  }
  return {
    background: scene.background ?? 'transparent',
    camera: scene.camera ?? 'orthographic',
    viewHeight: scene.viewHeight ?? 10,
    interaction: scene.interaction ?? 'mouse',
    moduleUrl: scene.moduleUrl ?? DEFAULT_THREE_URL,
    maxPixelRatio: scene.maxPixelRatio ?? 2,
    layers,
  };
}

/** Motor de escenas 2.5D con Three.js. */
export class ThreeEngine implements AnimationEngine {
  readonly id = 'three' as const;

  /** @inheritdoc */
  supports(config: AnimationConfig, caps: BrowserCapabilities): true | string {
    if (config.type !== 'three-scene' && config.type !== 'parallax') {
      return `el motor three no aplica a ${config.type}`;
    }
    if (!caps.webgl) return 'WebGL no disponible';
    return true;
  }

  /** @inheritdoc */
  propertiesFor(config: AnimationConfig): string[] {
    return config.type === 'three-scene' ? propertiesOf(config) : ['scene'];
  }

  /** @inheritdoc */
  async execute(
    config: AnimationConfig,
    elements: Element[],
    ctx: EngineContext,
  ): Promise<EngineRun> {
    const host = elements[0] as HTMLElement | undefined;
    if (!host) throw new Error(`three-scene "${config.name}": sin elemento contenedor`);
    ensureElementId(host);
    const scene = normalizeScene(config);
    const THREE = await loadThree(ctx.win, scene.moduleUrl);

    // Contenedor del canvas (opcionalmente aislado en Shadow DOM).
    const mount = ctx.doc.createElement('div');
    mount.setAttribute(THREE_HOST_ATTR, config.name);
    mount.style.cssText =
      'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0;';
    const hostStyle = ctx.win.getComputedStyle(host);
    if (!hostStyle.position || hostStyle.position === 'static')
      host.style.position = 'relative';
    let root: HTMLElement | ShadowRoot = host;
    if (ctx.sandbox === 'shadow' && ctx.capabilities.shadowDom) {
      const shadowHost = ctx.doc.createElement('div');
      shadowHost.setAttribute(THREE_HOST_ATTR, `${config.name}-shadow`);
      shadowHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      host.prepend(shadowHost);
      root = shadowHost.attachShadow({ mode: 'open' });
    }
    root.prepend(mount);

    const width = Math.max(1, host.clientWidth || 300);
    const height = Math.max(1, host.clientHeight || 150);
    const aspect = width / height;
    const three = new THREE.Scene();
    if (scene.background !== 'transparent')
      three.background = new THREE.Color(scene.background);
    const viewH = scene.viewHeight;
    const camera =
      scene.camera === 'perspective'
        ? new THREE.PerspectiveCamera(50, aspect, 0.1, 1000)
        : new THREE.OrthographicCamera(
            (-viewH * aspect) / 2,
            (viewH * aspect) / 2,
            viewH / 2,
            -viewH / 2,
            0.1,
            1000,
          );
    camera.position.set(0, 0, 20);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(ctx.win.devicePixelRatio || 1, scene.maxPixelRatio));
    renderer.setSize(width, height, false);
    renderer.domElement.style.cssText = 'width:100%;height:100%;display:block;';
    if (scene.background === 'transparent')
      renderer.setClearColor(new THREE.Color('#000000'), 0);
    mount.appendChild(renderer.domElement);

    const loader = new THREE.TextureLoader();
    const meshes: ThreeObject[] = [];
    scene.layers.forEach((layer, i) => {
      const w = layer.size?.width ?? viewH * aspect;
      const h = layer.size?.height ?? viewH;
      const material = layer.image
        ? new THREE.MeshBasicMaterial({
            map: loader.load(layer.image),
            transparent: true,
          })
        : new THREE.MeshBasicMaterial({
            color: new THREE.Color(layer.color ?? `hsl(${(i * 47) % 360} 60% 60%)`),
            transparent: true,
            opacity: 0.9,
          });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
      mesh.position.set(
        layer.position?.x ?? 0,
        layer.position?.y ?? 0,
        layer.position?.z ?? -i,
      );
      mesh.userData = {
        baseX: layer.position?.x ?? 0,
        baseY: layer.position?.y ?? 0,
        parallax: layer.parallax ?? 0,
        spin: layer.spin ?? 0,
      };
      three.add(mesh);
      meshes.push(mesh);
    });

    // Interacción: desplazamiento de capas según ratón y/o scroll.
    let pointerX = 0;
    let pointerY = 0;
    let scrollT = 0;
    const onMove = (ev: Event): void => {
      const e = ev as MouseEvent;
      const rect = host.getBoundingClientRect();
      pointerX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      pointerY = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
    };
    const onScroll = (): void => {
      const max = Math.max(1, ctx.doc.documentElement.scrollHeight - ctx.win.innerHeight);
      scrollT = (ctx.win.scrollY || 0) / max;
    };
    const useMouse = scene.interaction === 'mouse' || scene.interaction === 'both';
    const useScroll = scene.interaction === 'scroll' || scene.interaction === 'both';
    if (useMouse) host.addEventListener('mousemove', onMove, { passive: true });
    if (useScroll) ctx.win.addEventListener('scroll', onScroll, { passive: true });

    const onResize = (): void => {
      const w2 = Math.max(1, host.clientWidth || width);
      const h2 = Math.max(1, host.clientHeight || height);
      const a2 = w2 / h2;
      if (scene.camera === 'perspective') camera.aspect = a2;
      else {
        camera.left = (-viewH * a2) / 2;
        camera.right = (viewH * a2) / 2;
      }
      camera.updateProjectionMatrix();
      renderer.setSize(w2, h2, false);
    };
    ctx.win.addEventListener('resize', onResize);

    const reduced = ctx.reducedMotion;
    let raf = 0;
    let last = ctx.win.performance?.now?.() ?? Date.now();
    let stopped = false;
    const tick = (): void => {
      if (stopped) return;
      const now = ctx.win.performance?.now?.() ?? Date.now();
      const dt = (now - last) / 1000;
      last = now;
      for (const mesh of meshes) {
        const { baseX, baseY, parallax, spin } = mesh.userData as {
          baseX: number;
          baseY: number;
          parallax: number;
          spin: number;
        };
        if (!reduced) {
          const px = useMouse ? pointerX * parallax * (viewH / 4) : 0;
          const py = useMouse ? pointerY * parallax * (viewH / 4) : 0;
          const sy = useScroll ? scrollT * parallax * viewH : 0;
          mesh.position.x = baseX + px;
          mesh.position.y = baseY + py + sy;
          if (spin) mesh.rotation.z += spin * dt;
        }
      }
      renderer.render(three, camera);
      if (!reduced) raf = ctx.win.requestAnimationFrame(tick);
    };
    tick();

    const duration = toMs(config.parameters.duration, 0);
    let finished: Promise<void> = never();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      if (raf) ctx.win.cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      if (useMouse) host.removeEventListener('mousemove', onMove);
      if (useScroll) ctx.win.removeEventListener('scroll', onScroll);
      ctx.win.removeEventListener('resize', onResize);
      for (const mesh of meshes) {
        three.remove(mesh);
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      }
      renderer.dispose();
      mount.remove();
      const shadowHost = host.querySelector(
        `[${THREE_HOST_ATTR}="${config.name}-shadow"]`,
      );
      shadowHost?.remove();
    };
    if (duration > 0 && !reduced) {
      finished = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          stop();
          resolve();
        }, duration);
      });
    }
    return {
      properties: ['scene'],
      finished,
      stop,
      details: {
        layers: meshes.length,
        camera: scene.camera,
        interaction: scene.interaction,
        sandbox:
          ctx.sandbox === 'shadow' && ctx.capabilities.shadowDom ? 'shadow' : 'none',
        reducedMotion: reduced,
      },
    };
  }

  /** @inheritdoc */
  async cleanup(element: Element): Promise<void> {
    for (const node of Array.from(element.querySelectorAll(`[${THREE_HOST_ATTR}]`)))
      node.remove();
  }
}
