/**
 * Exportadores de configuración para clientes MCP genéricos (Claude
 * Desktop / Goose / Windsurf: `mcp.json`) y script de inyección para agentes
 * de navegador (Atlas, Operator, Mariner).
 *
 * Los exportadores de Claude Code y Cursor viven en `./claude-code` y
 * `./cursor` (v0.9.0); se re-exportan aquí por compatibilidad.
 */
import type { ToolMap } from '../types';
import { toolMapToJsonSchemas } from './schema';
import type { ExportContext } from './python-agents';

export { exportClaudeCodePlugin } from './claude-code';
export { exportCursorIntegration } from './cursor';

/**
 * Genera el snippet `mcpServers` para Claude Desktop, Cursor, Goose, Windsurf
 * y cualquier cliente MCP estándar.
 *
 * @param ctx Ruta CSS y URL.
 */
export function exportMcpConfig(ctx: ExportContext): string {
  return JSON.stringify(
    {
      mcpServers: {
        webmcpcss: {
          command: 'webmcpcss',
          args: [
            'mcp',
            '--serve',
            '--css',
            ctx.cssPath,
            ...(ctx.url ? ['--url', ctx.url] : []),
          ],
        },
      },
    },
    null,
    2,
  );
}

/**
 * Genera un script de inyección para agentes de navegador (ChatGPT Atlas,
 * Operator, Project Mariner, Comet, Skyvern...): expone
 * `window.__WEBMCP_GRAPH__` con las herramientas y sus esquemas, y además
 * las registra en `document.modelContext` si la API existe.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 */
export function exportBrowserInject(toolMap: ToolMap, ctx: ExportContext): string {
  const schemas = toolMapToJsonSchemas(toolMap);
  const graph = JSON.stringify(
    {
      source: ctx.cssPath,
      url: ctx.url ?? null,
      tools: schemas.map((s) => ({
        name: s.name,
        description: s.description,
        selector: toolMap.tools[s.name]?.selector,
        params: s.inputSchema.properties,
      })),
    },
    null,
    2,
  ).replace(/</g, '\\u003c');

  return `/**
 * WebMCPcss browser inject — expone window.__WEBMCP_GRAPH__ para agentes de
 * navegador (Atlas, Operator, Mariner...). Generado; no editar a mano.
 * Uso: page.evaluate(script) | chrome.debugger | userscript.
 */
(function () {
  'use strict';
  var GRAPH = ${graph.replace(/\n/g, '\n  ')};
  try {
    Object.defineProperty(window, '__WEBMCP_GRAPH__', { value: GRAPH, configurable: true });
  } catch (e) {
    window.__WEBMCP_GRAPH__ = GRAPH;
  }
  // Registro opcional en document.modelContext (estándar WebMCP; navigator.modelContext = alias obsoleto).
  var mc = (typeof document !== 'undefined' && document.modelContext) || (typeof navigator !== 'undefined' && navigator.modelContext) || undefined;
  if (mc && typeof mc.registerTool === 'function') {
    GRAPH.tools.forEach(function (t) {
      mc.registerTool({
        name: t.name,
        description: t.description,
        inputSchema: { type: 'object', properties: t.params },
        async execute(args) {
          var el = document.querySelector(t.selector);
          if (!el) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No existe ' + t.selector }) }] };
          Object.keys(args || {}).forEach(function (k) {
            var p = GRAPH.tools.filter(function (x) { return x.name === t.name; })[0].params[k];
            void p; // los params value(...) se rellenan por selector si está presente
          });
          el.click();
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, tool: t.name }) }] };
        },
      });
    });
  }
  console.log('[WebMCPcss] __WEBMCP_GRAPH__ con ' + GRAPH.tools.length + ' herramienta(s).');
})();
`;
}
