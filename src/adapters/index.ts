/**
 * Adaptadores de página: todo acceso al DOM/navegador pasa por aquí.
 */
export type { ApiToolSource, ElementInfo, PageAdapter, PageElement } from './PageAdapter';
export { DomAdapter } from './DomAdapter';
export { PuppeteerAdapter } from './PuppeteerAdapter';
