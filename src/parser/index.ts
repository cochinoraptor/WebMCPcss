/**
 * Punto de entrada del módulo parser.
 * Re-exporta las funciones de parseo y serialización de `.webmcp.css`.
 */
export {
  parseWebMCP,
  parseWebMCPFile,
  serializeToolMap,
  serializeParam,
  parseParamValue,
  parseTriggerValue,
  substituteVars,
  resolveSelector,
  unquote,
  WebMCPParseError,
  type ParseOptions,
} from './css-parser';
