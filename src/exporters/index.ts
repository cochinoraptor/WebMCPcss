/**
 * Punto de entrada de los exportadores multi-agente.
 *
 * `exportForAgent(format, toolMap, ctx)` devuelve un mapa
 * `ruta relativa → contenido` listo para escribir en disco.
 */
import type { ToolMap } from '../types';
import {
  exportBrowserInject,
  exportClaudeCodePlugin,
  exportCursorIntegration,
  exportMcpConfig,
} from './editors';
import {
  exportAutoGen,
  exportCrewAi,
  exportLangGraph,
  type ExportContext,
} from './python-agents';
import { toolMapToJsonSchemas } from './schema';

export {
  exportBrowserInject,
  exportClaudeCodePlugin,
  exportCursorIntegration,
  exportMcpConfig,
} from './editors';
export { exportAutoGen, exportCrewAi, exportLangGraph } from './python-agents';
export type { ExportContext } from './python-agents';
export { snakeCase, toolMapToJsonSchemas, toolToJsonSchema } from './schema';
export type { ToolJsonSchema } from './schema';
export {
  createMcpHttpServer,
  McpCore,
  startMcpStdioServer,
  PROMPT_TOOL_NAME,
  PROMPT_TOOL_SCHEMA,
} from './mcp-server';
export type {
  McpServerOptions,
  ToolExecutor,
  PromptExecutor,
  PromptToolArgs,
} from './mcp-server';

/** Formatos de exportación soportados. */
export const EXPORT_FORMATS = [
  'mcp-config',
  'claude-code',
  'cursor',
  'crewai',
  'autogen',
  'langgraph',
  'browser-inject',
  'json-schema',
] as const;

/** Formato de exportación. */
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Resultado de una exportación: archivos a escribir. */
export interface ExportResult {
  /** Mapa ruta relativa → contenido. */
  files: Record<string, string>;
  /** Nota breve para mostrar al usuario tras exportar. */
  note: string;
}

/**
 * Exporta el tool map al formato del agente indicado.
 *
 * @param format Uno de {@link EXPORT_FORMATS}.
 * @param toolMap Tool map parseado del .webmcp.css.
 * @param ctx Ruta del CSS y URL opcional.
 * @throws Error si el formato no está soportado.
 */
export function exportForAgent(
  format: string,
  toolMap: ToolMap,
  ctx: ExportContext,
): ExportResult {
  switch (format as ExportFormat) {
    case 'mcp-config':
      return {
        files: { 'mcp-config.json': exportMcpConfig(ctx) + '\n' },
        note: 'Fusiona mcp-config.json en claude_desktop_config.json (Claude Desktop), ~/.cursor/mcp.json (Cursor) o el equivalente de tu cliente MCP.',
      };
    case 'claude-code':
      return {
        files: exportClaudeCodePlugin(toolMap, ctx),
        note: 'Plugin de Claude Code generado. Instálalo con: claude plugin install <carpeta>.',
      };
    case 'cursor':
      return {
        files: exportCursorIntegration(ctx),
        note: 'Copia mcp.json en ~/.cursor/mcp.json y reinicia Cursor.',
      };
    case 'crewai':
      return {
        files: { 'webmcp_tools.py': exportCrewAi(toolMap, ctx) },
        note: 'Importa ALL_TOOLS desde webmcp_tools.py en tu Crew. Requiere webmcpcss en el PATH.',
      };
    case 'autogen': {
      const { json, python } = exportAutoGen(toolMap, ctx);
      return {
        files: { 'webmcp_tools.json': json + '\n', 'webmcp_autogen.py': python },
        note: 'Usa register_with_autogen(agent) o consume webmcp_tools.json como function schemas.',
      };
    }
    case 'langgraph': {
      const { python, graphJson } = exportLangGraph(toolMap, ctx);
      return {
        files: { 'webmcp_langgraph.py': python, 'webmcp_graph.json': graphJson + '\n' },
        note: 'Importa TOOLS desde webmcp_langgraph.py y pásalas a create_react_agent.',
      };
    }
    case 'browser-inject':
      return {
        files: { 'webmcp-inject.js': exportBrowserInject(toolMap, ctx) },
        note: 'Inyecta webmcp-inject.js en la página (page.evaluate, userscript o extensión): expone window.__WEBMCP_GRAPH__.',
      };
    case 'json-schema':
      return {
        files: {
          'webmcp-schemas.json':
            JSON.stringify(
              {
                source: ctx.cssPath,
                url: ctx.url ?? null,
                tools: toolMapToJsonSchemas(toolMap),
              },
              null,
              2,
            ) + '\n',
        },
        note: 'Esquemas JSON genéricos (function calling de OpenAI/Gemini/Mistral, etc.).',
      };
    default:
      throw new Error(
        `Formato desconocido: "${format}". Soportados: ${EXPORT_FORMATS.join(', ')}`,
      );
  }
}
