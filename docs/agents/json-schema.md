# JSON Schema genérico (function calling)

Para **LlamaIndex, Semantic Kernel, Haystack, smolagents, PydanticAI** y las
APIs de function calling de **OpenAI, Gemini, Mistral, Groq...**

```bash
webmcpcss export tienda.webmcp.css --format json-schema -o . --url https://tienda.com
```

Genera `webmcp-schemas.json`:

```json
{
  "source": "tienda.webmcp.css",
  "url": "https://tienda.com",
  "tools": [
    {
      "name": "addToCart",
      "description": "Añade el producto actual al carrito",
      "inputSchema": {
        "type": "object",
        "properties": { "quantity": { "type": "string", "description": "..." } },
        "required": []
      }
    }
  ]
}
```

## Patrón de uso (OpenAI como ejemplo)

```python
import json, subprocess
from openai import OpenAI

schemas = json.load(open("webmcp-schemas.json"))
tools = [{"type": "function", "function": {"name": t["name"],
          "description": t["description"], "parameters": t["inputSchema"]}}
         for t in schemas["tools"]]

client = OpenAI()
resp = client.chat.completions.create(model="gpt-4o", tools=tools,
    messages=[{"role": "user", "content": "Añade 2 unidades al carrito"}])

call = resp.choices[0].message.tool_calls[0]
result = subprocess.run(
    ["webmcpcss", "run", schemas["url"], schemas["source"],
     call.function.name, "--args", call.function.arguments],
    capture_output=True, text=True).stdout
```

El mismo patrón (schema → tool_call → `webmcpcss run`) funciona en cualquier
framework. Ejemplo generado:
[`examples/agents/json-schema/`](../../examples/agents/json-schema/).
