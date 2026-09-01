# examples/api-tools

Ejemplo de integración con la **API imperativa de WebMCP**
(`navigator.modelContext`), CSS moderno y auto-descubrimiento.

## Qué demuestra

- **CSS → API**: `webmcp-tools.js` se genera desde el `.webmcp.css`
  (herramienta `clearSearch`) con:

  ```bash
  webmcpcss generate --api webmcp.css -o webmcp-tools.js
  ```

- **CSS moderno**: variables (`--query-field`), reglas anidadas y
  contextos de solo lectura (`query`, `docTitle`).
- **API → WebMCPcss**: la página registra `searchDocs` directamente con
  `navigator.modelContext.registerTool()`; `WebMCPApiAdapter` puede
  listarla e invocarla.
- **Auto-descubrimiento**: `<meta name="webmcp" content="webmcp.css">`.

## Probar

```bash
# desde la raíz del repo (tras npm run build):
node dist/src/cli.js discover https://tuservidor/  # si lo publicas
node dist/src/cli.js parse examples/api-tools/webmcp.css
node dist/src/cli.js generate --api examples/api-tools/webmcp.css -o examples/api-tools/webmcp-tools.js
```

## Validar contra la página local

```bash
node dist/src/cli.js validate examples/api-tools/index.html examples/api-tools/webmcp.css
```
