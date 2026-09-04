/**
 * Módulo `prompt` (v0.7.0): modificación de sitios web mediante lenguaje
 * natural.
 *
 * ```ts
 * import { PromptManager, createLlmClient } from 'webmcpcss';
 * const manager = new PromptManager(adapter, { toolMap, llm: createLlmClient() });
 * const result = await manager.run('sube esta imagen al carrusel', { files: ['./foto.jpg'] });
 * ```
 */
export * from './types';
export {
  createLlmClient,
  resolveLlmConfig,
  extractJsonObject,
  FetchLlmClient,
  isLlmProvider,
  DEFAULT_MODELS,
  DEFAULT_BASE_URLS,
  type LlmOverrides,
} from './llm-client';
export {
  interpretPrompt,
  interpretHeuristically,
  normalizeLlmAction,
  normalizeActionName,
  buildInterpreterUserPrompt,
  INTERPRETER_SYSTEM_PROMPT,
} from './interpreter';
export {
  ElementFinder,
  findElement,
  FINDER_SYSTEM_PROMPT,
  type ElementFinderOptions,
  type FindOptions,
} from './element-finder';
export { ActionExecutor, sanitizeStyles, isSafeColor } from './action-executor';
export {
  AssetManager,
  detectMime,
  sniffMime,
  classifySource,
  MIME_BY_EXT,
} from './asset-manager';
export {
  canMutate,
  setStylesInPage,
  setTextInPage,
  removeInPage,
  moveInPage,
  moveToInPage,
  findFileInputInPage,
  type DomMutator,
} from './dom-mutator';
export { PromptManager, runPrompt, type PromptManagerOptions } from './prompt-manager';
export {
  findColor,
  detectKinds,
  keywords,
  looksLikeSelector,
  COLOR_NAMES,
  ELEMENT_KINDS,
} from './vocabulary';
