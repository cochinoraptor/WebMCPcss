/**
 * Motor CSS: genera `@keyframes` + una clase por animación, los inyecta en
 * un `<style data-webmcp-animation>` y asigna la clase a los elementos.
 * Para `parallax` mueve las capas con `transform: translate3d()` en cada
 * evento de scroll (con `requestAnimationFrame`), o con `ScrollTimeline`
 * si el navegador lo soporta y se ha pedido explícitamente.
 *
 * Es el motor de mayor compatibilidad y el fallback natural del resto.
 */
import type { AnimationConfig, BrowserCapabilities } from '../types';
import {
  type AnimationEngine,
  type EngineContext,
  type EngineRun,
  applyInline,
  deferred,
  ensureElementId,
  finalState,
  keyframeProperties,
  keyframesFor,
  never,
  propertiesOf,
  queryAll,
  toMs,
} from './base-engine';

/** Atributo del `<style>` que inyecta este motor. */
export const STYLE_ATTR = 'data-webmcp-animation';
/** Prefijo de clases generadas. */
const CLASS_PREFIX = 'webmcp-anim-';
/** Clase marcadora en elementos con parallax gestionado por CSS engine. */
const PARALLAX_CLASS = 'webmcp-parallax-layer';

/** Genera un nombre CSS seguro a partir del nombre de la animación. */
function cssName(name: string): string {
  return `${CLASS_PREFIX}${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/** Devuelve (creando si hace falta) la hoja de estilos del motor. */
function styleElement(doc: Document): HTMLStyleElement {
  let style = doc.querySelector<HTMLStyleElement>(`style[${STYLE_ATTR}]`);
  if (!style) {
    style = doc.createElement('style');
    style.setAttribute(STYLE_ATTR, '');
    (doc.head ?? doc.documentElement).appendChild(style);
  }
  return style;
}

/**
 * Serializa fotogramas a un bloque `@keyframes`. Si los fotogramas no traen
 * `offset`, se reparten uniformemente.
 */
export function keyframesToCss(name: string, config: AnimationConfig): string {
  const frames = keyframesFor(config);
  const n = frames.length;
  const rows = frames.map((kf, i) => {
    const offset =
      typeof kf.offset === 'number' ? kf.offset : n === 1 ? 1 : i / Math.max(1, n - 1);
    const decls = Object.entries(kf)
      .filter(
        ([k, v]) =>
          k !== 'offset' && k !== 'easing' && k !== 'composite' && v !== undefined,
      )
      .map(([k, v]) => `${k}: ${String(v)};`);
    if (kf.easing) decls.push(`animation-timing-function: ${kf.easing};`);
    return `  ${Math.round(offset * 10000) / 100}% { ${decls.join(' ')} }`;
  });
  return `@keyframes ${name} {\n${rows.join('\n')}\n}`;
}

/** Regla de la clase que aplica la animación. */
export function classRuleCss(name: string, config: AnimationConfig): string {
  const p = config.parameters;
  const duration = toMs(p.duration, 1000);
  const delay = toMs(p.delay, 0);
  const iterations = p.iterations === 'infinite' ? 'infinite' : String(p.iterations ?? 1);
  const decls = [
    `animation-name: ${name}`,
    `animation-duration: ${duration}ms`,
    `animation-delay: ${delay}ms`,
    `animation-timing-function: ${p.easing ?? 'ease'}`,
    `animation-iteration-count: ${iterations}`,
    `animation-direction: ${p.direction ?? 'normal'}`,
    `animation-fill-mode: ${p.fill ?? 'forwards'}`,
  ];
  if (config.type === 'isometric') decls.push('transform-style: preserve-3d');
  if (p.perspective && config.type !== 'isometric')
    decls.push(`perspective: ${p.perspective}`);
  return `.${name} { ${decls.join('; ')}; }`;
}

/** Motor basado en hojas de estilo CSS. */
export class CssEngine implements AnimationEngine {
  readonly id = 'css' as const;

  /** @inheritdoc */
  supports(config: AnimationConfig, caps: BrowserCapabilities): true | string {
    if (config.type === 'three-scene') return 'three-scene requiere el motor three';
    if (!caps.cssAnimations && config.type !== 'parallax') {
      return 'el navegador no soporta animaciones CSS';
    }
    if (config.type === 'isometric' && !caps.preserve3d) {
      return 'el navegador no soporta transform-style: preserve-3d';
    }
    return true;
  }

  /** @inheritdoc */
  propertiesFor(config: AnimationConfig): string[] {
    return propertiesOf(config);
  }

  /** @inheritdoc */
  async execute(
    config: AnimationConfig,
    elements: Element[],
    ctx: EngineContext,
  ): Promise<EngineRun> {
    if (config.type === 'parallax') return this.executeParallax(config, elements, ctx);
    const name = cssName(config.name);
    const frames = keyframesFor(config);
    const properties = keyframeProperties(frames);
    for (const el of elements) ensureElementId(el);

    if (ctx.reducedMotion) {
      const final = finalState(frames);
      for (const el of elements) applyInline(el, final);
      return {
        properties,
        finished: Promise.resolve(),
        stop: () => undefined,
        details: { className: name, reducedMotion: true },
      };
    }

    const style = styleElement(ctx.doc);
    const css = `${keyframesToCss(name, config)}\n${classRuleCss(name, config)}\n`;
    const marker = `/* ${name} */`;
    if (!style.textContent?.includes(marker)) {
      style.appendChild(ctx.doc.createTextNode(`${marker}\n${css}`));
    }
    for (const el of elements) {
      el.classList.remove(name); // reinicia si ya estaba
      void (el as HTMLElement).offsetWidth; // fuerza reflow para reiniciar la animación
      el.classList.add(name);
    }

    const total =
      config.parameters.iterations === 'infinite'
        ? Infinity
        : toMs(config.parameters.delay, 0) +
          toMs(config.parameters.duration, 1000) *
            Number(config.parameters.iterations ?? 1);
    let finished: Promise<void>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!Number.isFinite(total)) finished = never();
    else {
      const d = deferred();
      timer = setTimeout(d.resolve, total + 16);
      finished = d.promise;
    }
    return {
      properties,
      finished,
      details: { className: name, elements: elements.length },
      stop: () => {
        if (timer) clearTimeout(timer);
        for (const el of elements) el.classList.remove(name);
      },
    };
  }

  /** Parallax por scroll: cada capa se desplaza según `speed`. */
  private async executeParallax(
    config: AnimationConfig,
    elements: Element[],
    ctx: EngineContext,
  ): Promise<EngineRun> {
    const layers = config.parameters.layers ?? [];
    const scopeRoots = elements.length ? elements : [ctx.doc.documentElement];
    const resolved: Array<{ el: HTMLElement; speed: number; depth?: string }> = [];
    for (const layer of layers) {
      for (const root of scopeRoots) {
        const inRoot = queryAll(root as unknown as Document, layer.selector);
        const found = inRoot.length ? inRoot : queryAll(ctx.doc, layer.selector);
        for (const el of found) {
          ensureElementId(el);
          resolved.push({
            el: el as HTMLElement,
            speed: layer.speed,
            depth: layer.depth,
          });
        }
      }
    }
    const properties = ['transform'];
    if (resolved.length === 0) {
      throw new Error(
        `parallax "${config.name}": ninguna capa coincide (${layers.map((l) => l.selector).join(', ')})`,
      );
    }
    for (const { el } of resolved) {
      el.classList.add(PARALLAX_CLASS);
      el.style.willChange = 'transform';
    }
    if (ctx.reducedMotion) {
      return {
        properties,
        finished: Promise.resolve(),
        stop: () => undefined,
        details: { layers: resolved.length, reducedMotion: true },
      };
    }

    const containerSel = config.parameters.scrollContainer;
    const container = containerSel ? ctx.doc.querySelector(containerSel) : null;
    const target: EventTarget = container ?? ctx.win;
    const scrollY = (): number =>
      container
        ? (container as HTMLElement).scrollTop
        : ctx.win.scrollY || ctx.win.pageYOffset || 0;

    let raf = 0;
    const update = (): void => {
      raf = 0;
      const y = scrollY();
      for (const { el, speed, depth } of resolved) {
        // Las capas lentas (speed→0) se mueven en contra del scroll para
        // parecer lejanas; speed=1 se mueve con el contenido (sin offset).
        const offset = Math.round(y * (1 - speed) * 100) / 100;
        el.style.transform = `translate3d(0, ${offset}px, ${depth ?? '0'})`;
      }
    };
    const onScroll = (): void => {
      if (raf) return;
      raf = ctx.win.requestAnimationFrame ? ctx.win.requestAnimationFrame(update) : 1;
      if (!ctx.win.requestAnimationFrame) update();
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    update();
    return {
      properties,
      finished: never(),
      details: { layers: resolved.length, container: containerSel ?? 'window' },
      stop: () => {
        target.removeEventListener('scroll', onScroll);
        if (raf && ctx.win.cancelAnimationFrame) ctx.win.cancelAnimationFrame(raf);
        for (const { el } of resolved) {
          el.style.transform = '';
          el.style.willChange = '';
          el.classList.remove(PARALLAX_CLASS);
        }
      },
    };
  }

  /** @inheritdoc */
  async cleanup(element: Element): Promise<void> {
    for (const cls of Array.from(element.classList)) {
      if (cls.startsWith(CLASS_PREFIX) || cls === PARALLAX_CLASS)
        element.classList.remove(cls);
    }
    const style = (element as HTMLElement).style;
    if (style) {
      style.removeProperty('transform');
      style.removeProperty('will-change');
    }
  }
}
