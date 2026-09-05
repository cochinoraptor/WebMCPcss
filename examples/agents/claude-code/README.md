# Plugin Claude Code — webmcpcss v0.9.0

Instalación:

```bash
claude plugin install ./claude-plugin   # o la ruta de esta carpeta
```

## Comandos slash

| Comando | Qué hace |
| --- | --- |
| `/webmcpcss:generate <url>` | Genera un `.webmcp.css` escaneando el DOM |
| `/webmcpcss:validate <url> <css>` | Reporta selectores rotos |
| `/webmcpcss:repair <url> <css>` | Repara con visión + huellas |
| `/webmcpcss:run <herramienta> <args>` | Ejecuta una herramienta de `examples/shopping-cart/webmcp.css` |
| `/webmcpcss:prompt "<orden>"` | Modifica la página con lenguaje natural (dry-run + confirmación) |
| `/webmcpcss:animate <animation.webmcp.css>` | Valida conflictos y aplica animaciones declarativas |

## Skill

- **webmcp-audit** — auditoría de fragilidad de selectores con sugerencias
  de migración (se activa al pedir "audita/revisa este webmcp.css").

## Servidor MCP

El plugin declara en `.mcp.json` el servidor `webmcpcss mcp --serve`, que
expone 2 herramienta(s) del sitio (addToCart, applyCoupon)
más `webmcpcss_prompt` y `webmcpcss_animate`.

Requiere `webmcpcss` en el PATH (`npm i -g webmcpcss`).
