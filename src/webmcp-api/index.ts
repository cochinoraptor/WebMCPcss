/**
 * Módulo de integración con la API imperativa de WebMCP
 * (`document.modelContext`).
 *
 * @example
 * ```ts
 * import { WebMCPApiAdapter, getRegisteredTools } from 'webmcpcss';
 *
 * const adapter = await WebMCPApiAdapter.create(page); // instala el shim
 * await page.goto('https://sitio-con-webmcp.com');
 * const tools = await getRegisteredTools(adapter);
 * // → [{ name: 'searchFlights', description: '...', inputSchema: {...} }]
 * ```
 */
import type { ApiToolSource } from '../adapters/page-adapter';
import type { RegisteredToolInfo } from '../types';

export {
  installModelContextShim,
  readRegisteredTools,
  invokeRegisteredTool,
  API_REGISTRY_KEY,
} from './api-client';

/**
 * Recupera todas las herramientas registradas vía
 * `document.modelContext.registerTool()` en la página asociada a la fuente.
 *
 * @param source Cualquier adaptador que implemente {@link ApiToolSource}
 *   (p. ej. `WebMCPApiAdapter`).
 * @returns Lista de herramientas registradas (metadatos serializables).
 */
export async function getRegisteredTools(
  source: ApiToolSource,
): Promise<RegisteredToolInfo[]> {
  return source.listApiTools();
}
