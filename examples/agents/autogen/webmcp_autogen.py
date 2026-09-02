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


TOOL_SCHEMAS = json.loads("""{
  "source": "examples/shopping-cart/webmcp.css",
  "url": "https://tienda.example.com",
  "tools": [
    {
      "name": "addToCart",
      "description": "Añade el producto actual al carrito",
      "schema": {
        "type": "object",
        "properties": {
          "productId": {
            "type": "string",
            "description": "Atributo data-product-id del elemento"
          },
          "quantity": {
            "type": "string",
            "description": "Valor a escribir en #qty-input"
          }
        },
        "required": []
      }
    },
    {
      "name": "applyCoupon",
      "description": "Aplica un cupón de descuento",
      "schema": {
        "type": "object",
        "properties": {
          "code": {
            "type": "string",
            "description": "Valor a escribir en el elemento"
          }
        },
        "required": []
      }
    }
  ]
}""")["tools"]

def register_with_autogen(agent):
    """Registra todas las herramientas en un ConversableAgent de AutoGen."""
    for schema in TOOL_SCHEMAS:
        name = schema["name"]
        def make_fn(tool_name):
            def fn(**kwargs):
                return _run_tool(tool_name, kwargs)
            fn.__name__ = tool_name
            return fn
        agent.register_for_llm(name=name, description=schema["description"])(make_fn(name))
