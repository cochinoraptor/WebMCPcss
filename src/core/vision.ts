/**
 * Modo visión: cuando un selector se rompe, localiza el elemento por su
 * **huella** (atributos `data-*`, texto visible, `aria-label`, etiqueta,
 * clases estables) e infiere un selector estable nuevo.
 *
 * Prioridad de inferencia (README): `data-*` → `id` → `name`/`aria-label`
 * → clases estables.
 *
 * Lecciones del POC original incorporadas aquí:
 * - La etiqueta sola no basta (213 botones candidatos para 212 tarjetas):
 *   se exige al menos una coincidencia de palabras de la huella.
 * - La desambiguación es por **contexto** (el card padre via `scope`),
 *   no solo por el botón.
 */
import type { ElementInfo, PageAdapter } from '../adapters/PageAdapter';
import type { ToolDef } from '../types';
import {
  cssEscapeValue,
  isStableAttr,
  isStableClass,
  parseSelectorScope,
  selectorWords,
  splitWords,
} from '../utils/dom';

/**
 * Selector por el que se buscan candidatos accionables cuando falla una
 * herramienta.
 */
export const ACTIONABLE_SELECTOR =
  'button, a, input, select, textarea, form, [role="button"], [role="link"], ' +
  '[role="menuitem"], [role="option"], [onclick]';

/** Etiquetas con las que se puntúa un candidato por defecto. */
const DEFAULT_TAGS = ['button', 'a', 'input'];

/** Pistas derivadas de la definición rota (nombre, descripción, selector). */
export interface VisionHints {
  /** Etiquetas plausibles para el elemento buscado. */
  tags: string[];
  /** Palabras clave que describen al elemento (clases, aria-label, texto...). */
  words: string[];
  /** Atributos que la herramienta declara como parámetros (`aria-label`, ...). */
  requiredAttrs: string[];
}

/** Un candidato puntuado por el modo visión. */
export interface VisionCandidate {
  /** Huella del elemento. */
  info: ElementInfo;
  /** Puntuación (≥ 1; 0 se descarta). */
  score: number;
  /** Selector estable inferido (primera propuesta, con ámbito). */
  selector: string;
  /** Todas las propuestas de selector estable (sin ámbito). */
  proposals: string[];
}

/**
 * Deriva las pistas de visión de una herramienta rota: nombre camelCase,
 * descripción, tokens del selector objetivo y atributos de sus parámetros.
 *
 * `addToCart` con `attr(aria-label)` aporta `['add','to','cart']` y exige
 * que el candidato tenga `aria-label`.
 *
 * @param name Nombre de la herramienta (`addToCart`).
 * @param tool Definición de la herramienta cuyo selector se rompió.
 * @returns Pistas para puntuar candidatos.
 */
export function hintsFromTool(name: string, tool: ToolDef): VisionHints {
  const words = new Set<string>();
  splitWords(name).forEach((w) => words.add(w));
  if (tool.description) splitWords(tool.description).forEach((w) => words.add(w));
  selectorWords(parseSelectorScope(tool.selector).target).forEach((w) => words.add(w));
  const requiredAttrs: string[] = [];
  for (const source of Object.values(tool.params)) {
    if (source.source === 'attr') {
      requiredAttrs.push(source.value);
      splitWords(source.value).forEach((w) => words.add(w));
    } else if (source.source === 'value' || source.source === 'text') {
      if (source.selector) selectorWords(source.selector).forEach((w) => words.add(w));
    }
  }
  return {
    tags: DEFAULT_TAGS,
    words: [...words].filter((w) => w.length >= 3),
    requiredAttrs,
  };
}

/**
 * Puntúa un candidato contra las pistas.
 *
 * Coincidencias de palabras: exactas o por prefijo compartido (≥ 4 letras,
 * para tolerar leves variantes morfológicas). Sin ninguna coincidencia de
 * palabras la puntuación es 0 (lección del POC: la etiqueta sola no basta).
 *
 * @param info Huella del candidato.
 * @param hints Pistas de la definición rota.
 * @returns Puntuación del candidato (0 = descartado).
 */
export function scoreCandidate(info: ElementInfo, hints: VisionHints): number {
  const weighted = candidateWords(info);
  let wordScore = 0;
  for (const hint of hints.words) {
    let best = 0;
    for (const [word, weight] of weighted) {
      if (wordsMatch(hint, word)) best = Math.max(best, weight);
    }
    wordScore += best;
  }
  if (wordScore === 0) return 0;
  let score = wordScore;
  if (hints.tags.includes(info.tag)) score += 3;
  for (const attr of hints.requiredAttrs) {
    if (Object.prototype.hasOwnProperty.call(info.attrs, attr)) score += 1;
  }
  return score;
}

/**
 * Busca candidatos en la página, filtra por ámbito (`scope`, p. ej. el card
 * padre) y los puntúa. Devuelve los candidatos con puntuación > 0, ordenados
 * de mayor a menor.
 *
 * @param adapter Adaptador de la página actual.
 * @param hints Pistas de la definición rota.
 * @param scope Selector de ámbito que debe matchear algún ancestro.
 * @param candidateSelector Selector para enumerar candidatos.
 * @returns Candidatos puntuados (puede ser vacío).
 */
export async function findCandidates(
  adapter: PageAdapter,
  hints: VisionHints,
  scope?: string,
  candidateSelector = ACTIONABLE_SELECTOR,
): Promise<VisionCandidate[]> {
  let scopeActive = false;
  if (scope) {
    scopeActive = (await adapter.queryAll(scope)).length > 0;
  }
  const elements = await adapter.queryAll(candidateSelector);
  const scored: VisionCandidate[] = [];
  for (let index = 0; index < elements.length; index++) {
    const el = elements[index];
    if (scopeActive && !(await el.closest(scope as string))) continue;
    const info = await el.info();
    const score = scoreCandidate(info, hints);
    if (score > 0) {
      const proposals = selectorProposals(info);
      scored.push({
        info,
        score,
        proposals,
        selector: scope
          ? `${scope} ${proposals[0] ?? info.tag}`
          : (proposals[0] ?? info.tag),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Infiera un selector **estable** para un elemento, con la prioridad
 * documentada: `data-*` → `id` → `name`/`aria-label` → clases estables.
 * Si se pasa `scope`, se prefija como descendiente (`.card .btn`).
 *
 * @param info Huella del elemento.
 * @param scope Selector de ámbito opcional.
 * @returns Selector CSS inferido (la primera propuesta de
 *   {@link selectorProposals}).
 */
export function inferStableSelector(info: ElementInfo, scope?: string): string {
  const proposals = selectorProposals(info);
  const first = proposals[0] ?? info.tag;
  return scope ? `${scope} ${first}` : first;
}

/**
 * Genera las propuestas de selector estable para un elemento, en orden de
 * prioridad: `data-*` → `id` → `name`/`aria-label` → clases estables.
 *
 * La reparación elige entre las propuestas la que mejor **cubre** a todos
 * los candidatos de la herramienta (un selector de herramienta debe
 * generalizar, no apuntar a un único elemento).
 *
 * @param info Huella del elemento.
 * @returns Selectores propuestos, del más al menos prioritario.
 */
export function selectorProposals(info: ElementInfo): string[] {
  const proposals: string[] = [];

  // 1. Atributos data-* estables con valor.
  const dataAttrs = Object.entries(info.attrs)
    .filter(([name, value]) => name.startsWith('data-') && isStableAttr(name) && value)
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [name, value] of dataAttrs) {
    proposals.push(`[${name}="${cssEscapeValue(value)}"]`);
  }

  // 2. id estable.
  if (info.id && isStableClass(info.id)) {
    proposals.push(`#${info.id}`);
  }

  // 3. name / aria-label.
  const name = info.attrs['name'];
  if (name) proposals.push(`[name="${cssEscapeValue(name)}"]`);
  const aria = info.attrs['aria-label'];
  if (aria) proposals.push(`[aria-label="${cssEscapeValue(aria)}"]`);

  // 4. Clases estables.
  for (const cls of info.classes) {
    if (isStableClass(cls)) proposals.push(`.${cls}`);
  }

  // Último recurso: la etiqueta desnuda.
  if (proposals.length === 0) {
    proposals.push(info.tag);
  }
  return [...new Set(proposals)];
}

/**
 * Comprueba si dos palabras coinciden: exactas, o por prefijo compartido
 * de al menos 4 letras (`agrega` ≈ `agregar`).
 */
function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length >= 4 && b.length >= 4) {
    return a.startsWith(b) || b.startsWith(a);
  }
  return false;
}

/**
 * Construye el mapa palabra → peso máximo de la huella de un candidato.
 *
 * Pesos: clases estables e `id` (2), atributos `data-*` estables (2),
 * `aria-label` (1.5 → 1), otros atributos y texto (1).
 */
function candidateWords(info: ElementInfo): Map<string, number> {
  const weighted = new Map<string, number>();
  const add = (word: string, weight: number) => {
    if (word.length < 3) return;
    weighted.set(word, Math.max(weighted.get(word) ?? 0, weight));
  };
  for (const cls of info.classes) {
    if (isStableClass(cls)) splitWords(cls).forEach((w) => add(w, 2));
  }
  if (info.id) splitWords(info.id).forEach((w) => add(w, 2));
  for (const [name, value] of Object.entries(info.attrs)) {
    if (!isStableAttr(name)) continue;
    const weight = name.startsWith('data-') ? 2 : 1;
    splitWords(name).forEach((w) => add(w, weight));
    if (value && value.length <= 80) splitWords(value).forEach((w) => add(w, weight));
  }
  splitWords(info.text).forEach((w) => add(w, 1));
  return weighted;
}
