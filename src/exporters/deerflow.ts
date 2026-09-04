/**
 * Exportador para **DeerFlow** (ByteDance) — SuperAgent open source basado en
 * LangGraph con herramientas Python configurables (`config.yaml → tools`) y
 * *skills* progresivas (`skills/custom/<skill>/SKILL.md`).
 *
 * Genera un paquete con dos vías de integración complementarias:
 *
 * 1. **Herramientas Python del grupo `browser`** (`webmcp_tools.py`):
 *    `browser_get_webmcp_graph`, `browser_validate_selector`,
 *    `browser_repair_selector`, `browser_prompt` y `browser_animate`, todas
 *    decoradas con `@tool` de LangChain y delegando en el CLI `webmcpcss`.
 *    El grafo se devuelve como **mensaje estructurado** (JSON con
 *    `type: "webmcp_graph"`) para que los sub-agentes lo compartan sin
 *    volver a escanear la página.
 * 2. **Servidor MCP** (`extensions_config.json`): `webmcpcss mcp --serve`
 *    como servidor stdio, con *routing hints* para que DeerFlow prefiera las
 *    herramientas WebMCP en tareas de navegación.
 *
 * Incluye además la skill `webmcp-browser` (`SKILL.md`) y el fragmento de
 * `config.yaml` con el grupo `browser`. Sin dependencias nuevas.
 */
import type { ToolMap } from '../types';
import { VERSION } from '../version';
import type { ExportContext } from './python-agents';
import { toolMapToJsonSchemas } from './schema';

/** Nombres de las herramientas DeerFlow generadas (grupo `browser`). */
export const DEERFLOW_TOOL_NAMES = [
  'browser_get_webmcp_graph',
  'browser_validate_selector',
  'browser_repair_selector',
  'browser_prompt',
  'browser_animate',
] as const;

/** Escapa una cadena para incrustarla en un literal Python entre comillas dobles. */
function py(text: string): string {
  return JSON.stringify(text);
}

/**
 * Genera el módulo Python con las herramientas del grupo `browser`.
 *
 * @param toolMap Tool map parseado (se incrusta como grafo inicial).
 * @param ctx Ruta CSS y URL.
 */
export function buildDeerFlowTools(toolMap: ToolMap, ctx: ExportContext): string {
  const schemas = toolMapToJsonSchemas(toolMap);
  const graph = {
    type: 'webmcp_graph',
    version: VERSION,
    source: ctx.cssPath,
    url: ctx.url ?? null,
    tools: schemas.map((s) => ({
      name: s.name,
      description: s.description,
      selector: toolMap.tools[s.name]?.selector,
      inputSchema: s.inputSchema,
    })),
    context: Object.entries(toolMap.context).map(([name, c]) => ({
      name,
      selector: c.selector,
      format: c.format ?? 'text',
    })),
  };
  return `"""Herramientas WebMCP para DeerFlow (grupo 'browser') — generado por webmcpcss v${VERSION}.

No editar a mano. Regenerar con:
    webmcpcss export ${ctx.cssPath} --format deerflow -o <carpeta>${ctx.url ? ` --url ${ctx.url}` : ''}

Requisitos: Node.js con webmcpcss instalado ('npm i -g webmcpcss') en el
sandbox de DeerFlow. Cada herramienta ejecuta el CLI y devuelve JSON.

Registro en 'config.yaml'::

    tool_groups:
      - name: browser
    tools:
      - name: browser_get_webmcp_graph
        group: browser
        use: webmcp_tools:browser_get_webmcp_graph
      # ... (ver deerflow-tools.yaml)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any, Optional

from langchain_core.tools import tool

WEBMCP_CSS = os.environ.get("WEBMCP_CSS", ${py(ctx.cssPath)})
WEBMCP_URL = os.environ.get("WEBMCP_URL", ${py(ctx.url ?? '')})
WEBMCP_BIN = os.environ.get("WEBMCPCSS_BIN", "webmcpcss")
WEBMCP_TIMEOUT = int(os.environ.get("WEBMCP_TIMEOUT", "180"))

# Grafo declarado en tiempo de exportación: permite responder sin navegador
# y compartirlo entre sub-agentes como mensaje estructurado.
STATIC_GRAPH: dict[str, Any] = json.loads(${py(JSON.stringify(graph))})


def _structured(kind: str, payload: dict[str, Any]) -> str:
    """Serializa un mensaje estructurado que otros agentes pueden parsear."""
    return json.dumps({"type": kind, **payload}, ensure_ascii=False)


def _run(args: list[str]) -> dict[str, Any]:
    """Ejecuta el CLI webmcpcss y devuelve el JSON de stdout (o el error)."""
    if shutil.which(WEBMCP_BIN) is None:
        return {"success": False, "error": f"{WEBMCP_BIN} no está en el PATH (npm i -g webmcpcss)"}
    try:
        proc = subprocess.run(
            [WEBMCP_BIN, *args],
            capture_output=True,
            text=True,
            timeout=WEBMCP_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"webmcpcss superó {WEBMCP_TIMEOUT}s"}
    out = proc.stdout.strip()
    try:
        # El CLI imprime JSON en la última línea con --json / run.
        return json.loads(out.splitlines()[-1]) if out else {"success": proc.returncode == 0}
    except (json.JSONDecodeError, IndexError):
        return {
            "success": proc.returncode == 0,
            "stdout": out[-4000:],
            "stderr": proc.stderr.strip()[-2000:],
        }


def _url(url: Optional[str]) -> str:
    resolved = url or WEBMCP_URL
    if not resolved:
        raise ValueError("Falta la URL: pásala como argumento o define WEBMCP_URL")
    return resolved


@tool
def browser_get_webmcp_graph(url: Optional[str] = None, live: bool = False) -> str:
    """Devuelve el grafo WebMCP del sitio (herramientas, selectores, parámetros, contexto).

    Úsalo ANTES de interactuar con la página: te dice qué acciones existen
    (addToCart, login…) y qué parámetros aceptan. El resultado es un mensaje
    estructurado '{"type": "webmcp_graph", ...}' que puedes reenviar a
    sub-agentes para que no vuelvan a escanear la página.

    Args:
        url: URL del sitio (opcional; por defecto WEBMCP_URL).
        live: Si es True, valida los selectores contra la página real y añade
            'status' (ok/broken) por herramienta.

    Returns:
        JSON con el grafo y, con 'live=True', el estado de cada selector.
    """
    graph = dict(STATIC_GRAPH)
    if url:
        graph["url"] = url
    if live:
        report = _run(["validate", _url(url), WEBMCP_CSS, "--save-status", "/tmp/webmcp-status.json"])
        status: dict[str, bool] = {}
        try:
            with open("/tmp/webmcp-status.json", encoding="utf-8") as fh:
                for entry in json.load(fh).get("entries", []):
                    if entry.get("kind") in ("tool", "context"):
                        status[entry["name"]] = status.get(entry["name"], True) and (
                            entry.get("ok") or entry.get("optional", False)
                        )
        except (OSError, json.JSONDecodeError):
            graph["validation"] = report
        for t in graph["tools"]:
            if t["name"] in status:
                t["status"] = "ok" if status[t["name"]] else "broken"
    return _structured("webmcp_graph", graph)


@tool
def browser_validate_selector(selector: str, url: Optional[str] = None) -> str:
    """Comprueba si un selector CSS existe en la página y analiza su fragilidad.

    Args:
        selector: Selector CSS a comprobar (p. ej. '#add-to-cart').
        url: URL del sitio (opcional; por defecto WEBMCP_URL).

    Returns:
        JSON '{"type": "webmcp_selector", "selector", "exists", "fragility"}'.
    """
    css = f'{selector} {{ webmcp-tool: "probe"; }}'
    tmp = "/tmp/webmcp-probe.webmcp.css"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(css)
    report = _run(["validate", _url(url), tmp, "--save-status", "/tmp/webmcp-probe-status.json"])
    exists = None
    try:
        with open("/tmp/webmcp-probe-status.json", encoding="utf-8") as fh:
            entries = json.load(fh).get("entries", [])
            exists = all(e.get("ok") for e in entries if e.get("kind") == "tool")
    except (OSError, json.JSONDecodeError):
        pass
    fragility = _run(["graph", tmp, "--fragility", "--output", "/tmp/webmcp-probe-graph.json"])
    level = None
    try:
        with open("/tmp/webmcp-probe-graph.json", encoding="utf-8") as fh:
            for node in json.load(fh).get("nodes", []):
                if node.get("type") == "selector":
                    level = node.get("metadata", {}).get("fragility")
    except (OSError, json.JSONDecodeError):
        level = fragility
    return _structured(
        "webmcp_selector",
        {"selector": selector, "exists": exists, "fragility": level, "raw": report if exists is None else None},
    )


@tool
def browser_repair_selector(tool_name: str, url: Optional[str] = None, apply: bool = False) -> str:
    """Repara el selector roto de una herramienta WebMCP usando visión + huellas.

    Args:
        tool_name: Nombre de la herramienta (p. ej. 'addToCart').
        url: URL del sitio (opcional; por defecto WEBMCP_URL).
        apply: Si es True escribe el nuevo selector en el archivo .webmcp.css;
            si es False (por defecto) solo propone (dry-run).

    Returns:
        JSON '{"type": "webmcp_repair", ...}' con old/new selector y confianza.
    """
    args = ["repair", _url(url), WEBMCP_CSS]
    if not apply:
        args.append("--dry-run")
    result = _run(args)
    return _structured("webmcp_repair", {"tool": tool_name, "applied": apply, "result": result})


@tool
def browser_prompt(
    prompt: str,
    url: Optional[str] = None,
    execute: bool = False,
    files: Optional[list[str]] = None,
) -> str:
    """Modifica la página con una orden en lenguaje natural ("sube esta imagen al carrusel").

    Por defecto solo INTERPRETA la orden (dry-run) y devuelve la acción
    prevista; pide confirmación al usuario antes de llamar con 'execute=True'.

    Args:
        prompt: Orden en español o inglés.
        url: URL del sitio (opcional; por defecto WEBMCP_URL).
        execute: True para aplicar la acción realmente.
        files: Rutas/URLs de imágenes o archivos a subir.

    Returns:
        JSON '{"type": "webmcp_prompt", ...}' con la interpretación y el resultado.
    """
    args = ["prompt", prompt, "--url", _url(url), "--css", WEBMCP_CSS, "--json"]
    for f in files or []:
        args += ["--file", f]
    args.append("--execute" if execute else "--dry-run")
    return _structured("webmcp_prompt", {"executed": execute, "result": _run(args)})


@tool
def browser_animate(
    animation_file: str,
    url: Optional[str] = None,
    strategy: str = "queue",
    dry_run: bool = True,
    sandbox: bool = False,
) -> str:
    """Aplica animaciones declarativas (webmcp-animation-*) respetando las del sitio.

    Args:
        animation_file: Ruta a un .webmcp.css con reglas webmcp-animation-*.
        url: URL del sitio (opcional; por defecto WEBMCP_URL).
        strategy: Estrategia global de conflictos: replace | queue | ignore | merge.
        dry_run: True (por defecto) para ver plan, validación y conflictos sin ejecutar.
        sandbox: True para aislar las animaciones en un shadow root.

    Returns:
        JSON '{"type": "webmcp_animation", ...}' con plan, conflictos y resultado.
    """
    args = ["animate", animation_file, "--url", _url(url), "--conflict-strategy", strategy, "--json"]
    if dry_run:
        args.append("--dry-run")
    if sandbox:
        args.append("--sandbox")
    return _structured("webmcp_animation", {"dryRun": dry_run, "result": _run(args)})


BROWSER_TOOLS = [
    browser_get_webmcp_graph,
    browser_validate_selector,
    browser_repair_selector,
    browser_prompt,
    browser_animate,
]
`;
}

/**
 * Fragmento de `config.yaml` de DeerFlow con el grupo `browser`.
 *
 * @param ctx Ruta CSS y URL.
 */
export function buildDeerFlowConfigYaml(ctx: ExportContext): string {
  const tools = DEERFLOW_TOOL_NAMES.map(
    (name) => `  - name: ${name}\n    group: browser\n    use: webmcp_tools:${name}`,
  ).join('\n');
  return `# Fragmento para config.yaml de DeerFlow — generado por webmcpcss v${VERSION}
# 1. Copia webmcp_tools.py a backend/ (o a cualquier ruta del PYTHONPATH).
# 2. Fusiona este bloque en config.yaml.
# 3. Define WEBMCP_CSS / WEBMCP_URL en el entorno del backend o del sandbox.
tool_groups:
  - name: browser          # navegación y acciones WebMCP sobre el sitio

tools:
${tools}

# Variables de entorno usadas por webmcp_tools.py
#   WEBMCP_CSS=${ctx.cssPath}
#   WEBMCP_URL=${ctx.url ?? 'https://tu-sitio.com'}
#   WEBMCPCSS_BIN=webmcpcss   (opcional)
`;
}

/**
 * `extensions_config.json` de DeerFlow con el servidor MCP `webmcpcss`
 * (alternativa/complemento a las herramientas Python).
 *
 * @param toolMap Tool map parseado (para los *routing hints*).
 * @param ctx Ruta CSS y URL.
 */
export function buildDeerFlowExtensions(toolMap: ToolMap, ctx: ExportContext): string {
  const keywords = [
    'webmcp',
    'selector',
    'carrito',
    'formulario',
    'página web',
    'sitio web',
    ...Object.keys(toolMap.tools).slice(0, 10),
  ];
  return (
    JSON.stringify(
      {
        mcpServers: {
          webmcpcss: {
            enabled: true,
            type: 'stdio',
            command: 'webmcpcss',
            args: [
              'mcp',
              '--serve',
              '--css',
              ctx.cssPath,
              ...(ctx.url ? ['--url', ctx.url] : []),
            ],
            tool_name_prefix: true,
            session_init_timeout: 60,
            tool_call_timeout: 180,
            routing: { mode: 'prefer', priority: 60, keywords },
          },
        },
        skills: { 'webmcp-browser': { enabled: true } },
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * Skill `webmcp-browser` (SKILL.md con frontmatter) para DeerFlow.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 */
export function buildDeerFlowSkill(toolMap: ToolMap, ctx: ExportContext): string {
  const names = Object.keys(toolMap.tools);
  return `---
name: webmcp-browser
description: Opera sitios web mediante sus herramientas WebMCP declaradas en ${ctx.cssPath} (${names.slice(0, 5).join(', ') || 'sin herramientas'}${names.length > 5 ? '…' : ''}). Úsala cuando la tarea implique interactuar con ${ctx.url ?? 'el sitio'}: añadir al carrito, rellenar formularios, validar/reparar selectores, modificar la página por prompt o aplicar animaciones.
license: MIT
allowed-tools:
  - browser_get_webmcp_graph
  - browser_validate_selector
  - browser_repair_selector
  - browser_prompt
  - browser_animate
  - bash
---

# WebMCP browser skill (webmcpcss v${VERSION})

## Flujo recomendado

1. **Descubre**: llama a \`browser_get_webmcp_graph\` (con \`live=true\` si
   necesitas saber qué selectores siguen vivos). Reenvía el mensaje
   \`{"type": "webmcp_graph"}\` a los sub-agentes que vayan a operar la página.
2. **Actúa**: ejecuta la herramienta del sitio a través del servidor MCP
   (\`webmcpcss_<herramienta>\`) o con bash:
   \`webmcpcss run ${ctx.url ?? '<url>'} ${ctx.cssPath} <herramienta> --args '{...}'\`.
3. **Si algo falla**: \`browser_validate_selector\` para diagnosticar y
   \`browser_repair_selector\` (primero sin \`apply\`) para proponer un arreglo.
4. **Cambios libres**: \`browser_prompt\` interpreta órdenes en lenguaje
   natural; pide confirmación antes de \`execute=true\`.
5. **Animaciones**: \`browser_animate\` con \`dry_run=true\` muestra plan y
   conflictos con GSAP/Framer/CSS del sitio; aplica solo tras revisarlos.

## Reglas

- Nunca inventes selectores: usa los del grafo o los devueltos por repair.
- Acciones destructivas (pagar, borrar, enviar) requieren confirmación humana.
- Comparte el grafo como mensaje estructurado en vez de re-escanear la página.

## Herramientas del sitio

${names.map((n) => `- \`${n}\` — ${toolMap.tools[n].description ?? toolMap.tools[n].selector}`).join('\n') || '_Ninguna declarada._'}
`;
}

/**
 * Exporta el paquete completo para DeerFlow.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 * @returns Mapa ruta relativa → contenido.
 */
export function exportDeerFlow(
  toolMap: ToolMap,
  ctx: ExportContext,
): Record<string, string> {
  return {
    'webmcp_tools.py': buildDeerFlowTools(toolMap, ctx),
    'deerflow-tools.yaml': buildDeerFlowConfigYaml(ctx),
    'extensions_config.json': buildDeerFlowExtensions(toolMap, ctx),
    'skills/webmcp-browser/SKILL.md': buildDeerFlowSkill(toolMap, ctx),
    'README.md': `# Integración con DeerFlow (webmcpcss v${VERSION})

Dos vías, combinables:

## A) Herramientas Python del grupo \`browser\`

1. Copia \`webmcp_tools.py\` al backend de DeerFlow (p. ej. \`backend/webmcp_tools.py\`).
2. Fusiona \`deerflow-tools.yaml\` en tu \`config.yaml\` (grupo \`browser\` +
   cinco herramientas: ${DEERFLOW_TOOL_NAMES.join(', ')}).
3. Exporta \`WEBMCP_CSS=${ctx.cssPath}\` y \`WEBMCP_URL=${ctx.url ?? 'https://…'}\`.
4. Instala el CLI en el sandbox: \`npm i -g webmcpcss\`.

## B) Servidor MCP

Fusiona \`extensions_config.json\` en el \`extensions_config.json\` del proyecto:
DeerFlow arrancará \`webmcpcss mcp --serve\` y expondrá las herramientas como
\`webmcpcss_<nombre>\` (prefijo automático) con *routing hints*.

## Skill

Copia \`skills/webmcp-browser/\` a \`skills/custom/\` de DeerFlow (o súbela como
\`.skill\`). El agente cargará las instrucciones solo cuando la tarea toque el
sitio (carga progresiva).

Docs: https://github.com/cochinoraptor/WebMCPcss/blob/main/docs/agents/deerflow.md
`,
  };
}
