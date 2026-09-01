/**
 * `DomAdapter`: implementa {@link PageAdapter} sobre cualquier `Document`
 * (jsdom en tests/CLI con HTML local, DOM real en una extensión, ...).
 */
import type { PageAdapter, PageElement } from './PageAdapter';
import { normalizeText } from '../utils/dom';

/**
 * Envoltura de un `Element` del DOM como {@link PageElement}.
 */
class DomPageElement implements PageElement {
  private readonly el: Element;

  /**
   * @param el Elemento del documento.
   */
  constructor(el: Element) {
    this.el = el;
  }

  /** @inheritdoc */
  async info(): Promise<import('./PageAdapter').ElementInfo> {
    const attrs: Record<string, string> = {};
    for (const attr of Array.from(this.el.attributes)) {
      if (attr.name === 'class' || attr.name === 'id' || attr.name === 'style') continue;
      attrs[attr.name] = attr.value;
    }
    const maybeInput = this.el as unknown as { value?: unknown };
    return {
      tag: this.el.tagName.toLowerCase(),
      id: this.el.id || null,
      classes: Array.from(this.el.classList),
      attrs,
      text: normalizeText(this.el.textContent),
      value: typeof maybeInput.value === 'string' ? maybeInput.value : null,
    };
  }

  /** @inheritdoc */
  async click(): Promise<void> {
    (this.el as unknown as HTMLElement).click();
  }

  /** @inheritdoc */
  async dispatch(event: string): Promise<void> {
    if (event === 'click') {
      await this.click();
      return;
    }
    const win = this.el.ownerDocument.defaultView;
    if (!win) return;
    this.el.dispatchEvent(new win.Event(event, { bubbles: true, cancelable: true }));
  }

  /** @inheritdoc */
  async closest(selector: string): Promise<boolean> {
    return this.el.closest(selector) !== null;
  }
}

/**
 * Adaptador sobre un `Document` (típicamente jsdom).
 */
export class DomAdapter implements PageAdapter {
  private readonly doc: Document;
  readonly url: string;

  /**
   * @param doc Documento (jsdom `JSDOM.window.document` o equivalente).
   * @param url Identificador de la página para reportes.
   */
  constructor(doc: Document, url?: string) {
    this.doc = doc;
    this.url = url ?? (doc as Document & { baseURI?: string }).baseURI ?? 'dom://local';
  }

  /** @inheritdoc */
  async queryAll(selector: string): Promise<PageElement[]> {
    try {
      return Array.from(this.doc.querySelectorAll(selector)).map(
        (el) => new DomPageElement(el as Element),
      );
    } catch {
      return [];
    }
  }

  /** @inheritdoc */
  async query(selector: string): Promise<PageElement | null> {
    const all = await this.queryAll(selector);
    return all[0] ?? null;
  }

  /** @inheritdoc */
  async waitForSelector(selector: string, timeoutMs = 1500): Promise<boolean> {
    const parts = selector.split(',').map((s) => s.trim());
    const started = Date.now();
    for (;;) {
      for (const part of parts) {
        if (this.doc.querySelector(part)) return true;
      }
      if (Date.now() - started >= timeoutMs) return false;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
