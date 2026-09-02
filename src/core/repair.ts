/**
 * Lógica de auto-reparación de selectores.
 *
 * Dado un {@link ToolMap} y una página (a través de un {@link PageAdapter}),
 * detecta los selectores rotos y usa el módulo de visión para proponer
 * selectores estables de reemplazo.
 */
import type { PageAdapter } from '../adapters/page-adapter';
import type { ContextSpec, RepairResult, ToolMap, ToolSpec } from '../types';
import { logger } from '../utils/logger';
import { findBestCandidate, humanize, type VisionHints } from './vision';

/** Etiquetas típicas por tipo de entrada, usadas como pista adicional. */
const TOOL_TAGS = ['button', 'a', 'input', 'select', 'textarea'];

/**
 * Construye las pistas de visión para una herramienta o dato de contexto.
 *
 * @param name Nombre de la entrada (`addToCart`, `price`...).
 * @param spec Especificación con selector y huella opcional.
 * @param kind Tipo de entrada.
 */
export function buildHints(
  name: string,
  spec: ToolSpec | ContextSpec,
  kind: 'tool' | 'context',
): VisionHints {
  return {
    fingerprint: spec.fingerprint,
    toolName: name,
    text: spec.fingerprint?.text || humanize(name),
    oldSelector: spec.selector,
    tags: kind === 'tool' ? TOOL_TAGS : undefined,
  };
}

/**
 * Intenta reparar el selector de una entrada concreta.
 *
 * @param adapter Adaptador de página.
 * @param name Nombre de la herramienta o dato de contexto.
 * @param spec Su especificación actual.
 * @param kind Tipo de entrada.
 * @param threshold Umbral mínimo de confianza (0-1).
 * @returns Resultado de la reparación (sin mutar `spec`).
 */
export async function repairSelector(
  adapter: PageAdapter,
  name: string,
  spec: ToolSpec | ContextSpec,
  kind: 'tool' | 'context',
  threshold = 0.45,
): Promise<RepairResult> {
  const candidates = await adapter.snapshot();
  const hints = buildHints(name, spec, kind);
  const best = findBestCandidate(candidates, hints, threshold);

  if (!best) {
    logger.debug(`repair: sin candidato para "${name}" (${spec.selector})`);
    return { name, kind, repaired: false, oldSelector: spec.selector };
  }

  logger.debug(
    `repair: "${name}" ${spec.selector} → ${best.candidate.selector} (score ${best.score.toFixed(2)})`,
  );

  // Lección del PR #2 (@ctangarife): si el selector original apuntaba a una
  // FAMILIA (clases, sin id único), el reemplazo debe generalizar. La clase
  // compartida gana al aria-label único por elemento.
  let newSelector = best.candidate.selector;
  const family = best.candidate.familySelector;
  const oldWasFamily = /\./.test(spec.selector) && !/#/.test(spec.selector);
  if (family && oldWasFamily && (await adapter.exists(family))) {
    logger.debug(`repair: "${name}" generalizado a familia ${family}`);
    newSelector = family;
  }

  return {
    name,
    kind,
    repaired: true,
    oldSelector: spec.selector,
    newSelector,
    score: best.score,
  };
}

/**
 * Recorre todo el tool map, repara los selectores rotos y actualiza el
 * objeto EN MEMORIA (muta `map`) con los nuevos selectores encontrados.
 *
 * @param adapter Adaptador de página.
 * @param map Tool map a reparar (se muta con los selectores nuevos).
 * @param threshold Umbral mínimo de confianza.
 * @returns Lista de resultados, uno por selector roto detectado.
 */
export async function repairToolMap(
  adapter: PageAdapter,
  map: ToolMap,
  threshold = 0.45,
): Promise<RepairResult[]> {
  const results: RepairResult[] = [];

  for (const [name, tool] of Object.entries(map.tools)) {
    if (await adapter.exists(tool.selector)) continue;
    const result = await repairSelector(adapter, name, tool, 'tool', threshold);
    results.push(result);
    if (result.repaired && result.newSelector) {
      tool.selector = result.newSelector;
    }
  }

  for (const [name, ctx] of Object.entries(map.context)) {
    if (await adapter.exists(ctx.selector)) continue;
    const result = await repairSelector(adapter, name, ctx, 'context', threshold);
    results.push(result);
    if (result.repaired && result.newSelector) {
      ctx.selector = result.newSelector;
    }
  }

  return results;
}
