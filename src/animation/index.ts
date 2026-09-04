/**
 * Módulo de animaciones declarativas de WebMCPcss (v0.8.0).
 *
 * ```ts
 * import { parseAnimationsFile, animateWithPage } from 'webmcpcss';
 * const map = parseAnimationsFile('animations.webmcp.css');
 * const result = await animateWithPage(page, map, { strategy: 'queue' });
 * ```
 */
export * from './types';
export {
  parseAnimations,
  parseAnimationsFile,
  serializeAnimations,
  ANIMATION_PREFIX,
  type AnimationParseOptions,
} from './parser';
export { validateConfig, parseDuration, AnimationConfigError } from './config-validation';
export { detectCapabilities, detectLibraries } from './capabilities';
export {
  ConflictResolver,
  cssAnimatedProperties,
  type ConflictResolverOptions,
  type ExternalScanResult,
} from './conflict-resolver';
export { AnimationOrchestrator } from './orchestrator';
export { validateAnimations, validateStatic, type ValidateOptions } from './validators';
export {
  animateWithPage,
  animateInWindow,
  type ExecuteOptions,
  type ExecuteResult,
} from './executor';
export {
  buildRuntimeScript,
  writeRuntimeScript,
  RUNTIME_GLOBAL,
  RUNTIME_MODULES,
} from './runtime-bundle';
export {
  type AnimationEngine,
  type EngineContext,
  type EngineRun,
  ELEMENT_ID_ATTR,
  ANIMATION_ID_PREFIX,
  ensureElementId,
  propertiesOf,
  keyframesFor,
  buildTransform,
  toMs,
} from './engine/base-engine';
export { CssEngine, keyframesToCss, classRuleCss, STYLE_ATTR } from './engine/css-engine';
export { WaapiEngine, toWaapiKeyframes, toWaapiTiming } from './engine/waapi-engine';
export {
  ThreeEngine,
  loadThree,
  normalizeScene,
  DEFAULT_THREE_URL,
  THREE_HOST_ATTR,
} from './engine/three-engine';
