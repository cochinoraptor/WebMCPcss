/**
 * `PuppeteerAdapter`: implementación de {@link PageAdapter} sobre una
 * `Page` de Puppeteer (navegador real). Serializa las utilidades DOM
 * auto-contenidas y las ejecuta en el contexto de la página.
 */
import type { ElementHandle, Page } from 'puppeteer';
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
 * Adaptador de página basado en Puppeteer.
 * Implementa también {@link DomMutator} (v0.7.0) para el módulo `prompt`.
 */
export class PuppeteerAdapter implements PageAdapter, DomMutator {
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

  /* ---- DomMutator (v0.7.0) ---- */

  /** @inheritdoc */
  async count(selector: string): Promise<number> {
    try {
      return await this.page.$$eval(selector, (els) => els.length);
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
    return this.page.evaluate(
      setStylesInPage,
      await this.docHandle(),
      selector,
      styles,
      all,
    );
  }

  /** @inheritdoc */
  async setText(selector: string, text: string): Promise<void> {
    const ok = await this.page.evaluate(
      setTextInPage,
      await this.docHandle(),
      selector,
      text,
    );
    if (!ok) throw new Error(`Elemento no encontrado: "${selector}"`);
  }

  /** @inheritdoc */
  async remove(selector: string, all = false): Promise<number> {
    return this.page.evaluate(removeInPage, await this.docHandle(), selector, all);
  }

  /** @inheritdoc */
  async hide(selector: string, all = false): Promise<number> {
    return this.setStyles(selector, { display: 'none' }, all);
  }

  /** @inheritdoc */
  async move(selector: string, destination: string, placement: Placement): Promise<void> {
    const ok = await this.page.evaluate(
      moveInPage,
      await this.docHandle(),
      selector,
      destination,
      placement,
    );
    if (!ok)
      throw new Error(`No se pudo mover "${selector}" ${placement} "${destination}"`);
  }

  /** @inheritdoc */
  async moveTo(selector: string, x: number, y: number): Promise<void> {
    const ok = await this.page.evaluate(
      moveToInPage,
      await this.docHandle(),
      selector,
      x,
      y,
    );
    if (!ok) throw new Error(`Elemento no encontrado: "${selector}"`);
  }

  /**
   * @inheritdoc
   * Usa `ElementHandle.uploadFile` de Puppeteer sobre el `input[type="file"]`
   * asociado al selector (el propio input, uno interno, el de su formulario…).
   */
  async uploadFiles(
    selector: string,
    paths: string[],
  ): Promise<{ inputSelector: string; count: number }> {
    const inputSelector = await this.page.evaluate(
      findFileInputInPage,
      await this.docHandle(),
      selector,
    );
    if (!inputSelector) {
      throw new Error(`No se encontró un input[type="file"] para "${selector}"`);
    }
    const handle = (await this.page.$(
      inputSelector,
    )) as ElementHandle<HTMLInputElement> | null;
    if (!handle) throw new Error(`Input de archivo no accesible: ${inputSelector}`);
    await handle.uploadFile(...paths);
    // Algunos frameworks solo reaccionan a `change` disparado manualmente.
    await handle.evaluate((el) => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await handle.dispose();
    return { inputSelector, count: paths.length };
  }

  /** @inheritdoc Captura PNG de la página completa en base64. */
  async screenshot(): Promise<string | null> {
    try {
      const data = await this.page.screenshot({ encoding: 'base64', fullPage: true });
      return typeof data === 'string' ? data : Buffer.from(data).toString('base64');
    } catch {
      return null;
    }
  }

  /** Handle del documento de la página. */
  private async docHandle() {
    return this.page.evaluateHandle(() => document) as Promise<never>;
  }
}
