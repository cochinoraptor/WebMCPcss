/**
 * Auto-reparación de selectores: detecta un selector roto, activa el modo
 * visión ({@link ./vision}), infiere un selector estable nuevo y actualiza
 * el tool map en memoria.
 *
 * Lección del POC: en empates entre candidatos distintos la reparación se
 * marca como `ambiguous` y solo se acepta si la herramienta declara
 * `webmcp-confirmation` (la acción se verifica a posteriori).
 */
import type { PageAdapter } from '../adapters/PageAdapter';
import type { ContextDef, ToolMap } from '../types';
import { parseSelectorScope } from '../utils/dom';
import { findCandidates, hintsFromTool, type VisionCandidate } from './vision';

/** Resultado de intentar reparar un selector. */
export interface RepairOutcome {
  /** Nombre de la herramienta o contexto reparado. */
  name: string;
  /** `true` si se infirió un selector nuevo. */
  repaired: boolean;
  /** Selector original (roto). */
  from: string;
  /** Selector inferido (si `repaired`). */
  to?: string;
  /** Motivo del fallo cuando `repaired === false`. */
  reason?: 'no-candidates' | 'ambiguous' | 'scope-broken';
  /** `true` si hubo empate entre candidatos distintos y aun así se reparó. */
  ambiguous?: boolean;
  /** Número de candidatos considerados. */
  candidates?: number;
}

/** Opciones de reparación. */
export interface RepairOptions {
  /**
   * Aceptar la reparación aunque haya empate entre candidatos distintos.
   * Solo debe usarse cuando hay `webmcp-confirmation` que verifique la
   * acción (lección del POC).
   */
  allowAmbiguous?: boolean;
}

/**
 * Elige el selector ganador entre los candidatos (lecciones del POC).
 *
 * 1. Solo compiten candidatos con la puntuación máxima.
 * 2. Los candidatos se agrupan en **familias** por enlaces: dos candidatos
 *    quedan en la misma familia cuando alguna propuesta (selector
 *    compartido) los cubre a ambos. Así, variantes incidentales
 *    (`.chip.active` junto a `.chip`) no parten la familia.
 * 3. Más de una familia = reparación **ambigua**: se rechaza salvo
 *    `allowAmbiguous` (la acción debe verificarse con
 *    `webmcp-confirmation`); entonces gana la familia mayor y, en empate,
 *    la que aparece antes en el documento.
 * 4. Dentro de la familia gana la propuesta que más miembros cubre (un
 *    selector de herramienta debe generalizar: la clase compartida gana
 *    al `aria-label` único por tarjeta); en empate, la prioridad
 *    documentada (`data-*` → `id` → `name`/`aria-label` → clases).
 *
 * @param candidates Candidatos puntuados por visión.
 * @param allowAmbiguous Si se aceptan empates entre familias.
 * @returns Selector ganador (sin ámbito) o estado de empate.
 */
function pickWinner(
  candidates: VisionCandidate[],
  allowAmbiguous: boolean,
): { winner?: { selector: string; score: number }; ambiguous: boolean } {
  if (candidates.length === 0) return { ambiguous: false };
  const topScore = candidates[0].score;
  const top = candidates.filter((c) => c.score === topScore);

  // Union-find sobre los índices de los candidatos top.
  const parent = top.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const union = (a: number, b: number): void => {
    parent[find(a)] = find(b);
  };

  const membersBySelector = new Map<string, number[]>();
  top.forEach((candidate, index) => {
    for (const sel of candidate.proposals) {
      const list = membersBySelector.get(sel) ?? [];
      list.push(index);
      membersBySelector.set(sel, list);
    }
  });
  for (const members of membersBySelector.values()) {
    for (let i = 1; i < members.length; i++) union(members[0], members[i]);
  }

  // Familias (raíces) conservando el orden de documento del primer miembro.
  const families = new Map<number, number[]>();
  top.forEach((_, index) => {
    const root = find(index);
    const list = families.get(root) ?? [];
    list.push(index);
    families.set(root, list);
  });

  if (families.size === 0) return { ambiguous: false };
  if (families.size > 1) {
    if (!allowAmbiguous) return { ambiguous: true };
  }

  // Familia ganadora: mayor tamaño; en empate, primer miembro en documento.
  const rankedFamilies = [...families.values()].sort(
    (a, b) => b.length - a.length || a[0] - b[0],
  );
  const family = rankedFamilies[0];

  // Mejor propuesta dentro de la familia: cobertura, prioridad, alfabético.
  const stats = new Map<string, { coverage: number; priority: number }>();
  for (const index of family) {
    top[index].proposals.forEach((sel, priority) => {
      const entry = stats.get(sel) ?? { coverage: 0, priority };
      entry.coverage++;
      stats.set(sel, entry);
    });
  }
  const ranked = [...stats.entries()].sort(
    (a, b) =>
      b[1].coverage - a[1].coverage ||
      a[1].priority - b[1].priority ||
      a[0].localeCompare(b[0]),
  );
  return {
    winner: { selector: ranked[0][0], score: topScore },
    ambiguous: families.size > 1,
  };
}

/**
 * Intenta reparar el selector de una herramienta usando el modo visión.
 *
 * @param adapter Página actual.
 * @param map Tool map (se actualiza en memoria si la reparación tiene éxito).
 * @param name Nombre de la herramienta.
 * @param opts Opciones (`allowAmbiguous`).
 * @returns Descripción del intento de reparación.
 */
export async function repairTool(
  adapter: PageAdapter,
  map: ToolMap,
  name: string,
  opts: RepairOptions = {},
): Promise<RepairOutcome> {
  const tool = map.tools[name];
  if (!tool) return { name, repaired: false, from: '', reason: 'no-candidates' };
  const { scope } = parseSelectorScope(tool.selector);
  if (scope && (await adapter.queryAll(scope)).length === 0) {
    return { name, repaired: false, from: tool.selector, reason: 'scope-broken' };
  }
  const hints = hintsFromTool(name, tool);
  const candidates = await findCandidates(adapter, hints, scope);
  const outcomeBase = { name, from: tool.selector, candidates: candidates.length };
  if (candidates.length === 0) {
    return { ...outcomeBase, repaired: false, reason: 'no-candidates' };
  }
  const { winner, ambiguous } = pickWinner(candidates, opts.allowAmbiguous ?? false);
  if (!winner) {
    return { ...outcomeBase, repaired: false, reason: 'ambiguous', ambiguous: true };
  }
  const scoped = scope ? `${scope} ${winner.selector}` : winner.selector;
  map.tools[name] = { ...tool, selector: scoped };
  return { ...outcomeBase, repaired: true, to: scoped, ambiguous };
}

/**
 * Intenta reparar el selector de un contexto (dato de solo lectura).
 * Igual que {@link repairTool} pero sin acción: los candidatos se buscan
 * entre todos los elementos.
 *
 * @param adapter Página actual.
 * @param map Tool map (se actualiza en memoria si tiene éxito).
 * @param name Nombre del contexto.
 * @returns Descripción del intento de reparación.
 */
export async function repairContext(
  adapter: PageAdapter,
  map: ToolMap,
  name: string,
): Promise<RepairOutcome> {
  const ctx: ContextDef | undefined = map.context[name];
  if (!ctx) return { name, repaired: false, from: '', reason: 'no-candidates' };
  const { scope, target } = parseSelectorScope(ctx.selector);
  if (scope && (await adapter.queryAll(scope)).length === 0) {
    return { name, repaired: false, from: ctx.selector, reason: 'scope-broken' };
  }
  const words = new Set<string>(
    [name, ctx.format, ...target.split(/[.#[\](:)'"]+/)]
      .flatMap((s) => s.split(/[-_\s]+/))
      .map((w) => w.toLowerCase())
      .filter((w) => w.length >= 3),
  );
  const candidates = await findCandidates(
    adapter,
    { tags: [], words: [...words], requiredAttrs: [] },
    scope,
    '*',
  );
  const outcomeBase = { name, from: ctx.selector, candidates: candidates.length };
  if (candidates.length === 0) {
    return { ...outcomeBase, repaired: false, reason: 'no-candidates' };
  }
  const { winner } = pickWinner(candidates, false);
  if (!winner) {
    return { ...outcomeBase, repaired: false, reason: 'ambiguous', ambiguous: true };
  }
  const scoped = scope ? `${scope} ${winner.selector}` : winner.selector;
  map.context[name] = { ...ctx, selector: scoped };
  return { ...outcomeBase, repaired: true, to: scoped };
}
