/**
 * `PuppeteerAdapter`: implementa {@link PageAdapter} sobre una `Page` de
 * Puppeteer (navegador real).
 */
import type { ElementHandle, Page } from 'puppeteer';
import type { ElementInfo, PageAdapter, PageElement } from './PageAdapter';
import { normalizeText } from '../utils/dom';

/** Código serializable para extraer la huella de un elemento en la página. */
const INFO_FN = (el: Element): ElementInfo => {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'class' || attr.name === 'id' || attr.name === 'style') continue;
    attrs[attr.name] = attr.value;
  }
  const maybeInput = el as unknown as HTMLInputElement;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    classes: Array.from(el.classList),
    attrs,
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    value:
      typeof maybeInput.value === 'string' && maybeInput.tagName !== undefined
        ? maybeInput.value
        : null,
  };
};

/**
 * Envoltura de un `ElementHandle` de Puppeteer como {@link PageElement}.
 */
class PuppeteerPageElement implements PageElement {
  private readonly handle: ElementHandle<Element>;

  /**
   * @param handle Handle vivo del elemento en la página.
   */
  constructor(handle: ElementHandle<Element>) {
    this.handle = handle;
  }

  /** @inheritdoc */
  async info(): Promise<ElementInfo> {
    const info = (await this.handle.evaluate(INFO_FN)) as ElementInfo;
    info.text = normalizeText(info.text);
    return info;
  }

  /** @inheritdoc */
  async click(): Promise<void> {
    await this.handle.click();
  }

  /** @inheritdoc */
  async dispatch(event: string): Promise<void> {
    await this.handle.evaluate((el, ev) => {
      if (ev === 'click') {
        (el as unknown as HTMLElement).click();
        return;
      }
      el.dispatchEvent(new Event(ev, { bubbles: true, cancelable: true }));
    }, event);
  }

  /** @inheritdoc */
  async closest(selector: string): Promise<boolean> {
    return (await this.handle.evaluate(
      (el, s) => el.closest(s) !== null,
      selector,
    )) as boolean;
  }
}

/**
 * Adaptador sobre una página de Puppeteer ya abierta.
 */
export class PuppeteerAdapter implements PageAdapter {
  private readonly page: Page;

  /**
   * @param page Página de Puppeteer (ya navegada o a punto de navegar).
   */
  constructor(page: Page) {
    this.page = page;
  }

  /**
   * URL actual de la página (en vivo).
   */
  get url(): string {
    return this.page.url();
  }

  /**
   * Página de Puppeteer subyacente (para usos avanzados como `inject`).
   */
  get raw(): Page {
    return this.page;
  }

  /** @inheritdoc */
  async queryAll(selector: string): Promise<PageElement[]> {
    const handles = await this.page.$$(selector);
    return handles.map((h) => new PuppeteerPageElement(h as ElementHandle<Element>));
  }

  /** @inheritdoc */
  async query(selector: string): Promise<PageElement | null> {
    const handle = await this.page.$(selector);
    return handle ? new PuppeteerPageElement(handle as ElementHandle<Element>) : null;
  }

  /** @inheritdoc */
  async waitForSelector(selector: string, timeoutMs = 1500): Promise<boolean> {
    try {
      await this.page.waitForSelector(selector, { timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }
}
