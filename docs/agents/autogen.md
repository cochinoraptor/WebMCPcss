# AutoGen / AG2

```bash
webmcpcss export tienda.webmcp.css --format autogen -o ./autogen --url https://tienda.com
```

Genera dos archivos:

- **`webmcp_tools.json`** — cada herramienta con su JSON Schema (`type: object`,
  `properties`), consumible por cualquier framework de function calling.
- **`webmcp_autogen.py`** — `TOOL_SCHEMAS` + `register_with_autogen(agent)`.

```python
from autogen import ConversableAgent
from webmcp_autogen import register_with_autogen

agent = ConversableAgent("shopper", llm_config={"model": "gpt-4o"})
register_with_autogen(agent)  # registra addToCart, applyCoupon, ...
```

Las funciones registradas invocan `webmcpcss run` en un subproceso y
devuelven el JSON del resultado.

Ejemplo generado: [`examples/agents/autogen/`](../../examples/agents/autogen/).
