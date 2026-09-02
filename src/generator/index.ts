/**
 * Módulo generador: código JS para la API imperativa de WebMCP y
 * sugerencias opcionales con IA.
 */
export {
  generateApiScript,
  buildInputSchema,
  type JsGeneratorOptions,
} from './js-generator';
export {
  getAiConfig,
  buildSuggestionPrompt,
  parseAiSuggestions,
  applyAiSuggestions,
  enhanceToolMapWithAi,
  type AiToolSuggestion,
  type AiConfig,
} from './ai-suggester';
export {
  scanInteractiveElementsInPage,
  type PageScan,
  type ScannedForm,
  type ScannedField,
  type ScannedAction,
} from './scanner';
export { buildAutoToolMap, detectFramework, type DetectedFramework } from './analyzer';
