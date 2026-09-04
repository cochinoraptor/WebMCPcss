/**
 * Empaquetador del **runtime de navegador** del módulo de animaciones.
 *
 * El proyecto no usa bundler: este módulo concatena, en orden de
 * dependencias, los archivos JavaScript ya compilados (CommonJS en
 * `dist/`) de los módulos isomorfos y los envuelve en un IIFE con un
 * `require` mínimo en memoria. El resultado se inyecta con
 * `page.evaluate`/`addScriptTag` (CLI) o se guarda en disco
 * (`--output`) para usarlo como `<script>` en cualquier página:
 *
 * ```js
 * window.webmcpcss.animation.run(animationMap, { strategy: 'queue' });
 * window.webmcpcss.animation.registerExternal('gsap-hero', ['#hero'], ['transform']);
 * ```
 */
import * as fs from 'fs';
import * as path from 'path';

/** Módulos isomorfos que forman el runtime, en orden de dependencias. */
export const RUNTIME_MODULES = [
  'types',
  'engine/base-engine',
  'config-validation',
  'capabilities',
  'engine/css-engine',
  'engine/waapi-engine',
  'engine/three-engine',
  'conflict-resolver',
  'orchestrator',
  'validators',
] as const;

/** Nombre del global expuesto en la página. */
export const RUNTIME_GLOBAL = 'webmcpcss';

let cached: string | null = null;

/**
 * Localiza el directorio con los `.js` compilados de `src/animation`.
 * En desarrollo (`tsx`) puede no existir: se indica cómo generarlo.
 */
function compiledDir(): string {
  const here = __dirname; // dist/src/animation en producción; src/animation con tsx
  if (fs.existsSync(path.join(here, 'orchestrator.js'))) return here;
  const dist = path.resolve(here, '..', '..', 'dist', 'src', 'animation');
  if (fs.existsSync(path.join(dist, 'orchestrator.js'))) return dist;
  throw new Error(
    'No se encuentra el runtime compilado de animaciones. Ejecuta `npm run build` primero.',
  );
}

/**
 * Convierte un módulo CommonJS compilado en una función de fábrica
 * `(exports, require) => void` sin dependencias de Node.
 */
function wrapModule(id: string, code: string): string {
  const body = code
    .replace(/^"use strict";\s*/m, '')
    .replace(/\/\/# sourceMappingURL=.*$/m, '');
  return `  define(${JSON.stringify(id)}, function (exports, require) {\n${body}\n  });`;
}

/**
 * Genera el código fuente del runtime (cacheado por proceso).
 * @param options `pretty` desactiva la minificación ligera de comentarios.
 */
export function buildRuntimeScript(options: { force?: boolean } = {}): string {
  if (cached && !options.force) return cached;
  const dir = compiledDir();
  const modules = RUNTIME_MODULES.map((id) => {
    const file = path.join(dir, `${id}.js`);
    return wrapModule(`./${id}`, fs.readFileSync(file, 'utf8'));
  });
  const source = `/* WebMCPcss animation runtime — generado automáticamente */
(function (global) {
  var registry = {};
  var cache = {};
  function normalize(from, spec) {
    if (spec.charAt(0) !== '.') return spec;
    var parts = from.split('/').slice(0, -1);
    var segs = spec.split('/');
    for (var i = 0; i < segs.length; i++) {
      if (segs[i] === '.') continue;
      if (segs[i] === '..') parts.pop();
      else parts.push(segs[i]);
    }
    return parts.join('/');
  }
  function define(id, factory) { registry[id] = factory; }
  function load(id) {
    if (cache[id]) return cache[id].exports;
    var factory = registry[id];
    if (!factory) throw new Error('webmcpcss runtime: módulo no encontrado ' + id);
    var module = { exports: {} };
    cache[id] = module;
    factory(module.exports, function (spec) { return load(normalize(id, spec)); });
    return module.exports;
  }
${modules.join('\n')}
  var orchestratorMod = load('./orchestrator');
  var validatorsMod = load('./validators');
  var capsMod = load('./capabilities');
  var resolverMod = load('./conflict-resolver');
  var typesMod = load('./types');
  var ns = global.${RUNTIME_GLOBAL} = global.${RUNTIME_GLOBAL} || {};
  var current = null;
  ns.animation = {
    version: '0.8.0',
    AnimationOrchestrator: orchestratorMod.AnimationOrchestrator,
    ConflictResolver: resolverMod.ConflictResolver,
    detectCapabilities: function (o) { return capsMod.detectCapabilities(global, o); },
    detectLibraries: function () { return capsMod.detectLibraries(global); },
    validate: function (map, options) { return validatorsMod.validateAnimations(map, global, options); },
    PRIORITY_ORDER: typesMod.PRIORITY_ORDER,
    /** Crea (o reutiliza) el orquestador global de la página. */
    orchestrator: function (options) {
      if (!current || options) current = new orchestratorMod.AnimationOrchestrator(global, options || {});
      return current;
    },
    /** Ejecuta un AnimationMap completo. */
    run: function (map, options) { return ns.animation.orchestrator(options).runAll(map); },
    /** Planifica sin ejecutar. */
    plan: function (map, options) { return ns.animation.orchestrator(options).plan(map); },
    /** API de integración para librerías externas. */
    registerExternal: function (id, elements, properties, options) {
      var els = typeof elements === 'string' ? Array.prototype.slice.call(document.querySelectorAll(elements)) : elements;
      return ns.animation.orchestrator().resolver.registerExternal(id, els, properties, options);
    },
    releaseExternal: function (id) { return ns.animation.orchestrator().resolver.release(id); },
    active: function () { return current ? current.active() : []; },
    stop: function (name) { return current ? current.stop(name) : false; },
    stopAll: function () { if (current) current.stopAll(); },
  };
  return ns.animation;
})(typeof window !== 'undefined' ? window : globalThis);
`;
  cached = source;
  return source;
}

/**
 * Escribe el runtime en disco.
 * @param file Ruta de destino (`.js`).
 */
export function writeRuntimeScript(file: string): string {
  const abs = path.resolve(file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buildRuntimeScript(), 'utf8');
  return abs;
}
