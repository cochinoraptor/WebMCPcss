# Claude Code

Integración vía **plugin generado** (comandos slash) o vía **servidor MCP**.

## Opción A: plugin

```bash
webmcpcss export tienda.webmcp.css --format claude-code -o ./claude-plugin --url https://tienda.com
claude plugin install ./claude-plugin
```

Comandos disponibles:

- `/webmcpcss:generate <url>` — genera un `.webmcp.css` con `--auto` y lo valida.
- `/webmcpcss:validate <url> <css>` — reporte de selectores rotos.
- `/webmcpcss:repair <url> <css>` — repara con visión + huellas.
- `/webmcpcss:run <herramienta> <args>` — ejecuta una herramienta en el sitio.

Requiere `webmcpcss` en el PATH: `npm i -g webmcpcss`.

## Opción B: servidor MCP

```bash
claude mcp add webmcpcss -- webmcpcss mcp --serve --css tienda.webmcp.css --url https://tienda.com
```

Claude Code verá `addToCart`, `applyCoupon`, etc. como herramientas MCP
nativas y podrá ejecutarlas directamente (abre un navegador headless).

Ejemplo generado: [`examples/agents/claude-code/`](../../examples/agents/claude-code/).
