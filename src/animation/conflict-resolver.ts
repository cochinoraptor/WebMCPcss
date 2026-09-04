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
import {
  PRIORITY_ORDER,
  type ActiveAnimation,
  type AnimationPriority,
  type ConflictRequest,
  type ConflictResolution,
  type ConflictStrategy,
} from './types';
import {
  ANIMATION_ID_PREFIX,
  ELEMENT_ID_ATTR,
  ensureElementId,
  toKebab,
} from './engine/base-engine';

/** Propiedades que WAAPI puede componer aditivamente. */
const COMPOSABLE = new Set(['transform', 'translate', 'rotate', 'scale', 'opacity']);

/** Opciones del resolutor. */
export interface ConflictResolverOptions {
  /** Estrategia por defecto (`queue`). */
  strategy?: ConflictStrategy;
}

/** Resultado de un escaneo de animaciones externas. */
export interface ExternalScanResult {
  /** Animaciones detectadas y registradas. */
  registered: ActiveAnimation[];
  /** Librerías detectadas (informativo). */
  libraries: string[];
}

/** Registro y decisión de conflictos entre animaciones. */
export class ConflictResolver {
  private readonly active = new Map<string, ActiveAnimation>();
  private readonly strategy: ConflictStrategy;

  constructor(options: ConflictResolverOptions = {}) {
    this.strategy = options.strategy ?? 'queue';
  }

  /** Animaciones activas (propias y externas). */
  list(): ActiveAnimation[] {
    return [...this.active.values()];
  }

  /** Busca una animación activa por id. */
  get(id: string): ActiveAnimation | undefined {
    return this.active.get(id);
  }

  /** Registra una animación propia como activa. */
  register(
    entry: Omit<ActiveAnimation, 'since' | 'source'> & {
      source?: ActiveAnimation['source'];
    },
  ): ActiveAnimation {
    const full: ActiveAnimation = {
      ...entry,
      source: entry.source ?? 'webmcpcss',
      properties: entry.properties.map(toKebab),
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
  registerExternal(
    id: string,
    elements: Array<Element | string>,
    properties: string[],
    options: { library?: string; priority?: AnimationPriority; selector?: string } = {},
  ): ActiveAnimation {
    const ids = elements.map((e) => (typeof e === 'string' ? e : ensureElementId(e)));
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
  release(id: string): boolean {
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
  suppressExternal(win: Window, entry: ActiveAnimation): number {
    let cancelled = 0;
    const doc = win.document;
    for (const elId of entry.elements) {
      const el = doc.querySelector(`[${ELEMENT_ID_ATTR}="${elId}"]`);
      if (!el) continue;
      if (entry.library === 'css') {
        // Evita que la regla del sitio vuelva a arrancar la animación.
        (el as HTMLElement).style.setProperty('animation-name', 'none', 'important');
      }
      const getAnims = (el as Element & { getAnimations?: () => Animation[] })
        .getAnimations;
      if (typeof getAnims !== 'function') continue;
      for (const a of safeCall(() => getAnims.call(el)) ?? []) {
        if ((a.id ?? '').startsWith(ANIMATION_ID_PREFIX)) continue;
        const name = (a as Animation & { animationName?: string }).animationName;
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
  clear(onlyExternal = false): void {
    if (!onlyExternal) {
      this.active.clear();
      return;
    }
    for (const [id, a] of this.active)
      if (a.source === 'external') this.active.delete(id);
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
  scanExternal(
    win: Window,
    elements: Element[],
    priority: AnimationPriority = 'high',
  ): ExternalScanResult {
    const registered: ActiveAnimation[] = [];
    const libraries = new Set<string>();
    const doc = win.document;
    const getAnims = (doc as Document & { getAnimations?: () => Animation[] })
      .getAnimations;
    const docAnimations: Animation[] =
      typeof getAnims === 'function' ? (safeCall(() => getAnims.call(doc)) ?? []) : [];

    for (const el of elements) {
      const id = ensureElementId(el);
      // 1) Animaciones CSS declaradas en la hoja de estilos del sitio.
      const cs = safeCall(() => win.getComputedStyle(el));
      const animName = cs?.animationName;
      if (animName && animName !== 'none' && !animName.startsWith('webmcp-anim-')) {
        const props = cssAnimatedProperties(doc, animName);
        registered.push(
          this.register({
            id: `css:${animName}@${id}`,
            source: 'external',
            library: 'css',
            priority,
            elements: [id],
            properties: props.length ? props : ['transform', 'opacity'],
            selector: describe(el),
          }),
        );
        libraries.add('css');
      }
      // 2) Transiciones activas (propiedad concreta).
      const transitionProp = cs?.transitionProperty;
      const transitionDur = cs?.transitionDuration;
      if (
        transitionProp &&
        transitionProp !== 'all' &&
        transitionProp !== 'none' &&
        transitionDur &&
        /[1-9]/.test(transitionDur)
      ) {
        const props = transitionProp
          .split(',')
          .map((p) => p.trim())
          .filter(Boolean);
        registered.push(
          this.register({
            id: `transition@${id}`,
            source: 'external',
            library: 'css-transition',
            priority: 'low',
            elements: [id],
            properties: props,
            selector: describe(el),
          }),
        );
      }
      // 3) WAAPI ajenas (GSAP no usa WAAPI, pero Motion One, Anime v4 y código propio sí).
      // Las CSSAnimation/CSSTransition ya se registraron arriba desde el
      // estilo computado: aquí solo interesan las WAAPI puras.
      const elAnims = docAnimations.filter((a) => {
        const target = (a.effect as KeyframeEffect | null)?.target;
        if (target !== el || (a.id ?? '').startsWith(ANIMATION_ID_PREFIX)) return false;
        const ctor = (a.constructor as { name?: string } | undefined)?.name ?? '';
        const cssBacked =
          ctor === 'CSSAnimation' ||
          ctor === 'CSSTransition' ||
          'animationName' in (a as object) ||
          'transitionProperty' in (a as object);
        return !cssBacked;
      });
      elAnims.forEach((a, i) => {
        const effect = a.effect as KeyframeEffect | null;
        const props = new Set<string>();
        for (const kf of safeCall(() => effect?.getKeyframes()) ?? []) {
          for (const k of Object.keys(kf)) {
            if (['offset', 'computedOffset', 'easing', 'composite'].includes(k)) continue;
            props.add(toKebab(k));
          }
        }
        registered.push(
          this.register({
            id: `waapi:${a.id || i}@${id}`,
            source: 'external',
            library: 'waapi',
            priority,
            elements: [id],
            properties: [...props],
            selector: describe(el),
          }),
        );
        libraries.add('waapi');
      });
      // 4) Marcas de GSAP / Anime.js en el elemento.
      const gsapMark = (el as Element & { _gsap?: unknown })._gsap;
      if (gsapMark) {
        registered.push(
          this.register({
            id: `gsap@${id}`,
            source: 'external',
            library: 'gsap',
            priority,
            elements: [id],
            properties: ['transform', 'opacity'],
            selector: describe(el),
          }),
        );
        libraries.add('gsap');
      }
    }
    return { registered, libraries: [...libraries] };
  }

  /**
   * Decide qué hacer con una animación nueva.
   * @param request Animación entrante.
   */
  resolve(request: ConflictRequest): ConflictResolution {
    const props = new Set(request.properties.map(toKebab));
    const elements = new Set(request.elements);
    const conflicts: ActiveAnimation[] = [];
    const disputed = new Set<string>();
    for (const a of this.active.values()) {
      if (a.id === request.id) continue;
      if (!a.elements.some((e) => elements.has(e))) continue;
      const shared = a.properties.filter(
        (p) => props.has(p) || (p === 'scene' && props.has('scene')),
      );
      if (shared.length === 0) continue;
      conflicts.push(a);
      shared.forEach((p) => disputed.add(p));
    }
    if (conflicts.length === 0) {
      return { action: 'execute', conflictsWith: [], properties: [] };
    }
    const strategy = request.strategy ?? this.strategy;
    const mine = PRIORITY_ORDER[request.priority];
    const maxOther = Math.max(...conflicts.map((c) => PRIORITY_ORDER[c.priority]));
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

/** Ejecuta una función capturando excepciones (jsdom no implementa todo). */
function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Descripción corta de un elemento para mensajes. */
function describe(el: Element): string {
  const id = el.getAttribute('id');
  if (id) return `#${id}`;
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0];
  const tag = el.tagName.toLowerCase();
  return cls
    ? `${tag}.${cls}`
    : `${tag}[${ELEMENT_ID_ATTR}="${el.getAttribute(ELEMENT_ID_ATTR)}"]`;
}

/**
 * Propiedades animadas por un `@keyframes` del sitio (buscando en las hojas
 * de estilo accesibles; las cross-origin se ignoran).
 */
export function cssAnimatedProperties(doc: Document, animationName: string): string[] {
  const props = new Set<string>();
  const sheets = safeCall(() => Array.from(doc.styleSheets)) ?? [];
  for (const sheet of sheets) {
    const rules = safeCall(() => Array.from((sheet as CSSStyleSheet).cssRules)) ?? [];
    for (const rule of rules) {
      const kf = rule as CSSKeyframesRule;
      if (kf.type !== 7 /* KEYFRAMES_RULE */ || kf.name !== animationName) continue;
      for (const frame of Array.from(kf.cssRules) as CSSKeyframeRule[]) {
        for (const prop of declaredProperties(frame)) props.add(prop);
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
function declaredProperties(frame: CSSKeyframeRule): string[] {
  const style = frame.style as CSSStyleDeclaration | undefined;
  if (style && typeof style.item === 'function' && typeof style.length === 'number') {
    const out: string[] = [];
    for (let i = 0; i < style.length; i++) out.push(style.item(i));
    if (out.length) return out;
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
