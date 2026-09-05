# Ejemplos de integración por agente

Todos los archivos de estas carpetas fueron generados con el CLI a partir de
[`../shopping-cart/webmcp.css`](../shopping-cart/webmcp.css):

```bash
webmcpcss export examples/shopping-cart/webmcp.css \
  --format <formato> -o examples/agents/<formato> \
  --url https://tienda.example.com
```

| Carpeta           | Formato          | Agentes destino                                                             |
| ----------------- | ---------------- | --------------------------------------------------------------------------- |
| `mcp-config/`     | `mcp-config`     | Claude Desktop, Goose, Windsurf, cualquier cliente MCP                      |
| `claude-code/`    | `claude-code`    | Claude Code (plugin con comandos slash, `.mcp.json` y skill `webmcp-audit`) |
| `cursor/`         | `cursor`         | Cursor (mcp.json, snippets `webmcp:`, regla `.mdc`)                         |
| `deerflow/`       | `deerflow`       | DeerFlow (tools Python `browser_*`, skill, `extensions_config.json`)        |
| `flomny/`         | `flomny`         | Flomny (servidor MCP dedicado `mcp --serve --flomny` + workflow de ejemplo) |
| `crewai/`         | `crewai`         | CrewAI (módulo Python)                                                      |
| `autogen/`        | `autogen`        | AutoGen / function calling (JSON Schema + Python)                           |
| `langgraph/`      | `langgraph`      | LangGraph / LangChain (`@tool`)                                             |
| `browser-inject/` | `browser-inject` | ChatGPT Atlas, Operator, Project Mariner, Comet, Skyvern                    |
| `json-schema/`    | `json-schema`    | OpenAI/Gemini/Mistral function calling genérico                             |

Para regenerarlos todos: `bash ../../scripts/regen-agent-examples.sh` (o el
bucle de arriba). La guía completa por agente está en
[`../../docs/AGENTS.md`](../../docs/AGENTS.md).
