/**
 * `DomAdapter`: implementación de {@link PageAdapter} sobre un `Document`
 * DOM estándar (jsdom en Node, o el DOM real si se usa en un navegador /
 * extensión). Es la implementación usada por los tests unitarios, sin
 * necesidad de lanzar un navegador.
 */
import type { DomMutator } from '../prompt/dom-mutator';
import {
  findFileInputInPage,
  moveInPage,
  moveToInPage,
  removeInPage,
  setStylesInPage,
  setTextInPage,
} from '../prompt/dom-mutator';
import type { Placement } from '../prompt/types';
import type { ElementSnapshot } from '../types';
import { collectCandidatesInPage } from '../utils/dom-utils';
import type { PageAdapter } from './page-adapter';

/**
 * Adaptador de página basado en un `Document` DOM en memoria.
 * Implementa también {@link DomMutator} (v0.7.0) para el módulo `prompt`.
 */
export class DomAdapter implements PageAdapter, DomMutator {
  /**
   * @param doc Documento DOM sobre el que operar.
   */
  constructor(private readonly doc: Document) {}

  /** @inheritdoc */
  async exists(selector: string): Promise<boolean> {
    try {
      return this.doc.querySelector(selector) !== null;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async click(selector: string): Promise<void> {
    const el = this.query(selector);
    (el as HTMLElement).click?.();
    // Fallback para elementos sin click() nativo en jsdom.
    if (!(el as HTMLElement).click) {
      el.dispatchEvent(new (this.win().Event)('click', { bubbles: true }));
    }
  }

  /** @inheritdoc */
  async fill(selector: string, value: string): Promise<void> {
    const el = this.query(selector) as HTMLInputElement | HTMLTextAreaElement;
    el.value = value;
    el.dispatchEvent(new (this.win().Event)('input', { bubbles: true }));
    el.dispatchEvent(new (this.win().Event)('change', { bubbles: true }));
  }

  /** @inheritdoc */
  async submit(selector: string): Promise<void> {
    const el = this.query(selector);
    const form =
      el instanceof this.win().HTMLFormElement
        ? el
        : (el.closest('form') as HTMLFormElement | null);
    if (!form) throw new Error(`No se encontró formulario para "${selector}"`);
    // dispatchEvent respeta preventDefault() de los listeners de la página.
    form.dispatchEvent(
      new (this.win().Event)('submit', { bubbles: true, cancelable: true }),
    );
  }

  /**
   * @inheritdoc
   * Si el elemento no tiene el atributo, lo busca en el ancestro más
   * cercano que lo declare (semántica de herencia de `attr()`).
   */
  async readAttr(selector: string, attr: string): Promise<string | null> {
    const el = this.query(selector);
    const own = el.getAttribute(attr);
    if (own !== null) return own;
    const ancestor = el.closest(`[${attr}]`);
    return ancestor ? ancestor.getAttribute(attr) : null;
  }

  /** @inheritdoc */
  async readValue(selector: string): Promise<string | null> {
    const el = this.query(selector) as HTMLInputElement;
    return el.value ?? null;
  }

  /** @inheritdoc */
  async readText(selector: string): Promise<string | null> {
    const el = this.query(selector);
    const raw =
      (el as HTMLElement).innerText !== undefined
        ? (el as HTMLElement).innerText
        : el.textContent;
    return raw ? raw.replace(/\s+/g, ' ').trim() : null;
  }

  /** @inheritdoc */
  async snapshot(): Promise<ElementSnapshot[]> {
    return collectCandidatesInPage(this.doc);
  }

  /* ---- DomMutator (v0.7.0) ---- */

  /** @inheritdoc */
  async count(selector: string): Promise<number> {
    try {
      return this.doc.querySelectorAll(selector).length;
    } catch {
      return 0;
    }
  }

  /** @inheritdoc */
  async setStyles(
    selector: string,
    styles: Record<string, string>,
    all = false,
  ): Promise<number> {
    return setStylesInPage(this.doc, selector, styles, all);
  }

  /** @inheritdoc */
  async setText(selector: string, text: string): Promise<void> {
    if (!setTextInPage(this.doc, selector, text)) {
      throw new Error(`Elemento no encontrado: "${selector}"`);
    }
  }

  /** @inheritdoc */
  async remove(selector: string, all = false): Promise<number> {
    return removeInPage(this.doc, selector, all);
  }

  /** @inheritdoc */
  async hide(selector: string, all = false): Promise<number> {
    return setStylesInPage(this.doc, selector, { display: 'none' }, all);
  }

  /** @inheritdoc */
  async move(selector: string, destination: string, placement: Placement): Promise<void> {
    if (!moveInPage(this.doc, selector, destination, placement)) {
      throw new Error(`No se pudo mover "${selector}" ${placement} "${destination}"`);
    }
  }

  /** @inheritdoc */
  async moveTo(selector: string, x: number, y: number): Promise<void> {
    if (!moveToInPage(this.doc, selector, x, y)) {
      throw new Error(`Elemento no encontrado: "${selector}"`);
    }
  }

  /**
   * @inheritdoc
   * En jsdom no hay sistema de archivos del navegador: se registra la lista
   * de rutas en `data-webmcp-files` del input y se disparan `input`/`change`,
   * suficiente para tests y para páginas que solo escuchan el evento.
   */
  async uploadFiles(
    selector: string,
    paths: string[],
  ): Promise<{ inputSelector: string; count: number }> {
    const inputSelector = findFileInputInPage(this.doc, selector);
    if (!inputSelector) {
      throw new Error(`No se encontró un input[type="file"] para "${selector}"`);
    }
    const input = this.query(inputSelector) as HTMLInputElement;
    input.setAttribute('data-webmcp-files', JSON.stringify(paths));
    input.dispatchEvent(new (this.win().Event)('input', { bubbles: true }));
    input.dispatchEvent(new (this.win().Event)('change', { bubbles: true }));
    return { inputSelector, count: paths.length };
  }

  /** Obtiene un elemento o lanza un error descriptivo. */
  private query(selector: string): Element {
    const el = this.doc.querySelector(selector);
    if (!el) throw new Error(`Elemento no encontrado: "${selector}"`);
    return el;
  }

  /** Ventana asociada al documento. */
  private win(): Window & typeof globalThis {
    const w = this.doc.defaultView;
    if (!w) throw new Error('El documento no tiene ventana asociada');
    return w as Window & typeof globalThis;
  }
}
