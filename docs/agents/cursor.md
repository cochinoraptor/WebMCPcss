# Cursor

```bash
webmcpcss export tienda.webmcp.css --format cursor -o ./cursor-config --url https://tienda.com
```

1. Fusiona `cursor-config/mcp.json` con `~/.cursor/mcp.json` (global) o
   `.cursor/mcp.json` del proyecto.
2. Reinicia Cursor → Settings → MCP: verás el servidor `webmcpcss` en verde.
3. En el chat (modo Agent), Cursor puede listar y ejecutar las herramientas
   del `.webmcp.css` (la ejecución real abre un navegador headless).

Config resultante:

```json
{
  "mcpServers": {
    "webmcpcss": {
      "command": "webmcpcss",
      "args": [
        "mcp",
        "--serve",
        "--css",
        "tienda.webmcp.css",
        "--url",
        "https://tienda.com"
      ]
    }
  }
}
```

Requiere `npm i -g webmcpcss`. Ejemplo generado:
[`examples/agents/cursor/`](../../examples/agents/cursor/).
