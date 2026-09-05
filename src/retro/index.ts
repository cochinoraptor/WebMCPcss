/** Retro-WebMCP (v1.0.0): capa de compatibilidad para sitios legacy. */
export {
  buildRetroToolMap,
  decodeEntities,
  detectLegacySignals,
  enhanceRetroWithLlm,
  extractLegacyElements,
  extractTitle,
  fetchHtml,
  legacyScore,
  parseTagAttrs,
  proposeSelector,
  scanLegacyHtml,
  type LegacyElement,
  type LegacyForm,
  type LegacySignal,
  type RetroScan,
} from './scanner';
export {
  PROXY_PREFIX,
  createRetroProxy,
  injectWebMcpIntoHtml,
  rewriteAbsoluteUrls,
  startRetroProxy,
  type RetroProxyOptions,
} from './proxy';
export { buildRetroInjectScript, injectRetro, type RetroInjectOptions, type RetroInjectResult } from './injector';
export { prepareRetroSubmission, publishRetro, type RetroPublishOptions, type RetroSubmission } from './repository';
