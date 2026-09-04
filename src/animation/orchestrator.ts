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
import { detectCapabilities } from './capabilities';
import { ConflictResolver } from './conflict-resolver';
import {
  type AnimationEngine,
  type EngineContext,
  type EngineRun,
  ensureElementId,
  queryAll,
} from './engine/base-engine';
import { CssEngine } from './engine/css-engine';
import { ThreeEngine } from './engine/three-engine';
import { WaapiEngine } from './engine/waapi-engine';
import {
  PRIORITY_ORDER,
  type ActiveAnimation,
  type AnimationConfig,
  type AnimationEngineId,
  type AnimationHandle,
  type AnimationMap,
  type AnimationOutcome,
  type AnimationPlan,
  type AnimationPriority,
  type BrowserCapabilities,
  type ConflictStrategy,
  type OrchestrationResult,
  type OrchestratorOptions,
} from './types';

/** Animación en ejecución gestionada por el orquestador. */
interface RunningAnimation {
  config: AnimationConfig;
  engine: AnimationEngine;
  run: EngineRun;
  elements: Element[];
  handle: AnimationHandle;
}

/** Entrada de la cola de espera. */
interface QueuedAnimation {
  config: AnimationConfig;
  waitingFor: string[];
  resolve: (outcome: AnimationOutcome) => void;
}

/** Orden de preferencia de motores cuando `engine: auto`. */
const AUTO_ORDER: Record<AnimationConfig['type'], AnimationEngineId[]> = {
  keyframes: ['waapi', 'css'],
  isometric: ['waapi', 'css'],
  '3d-transform': ['waapi', 'css'],
  parallax: ['css', 'waapi', 'three'],
  'three-scene': ['three'],
};

/** Coordina motores, colas y conflictos sobre una ventana. */
export class AnimationOrchestrator {
  readonly resolver: ConflictResolver;
  readonly capabilities: BrowserCapabilities;
  private readonly engines: AnimationEngine[];
  private readonly running = new Map<string, RunningAnimation>();
  private readonly queue: QueuedAnimation[] = [];
  private readonly options: Required<
    Pick<
      OrchestratorOptions,
      'strategy' | 'dryRun' | 'externalPriority' | 'detectExternal'
    >
  > &
    OrchestratorOptions;

  /**
   * @param win Ventana (real o jsdom).
   * @param options Estrategia global, motor forzado, dry-run…
   * @param engines Motores disponibles (por defecto css, waapi y three).
   * @param capabilities Capacidades forzadas (tests) — si no, se detectan.
   */
  constructor(
    private readonly win: Window,
    options: OrchestratorOptions = {},
    engines?: AnimationEngine[],
    capabilities?: Partial<BrowserCapabilities>,
  ) {
    this.options = {
      strategy: options.strategy ?? 'queue',
      dryRun: options.dryRun ?? false,
      externalPriority: options.externalPriority ?? 'high',
      detectExternal: options.detectExternal ?? true,
      ...options,
    };
    this.engines = engines ?? [new CssEngine(), new WaapiEngine(), new ThreeEngine()];
    this.capabilities = detectCapabilities(win, capabilities);
    this.resolver = new ConflictResolver({ strategy: this.options.strategy });
  }

  /** Documento de la ventana. */
  private get doc(): Document {
    return this.win.document;
  }

  /** Animaciones ordenadas por prioridad descendente (estable). */
  static sortByPriority(configs: AnimationConfig[]): AnimationConfig[] {
    return [...configs].sort(
      (a, b) => PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority],
    );
  }

  /** Elige el motor para una configuración (o `null` con el motivo). */
  selectEngine(config: AnimationConfig): {
    engine: AnimationEngine | null;
    reason?: string;
  } {
    const forced =
      this.options.engine ?? (config.engine !== 'auto' ? config.engine : undefined);
    const reasons: string[] = [];
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
      if (ok === true) return { engine };
      reasons.push(`${id}: ${ok}`);
    }
    return { engine: null, reason: reasons.join('; ') || 'sin motores' };
  }

  /** Plan de ejecución sin tocar la página (base de `--dry-run`). */
  plan(map: AnimationMap): AnimationPlan[] {
    return AnimationOrchestrator.sortByPriority(Object.values(map.animations)).map(
      (config) => {
        const { engine, reason } = this.selectEngine(config);
        const plan: AnimationPlan = {
          name: config.name,
          type: config.type,
          priority: config.priority,
          selector: config.selector,
          engine: engine?.id ?? null,
          properties: engine ? engine.propertiesFor(config) : [],
          trigger: config.trigger ?? (config.type === 'parallax' ? 'scroll' : 'load'),
          strategy: config.conflict ?? this.options.strategy,
        };
        if (!engine) plan.unsupportedReason = reason;
        return plan;
      },
    );
  }

  /**
   * Escanea animaciones externas sobre los elementos objetivo de un mapa y
   * las registra en el resolutor.
   */
  detectExternal(map: AnimationMap): ActiveAnimation[] {
    if (!this.options.detectExternal) return [];
    const elements = new Set<Element>();
    for (const config of Object.values(map.animations)) {
      for (const el of queryAll(this.doc, config.selector)) elements.add(el);
      for (const layer of config.parameters.layers ?? []) {
        for (const el of queryAll(this.doc, layer.selector)) elements.add(el);
      }
    }
    return this.resolver.scanExternal(
      this.win,
      [...elements],
      this.options.externalPriority,
    ).registered;
  }

  /**
   * Ejecuta todas las animaciones del mapa respetando prioridades y
   * conflictos.
   * @param map Animaciones parseadas.
   */
  async runAll(map: AnimationMap): Promise<OrchestrationResult> {
    const started = Date.now();
    const external = this.detectExternal(map);
    const outcomes: AnimationOutcome[] = [];
    for (const config of AnimationOrchestrator.sortByPriority(
      Object.values(map.animations),
    )) {
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
  async run(
    config: AnimationConfig,
    strategyOverride?: ConflictStrategy,
  ): Promise<AnimationOutcome> {
    const strategy = strategyOverride ?? config.conflict ?? this.options.strategy;
    const elements = queryAll(this.doc, config.selector);
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
    const elementIds = targets.map(ensureElementId);
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
        return this.enqueue(
          config,
          own.map((c) => c.id),
          resolution,
        );
      }
      case 'replace':
        for (const c of resolution.conflictsWith) {
          if (c.source === 'webmcpcss') this.stop(c.id);
          else this.resolver.suppressExternal(this.win, c);
        }
        return this.execute(config, engine, targets, elementIds, resolution, 'replace');
      case 'merge':
        return this.execute(config, engine, targets, elementIds, resolution, 'add');
      default:
        return this.execute(config, engine, targets, elementIds, resolution, 'replace');
    }
  }

  /** Detiene una animación propia y libera su registro. Devuelve si existía. */
  stop(name: string): boolean {
    const r = this.running.get(name);
    if (!r) return false;
    r.run.stop();
    this.running.delete(name);
    this.resolver.release(name);
    void this.drainQueue(name);
    return true;
  }

  /** Detiene todas las animaciones propias. */
  stopAll(): void {
    for (const name of [...this.running.keys()]) this.stop(name);
    for (const q of this.queue.splice(0)) {
      q.resolve({
        name: q.config.name,
        status: 'ignored',
        message: 'Cancelada al detener el orquestador',
      });
    }
  }

  /** Handles de las animaciones en curso. */
  active(): AnimationHandle[] {
    return [...this.running.values()].map((r) => r.handle);
  }

  /** Nombres de animaciones en cola. */
  queued(): string[] {
    return this.queue.map((q) => q.config.name);
  }

  /** Espera a que termine una animación (o devuelve si no está activa). */
  async whenFinished(name: string): Promise<void> {
    const r = this.running.get(name);
    if (r) await r.run.finished;
  }

  /* ---------------------------------------------------------------- */

  /** Elementos que realmente se registran (capas en parallax). */
  private targetsOf(config: AnimationConfig, elements: Element[]): Element[] {
    if (config.type !== 'parallax') return elements;
    const targets: Element[] = [];
    const roots = elements.length ? elements : [this.doc.documentElement];
    for (const layer of config.parameters.layers ?? []) {
      for (const root of roots) {
        const inRoot = queryAll(root as unknown as Document, layer.selector);
        targets.push(...(inRoot.length ? inRoot : queryAll(this.doc, layer.selector)));
      }
    }
    return targets.length ? targets : elements;
  }

  /** Ejecuta con el motor, registra y engancha la limpieza al finalizar. */
  private async execute(
    config: AnimationConfig,
    engine: AnimationEngine,
    targets: Element[],
    elementIds: string[],
    resolution: AnimationOutcome['resolution'],
    composite: 'replace' | 'add',
    usedFallback = false,
  ): Promise<AnimationOutcome> {
    const reduced =
      this.capabilities.reducedMotion && config.parameters.respectReducedMotion !== false;
    const ctx: EngineContext = {
      win: this.win,
      doc: this.doc,
      capabilities: this.capabilities,
      composite,
      sandbox: config.sandbox ?? this.options.sandbox ?? 'none',
      reducedMotion: reduced,
    };
    const hostElements =
      config.type === 'parallax' ? queryAll(this.doc, config.selector) : targets;
    try {
      const run = await engine.execute(config, hostElements, ctx);
      const handle: AnimationHandle = {
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
        message: `${config.type} ejecutada con ${engine.id} sobre ${targets.length} elemento(s)${
          resolution?.action === 'replace'
            ? ` (sustituyendo ${resolution.conflictsWith.map((c) => c.id).join(', ')})`
            : ''
        }${resolution?.action === 'merge' ? ' (fusionada)' : ''}${reduced ? ' [reduced-motion: estado final estático]' : ''}`,
      };
    } catch (err) {
      return this.tryFallback(config, {
        name: config.name,
        status: 'failed',
        engine: engine.id,
        resolution,
        message: `Error en ${engine.id}: ${(err as Error).message}`,
        error: (err as Error).message,
      });
    }
  }

  /** Si la configuración tiene fallback, lo intenta; si no, devuelve el fallo. */
  private async tryFallback(
    config: AnimationConfig,
    failure: AnimationOutcome,
  ): Promise<AnimationOutcome> {
    if (!config.fallback) return failure;
    const fb: AnimationConfig = {
      ...config.fallback,
      name: config.name,
      fallback: undefined,
    };
    const elements = queryAll(this.doc, fb.selector);
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
    const ids = targets.map(ensureElementId);
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
    const outcome = await this.execute(
      fb,
      engine,
      targets,
      ids,
      resolution,
      resolution.action === 'merge' ? 'add' : 'replace',
      true,
    );
    return { ...outcome, message: `${failure.message} → fallback: ${outcome.message}` };
  }

  /** Encola una animación hasta que terminen las que la bloquean. */
  private enqueue(
    config: AnimationConfig,
    waitingFor: string[],
    resolution: AnimationOutcome['resolution'],
  ): Promise<AnimationOutcome> {
    // Si alguna de las bloqueantes es infinita, encolar sería esperar para
    // siempre: se devuelve `queued` con la referencia, y se ejecutará si
    // el usuario detiene la otra (stop) — comportamiento documentado.
    return new Promise<AnimationOutcome>((resolve) => {
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
  private async drainQueue(finished: string): Promise<void> {
    for (const q of [...this.queue]) {
      q.waitingFor = q.waitingFor.filter((n) => n !== finished && this.running.has(n));
      if (q.waitingFor.length > 0) continue;
      this.queue.splice(this.queue.indexOf(q), 1);
      const outcome = await this.run(q.config);
      this.onDequeued?.(outcome);
    }
  }

  /** Callback opcional cuando una animación encolada se ejecuta. */
  onDequeued?: (outcome: AnimationOutcome) => void;
}

/** Prioridad efectiva para mensajes (exportada para tests). */
export function priorityLabel(p: AnimationPriority): string {
  return `${p} (${PRIORITY_ORDER[p]})`;
}
