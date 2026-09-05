# Flomny

[Flomny](https://ir.iba.edu.pk/fyp-bscs/18/) descompone un prompt en un
workflow de pasos y descubre herramientas externas por **MCP**. En lugar de
exponer una herramienta MCP por cada acción del sitio (como hace el servidor
genérico), WebMCPcss le ofrece un **servidor dedicado** con una API de
introspección fija, más cómoda para planificar y validar pasos:

```bash
webmcpcss export tienda.webmcp.css --format flomny -o ./flomny --url https://tienda.com
webmcpcss mcp --serve --flomny --css tienda.webmcp.css --url https://tienda.com
```

| Herramienta           | Argumentos                                       | Devuelve                                                                      |
| --------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| `list_tools`          | `includeContext?`                                | catálogo: nombre, descripción, params, `inputSchema`, fragilidad, framework   |
| `get_tool_info`       | `name`                                           | selector, params (origen/selector), confirmación, trigger, huella, fragilidad |
| `get_selector_status` | `selector` \| `tool`, `url?`                     | `exists` (con `--url`), `fragility`, `framework`, `reasons`, `suggestions`    |
| `suggest_repair`      | `tool?`, `url?`                                  | propuestas old→new con confianza (con `--url`); nunca escribe el archivo      |
| `execute_prompt`      | `prompt`, `dryRun?`, `files?`, `screenshot?`     | interpretación / resultado de `webmcpcss prompt`                              |
| `apply_animation`     | `animationFile` \| `css`, `strategy?`, `dryRun?` | plan, conflictos y resultado de `webmcpcss animate`                           |

- Sin `--url` el servidor funciona en **modo estático**: catálogo y análisis
  de fragilidad; `exists` es `null` y `suggest_repair` devuelve solo
  heurísticas.
- Con `--url` valida selectores y propone reparaciones abriendo un navegador
  headless.
- `initialize` anuncia `webmcpcss-flomny`; también sirve por HTTP con
  `--http -p 8090` (`GET /api/tools`, `POST /api/call`).

## Archivos generados

```
flomny/
├── flomny-mcp.json          # mcpServers.webmcpcss-flomny (command/args)
├── workflow.example.json    # plantilla: list_tools → get_tool_info → get_selector_status → execute_prompt
└── README.md
```

Registra `flomny-mcp.json` en Integrations → MCP de Flomny e importa el
workflow de ejemplo como plantilla. El paso `get_selector_status` incluye
`on_failure: suggest_repair`, y `execute_prompt` se ejecuta primero en
`dryRun` con `requires_confirmation: true`.

## API

```ts
import { FlomnyMcpCore, startMcpStdioServer } from 'webmcpcss';

const core = new FlomnyMcpCore({
  toolMap,
  cssPath: 'tienda.webmcp.css',
  url: 'https://tienda.com',
  validateSelectors: async (url) => webmcp.validate(url), // opcional
  suggestRepairs: async () => webmcp.repairAll(), // opcional
  prompt,
  animate, // opcionales
});
await startMcpStdioServer(core);
```

Ejemplo generado: [`examples/agents/flomny/`](../../examples/agents/flomny/).
