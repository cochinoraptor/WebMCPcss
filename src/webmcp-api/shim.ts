/**
 * Shim de la API imperativa de WebMCP (`navigator.modelContext`).
 *
 * Se inyecta en la página **antes** de la navegación
 * (`page.evaluateOnNewDocument`) para capturar las herramientas que el
 * sitio registra con `registerTool()`. Si el navegador ya implementa la
 * API, el shim respeta la implementación nativa y solo observa.
 */
import type { ApiToolInfo } from '../types';

/**
 * Código fuente del shim (JS de navegador, autoejecutable e idempotente).
 * Registra las herramientas en `window.__WEBMCP_REGISTERED__` y expone los
 * handlers en `window.__WEBMCP_TOOLS__` para invocación remota.
 */
export const WEBMCP_API_SHIM_SOURCE = `
(function () {
  if (window.__WEBMCP_SHIM_INSTALLED__) return;
  window.__WEBMCP_SHIM_INSTALLED__ = true;
  window.__WEBMCP_REGISTERED__ = [];
  window.__WEBMCP_TOOLS__ = {};
  var ensureMC = function () {
    if (navigator.modelContext) return navigator.modelContext;
    var mc = {};
    try {
      Object.defineProperty(navigator, 'modelContext', { value: mc, configurable: true });
    } catch (e) {
      window.__WEBMCP_MC_FALLBACK__ = mc;
    }
    return mc;
  };
  var mc = ensureMC();
  mc.registerTool = function (def) {
    if (!def || !def.name) return def;
    window.__WEBMCP_REGISTERED__.push({
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema
    });
    window.__WEBMCP_TOOLS__[def.name] = def;
    return def;
  };
})();
`;

/**
 * Normaliza la lista cruda capturada por el shim.
 *
 * @param raw Valor de `window.__WEBMCP_REGISTERED__` tal cual llega.
 * @returns Herramientas registradas con nombre/descripción/schema.
 */
export function normalizeRegistered(raw: unknown): ApiToolInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .filter((t) => typeof t.name === 'string' && t.name.length > 0)
    .map((t) => ({
      name: t.name as string,
      description: typeof t.description === 'string' ? t.description : undefined,
      inputSchema: 'inputSchema' in t ? t.inputSchema : undefined,
    }));
}
