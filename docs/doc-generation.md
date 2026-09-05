# Doc-MCP (v1.0.0)

Documentación **interactiva y multi-audiencia** generada a partir del
`.webmcp.css`: una página HTML autocontenida para personas, Markdown para el
repositorio, JSON para integraciones y `llms.txt` / `AGENTS.md` para agentes
de IA. Con `doc serve` la documentación se sirve en local y se recarga al
cambiar el contrato.

- Código: `src/doc/` (`generator.ts`, `server.ts`)
- CLI: `webmcpcss doc generate | serve`
- Ejemplo: [`examples/v1/output/doc/`](../examples/v1/output/doc/)

## Salidas

| Archivo      | Audiencia     | Contenido                                                                                                              |
| ------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `index.html` | Personas      | Buscador, filtros por confirmación/pago/permisos, pestañas de ejemplos (CLI, MCP, REST, prompt), sin recursos externos |
| `README.md`  | Repositorio   | Tabla de herramientas, detalle por tool con selector/disparador/fragilidad y ejemplos                                  |
| `doc.json`   | Integraciones | Modelo completo (`DocModel`) serializado                                                                               |
| `llms.txt`   | Agentes       | Resumen compacto en el formato [llms.txt](https://llmstxt.org): una línea por tool con parámetros, confirmación y pago |
| `AGENTS.md`  | Agentes       | Reglas de uso (confirmaciones, pagos, contexto) y ficha por herramienta                                                |

## El modelo (`buildDocModel`)

Para cada tool: `name`, `description`, `selector`, `params` (nombre, fuente,
selector), `trigger`, `confirmation`, `intent`, `permissions`, `payment`
(`required`, `network`, `amount`), `fragility` (nivel y framework detectado
por el analizador de Mapas de Contenido) y cuatro **ejemplos** listos para
copiar:

```bash
webmcpcss run https://tienda.test tienda.webmcp.css buscarProductos --param query=zapatillas
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": { "name": "buscarProductos", "arguments": { "query": "zapatillas" } }
}
```

Y `stats`: total de tools, contextos, parámetros, tools con confirmación y
selectores frágiles.

## CLI

```bash
webmcpcss doc generate --file tienda.webmcp.css --title "Tienda" --url https://tienda.test -o webmcp-docs
webmcpcss doc generate --file tienda.webmcp.css --format llms      # solo llms.txt a stdout
webmcpcss doc serve --file tienda.webmcp.css --port 3000            # http://localhost:3000 (recarga en cada petición)
```

Rutas del servidor: `/` (`index.html`), `/README.md`, `/doc.json`,
`/llms.txt`, `/AGENTS.md`. Si el CSS desaparece o no parsea responde `500`
con el motivo.

## Ejemplo de `llms.txt` generado

```
# Tienda de ejemplo

> Sitio con herramientas WebMCP declaradas en tienda.webmcp.css…

## Herramientas

- buscarProductos: Busca productos en el catálogo (params: query)
- pagarPedido: Paga el pedido del carrito [requiere confirmación]
- descargarInforme: Descarga el informe premium (de pago) [requiere confirmación] [pago: 0.05 USDC base]
```

## API

```ts
import { doc } from 'webmcpcss';

const model = doc.buildDocModel(toolMap, {
  title: 'Tienda',
  url,
  cssPath,
  fragility: true,
});
const files = doc.generateDocs(toolMap, { title: 'Tienda' }); // { 'index.html', 'README.md', 'doc.json', 'llms.txt', 'AGENTS.md' }
const html = doc.renderHtml(model);
const { server, url: local } = await doc.startDocServer({ cssPath, port: 3000 });
```
