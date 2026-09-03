/**
 * Capacidad opcional de un adaptador: **mutar** la página (estilos, texto,
 * estructura, subida de archivos, capturas). Sigue el mismo patrón que
 * `ApiToolSource` en `src/adapters/page-adapter.ts`: los adaptadores que la
 * implementan (`DomAdapter`, `PuppeteerAdapter`) habilitan las acciones
 * del módulo `prompt`; los que no, reciben un error descriptivo.
 *
 * Las funciones `*InPage` son AUTO-CONTENIDAS para poder serializarse al
 * navegador con `page.$eval` / `page.evaluate` y ejecutarse igual sobre
 * jsdom en los tests.
 */
import type { PageAdapter } from '../adapters/page-adapter';
import type { Placement } from './types';

/** Operaciones de mutación del DOM que el ejecutor de prompts necesita. */
export interface DomMutator {
  /** Aplica estilos inline a los elementos que casen (`all`) o al primero. */
  setStyles(
    selector: string,
    styles: Record<string, string>,
    all?: boolean,
  ): Promise<number>;
  /** Cambia el texto visible (o el `value`/`placeholder` en campos). */
  setText(selector: string, text: string): Promise<void>;
  /** Elimina del DOM los elementos que casen (`all`) o el primero. */
  remove(selector: string, all?: boolean): Promise<number>;
  /** Oculta con `display: none !important` (reversible). */
  hide(selector: string, all?: boolean): Promise<number>;
  /** Recoloca un elemento respecto a un destino. */
  move(selector: string, destination: string, placement: Placement): Promise<void>;
  /** Posiciona un elemento en coordenadas absolutas del documento. */
  moveTo(selector: string, x: number, y: number): Promise<void>;
  /** Asigna archivos locales a un `input[type="file"]` (o al input de un contenedor). */
  uploadFiles(
    selector: string,
    paths: string[],
  ): Promise<{ inputSelector: string; count: number }>;
  /** Captura de pantalla PNG en base64, si el adaptador lo soporta. */
  screenshot?(): Promise<string | null>;
  /** Número de elementos que casan con el selector. */
  count(selector: string): Promise<number>;
}

/** Type guard: ¿el adaptador puede mutar la página? */
export function canMutate(adapter: PageAdapter): adapter is PageAdapter & DomMutator {
  const a = adapter as Partial<DomMutator>;
  return (
    typeof a.setStyles === 'function' &&
    typeof a.setText === 'function' &&
    typeof a.remove === 'function' &&
    typeof a.hide === 'function' &&
    typeof a.move === 'function' &&
    typeof a.uploadFiles === 'function'
  );
}

/* ------------------------------------------------------------------ */
/* Funciones auto-contenidas (DOM real o jsdom)                        */
/* ------------------------------------------------------------------ */

/**
 * Aplica estilos inline. Devuelve el número de elementos modificados.
 * Usa `setProperty(..., 'important')` para ganar a las hojas de estilo.
 */
export function setStylesInPage(
  doc: Document,
  selector: string,
  styles: Record<string, string>,
  all: boolean,
): number {
  const targets = all
    ? Array.from(doc.querySelectorAll(selector))
    : [doc.querySelector(selector)].filter((e): e is Element => e !== null);
  for (const el of targets) {
    const style = (el as HTMLElement).style;
    for (const [prop, value] of Object.entries(styles)) {
      const name = prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      style.setProperty(name, value, 'important');
    }
  }
  return targets.length;
}

/** Cambia el texto de un elemento (value/placeholder en campos de formulario). */
export function setTextInPage(doc: Document, selector: string, text: string): boolean {
  const el = doc.querySelector(selector);
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    const input = el as HTMLInputElement;
    const type = (input.getAttribute('type') || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'reset') {
      input.value = text;
    } else if (input.value) {
      input.value = text;
    } else {
      input.setAttribute('placeholder', text);
    }
    return true;
  }
  if (tag === 'img') {
    el.setAttribute('alt', text);
    return true;
  }
  // Conserva hijos no textuales (iconos) si el elemento mezcla texto y nodos.
  const textNodes = Array.from(el.childNodes).filter(
    (n) => n.nodeType === 3 && (n.textContent || '').trim(),
  );
  if (textNodes.length > 0 && el.childNodes.length > textNodes.length) {
    textNodes[0].textContent = text;
    for (const n of textNodes.slice(1)) n.textContent = '';
  } else {
    el.textContent = text;
  }
  return true;
}

/** Elimina elementos. Devuelve cuántos se eliminaron. */
export function removeInPage(doc: Document, selector: string, all: boolean): number {
  const targets = all
    ? Array.from(doc.querySelectorAll(selector))
    : [doc.querySelector(selector)].filter((e): e is Element => e !== null);
  for (const el of targets) el.parentNode?.removeChild(el);
  return targets.length;
}

/** Recoloca un elemento respecto a un destino. */
export function moveInPage(
  doc: Document,
  selector: string,
  destination: string,
  placement: string,
): boolean {
  const el = doc.querySelector(selector);
  const dest = doc.querySelector(destination);
  if (!el || !dest || el === dest || el.contains(dest)) return false;
  switch (placement) {
    case 'before':
      dest.parentNode?.insertBefore(el, dest);
      break;
    case 'after':
      dest.parentNode?.insertBefore(el, dest.nextSibling);
      break;
    case 'start':
      dest.insertBefore(el, dest.firstChild);
      break;
    default:
      dest.appendChild(el);
  }
  return true;
}

/** Posiciona un elemento en coordenadas absolutas del documento. */
export function moveToInPage(
  doc: Document,
  selector: string,
  x: number,
  y: number,
): boolean {
  const el = doc.querySelector(selector) as HTMLElement | null;
  if (!el) return false;
  el.style.setProperty('position', 'absolute', 'important');
  el.style.setProperty('left', `${x}px`, 'important');
  el.style.setProperty('top', `${y}px`, 'important');
  el.style.setProperty('margin', '0', 'important');
  return true;
}

/**
 * Localiza el `input[type="file"]` asociado a un selector: el propio
 * elemento, uno dentro de él, el asociado a un `<label for>`, uno en el
 * formulario contenedor o, como último recurso, el único de la página.
 * Devuelve un selector estable para el input o `null`.
 */
export function findFileInputInPage(doc: Document, selector: string): string | null {
  const el = doc.querySelector(selector);
  if (!el) return null;
  const isFile = (e: Element | null): e is HTMLInputElement =>
    !!e &&
    e.tagName.toLowerCase() === 'input' &&
    (e.getAttribute('type') || '').toLowerCase() === 'file';
  let input: HTMLInputElement | null = null;
  if (isFile(el)) input = el;
  if (!input) input = el.querySelector('input[type="file"]');
  if (!input && el.tagName.toLowerCase() === 'label') {
    const forId = el.getAttribute('for');
    const byFor = forId ? doc.getElementById(forId) : null;
    if (isFile(byFor)) input = byFor;
  }
  if (!input) {
    const form = el.closest('form');
    input = form ? form.querySelector('input[type="file"]') : null;
  }
  if (!input) {
    // Botón "Subir imagen" con un input oculto hermano/cercano.
    let scope: Element | null = el.parentElement;
    for (let depth = 0; scope && depth < 3 && !input; depth++) {
      input = scope.querySelector('input[type="file"]');
      scope = scope.parentElement;
    }
  }
  if (!input) {
    const allInputs = doc.querySelectorAll('input[type="file"]');
    if (allInputs.length === 1) input = allInputs[0] as HTMLInputElement;
  }
  if (!input) return null;
  // Selector estable: id → name → marca temporal data-webmcp-upload.
  const id = input.getAttribute('id');
  if (id && doc.querySelectorAll(`#${id.replace(/([^\w-])/g, '\\$1')}`).length === 1) {
    return `#${id.replace(/([^\w-])/g, '\\$1')}`;
  }
  const name = input.getAttribute('name');
  if (name && doc.querySelectorAll(`input[type="file"][name="${name}"]`).length === 1) {
    return `input[type="file"][name="${name}"]`;
  }
  const marker = `u${Date.now().toString(36)}`;
  input.setAttribute('data-webmcp-upload', marker);
  return `input[type="file"][data-webmcp-upload="${marker}"]`;
}
