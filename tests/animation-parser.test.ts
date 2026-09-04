/**
 * Tests del parser y la validación estática del estándar de animaciones
 * (v0.8.0): propiedades `webmcp-animation-*`, atajos, JSON, variables CSS,
 * anidamiento, `@import`, fallbacks y errores.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  buildTransform,
  keyframesFor,
  propertiesOf,
  toMs,
} from '../src/animation/engine/base-engine';
import { classRuleCss, keyframesToCss } from '../src/animation/engine/css-engine';
import { toWaapiKeyframes, toWaapiTiming } from '../src/animation/engine/waapi-engine';
import { normalizeScene } from '../src/animation/engine/three-engine';
import {
  parseAnimations,
  parseAnimationsFile,
  parseDuration,
  serializeAnimations,
} from '../src/animation/parser';
import { validateStatic } from '../src/animation/validators';
import { WebMCPParseError } from '../src/parser';
import type { AnimationConfig } from '../src/animation/types';

const FULL = `
:root { --hero: #hero; --dur: 1.2s; }
var(--hero) {
  webmcp-animation: "heroParallax";
  webmcp-animation-type: parallax;
  webmcp-animation-priority: high;
  webmcp-animation-trigger: scroll;
  webmcp-animation-layers: ".sky" 0.1, ".mountains" 0.4 -2px, ".ground" 1;
  webmcp-animation-description: "Fondo con profundidad";
}
.card {
  .title {
    webmcp-animation: "titleIn";
    webmcp-animation-type: keyframes;
    webmcp-animation-duration: var(--dur);
    webmcp-animation-delay: 100ms;
    webmcp-animation-easing: ease-out;
    webmcp-animation-iterations: 2;
    webmcp-animation-engine: waapi;
    webmcp-animation-conflict: merge;
    webmcp-animation-keyframes: '[{"opacity":0,"transform":"translateY(20px)"},{"opacity":1,"transform":"none"}]';
  }
  &.iso {
    webmcp-animation: "isoCard";
    webmcp-animation-type: isometric;
    webmcp-animation-rotation-x: 55deg;
    webmcp-animation-rotation-z: -30deg;
    webmcp-animation-scale: 0.9;
    webmcp-animation-params: '{"duration":"2s","perspective":"800px"}';
  }
}
#scene {
  webmcp-animation: "depth";
  webmcp-animation-type: three-scene;
  webmcp-animation-sandbox: shadow;
  webmcp-animation-scene: '{"layers":[{"color":"#123","position":{"z":-2}}]}';
  webmcp-animation-fallback: "isoCard";
}
#hero-fx {
  webmcp-animation: "flip";
  webmcp-animation-type: 3d-transform;
  webmcp-animation-rotation-y: 25deg;
  webmcp-animation-selector: "#hero .badge";
  webmcp-animation-fallback: '{"type":"keyframes","engine":"css","keyframes":[{"opacity":0},{"opacity":1}]}';
}
`;

describe('parseAnimations', () => {
  it('parsea todas las propiedades, atajos, variables y anidamiento', () => {
    const map = parseAnimations(FULL);
    expect(Object.keys(map.animations)).toEqual([
      'heroParallax',
      'titleIn',
      'isoCard',
      'depth',
      'flip',
    ]);
    const hero = map.animations.heroParallax;
    expect(hero.selector).toBe('#hero');
    expect(hero.type).toBe('parallax');
    expect(hero.priority).toBe('high');
    expect(hero.trigger).toBe('scroll');
    expect(hero.description).toBe('Fondo con profundidad');
    expect(hero.parameters.layers).toEqual([
      { selector: '.sky', speed: 0.1 },
      { selector: '.mountains', speed: 0.4, depth: '-2px' },
      { selector: '.ground', speed: 1 },
    ]);

    const title = map.animations.titleIn;
    expect(title.selector).toBe('.card .title');
    expect(title.parameters.duration).toBe('1.2s');
    expect(title.parameters.delay).toBe('100ms');
    expect(title.parameters.iterations).toBe(2);
    expect(title.engine).toBe('waapi');
    expect(title.conflict).toBe('merge');
    expect(title.parameters.keyframes).toHaveLength(2);

    const iso = map.animations.isoCard;
    expect(iso.selector).toBe('.card.iso');
    expect(iso.parameters.rotationX).toBe('55deg');
    expect(iso.parameters.rotationZ).toBe('-30deg');
    expect(iso.parameters.scale).toBe(0.9);
    // JSON + atajos: el JSON aporta duration/perspective
    expect(iso.parameters.duration).toBe('2s');
    expect(iso.parameters.perspective).toBe('800px');

    const depth = map.animations.depth;
    expect(depth.sandbox).toBe('shadow');
    expect(depth.parameters.sceneConfig?.layers).toHaveLength(1);
    // fallback por referencia: copia de isoCard con el selector propio
    expect(depth.fallback?.type).toBe('isometric');
    expect(depth.fallback?.selector).toBe('#scene');
    expect(depth.fallback?.fallback).toBeUndefined();

    const flip = map.animations.flip;
    expect(flip.selector).toBe('#hero .badge'); // selector explícito
    expect(flip.fallback?.type).toBe('keyframes');
    expect(flip.fallback?.engine).toBe('css');
    expect(flip.fallback?.name).toBe('flip__fallback');
    expect(map.warnings).toEqual([]);
  });

  it('los atajos tienen prioridad sobre el JSON de params', () => {
    const map = parseAnimations(`
      .a { webmcp-animation: "a"; webmcp-animation-type: keyframes;
        webmcp-animation-params: '{"duration":"5s","keyframes":[{"opacity":0},{"opacity":1}]}';
        webmcp-animation-duration: 1s; }`);
    expect(map.animations.a.parameters.duration).toBe('1s');
    expect(map.animations.a.parameters.keyframes).toHaveLength(2);
  });

  it('valores por defecto: type keyframes, priority normal', () => {
    const map = parseAnimations(
      `.a { webmcp-animation: "a"; webmcp-animation-keyframes: '[{"opacity":1}]'; }`,
    );
    expect(map.animations.a.type).toBe('keyframes');
    expect(map.animations.a.priority).toBe('normal');
  });

  it('acepta webmcp-animation-name como alias e iteraciones infinite', () => {
    const map = parseAnimations(
      `.a { webmcp-animation-name: "spin"; webmcp-animation-iterations: infinite; webmcp-animation-keyframes: '[{"transform":"rotate(360deg)"}]'; }`,
    );
    expect(map.animations.spin.parameters.iterations).toBe('infinite');
  });

  it('ignora reglas sin propiedades webmcp-animation-* (compatibilidad con webmcp-tool)', () => {
    const map = parseAnimations(
      `.btn { webmcp-tool: "buy"; color: red; } .x { webmcp-animation: "x"; webmcp-animation-keyframes: '[{"opacity":1}]'; }`,
    );
    expect(Object.keys(map.animations)).toEqual(['x']);
  });

  it('avisa al redeclarar y al usar sandbox shadow fuera de three-scene', () => {
    const map = parseAnimations(`
      .a { webmcp-animation: "dup"; webmcp-animation-keyframes: '[{"opacity":1}]'; webmcp-animation-sandbox: shadow; }
      .b { webmcp-animation: "dup"; webmcp-animation-keyframes: '[{"opacity":0}]'; }`);
    expect(map.animations.dup.selector).toBe('.b');
    expect(map.warnings.some((w) => w.includes('redeclarada'))).toBe(true);
    expect(map.warnings.some((w) => w.includes('sandbox shadow'))).toBe(true);
  });

  it('resuelve @import y layers en JSON', () => {
    const map = parseAnimations(
      `@import "base.css"; .b { webmcp-animation: "b"; webmcp-animation-type: parallax; webmcp-animation-layers: '[{"selector":".l","speed":0.5}]'; }`,
      {
        resolveImport: () =>
          `.a { webmcp-animation: "a"; webmcp-animation-keyframes: '[{"opacity":1}]'; }`,
      },
    );
    expect(Object.keys(map.animations).sort()).toEqual(['a', 'b']);
    expect(map.animations.b.parameters.layers?.[0]).toEqual({
      selector: '.l',
      speed: 0.5,
    });
  });

  it('parseAnimationsFile lee de disco con imports relativos', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcpcss-anim-'));
    fs.writeFileSync(
      path.join(dir, 'base.css'),
      `.a { webmcp-animation: "a"; webmcp-animation-keyframes: '[{"opacity":1}]'; }`,
    );
    fs.writeFileSync(
      path.join(dir, 'main.css'),
      `@import "base.css";\n.b { webmcp-animation: "b"; webmcp-animation-keyframes: '[{"opacity":0}]'; }`,
    );
    const map = parseAnimationsFile(path.join(dir, 'main.css'));
    expect(Object.keys(map.animations).sort()).toEqual(['a', 'b']);
  });

  describe('errores', () => {
    const bad = (css: string, re: RegExp) => {
      expect(() => parseAnimations(css)).toThrow(WebMCPParseError);
      expect(() => parseAnimations(css)).toThrow(re);
    };
    it('sin nombre', () =>
      bad(`.a { webmcp-animation-type: keyframes; }`, /no declara webmcp-animation/));
    it('nombre inválido', () =>
      bad(`.a { webmcp-animation: "1 bad"; }`, /Nombre de animación inválido/));
    it('tipo desconocido', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-type: wobble; }`,
        /webmcp-animation-type/,
      ));
    it('prioridad desconocida', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-priority: urgent; webmcp-animation-keyframes: '[{"opacity":1}]'; }`,
        /webmcp-animation-priority/,
      ));
    it('JSON inválido en params', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-params: '{oops}'; }`,
        /JSON inválido/,
      ));
    it('parallax sin capas', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-type: parallax; }`,
        /requiere "layers"/,
      ));
    it('capa mal formada', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-type: parallax; webmcp-animation-layers: ".x"; }`,
        /capa ".x" inválida/,
      ));
    it('keyframes sin fotogramas', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-type: keyframes; }`,
        /requiere "keyframes"/,
      ));
    it('three-scene sin capas', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-type: three-scene; }`,
        /sceneConfig.layers/,
      ));
    it('three-scene con motor css', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-type: three-scene; webmcp-animation-engine: css; webmcp-animation-scene: '{"layers":[{}]}'; }`,
        /solo puede ejecutarse con el motor three/,
      ));
    it('keyframes con motor three', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-engine: three; webmcp-animation-keyframes: '[{"opacity":1}]'; }`,
        /motor three no soporta keyframes/,
      ));
    it('duración inválida', () =>
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-duration: rápido; webmcp-animation-keyframes: '[{"opacity":1}]'; }`,
        /duración inválida/,
      ));
    it('fallback inexistente y auto-referencia', () => {
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-keyframes: '[{"opacity":1}]'; webmcp-animation-fallback: "nope"; }`,
        /inexistente/,
      );
      bad(
        `.a { webmcp-animation: "a"; webmcp-animation-keyframes: '[{"opacity":1}]'; webmcp-animation-fallback: "a"; }`,
        /su propio fallback/,
      );
    });
    it('CSS inválido y @import circular', () => {
      bad(`.a { webmcp-animation: "a"`, /CSS inválido/);
      expect(() =>
        parseAnimations('@import "x.css";', { resolveImport: () => '@import "x.css";' }),
      ).toThrow(/circular/);
    });
  });
});

describe('serializeAnimations', () => {
  it('produce CSS que vuelve a parsearse al mismo mapa', () => {
    const map = parseAnimations(FULL);
    const css = serializeAnimations(map);
    expect(css).toContain('webmcp-animation: "heroParallax"');
    expect(css).toContain('webmcp-animation-fallback: "isoCard"');
    const again = parseAnimations(css);
    expect(Object.keys(again.animations)).toEqual(Object.keys(map.animations));
    expect(again.animations.heroParallax.parameters.layers).toEqual(
      map.animations.heroParallax.parameters.layers,
    );
    expect(again.animations.titleIn.parameters).toEqual(
      map.animations.titleIn.parameters,
    );
  });
});

describe('utilidades de motores', () => {
  const cfg = (extra: Partial<AnimationConfig>): AnimationConfig => ({
    name: 'x',
    type: 'keyframes',
    priority: 'normal',
    selector: '.x',
    parameters: {},
    ...extra,
  });

  it('parseDuration / toMs', () => {
    expect(parseDuration('1.5s')).toBe(1500);
    expect(parseDuration('300ms')).toBe(300);
    expect(parseDuration(250)).toBe(250);
    expect(parseDuration('rápido')).toBeNull();
    expect(parseDuration(-1)).toBeNull();
    expect(toMs(undefined, 42)).toBe(42);
    expect(toMs('2s', 0)).toBe(2000);
  });

  it('buildTransform e keyframesFor para isometric / 3d-transform', () => {
    const iso = cfg({ type: 'isometric', parameters: { rotationX: '55deg' } });
    expect(buildTransform(iso)).toBe('rotateX(55deg) rotateZ(-45deg)');
    expect(keyframesFor(iso)).toEqual([
      { transform: 'none', 'transform-style': 'preserve-3d' },
      { transform: 'rotateX(55deg) rotateZ(-45deg)', 'transform-style': 'preserve-3d' },
    ]);
    const d3 = cfg({
      type: '3d-transform',
      parameters: {
        perspective: '800px',
        rotationY: '25deg',
        translationZ: '40px',
        scale: 1.1,
      },
    });
    expect(buildTransform(d3)).toBe(
      'perspective(800px) rotateY(25deg) translateZ(40px) scale(1.1)',
    );
    expect(buildTransform(cfg({ type: '3d-transform' }))).toBe('rotateY(25deg)');
    expect(propertiesOf(iso)).toEqual(['transform', 'transform-style']);
    expect(propertiesOf(cfg({ type: 'parallax' }))).toEqual(['transform']);
    expect(propertiesOf(cfg({ type: 'three-scene' }))).toEqual(['scene']);
    expect(
      propertiesOf(
        cfg({
          parameters: {
            keyframes: [{ opacity: 0, backgroundColor: 'red' }, { offset: 1 }],
          },
        }),
      ),
    ).toEqual(['opacity', 'background-color']);
  });

  it('keyframesToCss reparte offsets y convierte camelCase; classRuleCss usa los parámetros', () => {
    const c = cfg({
      parameters: {
        keyframes: [
          { opacity: 0 },
          { opacity: 0.5, easing: 'linear' },
          { opacity: 1, offset: 1 },
        ],
        duration: '2s',
        iterations: 'infinite',
        direction: 'alternate',
        easing: 'ease-in',
      },
    });
    const kf = keyframesToCss('webmcp-anim-x', c);
    expect(kf).toContain('0% { opacity: 0; }');
    expect(kf).toContain('50% { opacity: 0.5; animation-timing-function: linear; }');
    expect(kf).toContain('100% { opacity: 1; }');
    const rule = classRuleCss('webmcp-anim-x', c);
    expect(rule).toContain('animation-duration: 2000ms');
    expect(rule).toContain('animation-iteration-count: infinite');
    expect(rule).toContain('animation-direction: alternate');
    expect(rule).toContain('animation-timing-function: ease-in');
    expect(rule).toContain('animation-fill-mode: forwards');
  });

  it('toWaapiKeyframes/toWaapiTiming', () => {
    const c = cfg({
      parameters: {
        keyframes: [
          { 'background-color': 'red', '--x': '1' },
          { backgroundColor: 'blue' },
        ],
        duration: 500,
        delay: '1s',
        iterations: 3,
      },
    });
    expect(toWaapiKeyframes(c)).toEqual([
      { backgroundColor: 'red', '--x': '1' },
      { backgroundColor: 'blue' },
    ]);
    const t = toWaapiTiming(c, 'add');
    expect(t).toMatchObject({
      id: 'webmcpcss:x',
      duration: 500,
      delay: 1000,
      iterations: 3,
      composite: 'add',
      fill: 'forwards',
    });
    expect(
      toWaapiTiming(cfg({ parameters: { iterations: 'infinite' } })).iterations,
    ).toBe(Infinity);
  });

  it('normalizeScene aplica defaults y convierte parallax→capas', () => {
    const s = normalizeScene(
      cfg({ type: 'three-scene', parameters: { sceneConfig: { layers: [{}] } } }),
    );
    expect(s).toMatchObject({
      camera: 'orthographic',
      viewHeight: 10,
      interaction: 'mouse',
    });
    const p = normalizeScene(
      cfg({ type: 'parallax', parameters: { layers: [{ selector: '.a', speed: 0.2 }] } }),
    );
    expect(p.layers).toHaveLength(1);
    expect(p.layers[0].parallax).toBeCloseTo(0.8);
  });

  it('validateStatic devuelve errores/avisos sin lanzar', () => {
    expect(validateStatic(cfg({ type: 'parallax' })).errors[0]).toMatch(/layers/);
    const warn = validateStatic(cfg({ type: '3d-transform' }));
    expect(warn.errors).toEqual([]);
    expect(warn.warnings[0]).toMatch(/rotateY\(25deg\)/);
    expect(
      validateStatic(cfg({ parameters: { keyframes: [{ opacity: 1, offset: 2 }] } }))
        .errors[0],
    ).toMatch(/offset/);
    expect(
      validateStatic(cfg({ parameters: { keyframes: [{ opacity: 1 }], iterations: -1 } }))
        .errors[0],
    ).toMatch(/iteraciones/);
  });
});
