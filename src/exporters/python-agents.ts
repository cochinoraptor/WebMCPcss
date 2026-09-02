/**
 * Exportadores para agentes Python: CrewAI, AutoGen y LangGraph.
 *
 * Los archivos generados ejecutan las herramientas invocando el CLI
 * (`webmcpcss run <url> <css> <tool> --args JSON`), de modo que el agente
 * Python no necesita reimplementar nada: navegador, validación y reparación
 * quedan del lado de WebMCPcss.
 */
import type { ToolMap } from '../types';
import { snakeCase, toolMapToJsonSchemas } from './schema';

/** Contexto común de exportación. */
export interface ExportContext {
  /** Ruta del archivo .webmcp.css (se incrusta en el código generado). */
  cssPath: string;
  /** URL del sitio (si se conoce). */
  url?: string;
}

/** Cabecera compartida de los módulos Python generados. */
function pyHeader(ctx: ExportContext): string {
  return `"""Herramientas WebMCP generadas por webmcpcss — no editar a mano.

Requisitos: Node.js con webmcpcss instalado (npm i -g webmcpcss).
Cada herramienta ejecuta: webmcpcss run <url> <css> <tool> --args JSON
"""

import json
import subprocess

WEBMCP_CSS = ${JSON.stringify(ctx.cssPath)}
WEBMCP_URL = ${JSON.stringify(ctx.url ?? 'https://CAMBIA-ESTA-URL')}


def _run_tool(tool: str, args: dict | None = None) -> str:
    """Ejecuta una herramienta WebMCP vía CLI y devuelve su salida JSON."""
    cmd = [
        "webmcpcss", "run", WEBMCP_URL, WEBMCP_CSS, tool,
        "--args", json.dumps(args or {}),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        return json.dumps({"success": False, "error": result.stderr.strip()})
    return result.stdout.strip()
`;
}

/**
 * Genera un módulo Python con herramientas para CrewAI.
 * Si `crewai` no está instalado, las funciones siguen siendo usables.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 */
export function exportCrewAi(toolMap: ToolMap, ctx: ExportContext): string {
  const schemas = toolMapToJsonSchemas(toolMap);
  let py =
    pyHeader(ctx) +
    `\n\ntry:\n    from crewai.tools import tool as _crewai_tool\nexcept ImportError:  # crewai es opcional\n    def _crewai_tool(name):\n        def wrap(fn):\n            return fn\n        return wrap\n\n`;
  for (const s of schemas) {
    const fn = snakeCase(s.name);
    const params = Object.keys(s.inputSchema.properties);
    const sig = params.map((p) => `${snakeCase(p)}: str = ""`).join(', ');
    const argsDict = params.map((p) => `"${p}": ${snakeCase(p)}`).join(', ');
    py += `\n@_crewai_tool("${s.name}")\ndef ${fn}(${sig}) -> str:\n    """${s.description.replace(/"/g, "'")}"""\n    return _run_tool("${s.name}", {${argsDict}})\n\n`;
  }
  py += `\nALL_TOOLS = [${schemas.map((s) => snakeCase(s.name)).join(', ')}]\n`;
  return py;
}

/**
 * Genera el JSON de herramientas para AutoGen (y function calling en
 * general) + un pequeño módulo Python de registro.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 * @returns `{ json, python }` — dos archivos.
 */
export function exportAutoGen(
  toolMap: ToolMap,
  ctx: ExportContext,
): { json: string; python: string } {
  const schemas = toolMapToJsonSchemas(toolMap);
  const json = JSON.stringify(
    {
      source: ctx.cssPath,
      url: ctx.url ?? null,
      tools: schemas.map((s) => ({
        name: s.name,
        description: s.description,
        schema: s.inputSchema,
      })),
    },
    null,
    2,
  );
  let python = pyHeader(ctx) + '\n\n';
  python += `TOOL_SCHEMAS = json.loads("""${json.replace(/\\/g, '\\\\')}""")["tools"]\n\n`;
  python += `def register_with_autogen(agent):\n    """Registra todas las herramientas en un ConversableAgent de AutoGen."""\n    for schema in TOOL_SCHEMAS:\n        name = schema["name"]\n        def make_fn(tool_name):\n            def fn(**kwargs):\n                return _run_tool(tool_name, kwargs)\n            fn.__name__ = tool_name\n            return fn\n        agent.register_for_llm(name=name, description=schema["description"])(make_fn(name))\n`;
  return { json, python };
}

/**
 * Genera herramientas para LangGraph/LangChain (`@tool` de langchain_core)
 * más el grafo de estado en JSON.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 */
export function exportLangGraph(
  toolMap: ToolMap,
  ctx: ExportContext,
): { python: string; graphJson: string } {
  const schemas = toolMapToJsonSchemas(toolMap);
  let py = pyHeader(ctx) + `\n\nfrom langchain_core.tools import tool\n\n`;
  for (const s of schemas) {
    const fn = snakeCase(s.name);
    const params = Object.keys(s.inputSchema.properties);
    const sig = params.map((p) => `${snakeCase(p)}: str = ""`).join(', ');
    const argsDict = params.map((p) => `"${p}": ${snakeCase(p)}`).join(', ');
    py += `\n@tool\ndef ${fn}(${sig}) -> str:\n    """${s.description.replace(/"/g, "'")}"""\n    return _run_tool("${s.name}", {${argsDict}})\n\n`;
  }
  py += `\nTOOLS = [${schemas.map((s) => snakeCase(s.name)).join(', ')}]\n`;
  py += `\n# Uso con LangGraph:\n#   from langgraph.prebuilt import create_react_agent\n#   agent = create_react_agent(model, TOOLS)\n`;

  const graphJson = JSON.stringify(
    {
      nodes: schemas.map((s) => ({ id: s.name, type: 'tool', schema: s.inputSchema })),
      edges: [],
      metadata: { source: ctx.cssPath, url: ctx.url ?? null },
    },
    null,
    2,
  );
  return { python: py, graphJson };
}
