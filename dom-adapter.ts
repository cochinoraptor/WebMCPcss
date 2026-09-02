/**
 * `DomAdapter`: implementación de {@link PageAdapter} sobre un `Document`
 * DOM estándar (jsdom en Node, o el DOM real si se usa en un navegador /
 * extensión). Es la implementación usada por los tests unitarios, sin
 * necesidad de lanzar un navegador.
 */
import type { ElementSnapshot } from '../types';
import { collectCandidatesInPage } from '../utils/dom-utils';
import type { PageAdapter } from './page-adapter';

/** Adaptador de página basado en un `Document` DOM en memoria. */
export class DomAdapter implements PageAdapter {
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
