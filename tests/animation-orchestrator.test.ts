/**
 * Tests del runtime de animaciones (v0.8.0): capacidades, resolutor de
 * conflictos (propias y externas), orquestador (prioridades, colas,
 * replace/queue/ignore/merge, fallbacks, reduced-motion), motores sobre
 * jsdom, validadores, ejecutor local, bundle del navegador e integración
 * MCP/HTTP de `webmcpcss_animate`.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { detectCapabilities, detectLibraries } from '../src/animation/capabilities';
import { ConflictResolver } from '../src/animation/conflict-resolver';
import {
  type AnimationEngine,
  type EngineRun,
  ELEMENT_ID_ATTR,
  ensureElementId,
} from '../src/animation/engine/base-engine';
import { CssEngine, STYLE_ATTR } from '../src/animation/engine/css-engine';
import { ThreeEngine } from '../src/animation/engine/three-engine';
import { WaapiEngine } from '../src/animation/engine/waapi-engine';
import { animateInWindow } from '../src/animation/executor';
import { AnimationOrchestrator } from '../src/animation/orchestrator';
import { parseAnimations } from '../src/animation/parser';
import { buildRuntimeScript, RUNTIME_MODULES } from '../src/animation/runtime-bundle';
import type { AnimationConfig, AnimationMap } from '../src/animation/types';
import { validateAnimations } from '../src/animation/validators';
import {
  ANIMATE_TOOL_NAME,
  createMcpHttpServer,
  McpCore,
  type McpServerOptions,
} from '../src/exporters/mcp-server';
import { parseWebMCP } from '../src/parser';
import { readHistory } from '../src/utils/history';

const PAGE = `<!doctype html><html><head><style>
  @keyframes sitePulse { from { opacity: 1 } to { opacity: .5 } }
  .pulsing { animation-name: sitePulse; animation-duration: 1s; }
  .sliding { transition-property: opacity; transition-duration: 0.3s; }
</style></head><body>
  <section id="hero" class="hero"><div class="sky"></div><div class="mid"></div><h1 class="title">Hola</h1></section>
  <div class="card" id="c1">uno</div>
  <div class="card pulsing" id="c2">dos</div>
  <div class="card sliding" id="c3">tres</div>
  <div id="gs">gsap</div>
  <div id="scene"></div>
</body></html>`;

function load(html = PAGE) {
  const dom = new JSDOM(html, { pretendToBeVisual: true, runScripts: 'outside-only' });
  return { dom, win: dom.window as unknown as Window, doc: dom.window.document };
}

const cfg = (extra: Partial<AnimationConfig> & { name: string }): AnimationConfig => ({
  type: 'keyframes',
  priority: 'normal',
  selector: '.card',
  parameters: { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: 50 },
  ...extra,
});

const mapOf = (...configs: AnimationConfig[]): AnimationMap => ({
  animations: Object.fromEntries(configs.map((c) => [c.name, c])),
  warnings: [],
});

/** Motor de pruebas: registra llamadas y permite terminar animaciones a mano. */
class FakeEngine implements AnimationEngine {
  readonly id = 'waapi' as const;
  calls: Array<{ name: string; composite?: string; elements: number }> = [];
  stops: string[] = [];
  finishers = new Map<string, () => void>();
  supports(): true | string {
    return true;
  }
  propertiesFor(config: AnimationConfig): string[] {
    const first = config.parameters.keyframes?.[0] ?? {};
    return Object.keys(first).filter((k) => k !== 'offset' && k !== 'easing');
  }
  async execute(
    config: AnimationConfig,
    elements: Element[],
    ctx: { composite?: 'replace' | 'add' },
  ): Promise<EngineRun> {
    this.calls.push({
      name: config.name,
      composite: ctx.composite,
      elements: elements.length,
    });
    let resolve: () => void = () => undefined;
    const finished = new Promise<void>((r) => {
      resolve = r;
    });
    this.finishers.set(config.name, resolve);
    return {
      properties: this.propertiesFor(config),
      finished,
      stop: () => {
        this.stops.push(config.name);
        resolve();
      },
    };
  }
  async cleanup(): Promise<void> {
    /* noop */
  }
}

const NO_EXTERNAL = { detectExternal: false } as const;

describe('detectCapabilities / detectLibraries', () => {
  it('detecta capacidades de jsdom de forma conservadora y librerías globales', () => {
    const { win } = load();
    const caps = detectCapabilities(win);
    expect(caps.waapi).toBe(false);
    expect(caps.webgl).toBe(false);
    expect(caps.shadowDom).toBe(true);
    expect(caps.cssAnimations).toBe(true);
    expect(caps.reducedMotion).toBe(false);
    expect(caps.libraries).toEqual([]);
    (win as unknown as Record<string, unknown>).gsap = { version: '3.12.5' };
    (win as unknown as Record<string, unknown>).anime = () => undefined;
    (win as unknown as Record<string, unknown>).TweenMax = {};
    const libs = detectLibraries(win);
    expect(libs.map((l) => l.id).sort()).toEqual(['anime', 'gsap']);
    expect(libs.find((l) => l.id === 'gsap')?.version).toBe('3.12.5');
    expect(detectCapabilities(win, { webgl: true }).webgl).toBe(true);
  });
});

describe('ConflictResolver', () => {
  it('sin solapamiento → execute; mismos elementos y propiedades distintas → execute', () => {
    const r = new ConflictResolver();
    r.register({
      id: 'a',
      library: 'css',
      priority: 'normal',
      elements: ['e1'],
      properties: ['opacity'],
    });
    expect(
      r.resolve({
        id: 'b',
        priority: 'normal',
        elements: ['e2'],
        properties: ['opacity'],
      }).action,
    ).toBe('execute');
    expect(
      r.resolve({
        id: 'b',
        priority: 'normal',
        elements: ['e1'],
        properties: ['transform'],
      }).action,
    ).toBe('execute');
  });

  it('prioridad mayor → replace; menor → queue/ignore según estrategia; igual → estrategia', () => {
    const r = new ConflictResolver({ strategy: 'queue' });
    r.register({
      id: 'a',
      library: 'css',
      priority: 'normal',
      elements: ['e1'],
      properties: ['opacity'],
    });
    const base = { id: 'b', elements: ['e1'], properties: ['opacity'] };
    expect(r.resolve({ ...base, priority: 'high' }).action).toBe('replace');
    expect(r.resolve({ ...base, priority: 'low' }).action).toBe('queue');
    expect(r.resolve({ ...base, priority: 'low', strategy: 'ignore' }).action).toBe(
      'ignore',
    );
    expect(r.resolve({ ...base, priority: 'low', strategy: 'replace' }).action).toBe(
      'ignore',
    );
    expect(r.resolve({ ...base, priority: 'normal' }).action).toBe('queue');
    expect(r.resolve({ ...base, priority: 'normal', strategy: 'replace' }).action).toBe(
      'replace',
    );
    expect(r.resolve({ ...base, priority: 'normal', strategy: 'ignore' }).action).toBe(
      'ignore',
    );
    const res = r.resolve({ ...base, priority: 'normal' });
    expect(res.conflictsWith.map((c) => c.id)).toEqual(['a']);
    expect(res.properties).toEqual(['opacity']);
    expect(res.reason).toMatch(/encola/);
  });

  it('merge: componible para transform/opacity, degrada a queue si no', () => {
    const r = new ConflictResolver({ strategy: 'merge' });
    r.register({
      id: 'a',
      library: 'waapi',
      priority: 'normal',
      elements: ['e1'],
      properties: ['transform'],
    });
    expect(
      r.resolve({
        id: 'b',
        priority: 'normal',
        elements: ['e1'],
        properties: ['transform'],
      }).action,
    ).toBe('merge');
    r.register({
      id: 'c',
      library: 'waapi',
      priority: 'normal',
      elements: ['e2'],
      properties: ['background-color'],
    });
    expect(
      r.resolve({
        id: 'd',
        priority: 'normal',
        elements: ['e2'],
        properties: ['backgroundColor'],
      }).action,
    ).toBe('queue');
  });

  it('registerExternal / release / clear(onlyExternal)', () => {
    const { doc } = load();
    const r = new ConflictResolver();
    const el = doc.querySelector('#gs') as Element;
    const ext = r.registerExternal('gsap-1', [el], ['transform'], { library: 'gsap' });
    expect(ext.source).toBe('external');
    expect(ext.priority).toBe('high');
    expect(el.getAttribute(ELEMENT_ID_ATTR)).toBe(ext.elements[0]);
    r.register({
      id: 'own',
      library: 'css',
      priority: 'normal',
      elements: ['x'],
      properties: ['opacity'],
    });
    expect(r.list()).toHaveLength(2);
    r.clear(true);
    expect(r.list().map((a) => a.id)).toEqual(['own']);
    expect(r.release('own')).toBe(true);
    expect(r.release('own')).toBe(false);
  });

  it('scanExternal detecta animaciones CSS del sitio, transiciones y marcas de GSAP', () => {
    const { win, doc } = load();
    const gs = doc.querySelector('#gs') as Element & { _gsap?: unknown };
    gs._gsap = { id: 1 };
    const r = new ConflictResolver();
    const scan = r.scanExternal(win, Array.from(doc.querySelectorAll('.card, #gs')));
    const ids = scan.registered.map((a) => a.id);
    expect(ids.some((i) => i.startsWith('css:sitePulse@'))).toBe(true);
    expect(ids.some((i) => i.startsWith('transition@'))).toBe(true);
    expect(ids.some((i) => i.startsWith('gsap@'))).toBe(true);
    const pulse = scan.registered.find((a) => a.id.startsWith('css:sitePulse@'));
    expect(pulse?.properties).toEqual(['opacity']); // leído del @keyframes del sitio
    expect(pulse?.library).toBe('css');
    expect(scan.libraries).toContain('gsap');
  });
});

describe('AnimationOrchestrator', () => {
  it('ordena por prioridad, planifica y elige motor según capacidades', () => {
    const { win } = load();
    const o = new AnimationOrchestrator(win, NO_EXTERNAL);
    const map = mapOf(
      cfg({ name: 'low', priority: 'low' }),
      cfg({ name: 'crit', priority: 'critical' }),
      cfg({ name: 'iso', type: 'isometric', selector: '#c1', parameters: {} }),
      cfg({
        name: 'scene',
        type: 'three-scene',
        selector: '#scene',
        parameters: { sceneConfig: { layers: [{}] } },
      }),
      cfg({
        name: 'par',
        type: 'parallax',
        selector: '#hero',
        parameters: { layers: [{ selector: '.sky', speed: 0.2 }] },
      }),
    );
    const plan = o.plan(map);
    expect(plan.map((p) => p.name)).toEqual(['crit', 'iso', 'scene', 'par', 'low']);
    expect(plan.find((p) => p.name === 'iso')?.engine).toBe('css'); // jsdom: sin WAAPI → css
    expect(plan.find((p) => p.name === 'par')?.trigger).toBe('scroll');
    const scene = plan.find((p) => p.name === 'scene');
    expect(scene?.engine).toBeNull();
    expect(scene?.unsupportedReason).toMatch(/WebGL/);
  });

  it('ejecuta con el motor CSS: inyecta @keyframes, asigna clases, isométrico y parallax reaccionan al scroll', async () => {
    const { win, doc } = load();
    const o = new AnimationOrchestrator(win, NO_EXTERNAL);
    const map = mapOf(
      cfg({ name: 'fade', selector: '#c1' }),
      cfg({
        name: 'iso',
        type: 'isometric',
        selector: '#c2',
        parameters: { rotationX: '50deg' },
      }),
      cfg({
        name: 'par',
        type: 'parallax',
        selector: '#hero',
        parameters: {
          layers: [
            { selector: '.sky', speed: 0.2 },
            { selector: '.mid', speed: 0.5, depth: '-1px' },
          ],
        },
      }),
    );
    const r = await o.runAll(map);
    expect(r.success).toBe(true);
    expect(r.outcomes.map((x) => x.status)).toEqual(['executed', 'executed', 'executed']);
    const style = doc.querySelector(`style[${STYLE_ATTR}]`);
    expect(style?.textContent).toContain('@keyframes webmcp-anim-fade');
    expect(style?.textContent).toContain('rotateX(50deg) rotateZ(-45deg)');
    expect(doc.querySelector('#c1')?.classList.contains('webmcp-anim-fade')).toBe(true);
    expect(doc.querySelector('#c2')?.classList.contains('webmcp-anim-iso')).toBe(true);
    const sky = doc.querySelector('.sky') as HTMLElement;
    const mid = doc.querySelector('.mid') as HTMLElement;
    expect(sky.style.transform).toBe('translate3d(0, 0px, 0)');
    Object.defineProperty(win, 'scrollY', { value: 100, configurable: true });
    win.dispatchEvent(new win.Event('scroll'));
    await new Promise((res) => setTimeout(res, 30));
    expect(sky.style.transform).toBe('translate3d(0, 80px, 0)');
    expect(mid.style.transform).toBe('translate3d(0, 50px, -1px)');
    expect(
      o
        .active()
        .map((a) => a.name)
        .sort(),
    ).toEqual(['fade', 'iso', 'par']);
    o.stopAll();
    expect(o.active()).toEqual([]);
    expect(doc.querySelector('#c1')?.classList.contains('webmcp-anim-fade')).toBe(false);
    expect(sky.style.transform).toBe('');
  });

  it('prefers-reduced-motion aplica el estado final estático', async () => {
    const { win, doc } = load();
    const o = new AnimationOrchestrator(win, NO_EXTERNAL, undefined, {
      reducedMotion: true,
    });
    const r = await o.run(cfg({ name: 'fade', selector: '#c1' }));
    expect(r.status).toBe('executed');
    expect(r.handle?.reducedMotion).toBe(true);
    expect((doc.querySelector('#c1') as HTMLElement).style.opacity).toBe('1');
    expect(doc.querySelector(`style[${STYLE_ATTR}]`)).toBeNull();
    const r2 = await o.run(
      cfg({
        name: 'anim',
        selector: '#c2',
        parameters: {
          keyframes: [{ opacity: 0 }, { opacity: 1 }],
          respectReducedMotion: false,
        },
      }),
    );
    expect(r2.handle?.reducedMotion).toBeUndefined();
  });

  it('conflictos: replace por prioridad, queue tras la actual, ignore y merge (composite add)', async () => {
    const { win } = load();
    const fake = new FakeEngine();
    const o = new AnimationOrchestrator(win, { ...NO_EXTERNAL, strategy: 'queue' }, [
      fake,
    ]);
    const dequeued: string[] = [];
    o.onDequeued = (out) => dequeued.push(`${out.name}:${out.status}`);

    const a = await o.run(cfg({ name: 'a', selector: '#c1' }));
    expect(a.status).toBe('executed');
    const b = await o.run(cfg({ name: 'b', selector: '#c1' })); // misma prioridad → queue
    expect(b.status).toBe('queued');
    expect(o.queued()).toEqual(['b']);
    const c = await o.run(cfg({ name: 'c', selector: '#c1', priority: 'high' })); // mayor → replace a
    expect(c.status).toBe('executed');
    expect(c.resolution?.action).toBe('replace');
    expect(fake.stops).toContain('a');
    const d = await o.run(cfg({ name: 'd', selector: '#c1', priority: 'low' }), 'ignore');
    expect(d.status).toBe('ignored');
    const e = await o.run(
      cfg({
        name: 'e',
        selector: '#c1',
        priority: 'high',
        parameters: { keyframes: [{ transform: 'none' }, { transform: 'scale(1.1)' }] },
      }),
    );
    expect(e.status).toBe('executed'); // transform no colisiona con opacity
    const m = await o.run(
      cfg({
        name: 'm',
        selector: '#c1',
        priority: 'high',
        parameters: { keyframes: [{ transform: 'none' }, { transform: 'scale(2)' }] },
      }),
      'merge',
    );
    expect(m.status).toBe('executed');
    expect(m.resolution?.action).toBe('merge');
    expect(fake.calls.find((k) => k.name === 'm')?.composite).toBe('add');

    // Al terminar c (que bloqueaba a b), b sale de la cola y se ejecuta.
    fake.finishers.get('c')?.();
    await new Promise((res) => setTimeout(res, 10));
    expect(o.queued()).toEqual([]);
    expect(dequeued).toEqual(['b:executed']);
    expect(
      o
        .active()
        .map((x) => x.name)
        .sort(),
    ).toEqual(['b', 'e', 'm']);
    o.stopAll();
  });

  it('respeta animaciones externas: se ignora (no se pisa) salvo prioridad mayor, que las neutraliza', async () => {
    const { win, doc } = load();
    const o = new AnimationOrchestrator(win, { strategy: 'queue' });
    const gs = doc.querySelector('#gs') as Element;
    o.resolver.registerExternal('gsap-hero', [gs], ['transform'], { library: 'gsap' });
    const clash = await o.run(
      cfg({
        name: 'clash',
        selector: '#gs',
        parameters: { keyframes: [{ transform: 'none' }, { transform: 'scale(2)' }] },
      }),
    );
    expect(clash.status).toBe('ignored');
    expect(clash.message).toMatch(/externas/);
    const ok = await o.run(cfg({ name: 'ok', selector: '#gs' })); // opacity: sin conflicto
    expect(ok.status).toBe('executed');
    // La animación CSS del sitio en #c2 (sitePulse, opacity) se detecta y una crítica la sustituye.
    const r = await o.runAll(
      mapOf(cfg({ name: 'crit', selector: '#c2', priority: 'critical' })),
    );
    expect(r.external.some((e) => e.id.startsWith('css:sitePulse@'))).toBe(true);
    expect(r.outcomes[0].status).toBe('executed');
    expect(r.outcomes[0].resolution?.action).toBe('replace');
    expect(
      (doc.querySelector('#c2') as HTMLElement).style.getPropertyValue('animation-name'),
    ).toBe('none');
    o.stopAll();
  });

  it('fallback: sin motor compatible o sin elementos usa la configuración alternativa', async () => {
    const { win, doc } = load();
    const o = new AnimationOrchestrator(win, NO_EXTERNAL);
    const scene = cfg({
      name: 'scene',
      type: 'three-scene',
      selector: '#scene',
      parameters: { sceneConfig: { layers: [{}] } },
      fallback: cfg({ name: 'scene__fallback', selector: '#scene' }),
    });
    const r = await o.run(scene);
    expect(r.status).toBe('executed');
    expect(r.usedFallback).toBe(true);
    expect(r.message).toMatch(/Sin motor compatible.*fallback/);
    expect(doc.querySelector('#scene')?.classList.contains('webmcp-anim-scene')).toBe(
      true,
    );
    const missing = await o.run(cfg({ name: 'nope', selector: '#nada' }));
    expect(missing.status).toBe('failed');
    expect(missing.error).toBe('ELEMENT_NOT_FOUND');
    const dry = new AnimationOrchestrator(win, { ...NO_EXTERNAL, dryRun: true });
    const d = await dry.run(scene);
    expect(d.status).toBe('dry-run');
    expect(d.usedFallback).toBe(true);
    o.stopAll();
  });

  it('dry-run no toca la página y stop() devuelve false para desconocidas', async () => {
    const { win, doc } = load();
    const o = new AnimationOrchestrator(win, { ...NO_EXTERNAL, dryRun: true });
    const r = await o.runAll(mapOf(cfg({ name: 'fade', selector: '#c1' })));
    expect(r.outcomes[0].status).toBe('dry-run');
    expect(doc.querySelector(`style[${STYLE_ATTR}]`)).toBeNull();
    expect(o.stop('fade')).toBe(false);
  });

  it('motor forzado no compatible → failed con motivo; ScrollTimeline ausente → parallax por css', async () => {
    const { win } = load();
    const o = new AnimationOrchestrator(win, { ...NO_EXTERNAL, engine: 'waapi' });
    const r = await o.run(cfg({ name: 'fade', selector: '#c1' }));
    expect(r.status).toBe('failed');
    expect(r.message).toMatch(/Element.animate/);
    const auto = new AnimationOrchestrator(win, NO_EXTERNAL, undefined, { waapi: true });
    const p = auto.plan(
      mapOf(
        cfg({
          name: 'par',
          type: 'parallax',
          selector: '#hero',
          parameters: { layers: [{ selector: '.sky', speed: 0.3 }] },
        }),
      ),
    );
    expect(p[0].engine).toBe('css');
  });
});

describe('motores individuales', () => {
  it('WaapiEngine.supports y execute con Element.animate simulado (composite add, cancel)', async () => {
    const { win, doc } = load();
    const engine = new WaapiEngine();
    const caps = detectCapabilities(win);
    expect(engine.supports(cfg({ name: 'x' }), caps)).toMatch(/animate/);
    expect(engine.supports(cfg({ name: 'x' }), { ...caps, waapi: true })).toBe(true);
    expect(
      engine.supports(cfg({ name: 'p', type: 'parallax' }), { ...caps, waapi: true }),
    ).toMatch(/ScrollTimeline/);
    const created: Array<{
      keyframes: Keyframe[];
      options: KeyframeAnimationOptions;
      cancelled: boolean;
    }> = [];
    const el = doc.querySelector('#c1') as HTMLElement & { animate: unknown };
    el.animate = (keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
      const rec = { keyframes, options, cancelled: false };
      created.push(rec);
      return {
        finished: Promise.resolve(),
        cancel: () => (rec.cancelled = true),
        id: options.id,
      } as unknown as Animation;
    };
    const run = await engine.execute(
      cfg({
        name: 'x',
        parameters: { keyframes: [{ opacity: 0 }, { opacity: 1 }], duration: '1s' },
      }),
      [el],
      {
        win,
        doc,
        capabilities: { ...caps, waapi: true },
        composite: 'add',
        reducedMotion: false,
      },
    );
    expect(created[0].options).toMatchObject({
      id: 'webmcpcss:x',
      duration: 1000,
      composite: 'add',
    });
    expect(run.properties).toEqual(['opacity']);
    await run.finished;
    run.stop();
    expect(created[0].cancelled).toBe(true);
    const reduced = await engine.execute(cfg({ name: 'y' }), [el], {
      win,
      doc,
      capabilities: caps,
      reducedMotion: true,
    });
    expect(reduced.details?.reducedMotion).toBe(true);
    expect(el.style.opacity).toBe('1');
  });

  it('ThreeEngine.supports exige WebGL y tipo compatible; execute sin contenedor falla', async () => {
    const { win } = load();
    const engine = new ThreeEngine();
    const caps = detectCapabilities(win);
    expect(engine.supports(cfg({ name: 's', type: 'three-scene' }), caps)).toMatch(
      /WebGL/,
    );
    expect(
      engine.supports(cfg({ name: 's', type: 'three-scene' }), { ...caps, webgl: true }),
    ).toBe(true);
    expect(engine.supports(cfg({ name: 'k' }), { ...caps, webgl: true })).toMatch(
      /no aplica/,
    );
    await expect(
      engine.execute(cfg({ name: 's', type: 'three-scene' }), [], {
        win,
        doc: win.document,
        capabilities: caps,
        reducedMotion: false,
      }),
    ).rejects.toThrow(/contenedor/);
  });

  it('CssEngine.cleanup elimina clases y estilos; parallax sin capas coincidentes falla', async () => {
    const { win, doc } = load();
    const engine = new CssEngine();
    const el = doc.querySelector('#c1') as HTMLElement;
    el.classList.add('webmcp-anim-x', 'webmcp-parallax-layer', 'card');
    el.style.transform = 'translate3d(0,1px,0)';
    await engine.cleanup(el);
    expect(el.className).toBe('card');
    expect(el.style.transform).toBe('');
    await expect(
      engine.execute(
        cfg({
          name: 'p',
          type: 'parallax',
          selector: '#hero',
          parameters: { layers: [{ selector: '.nope', speed: 0.5 }] },
        }),
        [doc.querySelector('#hero') as Element],
        {
          win,
          doc,
          capabilities: detectCapabilities(win),
          reducedMotion: false,
        },
      ),
    ).rejects.toThrow(/ninguna capa coincide/);
  });
});

describe('motores con APIs simuladas (Three.js / ScrollTimeline / Puppeteer)', () => {
  /** Three.js mínimo: registra construcciones y renderizados. */
  function fakeThree() {
    const log: string[] = [];
    class Vec {
      x = 0;
      y = 0;
      z = 0;
      set(x: number, y: number, z: number) {
        this.x = x;
        this.y = y;
        this.z = z;
      }
    }
    class Obj {
      position = new Vec();
      rotation = new Vec();
      userData: Record<string, unknown> = {};
      geometry?: { dispose(): void };
      material?: { dispose(): void };
      children: Obj[] = [];
      add(o: Obj) {
        this.children.push(o);
      }
      remove(o: Obj) {
        this.children = this.children.filter((c) => c !== o);
      }
      lookAt() {
        /* noop */
      }
      updateProjectionMatrix() {
        log.push('updateProjectionMatrix');
      }
    }
    class Camera extends Obj {
      left = 0;
      right = 0;
      aspect = 1;
    }
    const THREE = {
      Scene: class extends Obj {
        background: unknown;
      },
      Color: class {
        constructor(public value: string) {}
      },
      PerspectiveCamera: class extends Camera {
        constructor() {
          super();
          log.push('perspective');
        }
      },
      OrthographicCamera: class extends Camera {
        constructor() {
          super();
          log.push('orthographic');
        }
      },
      WebGLRenderer: class {
        domElement: HTMLElement;
        constructor(win: Window) {
          this.domElement = win.document.createElement('canvas');
        }
        setPixelRatio() {
          /* noop */
        }
        setSize() {
          log.push('setSize');
        }
        setClearColor() {
          /* noop */
        }
        render() {
          log.push('render');
        }
        dispose() {
          log.push('dispose');
        }
      },
      TextureLoader: class {
        load(url: string) {
          log.push(`texture:${url}`);
          return {};
        }
      },
      MeshBasicMaterial: class {
        constructor(public opts: Record<string, unknown>) {}
        dispose() {
          log.push('material.dispose');
        }
      },
      PlaneGeometry: class {
        constructor(
          public w: number,
          public h: number,
        ) {}
        dispose() {
          log.push('geometry.dispose');
        }
      },
      Mesh: class extends Obj {
        constructor(
          public geometry: { dispose(): void },
          public material: { dispose(): void },
        ) {
          super();
        }
      },
    };
    return { THREE, log };
  }

  it('ThreeEngine monta la escena (Shadow DOM, mouse+scroll, resize) y la desmonta al parar', async () => {
    const { win, doc } = load();
    const { THREE, log } = fakeThree();
    const w = win as unknown as Record<string, unknown>;
    // WebGLRenderer necesita la ventana para crear el canvas.
    w.THREE = {
      ...THREE,
      WebGLRenderer: class extends THREE.WebGLRenderer {
        constructor() {
          super(win);
        }
      },
    };
    const engine = new ThreeEngine();
    const caps = { ...detectCapabilities(win), webgl: true };
    const host = doc.querySelector('#scene') as HTMLElement;
    const config = cfg({
      name: 'depth',
      type: 'three-scene',
      selector: '#scene',
      parameters: {
        duration: 40,
        sceneConfig: {
          camera: 'perspective',
          background: '#101010',
          interaction: 'both',
          layers: [
            { image: 'a.png', parallax: 0.5, spin: 1 },
            { color: '#abc', position: { z: -3 } },
          ],
        },
      },
    });
    const run = await engine.execute(config, [host], {
      win,
      doc,
      capabilities: caps,
      reducedMotion: false,
      sandbox: 'shadow',
    });
    expect(run.details).toMatchObject({
      layers: 2,
      camera: 'perspective',
      interaction: 'both',
      sandbox: 'shadow',
    });
    const shadowHost = host.querySelector(
      '[data-webmcp-three="depth-shadow"]',
    ) as HTMLElement;
    expect(shadowHost.shadowRoot?.querySelector('canvas')).toBeTruthy();
    expect(host.style.position).toBe('relative');
    expect(log).toContain('perspective');
    expect(log).toContain('texture:a.png');
    host.dispatchEvent(new win.MouseEvent('mousemove', { clientX: 10, clientY: 10 }));
    win.dispatchEvent(new win.Event('scroll'));
    win.dispatchEvent(new win.Event('resize'));
    expect(log).toContain('updateProjectionMatrix');
    await run.finished; // duration 40ms → se detiene sola
    expect(log).toContain('dispose');
    expect(log).toContain('geometry.dispose');
    expect(host.querySelector('[data-webmcp-three]')).toBeNull();
    run.stop(); // idempotente

    // Orquestador completo con WebGL "disponible": parallax puede ir por three si se fuerza.
    const o = new AnimationOrchestrator(
      win,
      { ...NO_EXTERNAL, engine: 'three' },
      undefined,
      caps,
    );
    const par = await o.run(
      cfg({
        name: 'par',
        type: 'parallax',
        selector: '#hero',
        parameters: { layers: [{ selector: '.sky', speed: 0.3 }] },
      }),
    );
    expect(par.status).toBe('executed');
    expect(par.engine).toBe('three');
    const reduced = new AnimationOrchestrator(win, NO_EXTERNAL, undefined, {
      ...caps,
      reducedMotion: true,
    });
    const still = await reduced.run(
      cfg({
        name: 'still',
        type: 'three-scene',
        selector: '#scene',
        parameters: { sceneConfig: { layers: [{}] } },
      }),
    );
    expect(still.handle?.reducedMotion).toBe(true);
    await engine.cleanup(host);
    expect(host.querySelector('[data-webmcp-three]')).toBeNull();
    o.stopAll();
    reduced.stopAll();
  });

  it('loadThree usa window.THREE y falla con un mensaje claro sin módulo', async () => {
    const { win } = load();
    const { loadThree } = await import('../src/animation/engine/three-engine');
    const fake = { Scene: class {}, WebGLRenderer: class {} };
    (win as unknown as Record<string, unknown>).THREE = fake;
    expect(await loadThree(win)).toBe(fake);
    delete (win as unknown as Record<string, unknown>).THREE;
    (win as unknown as Record<string, unknown>).THREE = { Scene: class {} }; // sin WebGLRenderer → se ignora
    await expect(loadThree(win, '/ruta/inexistente/three.module.js')).rejects.toThrow(
      /Three\.js/,
    );
  });

  it('WaapiEngine.executeParallax usa ScrollTimeline y cleanup cancela solo las propias', async () => {
    const { win, doc } = load();
    const created: Array<{
      id?: string;
      timeline?: unknown;
      cancelled: boolean;
      cancel?: () => void;
    }> = [];
    const w = win as unknown as Record<string, unknown>;
    w.ScrollTimeline = class {
      constructor(public opts: unknown) {}
    };
    const animate = function (
      this: Element,
      _k: Keyframe[],
      options: KeyframeAnimationOptions & { timeline?: unknown },
    ) {
      const rec = { id: options.id, timeline: options.timeline, cancelled: false };
      created.push(rec);
      return {
        id: options.id,
        finished: Promise.resolve(),
        cancel: () => (rec.cancelled = true),
      } as unknown as Animation;
    };
    const proto = win.Element.prototype as Element & {
      animate: unknown;
      getAnimations: unknown;
    };
    proto.animate = animate;
    proto.getAnimations = () =>
      created.filter((c) => !c.cancelled) as unknown as Animation[];
    const caps = detectCapabilities(win);
    expect(caps.waapi).toBe(true);
    expect(caps.scrollTimeline).toBe(true);
    const engine = new WaapiEngine();
    const par = cfg({
      name: 'par',
      type: 'parallax',
      selector: '#hero',
      parameters: {
        layers: [
          { selector: '.sky', speed: 0.2, depth: '-1px' },
          { selector: '.mid', speed: 0.6 },
        ],
      },
    });
    expect(engine.supports(par, caps)).toBe(true);
    const run = await engine.execute(par, [doc.querySelector('#hero') as Element], {
      win,
      doc,
      capabilities: caps,
      reducedMotion: false,
    });
    expect(run.details).toMatchObject({ animations: 2, timeline: 'scroll' });
    expect(created[0].id).toBe('webmcpcss:par');
    expect(created[0].timeline).toBeInstanceOf(w.ScrollTimeline as new () => unknown);
    run.stop();
    expect(created.every((c) => c.cancelled)).toBe(true);
    // En modo auto el parallax prefiere css (scroll por JS, universal); waapi solo si se fuerza.
    const o = new AnimationOrchestrator(win, NO_EXTERNAL, undefined, caps);
    expect(o.plan(mapOf(par))[0].engine).toBe('css');
    const forced = new AnimationOrchestrator(
      win,
      { ...NO_EXTERNAL, engine: 'waapi' },
      undefined,
      caps,
    );
    const out = await forced.run(par);
    expect(out.status).toBe('executed');
    expect(out.engine).toBe('waapi');
    forced.stopAll();
    // cleanup: cancela las de webmcpcss y respeta las ajenas
    created.length = 0;
    const own = {
      id: 'webmcpcss:x',
      cancelled: false,
      cancel: () => (own.cancelled = true),
    };
    const site = { id: 'site', cancelled: false, cancel: () => (site.cancelled = true) };
    created.push(own, site);
    await engine.cleanup(doc.querySelector('#c1') as Element);
    expect([own.cancelled, site.cancelled]).toEqual([true, false]);
  });

  it('animateWithPage inyecta el runtime y delega en la página (Page simulada)', async () => {
    const { animateWithPage } = await import('../src/animation/executor');
    const calls: string[] = [];
    let injected = false;
    const page = {
      evaluate: async (_fn: (...a: unknown[]) => unknown, ...args: unknown[]) => {
        if (args.length === 1) {
          calls.push('check');
          return injected;
        }
        calls.push('run');
        const [, map, o, dry] = args as [
          string,
          AnimationMap,
          Record<string, unknown>,
          boolean,
        ];
        if (!map) throw new Error(`argumentos inesperados: ${JSON.stringify(args)}`);
        const { win } = load();
        const orchestrator = new AnimationOrchestrator(win, {
          ...o,
          dryRun: dry,
          detectExternal: false,
        });
        const plan = orchestrator.plan(map);
        const validation = validateAnimations(map, win, o);
        const result = await orchestrator.runAll(map);
        orchestrator.stopAll();
        return JSON.parse(JSON.stringify({ plan, validation, result }));
      },
      addScriptTag: async ({ content }: { content: string }) => {
        calls.push(`inject:${content.length > 1000}`);
        injected = true;
      },
      screenshot: async () => {
        calls.push('screenshot');
        return 'QUJD';
      },
    };
    const distReady = fs.existsSync(
      path.resolve(__dirname, '..', 'dist', 'src', 'animation', 'orchestrator.js'),
    );
    if (!distReady) return; // el runtime requiere build previo
    const map = mapOf(cfg({ name: 'fade', selector: '#c1' }));
    const first = await animateWithPage(page as never, map, {
      historyFile: false,
      screenshot: true,
      settleMs: 1,
    });
    expect(first.success).toBe(true);
    expect(first.screenshotBase64).toBe('QUJD');
    expect(first.result?.outcomes[0].status).toBe('executed');
    expect(calls).toEqual(['check', 'inject:true', 'run', 'screenshot']);
    calls.length = 0;
    const dry = await animateWithPage(page as never, map, {
      historyFile: false,
      dryRun: true,
      screenshot: true,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.screenshotBase64).toBeUndefined();
    expect(calls).toEqual(['check', 'run']); // ya inyectado, sin captura en dry-run
  });
});

describe('validateAnimations', () => {
  it('informa selectores, motores, capas, conflictos previstos y externas', () => {
    const { win, doc } = load();
    (doc.querySelector('#gs') as Element & { _gsap?: unknown })._gsap = {};
    const map = parseAnimations(`
      #c1 { webmcp-animation: "a"; webmcp-animation-keyframes: '[{"opacity":0},{"opacity":1}]'; }
      #c1 { webmcp-animation: "b"; webmcp-animation-priority: low; webmcp-animation-keyframes: '[{"opacity":0.5},{"opacity":1}]'; }
      #nope { webmcp-animation: "missing"; webmcp-animation-keyframes: '[{"opacity":1}]'; }
      #hero { webmcp-animation: "par"; webmcp-animation-type: parallax; webmcp-animation-layers: ".sky" 0.2, ".ghost" 0.5; }
      #scene { webmcp-animation: "scene"; webmcp-animation-type: three-scene; webmcp-animation-scene: '{"layers":[{}]}'; }
      #gs { webmcp-animation: "g"; webmcp-animation-keyframes: '[{"transform":"none"},{"transform":"scale(2)"}]'; }
    `);
    const report = validateAnimations(map, win);
    expect(report.ok).toBe(false);
    const by = Object.fromEntries(report.entries.map((e) => [e.name, e]));
    expect(by.a.exists).toBe(true);
    expect(by.a.engine).toBe('css');
    expect(by.missing.errors[0]).toMatch(/sin coincidencias/);
    expect(by.par.errors[0]).toMatch(/Capa sin coincidencias: .ghost/);
    expect(by.scene.errors[0]).toMatch(/Sin motor compatible/);
    expect(by.b.warnings.some((w) => w.includes('encolaría'))).toBe(true);
    expect(report.conflicts.find((c) => c.animation === 'b')).toMatchObject({
      conflictsWith: 'a',
      action: 'queue',
      properties: ['opacity'],
    });
    expect(report.conflicts.find((c) => c.animation === 'g')?.conflictsWith).toMatch(
      /^gsap@/,
    );
    expect(report.capabilities?.waapi).toBe(false);
  });

  it('sin ventana solo valida reglas estáticas', () => {
    const report = validateAnimations(
      mapOf(cfg({ name: 'a' }), cfg({ name: 'p', type: 'parallax', parameters: {} })),
    );
    expect(report.entries[0].warnings[0]).toMatch(/Sin DOM/);
    expect(report.entries.find((e) => e.name === 'p')?.errors[0]).toMatch(/layers/);
    expect(report.ok).toBe(false);
  });
});

describe('animateInWindow (ejecutor local)', () => {
  let historyFile: string;
  afterEach(() => {
    if (historyFile && fs.existsSync(historyFile))
      fs.rmSync(path.dirname(historyFile), { recursive: true, force: true });
  });

  it('valida, ejecuta y registra en el historial', async () => {
    const { win } = load();
    historyFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'webmcpcss-anim-')),
      'h.json',
    );
    const r = await animateInWindow(win, mapOf(cfg({ name: 'fade', selector: '#c1' })), {
      historyFile,
      url: 'https://demo.test',
      detectExternal: false,
    });
    expect(r.success).toBe(true);
    expect(r.plan[0].engine).toBe('css');
    expect(r.result?.outcomes[0].status).toBe('executed');
    expect(r.message).toBe('1 executed');
    const events = readHistory(historyFile);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'animate',
      ok: true,
      url: 'https://demo.test',
    });
    r.orchestrator.stopAll();
  });

  it('bloquea la ejecución si la validación falla (salvo validate:false) y dry-run no registra', async () => {
    const { win } = load();
    historyFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'webmcpcss-anim-')),
      'h.json',
    );
    const map = mapOf(
      cfg({ name: 'ok', selector: '#c1' }),
      cfg({ name: 'missing', selector: '#nope' }),
    );
    const blocked = await animateInWindow(win, map, {
      historyFile,
      detectExternal: false,
    });
    expect(blocked.success).toBe(false);
    expect(blocked.result).toBeUndefined();
    expect(blocked.message).toMatch(/Validación fallida/);
    const forced = await animateInWindow(win, map, {
      historyFile,
      validate: false,
      detectExternal: false,
    });
    expect(forced.result?.outcomes.map((o) => o.status)).toEqual(['executed', 'failed']);
    expect(forced.success).toBe(false);
    const dry = await animateInWindow(win, map, {
      historyFile,
      dryRun: true,
      detectExternal: false,
    });
    expect(dry.dryRun).toBe(true);
    // El dry-run sigue informando de selectores sin coincidencias.
    expect(dry.result?.outcomes.map((o) => o.status)).toEqual(['dry-run', 'failed']);
    expect(dry.success).toBe(false);
    expect(readHistory(historyFile)).toHaveLength(2);
    forced.orchestrator.stopAll();
  });
});

describe('runtime del navegador (bundle)', () => {
  it('se genera desde dist/ y expone window.webmcpcss.animation funcional', async () => {
    const distDir = path.resolve(__dirname, '..', 'dist', 'src', 'animation');
    if (!fs.existsSync(path.join(distDir, 'orchestrator.js'))) {
      // Sin build previo no hay runtime que empaquetar (la CI ejecuta build antes de test).
      expect(() => buildRuntimeScript({ force: true })).toThrow(/npm run build/);
      return;
    }
    const script = buildRuntimeScript({ force: true });
    for (const id of RUNTIME_MODULES) expect(script).toContain(`define("./${id}"`);
    expect(script).not.toMatch(/require\("fs"\)|require\("path"\)|require\("postcss"\)/);
    const { dom, win } = load();
    dom.window.eval(script);
    const ns = (
      win as unknown as {
        webmcpcss: { animation: Record<string, (...a: unknown[]) => unknown> };
      }
    ).webmcpcss.animation;
    expect(typeof ns.run).toBe('function');
    const plan = ns.plan(mapOf(cfg({ name: 'fade', selector: '#c1' }))) as Array<{
      engine: string;
    }>;
    expect(plan[0].engine).toBe('css');
    const result = (await ns.run(mapOf(cfg({ name: 'fade', selector: '#c1' })), {
      detectExternal: false,
    })) as { outcomes: Array<{ status: string }> };
    expect(result.outcomes[0].status).toBe('executed');
    const ext = ns.registerExternal('gsap-x', '#gs', ['transform'], {
      library: 'gsap',
    }) as { source: string };
    expect(ext.source).toBe('external');
    expect((ns.active() as Array<{ name: string }>).map((a) => a.name)).toEqual(['fade']);
    expect(ns.stop('fade')).toBe(true);
    ns.stopAll();
  });
});

describe('Herramienta MCP webmcpcss_animate (v0.8.0)', () => {
  const toolMap = parseWebMCP(`.buy { webmcp-tool: "buyNow"; }`);
  const animateExecutor = vi.fn(async (args: Record<string, unknown>) => ({
    success: args.dryRun !== true,
    dryRun: args.dryRun === true,
    plan: [{ name: 'x' }],
    message: args.dryRun ? '[dry-run]' : '1 executed',
    ...(args.screenshot ? { screenshotBase64: 'iVBORw0KGgo=' } : {}),
  }));
  const makeOptions = (extra: Partial<McpServerOptions> = {}): McpServerOptions => ({
    toolMap,
    url: 'https://shop.test',
    ...extra,
  });

  it('tools/list solo la expone con ejecutor; sin ejecutor devuelve isError', async () => {
    const without = new McpCore(makeOptions());
    expect(without.listTools().tools.map((t) => t.name)).toEqual(['buyNow']);
    const res = await without.callTool(ANIMATE_TOOL_NAME, { css: 'x' });
    expect(res.isError).toBe(true);
    const withTool = new McpCore(makeOptions({ animate: animateExecutor }));
    const tools = withTool.listTools().tools;
    expect(tools.map((t) => t.name)).toEqual(['buyNow', ANIMATE_TOOL_NAME]);
    expect(
      (tools[1].inputSchema as { properties: Record<string, unknown> }).properties,
    ).toHaveProperty('strategy');
  });

  it('tools/call valida argumentos, normaliza enums y adjunta la captura como imagen', async () => {
    animateExecutor.mockClear();
    const core = new McpCore(makeOptions({ animate: animateExecutor }));
    const missing = await core.callTool(ANIMATE_TOOL_NAME, {});
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toMatch(/animationFile|css/);
    const ok = await core.callTool(ANIMATE_TOOL_NAME, {
      css: '.a{}',
      strategy: 'merge',
      engine: 'bogus',
      screenshot: true,
    });
    expect(ok.isError).toBeUndefined();
    expect(animateExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        css: '.a{}',
        strategy: 'merge',
        engine: undefined,
        url: undefined,
      }),
    );
    expect(ok.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(JSON.parse(ok.content[0].text as string).screenshotBase64).toBe('<image>');
    const dry = await core.callTool(ANIMATE_TOOL_NAME, {
      animationFile: 'a.css',
      dryRun: true,
    });
    expect(dry.isError).toBe(true); // success:false en el mock → isError
    const failing = new McpCore(
      makeOptions({
        animate: async () => {
          throw new Error('boom');
        },
      }),
    );
    const err = await failing.callTool(ANIMATE_TOOL_NAME, { css: 'x' });
    expect(err.isError).toBe(true);
    expect(err.content[0].text).toMatch(/boom/);
  });

  it('POST /api/animate por HTTP (200 / 422 / 404 / 400)', async () => {
    const start = async (opts: McpServerOptions) => {
      const server = createMcpHttpServer(opts);
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      return {
        server,
        base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      };
    };
    const close = async (server: http.Server) => {
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    };
    const a = await start(makeOptions({ animate: animateExecutor }));
    try {
      const ok = await fetch(`${a.base}/api/animate`, {
        method: 'POST',
        body: JSON.stringify({ css: '.a{}' }),
      });
      expect(ok.status).toBe(200);
      const bad = await fetch(`${a.base}/api/animate`, { method: 'POST', body: '{}' });
      expect(bad.status).toBe(422);
      const notJson = await fetch(`${a.base}/api/animate`, {
        method: 'POST',
        body: '{{{',
      });
      expect(notJson.status).toBe(400);
    } finally {
      await close(a.server);
    }
    const b = await start(makeOptions());
    try {
      const res = await fetch(`${b.base}/api/animate`, {
        method: 'POST',
        body: '{"css":"x"}',
      });
      expect(res.status).toBe(404);
    } finally {
      await close(b.server);
    }
  });
});

describe('ensureElementId', () => {
  it('es estable y persiste como atributo', () => {
    const { doc } = load();
    const el = doc.querySelector('#c1') as Element;
    const id = ensureElementId(el);
    expect(ensureElementId(el)).toBe(id);
    expect(el.getAttribute(ELEMENT_ID_ATTR)).toBe(id);
  });
});

/* ------------------------------------------------------------------ */
/* Integración CLI (requiere build previo: npm run build)              */
/* ------------------------------------------------------------------ */

const CLI = path.resolve(__dirname, '../dist/src/cli.js');

describe.skipIf(!fs.existsSync(CLI))('CLI animate (integración, sin navegador)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-cli-anim-'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('sin --url genera runtime, mapa JSON y loader', () => {
    const out = path.join(tmp, 'runtime');
    const stdout = execFileSync(
      'node',
      [
        CLI,
        'animate',
        path.resolve(__dirname, '../examples/animation/animations.webmcp.css'),
        '-o',
        out,
        '--conflict-strategy',
        'merge',
        '--json',
      ],
      { encoding: 'utf8' },
    );
    const parsed = JSON.parse(stdout) as {
      runtime: string;
      map: string;
      animations: string[];
    };
    expect(parsed.animations).toContain('heroParallax');
    expect(fs.existsSync(parsed.runtime)).toBe(true);
    expect(fs.readFileSync(parsed.runtime, 'utf8')).toContain('webmcpcss');
    const map = JSON.parse(fs.readFileSync(parsed.map, 'utf8')) as AnimationMap;
    expect(Object.keys(map.animations)).toHaveLength(7);
    expect(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).toContain(
      '"strategy":"merge"',
    );
  });

  it('rechaza estrategia/motor desconocidos y archivos sin animaciones', () => {
    const empty = path.join(tmp, 'empty.css');
    fs.writeFileSync(empty, '.a { color: red; }');
    const run = (args: string[]) => {
      try {
        execFileSync('node', [CLI, 'animate', ...args], {
          encoding: 'utf8',
          stdio: 'pipe',
        });
        return { code: 0, stderr: '' };
      } catch (e) {
        const err = e as { status: number; stderr: string };
        return { code: err.status, stderr: err.stderr };
      }
    };
    expect(run([empty, '-o', path.join(tmp, 'x')])).toMatchObject({ code: 1 });
    const bad = run([
      path.resolve(__dirname, '../examples/animation/animations.webmcp.css'),
      '--conflict-strategy',
      'sometimes',
      '-o',
      path.join(tmp, 'y'),
    ]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toMatch(/--conflict-strategy/);
    expect(run(['nope.css']).code).toBe(1);
  });
});
