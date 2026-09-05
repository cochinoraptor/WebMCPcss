# Tienda IA-First

Proyecto **IA-First** generado con `webmcpcss init --framework ia-first`.

```bash
npx serve .                                  # o cualquier servidor estático
webmcpcss validate http://localhost:3000 webmcp.css
webmcpcss mcp --serve --css webmcp.css --url http://localhost:3000
webmcpcss doc generate --file webmcp.css -o docs/
```

- `webmcp.css` — intenciones, confirmaciones y accesibilidad de cada componente.
- `index.html` — componentes con selectores estables (`data-tool`).
- `.well-known/webmcp.json` y `<link rel="webmcp">` — descubrimiento por agentes.
- `mcp.json` — servidor MCP listo para Claude Desktop / Cursor / DeerFlow.

Siguiente paso: `webmcpcss assist "añade un buscador de productos"`.
