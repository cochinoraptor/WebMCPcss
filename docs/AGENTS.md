# Integración con agentes IA (45+)

WebMCPcss habla **cuatro dialectos universales** — MCP (stdio), HTTP REST,
JSON Schema y módulos Python — con los que se cubre prácticamente todo el
ecosistema de agentes. Esta tabla indica qué formato usar con cada agente.

## Cómo leer la tabla

- **Formato**: valor para `webmcpcss export <css> --format <formato>` o el
  modo de servidor (`mcp --serve` / `mcp --serve --http`).
- **Guía**: documento en `docs/agents/` con pasos concretos.

## Tabla de agentes soportados

| #   | Agente                               | Empresa              | Formato                      | Guía                                       |
| --- | ------------------------------------ | -------------------- | ---------------------------- | ------------------------------------------ |
| 1   | Claude Desktop                       | Anthropic            | `mcp-config` + `mcp --serve` | [mcp-clients](agents/mcp-clients.md)       |
| 2   | Claude Code                          | Anthropic            | `claude-code`                | [claude-code](agents/claude-code.md)       |
| 3   | Cursor                               | Anysphere            | `cursor`                     | [cursor](agents/cursor.md)                 |
| 4   | Windsurf                             | Codeium              | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 5   | Goose                                | Block                | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 6   | Cline                                | Cline Bot            | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 7   | Roo Code                             | Roo                  | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 8   | Continue                             | Continue.dev         | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 9   | Zed AI                               | Zed Industries       | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 10  | GitHub Copilot (VS Code)             | GitHub               | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 11  | JetBrains AI Assistant               | JetBrains            | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 12  | Gemini CLI                           | Google               | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 13  | Codex CLI                            | OpenAI               | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 14  | Amazon Q Developer                   | AWS                  | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 15  | LibreChat                            | LibreChat            | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 16  | Open WebUI                           | Open WebUI           | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 17  | 5ire                                 | 5ire                 | `mcp-config`                 | [mcp-clients](agents/mcp-clients.md)       |
| 18  | Flomny                               | Flomny               | `flomny` (`mcp --flomny`)    | [flomny](agents/flomny.md)                 |
| 19  | CrewAI                               | CrewAI Inc           | `crewai`                     | [crewai](agents/crewai.md)                 |
| 20  | AutoGen / AG2                        | Microsoft            | `autogen`                    | [autogen](agents/autogen.md)               |
| 21  | LangGraph                            | LangChain            | `langgraph`                  | [langgraph](agents/langgraph.md)           |
| 22  | LangChain                            | LangChain            | `langgraph`                  | [langgraph](agents/langgraph.md)           |
| 23  | LlamaIndex Agents                    | LlamaIndex           | `json-schema`                | [json-schema](agents/json-schema.md)       |
| 24  | Semantic Kernel                      | Microsoft            | `json-schema`                | [json-schema](agents/json-schema.md)       |
| 25  | Haystack Agents                      | deepset              | `json-schema`                | [json-schema](agents/json-schema.md)       |
| 26  | smolagents                           | Hugging Face         | `json-schema`                | [json-schema](agents/json-schema.md)       |
| 27  | PydanticAI                           | Pydantic             | `json-schema`                | [json-schema](agents/json-schema.md)       |
| 28  | OpenAI Assistants / function calling | OpenAI               | `json-schema`                | [json-schema](agents/json-schema.md)       |
| 29  | Gemini function calling              | Google               | `json-schema`                | [json-schema](agents/json-schema.md)       |
| 30  | Mistral function calling             | Mistral              | `json-schema`                | [json-schema](agents/json-schema.md)       |
| 31  | ChatGPT Atlas                        | OpenAI               | `browser-inject`             | [browser-agents](agents/browser-agents.md) |
| 32  | Operator                             | OpenAI               | `browser-inject`             | [browser-agents](agents/browser-agents.md) |
| 33  | Project Mariner                      | Google               | `browser-inject`             | [browser-agents](agents/browser-agents.md) |
| 34  | Comet                                | Perplexity           | `browser-inject`             | [browser-agents](agents/browser-agents.md) |
| 35  | Skyvern                              | Skyvern              | `browser-inject` + REST      | [browser-agents](agents/browser-agents.md) |
| 36  | Browser Use                          | Browser Use          | `browser-inject` + REST      | [browser-agents](agents/browser-agents.md) |
| 37  | Stagehand                            | Browserbase          | `browser-inject`             | [browser-agents](agents/browser-agents.md) |
| 38  | Nanobrowser                          | Nanobrowser          | `browser-inject`             | [browser-agents](agents/browser-agents.md) |
| 39  | Manus                                | Monica               | REST (`mcp --serve --http`)  | [rest-api](agents/rest-api.md)             |
| 40  | Devin                                | Cognition            | REST                         | [rest-api](agents/rest-api.md)             |
| 41  | OpenHands                            | All Hands AI         | `mcp-config` o REST          | [rest-api](agents/rest-api.md)             |
| 42  | AgentGPT / AutoGPT                   | Significant Gravitas | `json-schema` o REST         | [rest-api](agents/rest-api.md)             |
| 43  | n8n AI Agents                        | n8n                  | REST                         | [rest-api](agents/rest-api.md)             |
| 44  | Dify                                 | LangGenius           | `json-schema` o REST         | [rest-api](agents/rest-api.md)             |
| 45  | Obsidian (documentación)             | —                    | `graph --obsidian`           | [obsidian](agents/obsidian.md)             |
| 46  | DeerFlow                             | ByteDance            | `deerflow`                   | [deerflow](agents/deerflow.md)             |

> ¿Falta tu agente? Si habla MCP usa `mcp-config`; si hace function calling
> usa `json-schema`; si controla un navegador usa `browser-inject`; y si no,
> siempre queda la API REST. Abre un issue si necesitas un formato nuevo.

## Los cuatro dialectos

### 1. Servidor MCP (stdio)

```bash
webmcpcss mcp --serve --css tienda.webmcp.css --url https://tienda.com
```

Expone `tools/list`, `tools/call` (ejecución real con navegador si pasas
`--url`; dry-run si no), `resources/list` y `resources/read`
(`webmcp://source`, `webmcp://graph`). Sin dependencias extra: JSON-RPC 2.0
por stdin/stdout.

### 2. API REST (HTTP)

```bash
webmcpcss mcp --serve --http -p 8090 --css tienda.webmcp.css --url https://tienda.com
```

- `GET /api/tools` — lista con JSON Schema por herramienta.
- `GET /api/graph` — grafo completo (tools + context).
- `POST /api/call` — `{"tool":"addToCart","args":{"quantity":"2"}}`.

### 3. Exportadores de archivos

```bash
webmcpcss export tienda.webmcp.css --format <formato> -o <carpeta> --url <url>
```

Formatos: `mcp-config`, `claude-code`, `cursor`, `deerflow`, `flomny`,
`crewai`, `autogen`, `langgraph`, `browser-inject`, `json-schema`.

Novedades v0.9.0:

- `claude-code`: comandos `/webmcpcss:prompt` y `/webmcpcss:animate`, skill
  `webmcp-audit` y `.mcp.json` incluido.
- `cursor`: snippets `webmcp:` con selectores estables, regla
  `.cursor/rules/webmcpcss.mdc` y `--register` para escribir
  `~/.cursor/mcp.json`.
- `deerflow`: herramientas Python del grupo `browser`
  (`browser_get_webmcp_graph`, `browser_validate_selector`,
  `browser_repair_selector`, `browser_prompt`, `browser_animate`), skill y
  `extensions_config.json`.
- `flomny`: servidor MCP dedicado (`webmcpcss mcp --serve --flomny`) con
  `list_tools`, `get_tool_info`, `get_selector_status`, `suggest_repair`,
  `execute_prompt`, `apply_animation`.

### 4. Ejecución directa (para wrappers)

```bash
webmcpcss run https://tienda.com tienda.webmcp.css addToCart --args '{"quantity":"2"}'
```

Imprime **solo JSON** en stdout — es lo que invocan los módulos Python
generados (CrewAI/AutoGen/LangGraph).
