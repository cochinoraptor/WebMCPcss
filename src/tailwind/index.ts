/**
 * Módulo de integración con Tailwind CSS.
 */
export * from './types';
export {
  classifyClass,
  isTailwindClass,
  splitVariants,
  inspectClassList,
  inspectElement,
  buildStableSelector,
  scanDocument,
} from './inspector';
export { ChangeHistory } from './history';
export type { HistoryEntry } from './history';
export { TailwindEditor } from './editor';
export {
  generateTailwindTools,
  buildTailwindToolsScript,
  applyToolArgs,
} from './tool-generator';
export { registerTailwindTools } from './tool-registry';
export { scanPage } from './browser-scan';
export type { PageLike } from './browser-scan';
export {
  formatForFramework,
  frameworkFromExtension,
  toReactComponent,
  toVueComponent,
  toAngularComponent,
} from './frameworks';
export type { Framework } from './frameworks';
