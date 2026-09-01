/**
 * Integración con la API imperativa de WebMCP (`navigator.modelContext`):
 * shim de captura, adaptador y generador de código (CSS → API).
 */
export { WEBMCP_API_SHIM_SOURCE, normalizeRegistered } from './shim';
export { WebMCPApiAdapter } from './WebMCPApiAdapter';
export { buildInputSchema, generateApiScript } from './generator';
