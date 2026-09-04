/**
 * Motor WAAPI: usa `Element.animate()` (Web Animations API). Permite
 * control fino (pausar, cancelar, `composite: 'add'` para fusiones) y es el
 * motor preferido para `keyframes`, `isometric` y `3d-transform` cuando el
 * navegador lo soporta. Para `parallax` usa `ScrollTimeline` si existe; en
 * caso contrario delega en el motor CSS (el orquestador lo gestiona).
 */
import type { AnimationConfig, BrowserCapabilities } from '../types';
import {
  ANIMATION_ID_PREFIX,
  type AnimationEngine,
  type EngineContext,
  type EngineRun,
  applyInline,
  ensureElementId,
  finalState,
  keyframeProperties,
  keyframesFor,
  propertiesOf,
  queryAll,
  toCamel,
  toMs,
} from './base-engine';

/** Constructor experimental `ScrollTimeline` (no está en lib.dom). */
interface ScrollTimelineCtor {
  new (options: {
    source: Element | null;
    axis?: 'block' | 'inline' | 'x' | 'y';
  }): AnimationTimeline;
}

/** Fotogramas en el formato que espera `Element.animate` (camelCase). */
export function toWaapiKeyframes(config: AnimationConfig): Keyframe[] {
  return keyframesFor(config).map((kf) => {
    const out: Record<string, string | number | undefined> = {};
    for (const [k, v] of Object.entries(kf)) {
      if (v === undefined) continue;
      if (k === 'offset' || k === 'easing' || k === 'composite') out[k] = v;
      else if (k.startsWith('--')) out[k] = v;
      else out[toCamel(k)] = v;
    }
    return out as Keyframe;
  });
}

/** Opciones de tiempo para `Element.animate`. */
export function toWaapiTiming(
  config: AnimationConfig,
  composite: 'replace' | 'add' = 'replace',
): KeyframeAnimationOptions {
  const p = config.parameters;
  return {
    id: `${ANIMATION_ID_PREFIX}${config.name}`,
    duration: toMs(p.duration, 1000),
    delay: toMs(p.delay, 0),
    easing: p.easing ?? 'ease',
    iterations: p.iterations === 'infinite' ? Infinity : Number(p.iterations ?? 1),
    direction: p.direction ?? 'normal',
    fill: p.fill ?? 'forwards',
    composite,
  };
}

/** Motor basado en la Web Animations API. */
export class WaapiEngine implements AnimationEngine {
  readonly id = 'waapi' as const;

  /** @inheritdoc */
  supports(config: AnimationConfig, caps: BrowserCapabilities): true | string {
    if (!caps.waapi) return 'Element.animate() no disponible';
    if (config.type === 'three-scene') return 'three-scene requiere el motor three';
    if (config.type === 'parallax' && !caps.scrollTimeline) {
      return 'parallax por WAAPI requiere ScrollTimeline (usa el motor css)';
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
    const frames = keyframesFor(config);
    const properties = keyframeProperties(frames);
    for (const el of elements) ensureElementId(el);
    if (config.type === 'isometric') {
      for (const el of elements) applyInline(el, { 'transform-style': 'preserve-3d' });
    }
    if (config.parameters.perspective && config.type !== 'isometric') {
      for (const el of elements)
        applyInline(el, { perspective: String(config.parameters.perspective) });
    }
    if (ctx.reducedMotion) {
      const final = finalState(frames);
      for (const el of elements) applyInline(el, final);
      return {
        properties,
        finished: Promise.resolve(),
        stop: () => undefined,
        details: { reducedMotion: true },
      };
    }
    const keyframes = toWaapiKeyframes(config);
    const timing = toWaapiTiming(config, ctx.composite ?? 'replace');
    const animations: Animation[] = [];
    for (const el of elements) {
      const anim = el.animate(keyframes, timing);
      animations.push(anim);
    }
    const finished = Promise.all(
      animations.map((a) =>
        a.finished.then(
          () => undefined,
          () => undefined,
        ),
      ),
    ).then(() => undefined);
    return {
      properties,
      finished,
      details: { animations: animations.length, composite: timing.composite },
      stop: () => {
        for (const a of animations) {
          try {
            a.cancel();
          } catch {
            /* ya cancelada */
          }
        }
      },
    };
  }

  /** Parallax con `ScrollTimeline` (Chrome 115+). */
  private async executeParallax(
    config: AnimationConfig,
    elements: Element[],
    ctx: EngineContext,
  ): Promise<EngineRun> {
    const Ctor = (ctx.win as unknown as { ScrollTimeline?: ScrollTimelineCtor })
      .ScrollTimeline;
    if (!Ctor) throw new Error('ScrollTimeline no disponible');
    const containerSel = config.parameters.scrollContainer;
    const source = containerSel
      ? ctx.doc.querySelector(containerSel)
      : (ctx.doc.scrollingElement ?? ctx.doc.documentElement);
    const timeline = new Ctor({ source, axis: 'block' });
    const roots = elements.length ? elements : [ctx.doc.documentElement];
    const animations: Animation[] = [];
    const scrollRange = Math.max(
      1,
      (source as HTMLElement | null)?.scrollHeight ??
        ctx.doc.documentElement.scrollHeight,
    );
    for (const layer of config.parameters.layers ?? []) {
      for (const root of roots) {
        const inRoot = queryAll(root as unknown as Document, layer.selector);
        const found = inRoot.length ? inRoot : queryAll(ctx.doc, layer.selector);
        for (const el of found) {
          ensureElementId(el);
          if (ctx.reducedMotion) continue;
          const offset = scrollRange * (1 - layer.speed);
          animations.push(
            el.animate(
              [
                { transform: `translate3d(0, 0, ${layer.depth ?? '0'})` },
                { transform: `translate3d(0, ${offset}px, ${layer.depth ?? '0'})` },
              ],
              { id: `${ANIMATION_ID_PREFIX}${config.name}`, timeline, fill: 'both' },
            ),
          );
        }
      }
    }
    return {
      properties: ['transform'],
      finished: new Promise<void>(() => undefined),
      details: { animations: animations.length, timeline: 'scroll' },
      stop: () => {
        for (const a of animations) a.cancel();
      },
    };
  }

  /** @inheritdoc */
  async cleanup(element: Element): Promise<void> {
    const getAnimations = (element as Element & { getAnimations?: () => Animation[] })
      .getAnimations;
    if (typeof getAnimations === 'function') {
      for (const a of getAnimations.call(element)) {
        if (a.id?.startsWith(ANIMATION_ID_PREFIX)) a.cancel();
      }
    }
  }
}
