/**
 * Validadores del estándar de animaciones:
 * - selectores (existen en el DOM, cuántos elementos),
 * - compatibilidad de motor/navegador,
 * - simulación de conflictos (sin ejecutar nada).
 *
 * Funcionan sobre un `Window` (jsdom o navegador) o, sin DOM, solo con las
 * comprobaciones estáticas.
 */
import { detectCapabilities } from './capabilities';
import { ConflictResolver } from './conflict-resolver';
import { ensureElementId, queryAll } from './engine/base-engine';
import { AnimationOrchestrator } from './orchestrator';
import { validateConfig } from './config-validation';
import {
  type AnimationConfig,
  type AnimationMap,
  type AnimationValidationEntry,
  type AnimationValidationReport,
  type BrowserCapabilities,
  type ConflictStrategy,
  type OrchestratorOptions,
  type PredictedConflict,
} from './types';

/** Opciones de {@link validateAnimations}. */
export interface ValidateOptions extends OrchestratorOptions {
  /** Capacidades forzadas (tests / entornos sin navegador). */
  capabilities?: Partial<BrowserCapabilities>;
}

/**
 * Validación estática de una configuración (sin DOM): coherencia tipo ↔
 * parámetros. Devuelve errores en vez de lanzar.
 */
export function validateStatic(config: AnimationConfig): {
  errors: string[];
  warnings: string[];
} {
  const warnings: string[] = [];
  try {
    validateConfig(config, warnings);
    return { errors: [], warnings };
  } catch (err) {
    return { errors: [(err as Error).message], warnings };
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
export function validateAnimations(
  map: AnimationMap,
  win?: Window,
  options: ValidateOptions = {},
): AnimationValidationReport {
  const entries: AnimationValidationEntry[] = [];
  const conflicts: PredictedConflict[] = [];
  const configs = AnimationOrchestrator.sortByPriority(Object.values(map.animations));

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

  const orchestrator = new AnimationOrchestrator(
    win,
    { ...options, dryRun: true },
    undefined,
    options.capabilities,
  );
  const capabilities = orchestrator.capabilities;
  const resolver = new ConflictResolver({ strategy: options.strategy ?? 'queue' });

  // Registrar externas para que la simulación las tenga en cuenta.
  const external = orchestrator.detectExternal(map);
  for (const a of external) resolver.register(a);

  for (const config of configs) {
    const { errors, warnings } = validateStatic(config);
    const elements = queryAll(win.document, config.selector);
    const exists = elements.length > 0;
    if (!exists && config.type !== 'parallax')
      errors.push(`Selector sin coincidencias: ${config.selector}`);
    if (elements.length > 1 && config.type === 'three-scene') {
      warnings.push(
        `three-scene solo usa el primer elemento (${elements.length} coinciden).`,
      );
    }
    for (const layer of config.parameters.layers ?? []) {
      if (queryAll(win.document, layer.selector).length === 0) {
        errors.push(`Capa sin coincidencias: ${layer.selector}`);
      }
    }
    const { engine, reason } = orchestrator.selectEngine(config);
    if (!engine) {
      if (config.fallback)
        warnings.push(`Sin motor compatible (${reason}); se usaría el fallback.`);
      else errors.push(`Sin motor compatible: ${reason}`);
    }
    if (capabilities.reducedMotion && config.parameters.respectReducedMotion !== false) {
      warnings.push(
        'prefers-reduced-motion activo: se aplicará el estado final estático.',
      );
    }

    // Simulación de conflictos.
    if (engine) {
      const targets =
        config.type === 'parallax'
          ? (config.parameters.layers ?? []).flatMap((l) =>
              queryAll(win.document, l.selector),
            )
          : elements;
      const ids = targets.map(ensureElementId);
      const properties = engine.propertiesFor(config);
      const strategy: ConflictStrategy = config.conflict ?? options.strategy ?? 'queue';
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
        } else if (resolution.action === 'queue') {
          warnings.push(`Se encolaría: ${resolution.reason}`);
        }
      }
      if (
        resolution.action === 'execute' ||
        resolution.action === 'replace' ||
        resolution.action === 'merge'
      ) {
        if (resolution.action === 'replace') {
          for (const c of resolution.conflictsWith) resolver.release(c.id);
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
    capabilities: detectCapabilities(win, options.capabilities),
    ok: entries.every((e) => e.errors.length === 0),
  };
}
