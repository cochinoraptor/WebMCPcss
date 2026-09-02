"""Herramientas WebMCP generadas por webmcpcss — no editar a mano.

Requisitos: Node.js con webmcpcss instalado (npm i -g webmcpcss).
Cada herramienta ejecuta: webmcpcss run <url> <css> <tool> --args JSON
"""

import json
import subprocess

WEBMCP_CSS = "examples/shopping-cart/webmcp.css"
WEBMCP_URL = "https://tienda.example.com"


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


from langchain_core.tools import tool


@tool
def add_to_cart(product_id: str = "", quantity: str = "") -> str:
    """Añade el producto actual al carrito"""
    return _run_tool("addToCart", {"productId": product_id, "quantity": quantity})


@tool
def apply_coupon(code: str = "") -> str:
    """Aplica un cupón de descuento"""
    return _run_tool("applyCoupon", {"code": code})


TOOLS = [add_to_cart, apply_coupon]

# Uso con LangGraph:
#   from langgraph.prebuilt import create_react_agent
#   agent = create_react_agent(model, TOOLS)
