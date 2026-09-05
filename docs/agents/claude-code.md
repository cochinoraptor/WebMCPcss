# Claude Code

Integración vía **plugin generado** (comandos slash) o vía **servidor MCP**.

## Opción A: plugin

```bash
webmcpcss export tienda.webmcp.css --format claude-code -o ./claude-plugin --url https://tienda.com
claude plugin install ./claude-plugin
```

Estructura del plugin (v0.9.0):

```
claude-plugin/
├── .claude-plugin/plugin.json      # manifiesto (versión = la del paquete)
├── .mcp.json                       # servidor MCP webmcpcss (se arranca con el plugin)
├── commands/{generate,validate,repair,run,prompt,animate}.md
├── skills/webmcp-audit/SKILL.md    # auditoría de fragilidad
└── README.md
```

Comandos disponibles:

- `/webmcpcss:generate <url>` — genera un `.webmcp.css` con `--auto` y lo valida.
- `/webmcpcss:validate <url> <css>` — reporte de selectores rotos.
- `/webmcpcss:repair <url> <css>` — repara con visión + huellas.
- `/webmcpcss:run <herramienta> <args>` — ejecuta una herramienta en el sitio.
- `/webmcpcss:prompt "<orden>"` — modifica la página con lenguaje natural:
  primero interpreta en seco (`--json`), muestra la acción, pide confirmación
  y solo entonces ejecuta con `--execute --screenshot`.
- `/webmcpcss:animate <animation.webmcp.css>` — ejecuta
  `validate-conflicts`, explica los conflictos previstos con GSAP/Framer/CSS
  del sitio y aplica con `animate` (`--sandbox`, `--conflict-strategy`).

Skill **`webmcp-audit`**: se activa al pedir «audita / revisa / haz robusto
este webmcp.css». Genera el grafo con `graph --fragility`, tabula selector ·
nivel · framework · sugerencia y propone reemplazos estables
(`[data-tool]` → `#id` → `[aria-label]`), añadiendo `webmcp-fingerprint` a
las herramientas críticas.

Requiere `webmcpcss` en el PATH: `npm i -g webmcpcss`.

## Opción B: servidor MCP

```bash
claude mcp add webmcpcss -- webmcpcss mcp --serve --css tienda.webmcp.css --url https://tienda.com
```

Claude Code verá `addToCart`, `applyCoupon`, etc. como herramientas MCP
nativas y podrá ejecutarlas directamente (abre un navegador headless).

Ejemplo generado: [`examples/agents/claude-code/`](../../examples/agents/claude-code/).
