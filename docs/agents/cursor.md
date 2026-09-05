# Cursor

```bash
webmcpcss export tienda.webmcp.css --format cursor -o ./cursor-config --url https://tienda.com
```

Genera (v0.9.0):

```
cursor-config/
├── mcp.json                          # servidor MCP webmcpcss
├── .vscode/webmcp.code-snippets      # autocompletado con prefijo webmcp:
├── .cursor/rules/webmcpcss.mdc       # regla de proyecto para el agente
└── README.md
```

## 1. Servidor MCP

- **Automático**: `webmcpcss export tienda.webmcp.css --format cursor --register`
  fusiona el servidor en `~/.cursor/mcp.json` conservando los que ya tengas.
- **Manual**: fusiona `mcp.json` con `~/.cursor/mcp.json` (global) o
  `.cursor/mcp.json` del proyecto.

Reinicia Cursor → Settings → MCP: verás `webmcpcss` en verde con las
herramientas del `.webmcp.css` más `webmcpcss_prompt` y `webmcpcss_animate`
(la ejecución real abre un navegador headless).

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

## 2. Autocompletado `webmcp:`

Copia `.vscode/webmcp.code-snippets` a la carpeta `.vscode/` del proyecto (o
a tus snippets de usuario). En cualquier archivo CSS/SCSS/LESS escribe
`webmcp:` y elige:

| Prefijo              | Inserta                                                                                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webmcp:tool`        | bloque de herramienta con selector estable a elegir (`[data-tool]`, `#id`, `[aria-label]`)                                                                                                                                           |
| `webmcp:context`     | dato de contexto con `webmcp-format`                                                                                                                                                                                                 |
| `webmcp:param`       | `webmcp-param-*` con `value()/attr()/data()/aria()/text()/"literal"`                                                                                                                                                                 |
| `webmcp:fingerprint` | huella JSON para `webmcpcss repair`                                                                                                                                                                                                  |
| `webmcp:animation`   | regla `webmcp-animation-*` con tipo, prioridad, trigger y estrategia de conflicto                                                                                                                                                    |
| `webmcp:<tool>`      | **una por herramienta declarada** (`webmcp:addToCart`…): el selector es una elección entre candidatos estables, ordenados por preferencia; el resto del bloque (descripción, params, confirmación) se rellena desde tu `.webmcp.css` |

Los candidatos los calcula `stableSelectorCandidates(nombre, selectorActual)`:
si el selector actual ya es `low` va primero; si es frágil (hash de CSS
Modules, `data-v-*`, `sc-*`…) se relega al final tras `[data-tool="…"]`,
`[data-testid="…"]` y `#id`.

## 3. Regla para el agente

Copia `.cursor/rules/webmcpcss.mdc` a `.cursor/rules/`. Se aplica al editar
`*.webmcp.css` y da al agente de Cursor las convenciones de selectores
estables, el comando de validación y una tabla con cada herramienta, su
selector actual, su fragilidad (y framework) y el selector recomendado.

Requiere `npm i -g webmcpcss`. Ejemplo generado:
[`examples/agents/cursor/`](../../examples/agents/cursor/).
