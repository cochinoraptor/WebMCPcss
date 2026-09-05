# Clientes MCP genéricos

Aplica a: **Claude Desktop, Windsurf, Goose, Cline, Roo Code, Continue,
Zed, GitHub Copilot (VS Code), JetBrains AI, Gemini CLI, Codex CLI,
Amazon Q, LibreChat, Open WebUI, 5ire** y cualquier cliente que soporte
servidores MCP por stdio. (Flomny tiene un [servidor dedicado](flomny.md) y
Cursor su [propia guía](cursor.md).)

## 1. Genera el snippet

```bash
webmcpcss export tienda.webmcp.css --format mcp-config -o . --url https://tienda.com
```

Produce `mcp-config.json`:

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

## 2. Pégalo en la configuración de tu cliente

| Cliente           | Archivo                                         |
| ----------------- | ----------------------------------------------- |
| Claude Desktop    | `claude_desktop_config.json`                    |
| Cursor            | `~/.cursor/mcp.json`                            |
| Windsurf          | `~/.codeium/windsurf/mcp_config.json`           |
| Cline / Roo Code  | ajustes MCP de la extensión                     |
| Continue          | `~/.continue/config.yaml` (bloque `mcpServers`) |
| Goose             | `~/.config/goose/config.yaml`                   |
| VS Code (Copilot) | `.vscode/mcp.json`                              |
| Gemini CLI        | `~/.gemini/settings.json`                       |
| Codex CLI         | `~/.codex/config.toml`                          |

## 3. Qué expone el servidor

- **tools/list** — cada herramienta del `.webmcp.css` con su JSON Schema.
- **tools/call** — ejecuta la herramienta con navegador headless (necesita
  `--url`; sin él responde dry-run con el selector y los args).
- **resources** — `webmcp://source` (el CSS) y `webmcp://graph` (grafo JSON).

Sin `webmcpcss` global también funciona con npx:
`"command": "npx", "args": ["-y", "webmcpcss", "mcp", "--serve", ...]`.
