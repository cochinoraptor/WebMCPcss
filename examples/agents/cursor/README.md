# Integración con Cursor (webmcpcss v0.9.0)

## 1. Servidor MCP

- Automático: `webmcpcss export examples/shopping-cart/webmcp.css --format cursor --register`
  (fusiona el servidor en `~/.cursor/mcp.json`).
- Manual: copia el contenido de `mcp.json` en `~/.cursor/mcp.json` (global)
  o en `.cursor/mcp.json` del proyecto.

Reinicia Cursor. En Settings → MCP verás el servidor `webmcpcss` con las
herramientas de `examples/shopping-cart/webmcp.css` más `webmcpcss_prompt` y `webmcpcss_animate`.

## 2. Autocompletado `webmcp:`

Copia `.vscode/webmcp.code-snippets` a la carpeta `.vscode/` de tu proyecto
(o a tus snippets de usuario). En cualquier archivo CSS escribe `webmcp:` y
elige: `webmcp:tool`, `webmcp:context`, `webmcp:param`,
`webmcp:fingerprint`, `webmcp:animation` o una herramienta concreta
(`webmcp:addToCart`). Cada snippet ofrece
**selectores estables** como primera elección.

## 3. Regla para el agente

Copia `.cursor/rules/webmcpcss.mdc` a `.cursor/rules/` del proyecto: el
agente de Cursor conocerá las herramientas, su fragilidad y las convenciones
de selectores al editar archivos `.webmcp.css`.

Requiere `webmcpcss` instalado globalmente: `npm i -g webmcpcss`.
