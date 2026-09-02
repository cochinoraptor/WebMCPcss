/**
 * Tailwind Editor: modifica clases Tailwind de elementos del DOM con
 * aplicación en tiempo real, historial (undo/redo) y exportación de diffs.
 *
 * Funciona sobre cualquier DOM estándar (navegador real, jsdom o el DOM de
 * una página Puppeteer si se ejecuta serializado).
 */
import { buildStableSelector } from './inspector';
import { ChangeHistory } from './history';
import type { ElementDiff, TailwindChange } from './types';

/** Editor de clases Tailwind con historial. */
export class TailwindEditor {
  private readonly changes: TailwindChange[] = [];
  /** `class` original de cada elemento tocado (para diffs). */
  private readonly originals = new Map<Element, string>();

  /**
   * @param history Historial a usar (se crea uno propio por defecto).
   */
  constructor(private readonly history: ChangeHistory = new ChangeHistory()) {}

  /**
   * Añade una clase Tailwind al elemento (aplicación inmediata en el DOM).
   * @param element Elemento objetivo.
   * @param className Clase a añadir (`p-8`, `md:bg-blue-500`...).
   * @returns `true` si la clase se añadió (no estaba ya).
   */
  addClass(element: Element, className: string): boolean {
    if (element.classList.contains(className)) return false;
    this.snapshot(element);
    element.classList.add(className);
    this.record(element, { op: 'add', className });
    this.history.push({
      label: `add ${className} → ${this.sel(element)}`,
      undo: () => element.classList.remove(className),
      redo: () => element.classList.add(className),
    });
    return true;
  }

  /**
   * Elimina una clase del elemento.
   * @param element Elemento objetivo.
   * @param className Clase a eliminar.
   * @returns `true` si la clase existía y se eliminó.
   */
  removeClass(element: Element, className: string): boolean {
    if (!element.classList.contains(className)) return false;
    this.snapshot(element);
    element.classList.remove(className);
    this.record(element, { op: 'remove', className });
    this.history.push({
      label: `remove ${className} → ${this.sel(element)}`,
      undo: () => element.classList.add(className),
      redo: () => element.classList.remove(className),
    });
    return true;
  }

  /**
   * Reemplaza una clase por otra (p. ej. `p-4` → `p-8`).
   * Si la clase antigua no existe, simplemente añade la nueva.
   *
   * @param element Elemento objetivo.
   * @param oldClass Clase a sustituir.
   * @param newClass Clase nueva.
   */
  replaceClass(element: Element, oldClass: string, newClass: string): void {
    this.snapshot(element);
    const hadOld = element.classList.contains(oldClass);
    if (hadOld) element.classList.remove(oldClass);
    element.classList.add(newClass);
    this.record(element, { op: 'replace', className: oldClass, newClassName: newClass });
    this.history.push({
      label: `replace ${oldClass} → ${newClass} en ${this.sel(element)}`,
      undo: () => {
        element.classList.remove(newClass);
        if (hadOld) element.classList.add(oldClass);
      },
      redo: () => {
        if (hadOld) element.classList.remove(oldClass);
        element.classList.add(newClass);
      },
    });
  }

  /**
   * Alterna una clase (la añade si falta, la quita si está).
   * @param element Elemento objetivo.
   * @param className Clase a alternar.
   * @returns `true` si tras la operación la clase está presente.
   */
  toggleClass(element: Element, className: string): boolean {
    this.snapshot(element);
    const nowPresent = element.classList.toggle(className);
    this.record(element, { op: 'toggle', className });
    this.history.push({
      label: `toggle ${className} → ${this.sel(element)}`,
      undo: () => element.classList.toggle(className),
      redo: () => element.classList.toggle(className),
    });
    return nowPresent;
  }

  /** Deshace el último cambio. @returns Etiqueta del cambio o `null`. */
  undo(): string | null {
    return this.history.undo();
  }

  /** Rehace el último cambio deshecho. @returns Etiqueta o `null`. */
  redo(): string | null {
    return this.history.redo();
  }

  /** Historial subyacente (para inspección avanzada). */
  getHistory(): ChangeHistory {
    return this.history;
  }

  /** Registro cronológico de operaciones realizadas. */
  getChanges(): TailwindChange[] {
    return [...this.changes];
  }

  /**
   * Exporta el diff de cada elemento tocado: `class` original vs. actual.
   * Útil para llevar los cambios de vuelta al código fuente.
   */
  exportDiffs(): ElementDiff[] {
    return Array.from(this.originals.entries())
      .map(([el, before]) => ({
        selector: this.sel(el),
        before,
        after: el.getAttribute('class') ?? '',
      }))
      .filter((d) => d.before !== d.after);
  }

  /** Guarda el `class` original del elemento la primera vez que se toca. */
  private snapshot(element: Element): void {
    if (!this.originals.has(element)) {
      this.originals.set(element, element.getAttribute('class') ?? '');
    }
  }

  /** Registra la operación en el log cronológico. */
  private record(
    element: Element,
    change: Omit<TailwindChange, 'ts' | 'selector'>,
  ): void {
    this.changes.push({
      ...change,
      selector: this.sel(element),
      ts: new Date().toISOString(),
    });
  }

  /** Selector estable memorizable del elemento. */
  private sel(element: Element): string {
    return buildStableSelector(element);
  }
}
