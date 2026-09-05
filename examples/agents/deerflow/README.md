# Integración con DeerFlow (webmcpcss v0.9.0)

Dos vías, combinables:

## A) Herramientas Python del grupo `browser`

1. Copia `webmcp_tools.py` al backend de DeerFlow (p. ej. `backend/webmcp_tools.py`).
2. Fusiona `deerflow-tools.yaml` en tu `config.yaml` (grupo `browser` +
   cinco herramientas: browser_get_webmcp_graph, browser_validate_selector, browser_repair_selector, browser_prompt, browser_animate).
3. Exporta `WEBMCP_CSS=examples/shopping-cart/webmcp.css` y `WEBMCP_URL=https://tienda.example.com`.
4. Instala el CLI en el sandbox: `npm i -g webmcpcss`.

## B) Servidor MCP

Fusiona `extensions_config.json` en el `extensions_config.json` del proyecto:
DeerFlow arrancará `webmcpcss mcp --serve` y expondrá las herramientas como
`webmcpcss_<nombre>` (prefijo automático) con *routing hints*.

## Skill

Copia `skills/webmcp-browser/` a `skills/custom/` de DeerFlow (o súbela como
`.skill`). El agente cargará las instrucciones solo cuando la tarea toque el
sitio (carga progresiva).

Docs: https://github.com/cochinoraptor/WebMCPcss/blob/main/docs/agents/deerflow.md
