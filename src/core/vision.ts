/**
 * Módulo de "visión por computadora" (fallback de localización).
 *
 * Cuando un selector CSS deja de funcionar (rediseño del sitio), este módulo
 * puntúa los elementos candidatos de la página comparándolos con las pistas
 * disponibles (huella capturada, texto esperado, nombre humanizado de la
 * herramienta, tokens del selector antiguo y posición aproximada) para
 * encontrar el elemento equivalente y proponer un selector estable nuevo.
 *
 * Las funciones son puras y operan sobre {@link ElementSnapshot}, por lo que
 * se pueden testear sin navegador. El adaptador (Puppeteer o DOM) es quien
 * produce las instantáneas.
 */
import type { ElementSnapshot, Fingerprint } from '../types';

/** Pistas para localizar un elemento perdido. */
export interface VisionHints {
  /** Huella capturada previamente (la pista más fuerte). */
  fingerprint?: Fingerprint;
  /** Texto esperado del elemento. */
  text?: string;
  /** Nombre de la herramienta (se humaniza: `addToCart` → "add to cart"). */
  toolName?: string;
  /** Selector antiguo (sus tokens dan pistas de clases/atributos). */
  oldSelector?: string;
  /** Posición aproximada anterior (si se conoce). */
  rect?: { x: number; y: number; width: number; height: number };
  /** Restringe a etiquetas concretas (`button`, `input`...). */
  tags?: string[];
}

/** Candidato puntuado. */
export interface ScoredCandidate {
  candidate: ElementSnapshot;
  score: number;
}

/**
 * Convierte un identificador camelCase/kebab-case en palabras.
 * @param name P. ej. `addToCart` o `add-to-cart`.
 * @returns `"add to cart"`.
 */
export function humanize(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .toLowerCase()
    .trim();
}

/**
 * Normaliza texto para comparación: minúsculas, sin tildes ni signos.
 * @param s Texto de entrada.
 */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Similitud de conjuntos de tokens (coeficiente de Dice) entre dos textos.
 * @returns Valor en [0, 1].
 */
export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeText(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/** Extrae tokens útiles de un selector CSS (clases, ids, atributos). */
function selectorTokens(selector: string): string[] {
  const tokens: string[] = [];
  const re = /[.#]([\w-]+)|\[([\w-]+)(?:[~^$*|]?=)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(selector)) !== null) {
    tokens.push((m[1] || m[2]).toLowerCase());
  }
  return tokens;
}

/**
 * Puntúa un candidato frente a las pistas dadas. Pondera:
 * - Coincidencia de atributos de la huella (peso alto, sobre todo `data-*`).
 * - Similitud de texto visible.
 * - Coincidencia de etiqueta.
 * - Solapamiento de tokens del selector antiguo con clases/atributos.
 * - Cercanía posicional (si hay rects disponibles).
 *
 * @param candidate Instantánea del elemento candidato.
 * @param hints Pistas de búsqueda.
 * @returns Puntuación en [0, 1].
 */
export function scoreCandidate(candidate: ElementSnapshot, hints: VisionHints): number {
  let score = 0;
  let weight = 0;

  const fp = hints.fingerprint;

  // 1) Atributos de la huella (la señal más fiable).
  if (fp?.attrs && Object.keys(fp.attrs).length > 0) {
    weight += 4;
    const keys = Object.keys(fp.attrs);
    let matched = 0;
    for (const k of keys) {
      const cv = candidate.attrs[k];
      if (cv !== undefined) {
        matched += cv === fp.attrs[k] ? 1 : 0.5;
        if (k.startsWith('data-') && cv === fp.attrs[k]) matched += 0.5;
      }
    }
    score += 4 * Math.min(1, matched / keys.length);
  }

  // 2) Texto visible e identificadores (id, data-*, clases del selector).
  // Comparar el nombre de la herramienta contra los identificadores del
  // candidato es robusto frente a sitios en otros idiomas: `addToCart`
  // casa con `data-action="add-to-cart"` aunque el botón diga "Añadir".
  const idText = humanize(
    Object.entries(candidate.attrs)
      .filter(([k]) => k !== 'href' && k !== 'type')
      .map(([, v]) => v)
      .join(' ') +
      ' ' +
      candidate.selector.replace(/[[\]"'=#.]/g, ' '),
  );
  const expectedText = hints.text ?? fp?.text;
  const nameWords = hints.toolName ? humanize(hints.toolName) : '';
  if (expectedText || nameWords) {
    weight += 3;
    let sim = 0;
    if (expectedText) sim = tokenSimilarity(candidate.text, expectedText);
    if (nameWords) {
      sim = Math.max(
        sim,
        tokenSimilarity(idText, nameWords),
        tokenSimilarity(candidate.text, nameWords),
      );
    }
    score += 3 * sim;
  }

  // 3) Etiqueta.
  const expectedTag = fp?.tag ?? undefined;
  if (expectedTag) {
    weight += 1;
    if (candidate.tag === expectedTag) score += 1;
  }
  if (hints.tags && hints.tags.length > 0) {
    weight += 1;
    if (hints.tags.includes(candidate.tag)) score += 1;
  }

  // 4) Tokens del selector antiguo vs. clases/atributos del candidato.
  // Señal SOLO POSITIVA (bonus): si el sitio renombró todo, la ausencia de
  // coincidencia no debe penalizar a un candidato bueno por otras señales.
  let bonus = 0;
  if (hints.oldSelector) {
    const tokens = selectorTokens(hints.oldSelector);
    if (tokens.length > 0) {
      const hay = normalizeText(
        candidate.selector + ' ' + Object.entries(candidate.attrs).flat().join(' '),
      );
      const hit = tokens.filter((t) => hay.includes(normalizeText(t))).length;
      bonus += 0.5 * Math.min(1, hit / tokens.length);
    }
  }

  // 5) Posición aproximada.
  if (hints.rect && candidate.rect && (candidate.rect.width || candidate.rect.height)) {
    weight += 0.5;
    const dx = hints.rect.x - candidate.rect.x;
    const dy = hints.rect.y - candidate.rect.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    score += 0.5 * Math.max(0, 1 - dist / 800);
  }

  if (weight === 0) return 0;
  const normalized = Math.min(1, score / weight + bonus);
  return candidate.visible ? normalized : normalized * 0.5;
}

/**
 * Encuentra el mejor candidato para las pistas dadas.
 *
 * @param candidates Instantáneas de la página (de `adapter.snapshot()`).
 * @param hints Pistas de búsqueda.
 * @param threshold Puntuación mínima aceptable (por defecto 0.45).
 * @returns El mejor candidato con su puntuación, o `null` si ninguno supera el umbral.
 */
export function findBestCandidate(
  candidates: ElementSnapshot[],
  hints: VisionHints,
  threshold = 0.45,
): ScoredCandidate | null {
  let best: ScoredCandidate | null = null;
  for (const candidate of candidates) {
    const score = scoreCandidate(candidate, hints);
    if (score >= threshold && (!best || score > best.score)) {
      best = { candidate, score };
    }
  }
  return best;
}
