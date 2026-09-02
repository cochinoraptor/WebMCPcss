/**
 * `PuppeteerAdapter`: implementación de {@link PageAdapter} sobre una
 * `Page` de Puppeteer (navegador real). Serializa las utilidades DOM
 * auto-contenidas y las ejecuta en el contexto de la página.
 */
import type { Page } from 'puppeteer';
import type { ElementSnapshot } from '../types';
import { collectCandidatesInPage } from '../utils/dom-utils';
import type { PageAdapter } from './page-adapter';

/** Adaptador de página basado en Puppeteer. */
export class PuppeteerAdapter implements PageAdapter {
  /**
   * @param page Página de Puppeteer ya navegada a la URL objetivo.
   */
  constructor(private readonly page: Page) {}

  /** @inheritdoc */
  async exists(selector: string): Promise<boolean> {
    try {
      return (await this.page.$(selector)) !== null;
    } catch {
      return false;
    }
  }

  /** @inheritdoc */
  async click(selector: string): Promise<void> {
    await this.page.click(selector);
  }

  /** @inheritdoc */
  async fill(selector: string, value: string): Promise<void> {
    await this.page.$eval(
      selector,
      (el, v) => {
        const input = el as HTMLInputElement;
        input.value = v as string;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      },
      value,
    );
  }

  /** @inheritdoc */
  async submit(selector: string): Promise<void> {
    await this.page.$eval(selector, (el) => {
      const form =
        el instanceof HTMLFormElement ? el : (el.closest('form') as HTMLFormElement);
      if (!form) throw new Error('No se encontró formulario');
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
  }

  /**
   * @inheritdoc
   * Si el elemento no tiene el atributo, lo busca en el ancestro más
   * cercano que lo declare (semántica de herencia de `attr()`).
   */
  async readAttr(selector: string, attr: string): Promise<string | null> {
    try {
      return await this.page.$eval(
        selector,
        (el, a) => {
          const name = a as string;
          const own = el.getAttribute(name);
          if (own !== null) return own;
          const ancestor = el.closest(`[${name}]`);
          return ancestor ? ancestor.getAttribute(name) : null;
        },
        attr,
      );
    } catch {
      return null;
    }
  }

  /** @inheritdoc */
  async readValue(selector: string): Promise<string | null> {
    try {
      return await this.page.$eval(selector, (el) => (el as HTMLInputElement).value);
    } catch {
      return null;
    }
  }

  /** @inheritdoc */
  async readText(selector: string): Promise<string | null> {
    try {
      return await this.page.$eval(selector, (el) =>
        ((el as HTMLElement).innerText || el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim(),
      );
    } catch {
      return null;
    }
  }

  /** @inheritdoc */
  async snapshot(): Promise<ElementSnapshot[]> {
    // La función es auto-contenida, por lo que puede serializarse al navegador.
    return this.page.evaluate(collectCandidatesInPage, await this.docHandle());
  }

  /** Handle del documento de la página. */
  private async docHandle() {
    return this.page.evaluateHandle(() => document) as Promise<never>;
  }
}
