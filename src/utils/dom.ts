/**
 * Utilidades DOM auto-contenidas para el núcleo de WebMCPcss.
 *
 * Funciones puras sobre cadenas y estructuras serializables: la lógica de
 * visión/reparación debe poder testearse sin navegador (regla de oro de
 * CONTRIBUTING.md).
 */

/**
 * Normaliza texto visible: colapsa espacios y recorta.
 *
 * @param text Texto crudo (`textContent`).
 * @returns Texto con espacios simples y sin extremos.
 */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Divide un nombre en palabras: camelCase, kebab-case, snake_case y
 * separadores se convierten en límites de palabra.
 *
 * `addToCart` → `['add', 'to', 'cart']`; `btn-add` → `['btn', 'add']`.
 *
 * @param name Identificador arbitrario.
 * @returns Palabras en minúsculas, sin vacíos.
 */
export function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_.]+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

/**
 * Comprueba si una clase CSS es "estable" (semántica) y no un hash de
 * build (Vue scoped, CSS Modules, emotion, styled-components...).
 *
 * Reglas: se rechazan `data-v-*`, `css-*`, `jsx-*`, `sc-*`, clases con
 * sufijos parecidos a hash y las puramente numéricas.
 *
 * @param cls Nombre de clase sin punto.
 * @returns `true` si la clase parece estable.
 */
export function isStableClass(cls: string): boolean {
  if (!cls || cls.length < 2) return false;
  if (/^(data-v-|css-|jsx-|sc-|emotion-|styled-|nv-|_)/i.test(cls)) return false;
  if (/^\d+$/.test(cls)) return false;
  // Sufijos tipo hash: guion/bajo seguido de 5+ caracteres alfanuméricos mixtos.
  if (/-_?[a-z0-9]{5,}$/i.test(cls) && /\d/.test(cls)) return false;
  if (/[a-f0-9]{6,}/i.test(cls)) return false;
  return true;
}

/**
 * Comprueba si un atributo es estable y útil como selector.
 * Se excluyen los atributos de scope de Vue (`data-v-*`).
 *
 * @param name Nombre del atributo.
 * @returns `true` si el atributo puede usarse para inferir selectores.
 */
export function isStableAttr(name: string): boolean {
  return !/^data-v-/i.test(name);
}

/**
 * Escapa un valor para usarlo dentro de un selector CSS con comillas
 * (`[aria-label="..."]`, `[data-x="..."]`).
 *
 * @param value Valor del atributo.
 * @returns Valor escapado (sin comillas envolventes).
 */
export function cssEscapeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Divide un selector en ámbito (`scope`) y objetivo (`target`) por el
 * último combinador descendiente de primer nivel.
 *
 * `.product-card .card-add` → `{ scope: '.product-card', target: '.card-add' }`.
 * `.card-add` → `{ scope: undefined, target: '.card-add' }`.
 *
 * Respeta paréntesis, corchetes y comillas para no cortar dentro de
 * `:not(...)`, `[attr="a b"]`, etc.
 *
 * @param selector Selector CSS compuesto.
 * @returns Ámbito (si existe) y objetivo.
 */
export function parseSelectorScope(selector: string): {
  scope?: string;
  target: string;
} {
  let depth = 0;
  let quote: string | null = null;
  let cut = -1;
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (depth === 0 && ch === ' ') cut = i;
  }
  if (cut <= 0 || cut >= selector.length - 1) return { target: selector.trim() };
  return {
    scope: selector.slice(0, cut).trim(),
    target: selector.slice(cut + 1).trim(),
  };
}

/**
 * Extrae palabras de interés (para la huella de visión) de la parte objetivo
 * de un selector: clases, ids y nombres/valores de atributos.
 *
 * `.product-card .card-add` → `['card', 'add']` (del target `.card-add`).
 *
 * @param selector Selector CSS.
 * @returns Palabras normalizadas y únicas.
 */
export function selectorWords(selector: string): string[] {
  const words = new Set<string>();
  const clsMatches = selector.matchAll(/\.([A-Za-z0-9_-]+)/g);
  for (const m of clsMatches) splitWords(m[1]).forEach((w) => words.add(w));
  const idMatches = selector.matchAll(/#([A-Za-z0-9_-]+)/g);
  for (const m of idMatches) splitWords(m[1]).forEach((w) => words.add(w));
  const attrMatches = selector.matchAll(
    /\[\s*([A-Za-z0-9_-]+)(?:[*^|$~]?=\s*("[^"]*"|'[^']*'|[^\]\s]+))?\s*\]/g,
  );
  for (const m of attrMatches) {
    splitWords(m[1]).forEach((w) => words.add(w));
    if (m[2]) {
      const raw = m[2].replace(/^["']|["']$/g, '');
      splitWords(raw).forEach((w) => words.add(w));
    }
  }
  return [...words];
}
