# Integración con Flomny (webmcpcss v0.9.0)

Flomny descubre herramientas externas por MCP y las encadena en workflows
generados desde lenguaje natural. WebMCPcss le ofrece un **servidor MCP
dedicado** con una API de introspección fija:

| Herramienta | Uso |
| --- | --- |
| `list_tools` | Catálogo de herramientas del sitio (con fragilidad) |
| `get_tool_info` | Selector, parámetros, confirmación, huella |
| `get_selector_status` | ¿Existe? · fragilidad · framework · sugerencias |
| `suggest_repair` | Propuesta de reparación sin escribir el archivo |
| `execute_prompt` | Orden en lenguaje natural (dry-run por defecto) |
| `apply_animation` | Animaciones declarativas con resolución de conflictos |

## Instalación

1. `npm i -g webmcpcss`
2. Registra el servidor en Flomny (Integrations → MCP) con el contenido de
   `flomny-mcp.json`, o arráncalo a mano:
   `webmcpcss mcp --serve --flomny --css examples/shopping-cart/webmcp.css --url https://tienda.example.com`
3. Importa `workflow.example.json` como plantilla de workflow.

Sin `--url` el servidor responde en modo estático (catálogo y fragilidad);
con `--url` valida selectores, propone reparaciones y ejecuta acciones en un
navegador headless.

Docs: https://github.com/cochinoraptor/WebMCPcss/blob/main/docs/agents/flomny.md
