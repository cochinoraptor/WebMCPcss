/**
 * Tailwind Inspector: detecta y clasifica clases de Tailwind CSS.
 *
 * DECISIÓN DE DISEÑO: la clasificación se basa en patrones (regex) en lugar
 * de depender del paquete `tailwindcss`. Ventajas: cero dependencias nuevas,
 * funciona dentro del navegador (los patrones se pueden serializar) y no
 * requiere el archivo de configuración del sitio. Cubre las utilidades core
 * de Tailwind v3/v4, variantes (`md:`, `hover:`...), negativos (`-mt-2`) y
 * valores arbitrarios (`p-[13px]`).
 */
import type {
  ClassifiedClass,
  TailwindCategory,
  TailwindClasses,
  TailwindScanEntry,
} from './types';

/** Paleta de colores estándar de Tailwind. */
const PALETTE =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white|transparent|current|inherit';

/** Tabla ordenada de categorías → patrones (la primera que casa gana). */
const CATEGORY_PATTERNS: Array<[TailwindCategory, RegExp]> = [
  // Colores (antes que typography/backgrounds/borders para capturar *-{paleta}).
  [
    'colors',
    new RegExp(
      `^(bg|text|border|ring|fill|stroke|accent|caret|divide|outline|decoration|shadow|from|via|to)-(${PALETTE})(-\\d{2,3})?(/\\d{1,3})?$`,
    ),
  ],
  ['colors', /^(bg|text|border|ring|fill|stroke|accent|caret)-\[#[0-9a-fA-F]{3,8}\]$/],
  // Tipografía.
  [
    'typography',
    /^(text-(xs|sm|base|lg|xl|\dxl|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)|font-|tracking-|leading-|list-|whitespace-|break-|hyphens-|indent-|align-|truncate$|italic$|not-italic$|underline|overline$|line-through$|no-underline$|uppercase$|lowercase$|capitalize$|normal-case$|antialiased$|subpixel-antialiased$|text-\[)/,
  ],
  // Fondos (no color): gradientes, posición, repetición...
  [
    'backgrounds',
    /^bg-(gradient-|none$|auto$|cover$|contain$|center|top|bottom|left|right|repeat|no-repeat|fixed$|local$|scroll$|origin-|clip-|blend-)/,
  ],
  // Espaciado.
  ['spacing', /^-?(p|m)(t|r|b|l|x|y|s|e)?-(\d+(\.\d+)?|px|auto|\[.+\])$/],
  ['spacing', /^-?space-(x|y)-(\d+(\.\d+)?|px|reverse|\[.+\])$/],
  // Tamaño.
  [
    'sizing',
    /^(w|h|size)-(\d+(\.\d+)?|px|auto|full|screen|min|max|fit|svh|lvh|dvh|\d+\/\d+|\[.+\])$/,
  ],
  ['sizing', /^(min-w|min-h|max-w|max-h)-/],
  // Flexbox y Grid.
  [
    'flexbox-grid',
    /^(flex-|grid-|col-|row-|gap-|justify-|items-|content-|self-|place-|order-|basis-|grow|shrink)/,
  ],
  // Layout.
  [
    'layout',
    /^(block$|inline|flex$|grid$|table|hidden$|contents$|flow-root$|list-item$|container$|static$|fixed$|absolute$|relative$|sticky$|inset-|top-|right-|bottom-|left-|-top-|-right-|-bottom-|-left-|z-|float-|clear-|isolate|object-|overflow-|overscroll-|visible$|invisible$|collapse$|columns-|box-|aspect-|sr-only$|not-sr-only$)/,
  ],
  // Bordes.
  [
    'borders',
    /^(border($|-[trblxyse]$|-\d|-\[|-(solid|dashed|dotted|double|hidden|none)$)|rounded|divide-|outline|ring($|-\d|-\[|-inset$|-offset-))/,
  ],
  // Efectos y filtros.
  [
    'effects',
    /^(shadow|opacity-|mix-blend-|blur|brightness-|contrast-|drop-shadow|grayscale|hue-rotate-|invert|saturate-|sepia|backdrop-)/,
  ],
  // Transformaciones.
  ['transforms', /^-?(scale-|rotate-|translate-|skew-|origin-)|^transform/],
  // Transiciones y animación.
  ['transitions', /^(transition|duration-|ease-|delay-|animate-)/],
  // Interactividad.
  [
    'interactivity',
    /^(cursor-|select-|pointer-events-|resize|scroll-|snap-|touch-|will-change-|appearance-|caret-)/,
  ],
];

/**
 * Separa las variantes de una clase Tailwind.
 * @param raw Clase completa, p. ej. `md:hover:bg-blue-500`.
 * @returns `{ base: 'bg-blue-500', variants: ['md', 'hover'] }`.
 */
export function splitVariants(raw: string): { base: string; variants: string[] } {
  // Los ':' dentro de valores arbitrarios ([...]) no separan variantes.
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of raw) {
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === ':' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return { base: parts[parts.length - 1], variants: parts.slice(0, -1) };
}

/**
 * Clasifica una clase en su categoría Tailwind.
 * @param raw Clase (con o sin variantes).
 * @returns La clase clasificada, o `null` si no parece de Tailwind.
 */
export function classifyClass(raw: string): ClassifiedClass | null {
  const { base, variants } = splitVariants(raw.trim());
  if (!base) return null;
  for (const [category, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(base)) return { raw, base, variants, category };
  }
  return null;
}

/**
 * ¿La clase parece una utilidad de Tailwind?
 * @param raw Clase a comprobar.
 */
export function isTailwindClass(raw: string): boolean {
  return classifyClass(raw) !== null;
}

/**
 * Inspecciona una lista de clases y las agrupa por categoría.
 * Función pura: útil en Node, tests y navegador.
 *
 * @param classList Lista de clases (p. ej. `Array.from(el.classList)`).
 */
export function inspectClassList(classList: string[]): TailwindClasses {
  const result: TailwindClasses = { classes: {}, all: [], unknown: [] };
  for (const cls of classList) {
    const classified = classifyClass(cls);
    if (!classified) {
      result.unknown.push(cls);
      continue;
    }
    result.all.push(cls);
    (result.classes[classified.category] ??= []).push(cls);
  }
  return result;
}

/**
 * Inspecciona un elemento del DOM y extrae sus clases Tailwind clasificadas.
 *
 * @param element Elemento HTML (DOM real o jsdom).
 * @returns Estructura con clases por categoría, selector estable y etiqueta.
 */
export function inspectElement(element: Element): TailwindClasses {
  const inspection = inspectClassList(Array.from(element.classList));
  inspection.tag = element.tagName.toLowerCase();
  inspection.selector = buildStableSelector(element);
  return inspection;
}

/**
 * Construye un selector estable para un elemento (id → data-* → clase no
 * Tailwind → tag:nth-of-type). Las clases de Tailwind NO se usan como
 * selector: cambiarían justo al editarlas.
 *
 * @param el Elemento del DOM.
 */
export function buildStableSelector(el: Element): string {
  const doc = el.ownerDocument;
  const id = el.getAttribute('id');
  if (id && doc.querySelectorAll(`#${id}`).length === 1) return `#${id}`;
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-') && attr.value) {
      const sel = `[${attr.name}="${attr.value.replace(/["\\]/g, '\\$&')}"]`;
      if (doc.querySelectorAll(sel).length === 1) return sel;
    }
  }
  const tag = el.tagName.toLowerCase();
  const ownClass = Array.from(el.classList).find((c) => !isTailwindClass(c));
  if (ownClass) {
    const sel = `${tag}.${ownClass}`;
    try {
      if (doc.querySelectorAll(sel).length === 1) return sel;
    } catch {
      /* clase con caracteres raros */
    }
  }
  const parent = el.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
  const idx = siblings.indexOf(el) + 1;
  const parentSel = parent === doc.body ? 'body' : buildStableSelector(parent);
  return `${parentSel} > ${tag}:nth-of-type(${idx})`;
}

/**
 * Escanea un documento y devuelve todos los elementos con clases Tailwind.
 *
 * @param doc Documento DOM.
 * @param options `minClasses`: mínimo de clases Tailwind para incluir un
 *   elemento (def. 2, para evitar ruido); `maxElements`: tope (def. 50).
 */
export function scanDocument(
  doc: Document,
  options: { minClasses?: number; maxElements?: number } = {},
): TailwindScanEntry[] {
  const minClasses = options.minClasses ?? 2;
  const maxElements = options.maxElements ?? 50;
  const entries: TailwindScanEntry[] = [];
  const seenIds = new Set<string>();

  for (const el of Array.from(doc.querySelectorAll('[class]'))) {
    const classList = Array.from(el.classList);
    const inspection = inspectClassList(classList);
    if (inspection.all.length < minClasses) continue;

    const selector = buildStableSelector(el);
    inspection.selector = selector;
    inspection.tag = el.tagName.toLowerCase();

    // Identificador legible y único para nombres de herramientas.
    let id = readableId(el, entries.length + 1);
    while (seenIds.has(id)) id = `${id}X`;
    seenIds.add(id);

    entries.push({
      selector,
      tag: el.tagName.toLowerCase(),
      id,
      classList,
      inspection,
    });
    if (entries.length >= maxElements) break;
  }
  return entries;
}

/** Deriva un identificador PascalCase legible para un elemento. */
function readableId(el: Element, index: number): string {
  const source =
    el.getAttribute('id') ||
    Array.from(el.classList).find((c) => !isTailwindClass(c)) ||
    `${el.tagName.toLowerCase()}${index}`;
  const cleaned = source
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
  return cleaned || `Element${index}`;
}
