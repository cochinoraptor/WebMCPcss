/* WebMCPcss animation runtime — generado automáticamente */
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
  define("./types", function (exports, require) {
/**
 * Tipos del estándar de animaciones de WebMCPcss (v0.8.0).
 *
 * Una animación se declara en un `.webmcp.css` con propiedades
 * `webmcp-animation-*` y se materializa en el navegador mediante uno de los
 * motores disponibles (CSS, Web Animations API o Three.js). El orquestador
 * decide el motor, gestiona colas por prioridad y resuelve conflictos entre
 * animaciones propias y de terceros (GSAP, Anime.js, CSS existente...).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANIMATION_TRIGGERS = exports.CONFLICT_STRATEGIES = exports.ANIMATION_PRIORITIES = exports.ANIMATION_TYPES = exports.PRIORITY_ORDER = void 0;
/** Orden numérico de prioridades. */
exports.PRIORITY_ORDER = {
    low: 0,
    normal: 1,
    high: 2,
    critical: 3,
};
/** Tipos válidos (para validación). */
exports.ANIMATION_TYPES = [
    'parallax',
    'isometric',
    '3d-transform',
    'keyframes',
    'three-scene',
];
/** Prioridades válidas. */
exports.ANIMATION_PRIORITIES = [
    'low',
    'normal',
    'high',
    'critical',
];
/** Estrategias válidas. */
exports.CONFLICT_STRATEGIES = [
    'replace',
    'queue',
    'ignore',
    'merge',
];
/** Disparadores válidos. */
exports.ANIMATION_TRIGGERS = [
    'load',
    'scroll',
    'hover',
    'click',
    'visible',
    'manual',
];

  });
  define("./engine/base-engine", function (exports, require) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANIMATION_ID_PREFIX = exports.ELEMENT_ID_ATTR = void 0;
exports.ensureElementId = ensureElementId;
exports.toKebab = toKebab;
exports.toCamel = toCamel;
exports.toMs = toMs;
exports.keyframeProperties = keyframeProperties;
exports.buildTransform = buildTransform;
exports.keyframesFor = keyframesFor;
exports.propertiesOf = propertiesOf;
exports.finalState = finalState;
exports.applyInline = applyInline;
exports.queryAll = queryAll;
exports.never = never;
exports.deferred = deferred;
/** Atributo con el identificador estable de un elemento animado. */
exports.ELEMENT_ID_ATTR = 'data-webmcp-anim-id';
/** Prefijo de los identificadores de animaciones WAAPI creadas por WebMCPcss. */
exports.ANIMATION_ID_PREFIX = 'webmcpcss:';
/** Claves de un fotograma que NO son propiedades CSS. */
const KEYFRAME_META = new Set(['offset', 'easing', 'composite', 'computedOffset']);
let idCounter = 0;
/**
 * Devuelve (creando si hace falta) un identificador estable para el elemento,
 * persistido en un atributo `data-*` para sobrevivir a serializaciones.
 */
function ensureElementId(el) {
    let id = el.getAttribute(exports.ELEMENT_ID_ATTR);
    if (!id) {
        id = `wa${++idCounter}`;
        el.setAttribute(exports.ELEMENT_ID_ATTR, id);
    }
    return id;
}
/** `backgroundColor` → `background-color`. */
function toKebab(prop) {
    if (prop.startsWith('--'))
        return prop;
    return prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^ms-/, '-ms-');
}
/** `background-color` → `backgroundColor`. */
function toCamel(prop) {
    if (prop.startsWith('--'))
        return prop;
    return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
/** Convierte una duración (`1.5s`, `300ms`, número en ms) a milisegundos. */
function toMs(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value === 'number')
        return Number.isFinite(value) && value >= 0 ? value : fallback;
    const m = /^\s*([\d.]+)\s*(ms|s)?\s*$/i.exec(value);
    if (!m)
        return fallback;
    const n = Number(m[1]);
    if (!Number.isFinite(n))
        return fallback;
    return (m[2] ?? 'ms').toLowerCase() === 's' ? n * 1000 : n;
}
/** Propiedades CSS (kebab-case) presentes en una lista de fotogramas. */
function keyframeProperties(keyframes) {
    const props = new Set();
    for (const kf of keyframes) {
        for (const key of Object.keys(kf)) {
            if (KEYFRAME_META.has(key) || kf[key] === undefined)
                continue;
            props.add(toKebab(key));
        }
    }
    return [...props];
}
/** Transformación CSS final de una animación isométrica o 3D. */
function buildTransform(config) {
    const p = config.parameters;
    const parts = [];
    if (p.perspective)
        parts.push(`perspective(${p.perspective})`);
    if (config.type === 'isometric') {
        parts.push(`rotateX(${p.rotationX ?? '60deg'})`);
        if (p.rotationY)
            parts.push(`rotateY(${p.rotationY})`);
        parts.push(`rotateZ(${p.rotationZ ?? '-45deg'})`);
    }
    else {
        if (p.rotationX)
            parts.push(`rotateX(${p.rotationX})`);
        if (p.rotationY)
            parts.push(`rotateY(${p.rotationY})`);
        if (p.rotationZ)
            parts.push(`rotateZ(${p.rotationZ})`);
        if (!p.rotationX && !p.rotationY && !p.rotationZ && !p.translationZ && !p.scale) {
            parts.push('rotateY(25deg)');
        }
    }
    if (p.translationZ)
        parts.push(`translateZ(${p.translationZ})`);
    if (typeof p.scale === 'number')
        parts.push(`scale(${p.scale})`);
    return parts.join(' ');
}
/**
 * Fotogramas equivalentes a la animación (keyframes explícitos o generados
 * para `isometric`/`3d-transform`). Los nombres quedan en kebab-case.
 */
function keyframesFor(config) {
    if (config.type === 'keyframes') {
        return (config.parameters.keyframes ?? []).map((kf) => {
            const out = {};
            for (const [k, v] of Object.entries(kf)) {
                if (v === undefined)
                    continue;
                out[KEYFRAME_META.has(k) ? k : toKebab(k)] = v;
            }
            return out;
        });
    }
    if (config.type === 'isometric' || config.type === '3d-transform') {
        const base = { transform: 'none' };
        const final = { transform: buildTransform(config) };
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
function propertiesOf(config) {
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
function finalState(keyframes) {
    const out = {};
    for (const kf of keyframes) {
        for (const [k, v] of Object.entries(kf)) {
            if (KEYFRAME_META.has(k) || v === undefined)
                continue;
            out[toKebab(k)] = String(v);
        }
    }
    return out;
}
/** Aplica estilos inline a un elemento (helper común). */
function applyInline(el, styles) {
    const style = el.style;
    if (!style)
        return;
    for (const [prop, value] of Object.entries(styles))
        style.setProperty(prop, value);
}
/** Resuelve la lista de elementos de un selector dentro de un documento. */
function queryAll(doc, selector) {
    try {
        return Array.from(doc.querySelectorAll(selector));
    }
    catch {
        return [];
    }
}
/** Promesa que nunca se resuelve (animaciones infinitas/continuas). */
function never() {
    return new Promise(() => undefined);
}
/**
 * Crea un `Promise<void>` con su `resolve` accesible (equivalente a
 * `Promise.withResolvers`, que no existe en Node 18).
 */
function deferred() {
    let resolve = () => undefined;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

  });
  define("./config-validation", function (exports, require) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnimationConfigError = void 0;
exports.parseDuration = parseDuration;
exports.validateConfig = validateConfig;
/** Error de configuración de una animación. */
class AnimationConfigError extends Error {
    constructor(message, line) {
        super(message);
        this.line = line;
        this.name = 'AnimationConfigError';
    }
}
exports.AnimationConfigError = AnimationConfigError;
/**
 * Convierte una duración CSS (`1.5s`, `300ms`) o un número (ms) a milisegundos.
 * @returns Milisegundos o `null` si no es válida.
 */
function parseDuration(value) {
    if (value === undefined || value === null)
        return null;
    if (typeof value === 'number')
        return Number.isFinite(value) && value >= 0 ? value : null;
    const m = /^\s*([\d.]+)\s*(ms|s)?\s*$/i.exec(value);
    if (!m)
        return null;
    const n = Number(m[1]);
    if (!Number.isFinite(n))
        return null;
    return (m[2] ?? 'ms').toLowerCase() === 's' ? n * 1000 : n;
}
/**
 * Comprueba la coherencia de una configuración. Los problemas graves lanzan
 * {@link AnimationConfigError}; los leves se añaden a `warnings`.
 *
 * @param config Configuración a validar.
 * @param warnings Lista donde acumular avisos no bloqueantes.
 */
function validateConfig(config, warnings) {
    const p = config.parameters;
    const where = `"${config.name}"`;
    const fail = (msg) => {
        throw new AnimationConfigError(`${where}: ${msg}`, config.line);
    };
    switch (config.type) {
        case 'parallax':
            if (!p.layers || p.layers.length === 0) {
                fail('una animación parallax requiere "layers" (webmcp-animation-layers o params.layers)');
            }
            for (const layer of p.layers ?? []) {
                if (!layer.selector ||
                    typeof layer.speed !== 'number' ||
                    !Number.isFinite(layer.speed)) {
                    fail('cada capa necesita "selector" y "speed" numérico');
                }
                if (layer.speed < 0 || layer.speed > 1) {
                    warnings.push(`${where}: la capa ${layer.selector} tiene speed ${layer.speed} fuera de 0–1.`);
                }
            }
            if (config.engine === 'three') {
                warnings.push(`${where}: parallax con motor three se ejecutará como escena 2.5D.`);
            }
            break;
        case 'keyframes':
            if (!Array.isArray(p.keyframes) || p.keyframes.length === 0) {
                fail('una animación keyframes requiere "keyframes" (array con al menos un fotograma)');
            }
            for (const kf of p.keyframes ?? []) {
                if (!kf || typeof kf !== 'object')
                    fail('cada fotograma debe ser un objeto');
                if (kf.offset !== undefined && (kf.offset < 0 || kf.offset > 1)) {
                    fail(`offset ${String(kf.offset)} fuera de 0–1`);
                }
            }
            if (config.engine === 'three')
                fail('el motor three no soporta keyframes DOM; usa css o waapi');
            break;
        case 'three-scene':
            if (!p.sceneConfig ||
                !Array.isArray(p.sceneConfig.layers) ||
                !p.sceneConfig.layers.length) {
                fail('una animación three-scene requiere "sceneConfig.layers" (webmcp-animation-scene)');
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
            if (config.type === '3d-transform' &&
                !p.rotationX &&
                !p.rotationY &&
                !p.rotationZ &&
                !p.translationZ &&
                p.scale === undefined) {
                warnings.push(`${where}: 3d-transform sin rotación/traslación; se aplicará rotateY(25deg) por defecto.`);
            }
            break;
        default:
            fail(`tipo desconocido "${String(config.type)}"`);
    }
    if (p.duration !== undefined && parseDuration(p.duration) === null) {
        fail(`duración inválida "${String(p.duration)}"`);
    }
    if (p.delay !== undefined && parseDuration(p.delay) === null) {
        fail(`retardo inválido "${String(p.delay)}"`);
    }
    if (p.iterations !== undefined &&
        p.iterations !== 'infinite' &&
        (typeof p.iterations !== 'number' || p.iterations < 0)) {
        fail(`iteraciones inválidas "${String(p.iterations)}"`);
    }
    if (config.sandbox === 'shadow' && config.type !== 'three-scene') {
        warnings.push(`${where}: el sandbox shadow solo aísla motores con nodos propios (three-scene).`);
    }
}

  });
  define("./capabilities", function (exports, require) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectLibraries = detectLibraries;
exports.detectCapabilities = detectCapabilities;
/** Librerías conocidas: global → identificador legible. */
const KNOWN_LIBRARIES = [
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
function detectLibraries(win) {
    const w = win;
    const found = new Map();
    for (const lib of KNOWN_LIBRARIES) {
        const value = w[lib.global];
        if (value === undefined || value === null)
            continue;
        if (found.has(lib.id))
            continue;
        const entry = { id: lib.id, name: lib.name };
        if (lib.version && (typeof value === 'object' || typeof value === 'function')) {
            const v = value[lib.version];
            if (typeof v === 'string' || typeof v === 'number')
                entry.version = String(v);
        }
        found.set(lib.id, entry);
    }
    return [...found.values()];
}
/** `CSS.supports` con tolerancia a entornos sin `CSS`. */
function supports(win, prop, value, fallback) {
    const css = win.CSS;
    if (css && typeof css.supports === 'function') {
        try {
            return css.supports(prop, value);
        }
        catch {
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
function detectCapabilities(win, overrides = {}) {
    const w = win;
    const elementProto = w.Element
        ?.prototype;
    const waapi = typeof elementProto?.animate === 'function';
    const hasWebGLCtor = 'WebGLRenderingContext' in w || 'WebGL2RenderingContext' in w;
    let webgl = false;
    if (hasWebGLCtor) {
        try {
            const canvas = win.document.createElement('canvas');
            webgl = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
        }
        catch {
            webgl = false;
        }
    }
    let reducedMotion = false;
    try {
        reducedMotion =
            typeof win.matchMedia === 'function' &&
                win.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    }
    catch {
        reducedMotion = false;
    }
    const caps = {
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

  });
  define("./engine/css-engine", function (exports, require) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.CssEngine = exports.STYLE_ATTR = void 0;
exports.keyframesToCss = keyframesToCss;
exports.classRuleCss = classRuleCss;
const base_engine_1 = require("./base-engine");
/** Atributo del `<style>` que inyecta este motor. */
exports.STYLE_ATTR = 'data-webmcp-animation';
/** Prefijo de clases generadas. */
const CLASS_PREFIX = 'webmcp-anim-';
/** Clase marcadora en elementos con parallax gestionado por CSS engine. */
const PARALLAX_CLASS = 'webmcp-parallax-layer';
/** Genera un nombre CSS seguro a partir del nombre de la animación. */
function cssName(name) {
    return `${CLASS_PREFIX}${name.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}
/** Devuelve (creando si hace falta) la hoja de estilos del motor. */
function styleElement(doc) {
    let style = doc.querySelector(`style[${exports.STYLE_ATTR}]`);
    if (!style) {
        style = doc.createElement('style');
        style.setAttribute(exports.STYLE_ATTR, '');
        (doc.head ?? doc.documentElement).appendChild(style);
    }
    return style;
}
/**
 * Serializa fotogramas a un bloque `@keyframes`. Si los fotogramas no traen
 * `offset`, se reparten uniformemente.
 */
function keyframesToCss(name, config) {
    const frames = (0, base_engine_1.keyframesFor)(config);
    const n = frames.length;
    const rows = frames.map((kf, i) => {
        const offset = typeof kf.offset === 'number' ? kf.offset : n === 1 ? 1 : i / Math.max(1, n - 1);
        const decls = Object.entries(kf)
            .filter(([k, v]) => k !== 'offset' && k !== 'easing' && k !== 'composite' && v !== undefined)
            .map(([k, v]) => `${k}: ${String(v)};`);
        if (kf.easing)
            decls.push(`animation-timing-function: ${kf.easing};`);
        return `  ${Math.round(offset * 10000) / 100}% { ${decls.join(' ')} }`;
    });
    return `@keyframes ${name} {\n${rows.join('\n')}\n}`;
}
/** Regla de la clase que aplica la animación. */
function classRuleCss(name, config) {
    const p = config.parameters;
    const duration = (0, base_engine_1.toMs)(p.duration, 1000);
    const delay = (0, base_engine_1.toMs)(p.delay, 0);
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
    if (config.type === 'isometric')
        decls.push('transform-style: preserve-3d');
    if (p.perspective && config.type !== 'isometric')
        decls.push(`perspective: ${p.perspective}`);
    return `.${name} { ${decls.join('; ')}; }`;
}
/** Motor basado en hojas de estilo CSS. */
class CssEngine {
    constructor() {
        this.id = 'css';
    }
    /** @inheritdoc */
    supports(config, caps) {
        if (config.type === 'three-scene')
            return 'three-scene requiere el motor three';
        if (!caps.cssAnimations && config.type !== 'parallax') {
            return 'el navegador no soporta animaciones CSS';
        }
        if (config.type === 'isometric' && !caps.preserve3d) {
            return 'el navegador no soporta transform-style: preserve-3d';
        }
        return true;
    }
    /** @inheritdoc */
    propertiesFor(config) {
        return (0, base_engine_1.propertiesOf)(config);
    }
    /** @inheritdoc */
    async execute(config, elements, ctx) {
        if (config.type === 'parallax')
            return this.executeParallax(config, elements, ctx);
        const name = cssName(config.name);
        const frames = (0, base_engine_1.keyframesFor)(config);
        const properties = (0, base_engine_1.keyframeProperties)(frames);
        for (const el of elements)
            (0, base_engine_1.ensureElementId)(el);
        if (ctx.reducedMotion) {
            const final = (0, base_engine_1.finalState)(frames);
            for (const el of elements)
                (0, base_engine_1.applyInline)(el, final);
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
            void el.offsetWidth; // fuerza reflow para reiniciar la animación
            el.classList.add(name);
        }
        const total = config.parameters.iterations === 'infinite'
            ? Infinity
            : (0, base_engine_1.toMs)(config.parameters.delay, 0) +
                (0, base_engine_1.toMs)(config.parameters.duration, 1000) *
                    Number(config.parameters.iterations ?? 1);
        let finished;
        let timer;
        if (!Number.isFinite(total))
            finished = (0, base_engine_1.never)();
        else {
            const d = (0, base_engine_1.deferred)();
            timer = setTimeout(d.resolve, total + 16);
            finished = d.promise;
        }
        return {
            properties,
            finished,
            details: { className: name, elements: elements.length },
            stop: () => {
                if (timer)
                    clearTimeout(timer);
                for (const el of elements)
                    el.classList.remove(name);
            },
        };
    }
    /** Parallax por scroll: cada capa se desplaza según `speed`. */
    async executeParallax(config, elements, ctx) {
        const layers = config.parameters.layers ?? [];
        const scopeRoots = elements.length ? elements : [ctx.doc.documentElement];
        const resolved = [];
        for (const layer of layers) {
            for (const root of scopeRoots) {
                const inRoot = (0, base_engine_1.queryAll)(root, layer.selector);
                const found = inRoot.length ? inRoot : (0, base_engine_1.queryAll)(ctx.doc, layer.selector);
                for (const el of found) {
                    (0, base_engine_1.ensureElementId)(el);
                    resolved.push({
                        el: el,
                        speed: layer.speed,
                        depth: layer.depth,
                    });
                }
            }
        }
        const properties = ['transform'];
        if (resolved.length === 0) {
            throw new Error(`parallax "${config.name}": ninguna capa coincide (${layers.map((l) => l.selector).join(', ')})`);
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
        const target = container ?? ctx.win;
        const scrollY = () => container
            ? container.scrollTop
            : ctx.win.scrollY || ctx.win.pageYOffset || 0;
        let raf = 0;
        const update = () => {
            raf = 0;
            const y = scrollY();
            for (const { el, speed, depth } of resolved) {
                // Las capas lentas (speed→0) se mueven en contra del scroll para
                // parecer lejanas; speed=1 se mueve con el contenido (sin offset).
                const offset = Math.round(y * (1 - speed) * 100) / 100;
                el.style.transform = `translate3d(0, ${offset}px, ${depth ?? '0'})`;
            }
        };
        const onScroll = () => {
            if (raf)
                return;
            raf = ctx.win.requestAnimationFrame ? ctx.win.requestAnimationFrame(update) : 1;
            if (!ctx.win.requestAnimationFrame)
                update();
        };
        target.addEventListener('scroll', onScroll, { passive: true });
        update();
        return {
            properties,
            finished: (0, base_engine_1.never)(),
            details: { layers: resolved.length, container: containerSel ?? 'window' },
            stop: () => {
                target.removeEventListener('scroll', onScroll);
                if (raf && ctx.win.cancelAnimationFrame)
                    ctx.win.cancelAnimationFrame(raf);
                for (const { el } of resolved) {
                    el.style.transform = '';
                    el.style.willChange = '';
                    el.classList.remove(PARALLAX_CLASS);
                }
            },
        };
    }
    /** @inheritdoc */
    async cleanup(element) {
        for (const cls of Array.from(element.classList)) {
            if (cls.startsWith(CLASS_PREFIX) || cls === PARALLAX_CLASS)
                element.classList.remove(cls);
        }
        const style = element.style;
        if (style) {
            style.removeProperty('transform');
            style.removeProperty('will-change');
        }
    }
}
exports.CssEngine = CssEngine;

  });
  define("./engine/waapi-engine", function (exports, require) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.WaapiEngine = void 0;
exports.toWaapiKeyframes = toWaapiKeyframes;
exports.toWaapiTiming = toWaapiTiming;
const base_engine_1 = require("./base-engine");
/** Fotogramas en el formato que espera `Element.animate` (camelCase). */
function toWaapiKeyframes(config) {
    return (0, base_engine_1.keyframesFor)(config).map((kf) => {
        const out = {};
        for (const [k, v] of Object.entries(kf)) {
            if (v === undefined)
                continue;
            if (k === 'offset' || k === 'easing' || k === 'composite')
                out[k] = v;
            else if (k.startsWith('--'))
                out[k] = v;
            else
                out[(0, base_engine_1.toCamel)(k)] = v;
        }
        return out;
    });
}
/** Opciones de tiempo para `Element.animate`. */
function toWaapiTiming(config, composite = 'replace') {
    const p = config.parameters;
    return {
        id: `${base_engine_1.ANIMATION_ID_PREFIX}${config.name}`,
        duration: (0, base_engine_1.toMs)(p.duration, 1000),
        delay: (0, base_engine_1.toMs)(p.delay, 0),
        easing: p.easing ?? 'ease',
        iterations: p.iterations === 'infinite' ? Infinity : Number(p.iterations ?? 1),
        direction: p.direction ?? 'normal',
        fill: p.fill ?? 'forwards',
        composite,
    };
}
/** Motor basado en la Web Animations API. */
class WaapiEngine {
    constructor() {
        this.id = 'waapi';
    }
    /** @inheritdoc */
    supports(config, caps) {
        if (!caps.waapi)
            return 'Element.animate() no disponible';
        if (config.type === 'three-scene')
            return 'three-scene requiere el motor three';
        if (config.type === 'parallax' && !caps.scrollTimeline) {
            return 'parallax por WAAPI requiere ScrollTimeline (usa el motor css)';
        }
        if (config.type === 'isometric' && !caps.preserve3d) {
            return 'el navegador no soporta transform-style: preserve-3d';
        }
        return true;
    }
    /** @inheritdoc */
    propertiesFor(config) {
        return (0, base_engine_1.propertiesOf)(config);
    }
    /** @inheritdoc */
    async execute(config, elements, ctx) {
        if (config.type === 'parallax')
            return this.executeParallax(config, elements, ctx);
        const frames = (0, base_engine_1.keyframesFor)(config);
        const properties = (0, base_engine_1.keyframeProperties)(frames);
        for (const el of elements)
            (0, base_engine_1.ensureElementId)(el);
        if (config.type === 'isometric') {
            for (const el of elements)
                (0, base_engine_1.applyInline)(el, { 'transform-style': 'preserve-3d' });
        }
        if (config.parameters.perspective && config.type !== 'isometric') {
            for (const el of elements)
                (0, base_engine_1.applyInline)(el, { perspective: String(config.parameters.perspective) });
        }
        if (ctx.reducedMotion) {
            const final = (0, base_engine_1.finalState)(frames);
            for (const el of elements)
                (0, base_engine_1.applyInline)(el, final);
            return {
                properties,
                finished: Promise.resolve(),
                stop: () => undefined,
                details: { reducedMotion: true },
            };
        }
        const keyframes = toWaapiKeyframes(config);
        const timing = toWaapiTiming(config, ctx.composite ?? 'replace');
        const animations = [];
        for (const el of elements) {
            const anim = el.animate(keyframes, timing);
            animations.push(anim);
        }
        const finished = Promise.all(animations.map((a) => a.finished.then(() => undefined, () => undefined))).then(() => undefined);
        return {
            properties,
            finished,
            details: { animations: animations.length, composite: timing.composite },
            stop: () => {
                for (const a of animations) {
                    try {
                        a.cancel();
                    }
                    catch {
                        /* ya cancelada */
                    }
                }
            },
        };
    }
    /** Parallax con `ScrollTimeline` (Chrome 115+). */
    async executeParallax(config, elements, ctx) {
        const Ctor = ctx.win
            .ScrollTimeline;
        if (!Ctor)
            throw new Error('ScrollTimeline no disponible');
        const containerSel = config.parameters.scrollContainer;
        const source = containerSel
            ? ctx.doc.querySelector(containerSel)
            : (ctx.doc.scrollingElement ?? ctx.doc.documentElement);
        const timeline = new Ctor({ source, axis: 'block' });
        const roots = elements.length ? elements : [ctx.doc.documentElement];
        const animations = [];
        const scrollRange = Math.max(1, source?.scrollHeight ??
            ctx.doc.documentElement.scrollHeight);
        for (const layer of config.parameters.layers ?? []) {
            for (const root of roots) {
                const inRoot = (0, base_engine_1.queryAll)(root, layer.selector);
                const found = inRoot.length ? inRoot : (0, base_engine_1.queryAll)(ctx.doc, layer.selector);
                for (const el of found) {
                    (0, base_engine_1.ensureElementId)(el);
                    if (ctx.reducedMotion)
                        continue;
                    const offset = scrollRange * (1 - layer.speed);
                    animations.push(el.animate([
                        { transform: `translate3d(0, 0, ${layer.depth ?? '0'})` },
                        { transform: `translate3d(0, ${offset}px, ${layer.depth ?? '0'})` },
                    ], { id: `${base_engine_1.ANIMATION_ID_PREFIX}${config.name}`, timeline, fill: 'both' }));
                }
            }
        }
        return {
            properties: ['transform'],
            finished: new Promise(() => undefined),
            details: { animations: animations.length, timeline: 'scroll' },
            stop: () => {
                for (const a of animations)
                    a.cancel();
            },
        };
    }
    /** @inheritdoc */
    async cleanup(element) {
        const getAnimations = element
            .getAnimations;
        if (typeof getAnimations === 'function') {
            for (const a of getAnimations.call(element)) {
                if (a.id?.startsWith(base_engine_1.ANIMATION_ID_PREFIX))
                    a.cancel();
            }
        }
    }
}
exports.WaapiEngine = WaapiEngine;

  });
  define("./engine/three-engine", function (exports, require) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.ThreeEngine = exports.THREE_HOST_ATTR = exports.DEFAULT_THREE_URL = void 0;
exports.loadThree = loadThree;
exports.normalizeScene = normalizeScene;
const base_engine_1 = require("./base-engine");
/** URL por defecto del módulo ESM de Three.js. */
exports.DEFAULT_THREE_URL = 'https://unpkg.com/three@0.160.0/build/three.module.js';
/** Atributo del contenedor que crea este motor. */
exports.THREE_HOST_ATTR = 'data-webmcp-three';
/**
 * Obtiene Three.js: global `window.THREE` o import dinámico del módulo ESM.
 * @param win Ventana.
 * @param moduleUrl URL del módulo (por defecto {@link DEFAULT_THREE_URL}).
 */
async function loadThree(win, moduleUrl = exports.DEFAULT_THREE_URL) {
    const existing = win.THREE;
    if (existing?.WebGLRenderer)
        return existing;
    // `new Function` evita que TypeScript/CommonJS reescriban el import dinámico.
    const importer = new Function('u', 'return import(u)');
    let mod;
    try {
        mod = await importer(moduleUrl);
    }
    catch (err) {
        throw new Error(`No se pudo cargar Three.js desde ${moduleUrl} (${err.message}). ` +
            'Incluye three en la página (window.THREE) o indica moduleUrl en sceneConfig.');
    }
    const three = mod.default ?? mod;
    if (!three?.WebGLRenderer) {
        throw new Error(`El módulo ${moduleUrl} no expone Three.js (falta WebGLRenderer)`);
    }
    return three;
}
/** Normaliza la configuración de escena con valores por defecto. */
function normalizeScene(config) {
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
        moduleUrl: scene.moduleUrl ?? exports.DEFAULT_THREE_URL,
        maxPixelRatio: scene.maxPixelRatio ?? 2,
        layers,
    };
}
/** Motor de escenas 2.5D con Three.js. */
class ThreeEngine {
    constructor() {
        this.id = 'three';
    }
    /** @inheritdoc */
    supports(config, caps) {
        if (config.type !== 'three-scene' && config.type !== 'parallax') {
            return `el motor three no aplica a ${config.type}`;
        }
        if (!caps.webgl)
            return 'WebGL no disponible';
        return true;
    }
    /** @inheritdoc */
    propertiesFor(config) {
        return config.type === 'three-scene' ? (0, base_engine_1.propertiesOf)(config) : ['scene'];
    }
    /** @inheritdoc */
    async execute(config, elements, ctx) {
        const host = elements[0];
        if (!host)
            throw new Error(`three-scene "${config.name}": sin elemento contenedor`);
        (0, base_engine_1.ensureElementId)(host);
        const scene = normalizeScene(config);
        const THREE = await loadThree(ctx.win, scene.moduleUrl);
        // Contenedor del canvas (opcionalmente aislado en Shadow DOM).
        const mount = ctx.doc.createElement('div');
        mount.setAttribute(exports.THREE_HOST_ATTR, config.name);
        mount.style.cssText =
            'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:0;';
        const hostStyle = ctx.win.getComputedStyle(host);
        if (!hostStyle.position || hostStyle.position === 'static')
            host.style.position = 'relative';
        let root = host;
        if (ctx.sandbox === 'shadow' && ctx.capabilities.shadowDom) {
            const shadowHost = ctx.doc.createElement('div');
            shadowHost.setAttribute(exports.THREE_HOST_ATTR, `${config.name}-shadow`);
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
        const camera = scene.camera === 'perspective'
            ? new THREE.PerspectiveCamera(50, aspect, 0.1, 1000)
            : new THREE.OrthographicCamera((-viewH * aspect) / 2, (viewH * aspect) / 2, viewH / 2, -viewH / 2, 0.1, 1000);
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
        const meshes = [];
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
            mesh.position.set(layer.position?.x ?? 0, layer.position?.y ?? 0, layer.position?.z ?? -i);
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
        const onMove = (ev) => {
            const e = ev;
            const rect = host.getBoundingClientRect();
            pointerX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
            pointerY = -(((e.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
        };
        const onScroll = () => {
            const max = Math.max(1, ctx.doc.documentElement.scrollHeight - ctx.win.innerHeight);
            scrollT = (ctx.win.scrollY || 0) / max;
        };
        const useMouse = scene.interaction === 'mouse' || scene.interaction === 'both';
        const useScroll = scene.interaction === 'scroll' || scene.interaction === 'both';
        if (useMouse)
            host.addEventListener('mousemove', onMove, { passive: true });
        if (useScroll)
            ctx.win.addEventListener('scroll', onScroll, { passive: true });
        const onResize = () => {
            const w2 = Math.max(1, host.clientWidth || width);
            const h2 = Math.max(1, host.clientHeight || height);
            const a2 = w2 / h2;
            if (scene.camera === 'perspective')
                camera.aspect = a2;
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
        const tick = () => {
            if (stopped)
                return;
            const now = ctx.win.performance?.now?.() ?? Date.now();
            const dt = (now - last) / 1000;
            last = now;
            for (const mesh of meshes) {
                const { baseX, baseY, parallax, spin } = mesh.userData;
                if (!reduced) {
                    const px = useMouse ? pointerX * parallax * (viewH / 4) : 0;
                    const py = useMouse ? pointerY * parallax * (viewH / 4) : 0;
                    const sy = useScroll ? scrollT * parallax * viewH : 0;
                    mesh.position.x = baseX + px;
                    mesh.position.y = baseY + py + sy;
                    if (spin)
                        mesh.rotation.z += spin * dt;
                }
            }
            renderer.render(three, camera);
            if (!reduced)
                raf = ctx.win.requestAnimationFrame(tick);
        };
        tick();
        const duration = (0, base_engine_1.toMs)(config.parameters.duration, 0);
        let finished = (0, base_engine_1.never)();
        let timer;
        const stop = () => {
            if (stopped)
                return;
            stopped = true;
            if (raf)
                ctx.win.cancelAnimationFrame(raf);
            if (timer)
                clearTimeout(timer);
            if (useMouse)
                host.removeEventListener('mousemove', onMove);
            if (useScroll)
                ctx.win.removeEventListener('scroll', onScroll);
            ctx.win.removeEventListener('resize', onResize);
            for (const mesh of meshes) {
                three.remove(mesh);
                mesh.geometry?.dispose();
                mesh.material?.dispose();
            }
            renderer.dispose();
            mount.remove();
            const shadowHost = host.querySelector(`[${exports.THREE_HOST_ATTR}="${config.name}-shadow"]`);
            shadowHost?.remove();
        };
        if (duration > 0 && !reduced) {
            finished = new Promise((resolve) => {
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
                sandbox: ctx.sandbox === 'shadow' && ctx.capabilities.shadowDom ? 'shadow' : 'none',
                reducedMotion: reduced,
            },
        };
    }
    /** @inheritdoc */
    async cleanup(element) {
        for (const node of Array.from(element.querySelectorAll(`[${exports.THREE_HOST_ATTR}]`)))
            node.remove();
    }
}
exports.ThreeEngine = ThreeEngine;

  });
  define("./conflict-resolver", function (exports, require) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConflictResolver = void 0;
exports.cssAnimatedProperties = cssAnimatedProperties;
/**
 * Resolutor de conflictos entre animaciones.
 *
 * Mantiene un registro `elemento → propiedades animadas → animación` que
 * incluye tanto las animaciones de WebMCPcss como las **externas**
 * (CSS/WAAPI ya presentes en la página, GSAP, Anime.js…, notificadas por
 * la API `registerExternal()` o detectadas por `scanExternal()`).
 *
 * Reglas de decisión (para cada propiedad en disputa):
 * - Sin solapamiento → `execute`.
 * - Nueva prioridad **mayor** que todas las activas → `replace`
 *   (se detienen las anteriores; las externas no se pueden detener: se
 *   sobrescriben y se avisa).
 * - Prioridad **menor** → `ignore` si la estrategia es `ignore`/`replace`
 *   (no se pisa a un superior), `queue` si es `queue`, `merge` solo si las
 *   propiedades son disjuntas o las animaciones son componibles.
 * - Prioridad **igual** → la estrategia configurada (`queue` por defecto).
 * - `merge` con la misma propiedad `transform`/`opacity` en WAAPI → se
 *   ejecuta con `composite: 'add'`; en otro caso se degrada a `queue`.
 */
const types_1 = require("./types");
const base_engine_1 = require("./engine/base-engine");
/** Propiedades que WAAPI puede componer aditivamente. */
const COMPOSABLE = new Set(['transform', 'translate', 'rotate', 'scale', 'opacity']);
/** Registro y decisión de conflictos entre animaciones. */
class ConflictResolver {
    constructor(options = {}) {
        this.active = new Map();
        this.strategy = options.strategy ?? 'queue';
    }
    /** Animaciones activas (propias y externas). */
    list() {
        return [...this.active.values()];
    }
    /** Busca una animación activa por id. */
    get(id) {
        return this.active.get(id);
    }
    /** Registra una animación propia como activa. */
    register(entry) {
        const full = {
            ...entry,
            source: entry.source ?? 'webmcpcss',
            properties: entry.properties.map(base_engine_1.toKebab),
            since: Date.now(),
        };
        this.active.set(full.id, full);
        return full;
    }
    /**
     * API de integración: otra librería (o el propio sitio) declara que está
     * animando ciertos elementos/propiedades para que el orquestador lo tenga
     * en cuenta.
     *
     * @param id Identificador único de la animación externa.
     * @param elements Elementos o identificadores de elementos.
     * @param properties Propiedades CSS animadas.
     * @param options Librería y prioridad (por defecto `high`).
     */
    registerExternal(id, elements, properties, options = {}) {
        const ids = elements.map((e) => (typeof e === 'string' ? e : (0, base_engine_1.ensureElementId)(e)));
        return this.register({
            id,
            source: 'external',
            library: options.library ?? 'external',
            priority: options.priority ?? 'high',
            elements: ids,
            properties,
            selector: options.selector,
        });
    }
    /** Elimina una animación del registro. */
    release(id) {
        return this.active.delete(id);
    }
    /**
     * Neutraliza una animación externa que va a ser sustituida: cancela las
     * `Animation` CSS/WAAPI ajenas del elemento sobre las propiedades en
     * disputa (las de GSAP/Anime.js no son cancelables desde fuera: solo se
     * sobrescriben visualmente) y libera su registro.
     *
     * @param win Ventana.
     * @param entry Animación externa a suprimir.
     * @returns Número de `Animation` canceladas.
     */
    suppressExternal(win, entry) {
        let cancelled = 0;
        const doc = win.document;
        for (const elId of entry.elements) {
            const el = doc.querySelector(`[${base_engine_1.ELEMENT_ID_ATTR}="${elId}"]`);
            if (!el)
                continue;
            if (entry.library === 'css') {
                // Evita que la regla del sitio vuelva a arrancar la animación.
                el.style.setProperty('animation-name', 'none', 'important');
            }
            const getAnims = el
                .getAnimations;
            if (typeof getAnims !== 'function')
                continue;
            for (const a of safeCall(() => getAnims.call(el)) ?? []) {
                if ((a.id ?? '').startsWith(base_engine_1.ANIMATION_ID_PREFIX))
                    continue;
                const name = a.animationName;
                if (entry.library === 'css' && name && !entry.id.startsWith(`css:${name}@`))
                    continue;
                safeCall(() => a.cancel());
                cancelled++;
            }
        }
        this.release(entry.id);
        return cancelled;
    }
    /** Vacía el registro (opcionalmente solo las externas). */
    clear(onlyExternal = false) {
        if (!onlyExternal) {
            this.active.clear();
            return;
        }
        for (const [id, a] of this.active)
            if (a.source === 'external')
                this.active.delete(id);
    }
    /**
     * Detecta animaciones ya presentes en la página (CSS `animation`,
     * `transition` en curso y WAAPI ajenas) sobre los elementos indicados y
     * las registra como externas.
     *
     * @param win Ventana.
     * @param elements Elementos a inspeccionar.
     * @param priority Prioridad asignada (por defecto `high`: se respetan).
     */
    scanExternal(win, elements, priority = 'high') {
        const registered = [];
        const libraries = new Set();
        const doc = win.document;
        const getAnims = doc
            .getAnimations;
        const docAnimations = typeof getAnims === 'function' ? (safeCall(() => getAnims.call(doc)) ?? []) : [];
        for (const el of elements) {
            const id = (0, base_engine_1.ensureElementId)(el);
            // 1) Animaciones CSS declaradas en la hoja de estilos del sitio.
            const cs = safeCall(() => win.getComputedStyle(el));
            const animName = cs?.animationName;
            if (animName && animName !== 'none' && !animName.startsWith('webmcp-anim-')) {
                const props = cssAnimatedProperties(doc, animName);
                registered.push(this.register({
                    id: `css:${animName}@${id}`,
                    source: 'external',
                    library: 'css',
                    priority,
                    elements: [id],
                    properties: props.length ? props : ['transform', 'opacity'],
                    selector: describe(el),
                }));
                libraries.add('css');
            }
            // 2) Transiciones activas (propiedad concreta).
            const transitionProp = cs?.transitionProperty;
            const transitionDur = cs?.transitionDuration;
            if (transitionProp &&
                transitionProp !== 'all' &&
                transitionProp !== 'none' &&
                transitionDur &&
                /[1-9]/.test(transitionDur)) {
                const props = transitionProp
                    .split(',')
                    .map((p) => p.trim())
                    .filter(Boolean);
                registered.push(this.register({
                    id: `transition@${id}`,
                    source: 'external',
                    library: 'css-transition',
                    priority: 'low',
                    elements: [id],
                    properties: props,
                    selector: describe(el),
                }));
            }
            // 3) WAAPI ajenas (GSAP no usa WAAPI, pero Motion One, Anime v4 y código propio sí).
            // Las CSSAnimation/CSSTransition ya se registraron arriba desde el
            // estilo computado: aquí solo interesan las WAAPI puras.
            const elAnims = docAnimations.filter((a) => {
                const target = a.effect?.target;
                if (target !== el || (a.id ?? '').startsWith(base_engine_1.ANIMATION_ID_PREFIX))
                    return false;
                const ctor = a.constructor?.name ?? '';
                const cssBacked = ctor === 'CSSAnimation' ||
                    ctor === 'CSSTransition' ||
                    'animationName' in a ||
                    'transitionProperty' in a;
                return !cssBacked;
            });
            elAnims.forEach((a, i) => {
                const effect = a.effect;
                const props = new Set();
                for (const kf of safeCall(() => effect?.getKeyframes()) ?? []) {
                    for (const k of Object.keys(kf)) {
                        if (['offset', 'computedOffset', 'easing', 'composite'].includes(k))
                            continue;
                        props.add((0, base_engine_1.toKebab)(k));
                    }
                }
                registered.push(this.register({
                    id: `waapi:${a.id || i}@${id}`,
                    source: 'external',
                    library: 'waapi',
                    priority,
                    elements: [id],
                    properties: [...props],
                    selector: describe(el),
                }));
                libraries.add('waapi');
            });
            // 4) Marcas de GSAP / Anime.js en el elemento.
            const gsapMark = el._gsap;
            if (gsapMark) {
                registered.push(this.register({
                    id: `gsap@${id}`,
                    source: 'external',
                    library: 'gsap',
                    priority,
                    elements: [id],
                    properties: ['transform', 'opacity'],
                    selector: describe(el),
                }));
                libraries.add('gsap');
            }
        }
        return { registered, libraries: [...libraries] };
    }
    /**
     * Decide qué hacer con una animación nueva.
     * @param request Animación entrante.
     */
    resolve(request) {
        const props = new Set(request.properties.map(base_engine_1.toKebab));
        const elements = new Set(request.elements);
        const conflicts = [];
        const disputed = new Set();
        for (const a of this.active.values()) {
            if (a.id === request.id)
                continue;
            if (!a.elements.some((e) => elements.has(e)))
                continue;
            const shared = a.properties.filter((p) => props.has(p) || (p === 'scene' && props.has('scene')));
            if (shared.length === 0)
                continue;
            conflicts.push(a);
            shared.forEach((p) => disputed.add(p));
        }
        if (conflicts.length === 0) {
            return { action: 'execute', conflictsWith: [], properties: [] };
        }
        const strategy = request.strategy ?? this.strategy;
        const mine = types_1.PRIORITY_ORDER[request.priority];
        const maxOther = Math.max(...conflicts.map((c) => types_1.PRIORITY_ORDER[c.priority]));
        const names = conflicts
            .map((c) => `${c.id} (${c.library}, ${c.priority})`)
            .join(', ');
        const properties = [...disputed];
        if (mine > maxOther) {
            return {
                action: 'replace',
                reason: `prioridad ${request.priority} > ${conflicts.map((c) => c.priority).join('/')}: sustituye a ${names}`,
                conflictsWith: conflicts,
                properties,
            };
        }
        if (strategy === 'merge') {
            const composable = properties.every((p) => COMPOSABLE.has(p));
            if (composable) {
                return {
                    action: 'merge',
                    reason: `fusión aditiva de ${properties.join(', ')} con ${names}`,
                    conflictsWith: conflicts,
                    properties,
                };
            }
            return {
                action: 'queue',
                reason: `no se puede fusionar ${properties.join(', ')} (no componible); se encola tras ${names}`,
                conflictsWith: conflicts,
                properties,
            };
        }
        if (mine < maxOther) {
            if (strategy === 'queue') {
                return {
                    action: 'queue',
                    reason: `prioridad ${request.priority} < ${conflicts.map((c) => c.priority).join('/')}: se encola tras ${names}`,
                    conflictsWith: conflicts,
                    properties,
                };
            }
            return {
                action: 'ignore',
                reason: `prioridad ${request.priority} < ${conflicts.map((c) => c.priority).join('/')}: se ignora (${names})`,
                conflictsWith: conflicts,
                properties,
            };
        }
        // Misma prioridad: manda la estrategia.
        if (strategy === 'replace') {
            return {
                action: 'replace',
                reason: `misma prioridad; estrategia replace sustituye a ${names}`,
                conflictsWith: conflicts,
                properties,
            };
        }
        if (strategy === 'ignore') {
            return {
                action: 'ignore',
                reason: `misma prioridad; estrategia ignore mantiene ${names}`,
                conflictsWith: conflicts,
                properties,
            };
        }
        return {
            action: 'queue',
            reason: `misma prioridad; se encola tras ${names}`,
            conflictsWith: conflicts,
            properties,
        };
    }
}
exports.ConflictResolver = ConflictResolver;
/** Ejecuta una función capturando excepciones (jsdom no implementa todo). */
function safeCall(fn) {
    try {
        return fn();
    }
    catch {
        return undefined;
    }
}
/** Descripción corta de un elemento para mensajes. */
function describe(el) {
    const id = el.getAttribute('id');
    if (id)
        return `#${id}`;
    const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0];
    const tag = el.tagName.toLowerCase();
    return cls
        ? `${tag}.${cls}`
        : `${tag}[${base_engine_1.ELEMENT_ID_ATTR}="${el.getAttribute(base_engine_1.ELEMENT_ID_ATTR)}"]`;
}
/**
 * Propiedades animadas por un `@keyframes` del sitio (buscando en las hojas
 * de estilo accesibles; las cross-origin se ignoran).
 */
function cssAnimatedProperties(doc, animationName) {
    const props = new Set();
    const sheets = safeCall(() => Array.from(doc.styleSheets)) ?? [];
    for (const sheet of sheets) {
        const rules = safeCall(() => Array.from(sheet.cssRules)) ?? [];
        for (const rule of rules) {
            const kf = rule;
            if (kf.type !== 7 /* KEYFRAMES_RULE */ || kf.name !== animationName)
                continue;
            for (const frame of Array.from(kf.cssRules)) {
                for (const prop of declaredProperties(frame))
                    props.add(prop);
            }
        }
    }
    return [...props];
}
/**
 * Nombres de propiedad declarados en un fotograma. Usa la API estándar
 * (`style.item(i)`) y, si el entorno no la implementa (jsdom), analiza
 * `cssText`.
 */
function declaredProperties(frame) {
    const style = frame.style;
    if (style && typeof style.item === 'function' && typeof style.length === 'number') {
        const out = [];
        for (let i = 0; i < style.length; i++)
            out.push(style.item(i));
        if (out.length)
            return out;
    }
    const text = style?.cssText ?? frame.cssText ?? '';
    const body = text.includes('{')
        ? text.slice(text.indexOf('{') + 1, text.lastIndexOf('}'))
        : text;
    return body
        .split(';')
        .map((d) => d.split(':')[0]?.trim() ?? '')
        .filter((p) => p && /^[-a-z]+$/i.test(p));
}

  });
  define("./orchestrator", function (exports, require) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnimationOrchestrator = void 0;
exports.priorityLabel = priorityLabel;
/**
 * Orquestador de animaciones.
 *
 * Coordina la ejecución de un {@link AnimationMap} sobre una ventana:
 * 1. Detecta capacidades y librerías externas ({@link detectCapabilities}).
 * 2. Ordena las animaciones por prioridad (`critical` → `low`).
 * 3. Para cada una: resuelve elementos, elige motor (preferencia →
 *    `supports`), consulta al {@link ConflictResolver} y ejecuta, encola,
 *    ignora o sustituye según la decisión.
 * 4. Mantiene el estado de las animaciones activas para detenerlas
 *    (`stop`, `stopAll`) y procesa la cola cuando una termina.
 *
 * Es isomorfo: funciona sobre jsdom (tests) y en el navegador (inyectado
 * por el runtime del CLI).
 */
const capabilities_1 = require("./capabilities");
const conflict_resolver_1 = require("./conflict-resolver");
const base_engine_1 = require("./engine/base-engine");
const css_engine_1 = require("./engine/css-engine");
const three_engine_1 = require("./engine/three-engine");
const waapi_engine_1 = require("./engine/waapi-engine");
const types_1 = require("./types");
/** Orden de preferencia de motores cuando `engine: auto`. */
const AUTO_ORDER = {
    keyframes: ['waapi', 'css'],
    isometric: ['waapi', 'css'],
    '3d-transform': ['waapi', 'css'],
    parallax: ['css', 'waapi', 'three'],
    'three-scene': ['three'],
};
/** Coordina motores, colas y conflictos sobre una ventana. */
class AnimationOrchestrator {
    /**
     * @param win Ventana (real o jsdom).
     * @param options Estrategia global, motor forzado, dry-run…
     * @param engines Motores disponibles (por defecto css, waapi y three).
     * @param capabilities Capacidades forzadas (tests) — si no, se detectan.
     */
    constructor(win, options = {}, engines, capabilities) {
        this.win = win;
        this.running = new Map();
        this.queue = [];
        this.options = {
            strategy: options.strategy ?? 'queue',
            dryRun: options.dryRun ?? false,
            externalPriority: options.externalPriority ?? 'high',
            detectExternal: options.detectExternal ?? true,
            ...options,
        };
        this.engines = engines ?? [new css_engine_1.CssEngine(), new waapi_engine_1.WaapiEngine(), new three_engine_1.ThreeEngine()];
        this.capabilities = (0, capabilities_1.detectCapabilities)(win, capabilities);
        this.resolver = new conflict_resolver_1.ConflictResolver({ strategy: this.options.strategy });
    }
    /** Documento de la ventana. */
    get doc() {
        return this.win.document;
    }
    /** Animaciones ordenadas por prioridad descendente (estable). */
    static sortByPriority(configs) {
        return [...configs].sort((a, b) => types_1.PRIORITY_ORDER[b.priority] - types_1.PRIORITY_ORDER[a.priority]);
    }
    /** Elige el motor para una configuración (o `null` con el motivo). */
    selectEngine(config) {
        const forced = this.options.engine ?? (config.engine !== 'auto' ? config.engine : undefined);
        const reasons = [];
        const candidates = forced
            ? [forced]
            : AUTO_ORDER[config.type].filter((id) => this.engines.some((e) => e.id === id));
        for (const id of candidates) {
            const engine = this.engines.find((e) => e.id === id);
            if (!engine) {
                reasons.push(`${id}: motor no disponible`);
                continue;
            }
            const ok = engine.supports(config, this.capabilities);
            if (ok === true)
                return { engine };
            reasons.push(`${id}: ${ok}`);
        }
        return { engine: null, reason: reasons.join('; ') || 'sin motores' };
    }
    /** Plan de ejecución sin tocar la página (base de `--dry-run`). */
    plan(map) {
        return AnimationOrchestrator.sortByPriority(Object.values(map.animations)).map((config) => {
            const { engine, reason } = this.selectEngine(config);
            const plan = {
                name: config.name,
                type: config.type,
                priority: config.priority,
                selector: config.selector,
                engine: engine?.id ?? null,
                properties: engine ? engine.propertiesFor(config) : [],
                trigger: config.trigger ?? (config.type === 'parallax' ? 'scroll' : 'load'),
                strategy: config.conflict ?? this.options.strategy,
            };
            if (!engine)
                plan.unsupportedReason = reason;
            return plan;
        });
    }
    /**
     * Escanea animaciones externas sobre los elementos objetivo de un mapa y
     * las registra en el resolutor.
     */
    detectExternal(map) {
        if (!this.options.detectExternal)
            return [];
        const elements = new Set();
        for (const config of Object.values(map.animations)) {
            for (const el of (0, base_engine_1.queryAll)(this.doc, config.selector))
                elements.add(el);
            for (const layer of config.parameters.layers ?? []) {
                for (const el of (0, base_engine_1.queryAll)(this.doc, layer.selector))
                    elements.add(el);
            }
        }
        return this.resolver.scanExternal(this.win, [...elements], this.options.externalPriority).registered;
    }
    /**
     * Ejecuta todas las animaciones del mapa respetando prioridades y
     * conflictos.
     * @param map Animaciones parseadas.
     */
    async runAll(map) {
        const started = Date.now();
        const external = this.detectExternal(map);
        const outcomes = [];
        for (const config of AnimationOrchestrator.sortByPriority(Object.values(map.animations))) {
            outcomes.push(await this.run(config));
        }
        return {
            outcomes,
            capabilities: this.capabilities,
            external,
            durationMs: Date.now() - started,
            success: outcomes.every((o) => o.status !== 'failed'),
        };
    }
    /**
     * Ejecuta (o planifica) una animación concreta.
     * @param config Configuración.
     * @param strategyOverride Estrategia puntual (sobrescribe config y global).
     */
    async run(config, strategyOverride) {
        const strategy = strategyOverride ?? config.conflict ?? this.options.strategy;
        const elements = (0, base_engine_1.queryAll)(this.doc, config.selector);
        if (elements.length === 0 && config.type !== 'parallax') {
            return this.tryFallback(config, {
                name: config.name,
                status: 'failed',
                message: `Selector sin coincidencias: ${config.selector}`,
                error: 'ELEMENT_NOT_FOUND',
            });
        }
        const { engine, reason } = this.selectEngine(config);
        if (!engine) {
            return this.tryFallback(config, {
                name: config.name,
                status: 'failed',
                message: `Sin motor compatible: ${reason}`,
                error: 'ENGINE_UNSUPPORTED',
            });
        }
        const properties = engine.propertiesFor(config);
        const targets = this.targetsOf(config, elements);
        const elementIds = targets.map(base_engine_1.ensureElementId);
        const resolution = this.resolver.resolve({
            id: config.name,
            priority: config.priority,
            elements: elementIds,
            properties,
            strategy,
            selector: config.selector,
        });
        if (this.options.dryRun) {
            return {
                name: config.name,
                status: 'dry-run',
                engine: engine.id,
                resolution,
                message: `[dry-run] ${config.type} con ${engine.id} sobre ${targets.length} elemento(s) → ${resolution.action}`,
            };
        }
        switch (resolution.action) {
            case 'ignore':
                return {
                    name: config.name,
                    status: 'ignored',
                    engine: engine.id,
                    resolution,
                    message: `Ignorada: ${resolution.reason}`,
                };
            case 'queue': {
                const own = resolution.conflictsWith.filter((c) => c.source === 'webmcpcss');
                if (own.length === 0) {
                    // Solo colisiona con externas (no sabemos cuándo acaban): no se
                    // pisa a un superior; se informa y se ignora.
                    return {
                        name: config.name,
                        status: 'ignored',
                        engine: engine.id,
                        resolution,
                        message: `Ignorada para no pisar animaciones externas: ${resolution.reason}`,
                    };
                }
                return this.enqueue(config, own.map((c) => c.id), resolution);
            }
            case 'replace':
                for (const c of resolution.conflictsWith) {
                    if (c.source === 'webmcpcss')
                        this.stop(c.id);
                    else
                        this.resolver.suppressExternal(this.win, c);
                }
                return this.execute(config, engine, targets, elementIds, resolution, 'replace');
            case 'merge':
                return this.execute(config, engine, targets, elementIds, resolution, 'add');
            default:
                return this.execute(config, engine, targets, elementIds, resolution, 'replace');
        }
    }
    /** Detiene una animación propia y libera su registro. Devuelve si existía. */
    stop(name) {
        const r = this.running.get(name);
        if (!r)
            return false;
        r.run.stop();
        this.running.delete(name);
        this.resolver.release(name);
        void this.drainQueue(name);
        return true;
    }
    /** Detiene todas las animaciones propias. */
    stopAll() {
        for (const name of [...this.running.keys()])
            this.stop(name);
        for (const q of this.queue.splice(0)) {
            q.resolve({
                name: q.config.name,
                status: 'ignored',
                message: 'Cancelada al detener el orquestador',
            });
        }
    }
    /** Handles de las animaciones en curso. */
    active() {
        return [...this.running.values()].map((r) => r.handle);
    }
    /** Nombres de animaciones en cola. */
    queued() {
        return this.queue.map((q) => q.config.name);
    }
    /** Espera a que termine una animación (o devuelve si no está activa). */
    async whenFinished(name) {
        const r = this.running.get(name);
        if (r)
            await r.run.finished;
    }
    /* ---------------------------------------------------------------- */
    /** Elementos que realmente se registran (capas en parallax). */
    targetsOf(config, elements) {
        if (config.type !== 'parallax')
            return elements;
        const targets = [];
        const roots = elements.length ? elements : [this.doc.documentElement];
        for (const layer of config.parameters.layers ?? []) {
            for (const root of roots) {
                const inRoot = (0, base_engine_1.queryAll)(root, layer.selector);
                targets.push(...(inRoot.length ? inRoot : (0, base_engine_1.queryAll)(this.doc, layer.selector)));
            }
        }
        return targets.length ? targets : elements;
    }
    /** Ejecuta con el motor, registra y engancha la limpieza al finalizar. */
    async execute(config, engine, targets, elementIds, resolution, composite, usedFallback = false) {
        const reduced = this.capabilities.reducedMotion && config.parameters.respectReducedMotion !== false;
        const ctx = {
            win: this.win,
            doc: this.doc,
            capabilities: this.capabilities,
            composite,
            sandbox: config.sandbox ?? this.options.sandbox ?? 'none',
            reducedMotion: reduced,
        };
        const hostElements = config.type === 'parallax' ? (0, base_engine_1.queryAll)(this.doc, config.selector) : targets;
        try {
            const run = await engine.execute(config, hostElements, ctx);
            const handle = {
                name: config.name,
                engine: engine.id,
                elementCount: targets.length,
                elements: elementIds,
                properties: run.properties,
                reducedMotion: reduced || undefined,
                details: run.details,
            };
            this.running.set(config.name, { config, engine, run, elements: targets, handle });
            this.resolver.register({
                id: config.name,
                library: engine.id,
                priority: config.priority,
                elements: elementIds,
                properties: run.properties,
                selector: config.selector,
            });
            void run.finished.then(() => {
                if (this.running.get(config.name)?.run === run) {
                    this.running.delete(config.name);
                    this.resolver.release(config.name);
                    void this.drainQueue(config.name);
                }
            });
            return {
                name: config.name,
                status: 'executed',
                engine: engine.id,
                resolution,
                handle,
                usedFallback: usedFallback || undefined,
                message: `${config.type} ejecutada con ${engine.id} sobre ${targets.length} elemento(s)${resolution?.action === 'replace'
                    ? ` (sustituyendo ${resolution.conflictsWith.map((c) => c.id).join(', ')})`
                    : ''}${resolution?.action === 'merge' ? ' (fusionada)' : ''}${reduced ? ' [reduced-motion: estado final estático]' : ''}`,
            };
        }
        catch (err) {
            return this.tryFallback(config, {
                name: config.name,
                status: 'failed',
                engine: engine.id,
                resolution,
                message: `Error en ${engine.id}: ${err.message}`,
                error: err.message,
            });
        }
    }
    /** Si la configuración tiene fallback, lo intenta; si no, devuelve el fallo. */
    async tryFallback(config, failure) {
        if (!config.fallback)
            return failure;
        const fb = {
            ...config.fallback,
            name: config.name,
            fallback: undefined,
        };
        const elements = (0, base_engine_1.queryAll)(this.doc, fb.selector);
        if (elements.length === 0 && fb.type !== 'parallax') {
            return {
                ...failure,
                message: `${failure.message}; fallback sin elementos (${fb.selector})`,
            };
        }
        const { engine, reason } = this.selectEngine(fb);
        if (!engine)
            return {
                ...failure,
                message: `${failure.message}; fallback sin motor (${reason})`,
            };
        const targets = this.targetsOf(fb, elements);
        const ids = targets.map(base_engine_1.ensureElementId);
        const resolution = this.resolver.resolve({
            id: fb.name,
            priority: fb.priority,
            elements: ids,
            properties: engine.propertiesFor(fb),
            strategy: fb.conflict ?? this.options.strategy,
        });
        if (this.options.dryRun) {
            return {
                name: config.name,
                status: 'dry-run',
                engine: engine.id,
                resolution,
                usedFallback: true,
                message: `[dry-run] ${failure.message}; se usaría el fallback ${fb.type} con ${engine.id}`,
            };
        }
        if (resolution.action === 'ignore' || resolution.action === 'queue') {
            return {
                ...failure,
                message: `${failure.message}; fallback bloqueado: ${resolution.reason}`,
            };
        }
        const outcome = await this.execute(fb, engine, targets, ids, resolution, resolution.action === 'merge' ? 'add' : 'replace', true);
        return { ...outcome, message: `${failure.message} → fallback: ${outcome.message}` };
    }
    /** Encola una animación hasta que terminen las que la bloquean. */
    enqueue(config, waitingFor, resolution) {
        // Si alguna de las bloqueantes es infinita, encolar sería esperar para
        // siempre: se devuelve `queued` con la referencia, y se ejecutará si
        // el usuario detiene la otra (stop) — comportamiento documentado.
        return new Promise((resolve) => {
            this.queue.push({ config, waitingFor, resolve });
            resolve({
                name: config.name,
                status: 'queued',
                resolution,
                message: `Encolada tras ${waitingFor.join(', ')}: ${resolution?.reason ?? ''}`,
            });
        });
    }
    /** Lanza las animaciones en cola que ya no tienen bloqueantes. */
    async drainQueue(finished) {
        for (const q of [...this.queue]) {
            q.waitingFor = q.waitingFor.filter((n) => n !== finished && this.running.has(n));
            if (q.waitingFor.length > 0)
                continue;
            this.queue.splice(this.queue.indexOf(q), 1);
            const outcome = await this.run(q.config);
            this.onDequeued?.(outcome);
        }
    }
}
exports.AnimationOrchestrator = AnimationOrchestrator;
/** Prioridad efectiva para mensajes (exportada para tests). */
function priorityLabel(p) {
    return `${p} (${types_1.PRIORITY_ORDER[p]})`;
}

  });
  define("./validators", function (exports, require) {
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateStatic = validateStatic;
exports.validateAnimations = validateAnimations;
/**
 * Validadores del estándar de animaciones:
 * - selectores (existen en el DOM, cuántos elementos),
 * - compatibilidad de motor/navegador,
 * - simulación de conflictos (sin ejecutar nada).
 *
 * Funcionan sobre un `Window` (jsdom o navegador) o, sin DOM, solo con las
 * comprobaciones estáticas.
 */
const capabilities_1 = require("./capabilities");
const conflict_resolver_1 = require("./conflict-resolver");
const base_engine_1 = require("./engine/base-engine");
const orchestrator_1 = require("./orchestrator");
const config_validation_1 = require("./config-validation");
/**
 * Validación estática de una configuración (sin DOM): coherencia tipo ↔
 * parámetros. Devuelve errores en vez de lanzar.
 */
function validateStatic(config) {
    const warnings = [];
    try {
        (0, config_validation_1.validateConfig)(config, warnings);
        return { errors: [], warnings };
    }
    catch (err) {
        return { errors: [err.message], warnings };
    }
}
/**
 * Valida un mapa de animaciones contra una ventana: selectores,
 * compatibilidad y conflictos previstos.
 *
 * @param map Animaciones parseadas.
 * @param win Ventana (opcional: sin ella solo se validan las reglas estáticas).
 * @param options Estrategia/motor forzado, capacidades…
 */
function validateAnimations(map, win, options = {}) {
    const entries = [];
    const conflicts = [];
    const configs = orchestrator_1.AnimationOrchestrator.sortByPriority(Object.values(map.animations));
    if (!win) {
        for (const config of configs) {
            const { errors, warnings } = validateStatic(config);
            entries.push({
                name: config.name,
                selector: config.selector,
                exists: false,
                count: 0,
                compatible: errors.length === 0,
                errors,
                warnings: [...warnings, 'Sin DOM: selector y compatibilidad no comprobados.'],
            });
        }
        return { entries, conflicts, ok: entries.every((e) => e.errors.length === 0) };
    }
    const orchestrator = new orchestrator_1.AnimationOrchestrator(win, { ...options, dryRun: true }, undefined, options.capabilities);
    const capabilities = orchestrator.capabilities;
    const resolver = new conflict_resolver_1.ConflictResolver({ strategy: options.strategy ?? 'queue' });
    // Registrar externas para que la simulación las tenga en cuenta.
    const external = orchestrator.detectExternal(map);
    for (const a of external)
        resolver.register(a);
    for (const config of configs) {
        const { errors, warnings } = validateStatic(config);
        const elements = (0, base_engine_1.queryAll)(win.document, config.selector);
        const exists = elements.length > 0;
        if (!exists && config.type !== 'parallax')
            errors.push(`Selector sin coincidencias: ${config.selector}`);
        if (elements.length > 1 && config.type === 'three-scene') {
            warnings.push(`three-scene solo usa el primer elemento (${elements.length} coinciden).`);
        }
        for (const layer of config.parameters.layers ?? []) {
            if ((0, base_engine_1.queryAll)(win.document, layer.selector).length === 0) {
                errors.push(`Capa sin coincidencias: ${layer.selector}`);
            }
        }
        const { engine, reason } = orchestrator.selectEngine(config);
        if (!engine) {
            if (config.fallback)
                warnings.push(`Sin motor compatible (${reason}); se usaría el fallback.`);
            else
                errors.push(`Sin motor compatible: ${reason}`);
        }
        if (capabilities.reducedMotion && config.parameters.respectReducedMotion !== false) {
            warnings.push('prefers-reduced-motion activo: se aplicará el estado final estático.');
        }
        // Simulación de conflictos.
        if (engine) {
            const targets = config.type === 'parallax'
                ? (config.parameters.layers ?? []).flatMap((l) => (0, base_engine_1.queryAll)(win.document, l.selector))
                : elements;
            const ids = targets.map(base_engine_1.ensureElementId);
            const properties = engine.propertiesFor(config);
            const strategy = config.conflict ?? options.strategy ?? 'queue';
            const resolution = resolver.resolve({
                id: config.name,
                priority: config.priority,
                elements: ids,
                properties,
                strategy,
            });
            if (resolution.action !== 'execute') {
                for (const c of resolution.conflictsWith) {
                    conflicts.push({
                        animation: config.name,
                        conflictsWith: c.id,
                        properties: resolution.properties,
                        action: resolution.action,
                        reason: resolution.reason,
                    });
                }
                if (resolution.action === 'ignore') {
                    warnings.push(`Se ignoraría: ${resolution.reason}`);
                }
                else if (resolution.action === 'queue') {
                    warnings.push(`Se encolaría: ${resolution.reason}`);
                }
            }
            if (resolution.action === 'execute' ||
                resolution.action === 'replace' ||
                resolution.action === 'merge') {
                if (resolution.action === 'replace') {
                    for (const c of resolution.conflictsWith)
                        resolver.release(c.id);
                }
                resolver.register({
                    id: config.name,
                    library: engine.id,
                    priority: config.priority,
                    elements: ids,
                    properties,
                    selector: config.selector,
                });
            }
        }
        entries.push({
            name: config.name,
            selector: config.selector,
            exists,
            count: elements.length,
            engine: engine?.id,
            compatible: !!engine || !!config.fallback,
            errors,
            warnings,
        });
    }
    return {
        entries,
        conflicts,
        capabilities: (0, capabilities_1.detectCapabilities)(win, options.capabilities),
        ok: entries.every((e) => e.errors.length === 0),
    };
}

  });
  var orchestratorMod = load('./orchestrator');
  var validatorsMod = load('./validators');
  var capsMod = load('./capabilities');
  var resolverMod = load('./conflict-resolver');
  var typesMod = load('./types');
  var ns = global.webmcpcss = global.webmcpcss || {};
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
