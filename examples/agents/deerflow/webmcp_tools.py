"""Herramientas WebMCP para DeerFlow (grupo 'browser') — generado por webmcpcss v0.9.0.

No editar a mano. Regenerar con:
    webmcpcss export examples/shopping-cart/webmcp.css --format deerflow -o <carpeta> --url https://tienda.example.com

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

WEBMCP_CSS = os.environ.get("WEBMCP_CSS", "examples/shopping-cart/webmcp.css")
WEBMCP_URL = os.environ.get("WEBMCP_URL", "https://tienda.example.com")
WEBMCP_BIN = os.environ.get("WEBMCPCSS_BIN", "webmcpcss")
WEBMCP_TIMEOUT = int(os.environ.get("WEBMCP_TIMEOUT", "180"))

# Grafo declarado en tiempo de exportación: permite responder sin navegador
# y compartirlo entre sub-agentes como mensaje estructurado.
STATIC_GRAPH: dict[str, Any] = json.loads("{\"type\":\"webmcp_graph\",\"version\":\"0.9.0\",\"source\":\"examples/shopping-cart/webmcp.css\",\"url\":\"https://tienda.example.com\",\"tools\":[{\"name\":\"addToCart\",\"description\":\"Añade el producto actual al carrito\",\"selector\":\"[data-product] .btn-add\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"productId\":{\"type\":\"string\",\"description\":\"Atributo data-product-id del elemento\"},\"quantity\":{\"type\":\"string\",\"description\":\"Valor a escribir en #qty-input\"}},\"required\":[]}},{\"name\":\"applyCoupon\",\"description\":\"Aplica un cupón de descuento\",\"selector\":\".coupon-form input[type=\\\"text\\\"]\",\"inputSchema\":{\"type\":\"object\",\"properties\":{\"code\":{\"type\":\"string\",\"description\":\"Valor a escribir en el elemento\"}},\"required\":[]}}],\"context\":[{\"name\":\"price\",\"selector\":\".product-price\",\"format\":\"currency\"}]}")


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
