/**
 * Escaneo de páginas reales (Puppeteer) para el módulo Tailwind.
 *
 * La extracción del DOM (classList + selector estable) se ejecuta dentro de
 * la página con una función auto-contenida; la clasificación de clases se
 * hace después en Node con `inspectClassList()` para no duplicar lógica.
 */
import { inspectClassList, isTailwindClass } from './inspector';
import type { TailwindScanEntry } from './types';

/** Datos crudos extraídos de la página. */
interface RawEntry {
  selector: string;
  tag: string;
  classList: string[];
  domId: string;
  ownClass: string;
}

/** Página mínima de Puppeteer que necesitamos (evita dependencia de tipos). */
export interface PageLike {
  evaluate<T>(fn: string | (() => T)): Promise<T>;
}

/**
 * Función auto-contenida que se serializa hacia `page.evaluate`.
 * No puede referenciar nada fuera de su propio cuerpo.
 */
const EXTRACT_SCRIPT = `(() => {
  function stableSelector(el) {
    const doc = el.ownerDocument;
    const id = el.getAttribute('id');
    if (id && doc.querySelectorAll('#' + (window.CSS ? CSS.escape(id) : id)).length === 1) return '#' + id;
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.indexOf('data-') === 0 && attr.value) {
        const sel = '[' + attr.name + '="' + attr.value.replace(/["\\\\]/g, '\\\\$&') + '"]';
        try { if (doc.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
      }
    }
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (!parent) return tag;
    const siblings = Array.from(parent.children).filter((c) => c.tagName === el.tagName);
    const idx = siblings.indexOf(el) + 1;
    const parentSel = parent === doc.body ? 'body' : stableSelector(parent);
    return parentSel + ' > ' + tag + ':nth-of-type(' + idx + ')';
  }
  return Array.from(document.querySelectorAll('[class]')).map((el) => ({
    selector: stableSelector(el),
    tag: el.tagName.toLowerCase(),
    classList: Array.from(el.classList),
    domId: el.getAttribute('id') || '',
    ownClass: '',
  }));
})()`;

/**
 * Escanea una página Puppeteer ya cargada y devuelve los elementos con
 * clases Tailwind clasificadas.
 *
 * @param page Página de Puppeteer (tras `page.goto`).
 * @param options `minClasses` (def. 2) y `maxElements` (def. 50).
 */
export async function scanPage(
  page: PageLike,
  options: { minClasses?: number; maxElements?: number } = {},
): Promise<TailwindScanEntry[]> {
  const minClasses = options.minClasses ?? 2;
  const maxElements = options.maxElements ?? 50;
  const raw = await page.evaluate<RawEntry[]>(EXTRACT_SCRIPT);

  const entries: TailwindScanEntry[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    const inspection = inspectClassList(item.classList);
    if (inspection.all.length < minClasses) continue;
    inspection.selector = item.selector;
    inspection.tag = item.tag;

    const source =
      item.domId ||
      item.classList.find((c) => !isTailwindClass(c)) ||
      `${item.tag}${entries.length + 1}`;
    let id =
      source
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .trim()
        .split(/\s+/)
        .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : ''))
        .join('') || `Element${entries.length + 1}`;
    while (seenIds.has(id)) id = `${id}X`;
    seenIds.add(id);

    entries.push({
      selector: item.selector,
      tag: item.tag,
      id,
      classList: item.classList,
      inspection,
    });
    if (entries.length >= maxElements) break;
  }
  return entries;
}
