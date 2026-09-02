# API REST (Manus, Devin, OpenHands, n8n, Dify, agentes propios)

Para agentes que solo saben hablar HTTP, WebMCPcss sirve una API REST sin
dependencias (módulo `http` de Node):

```bash
webmcpcss mcp --serve --http -p 8090 --css tienda.webmcp.css --url https://tienda.com
```

## Endpoints

### `GET /api/tools`

```json
{ "tools": [ { "name": "addToCart", "description": "...", "inputSchema": { ... } } ] }
```

### `GET /api/graph`

Grafo completo: herramientas (con selector) + datos de contexto.

### `POST /api/call`

```bash
curl -X POST http://localhost:8090/api/call \
  -H 'Content-Type: application/json' \
  -d '{"tool":"addToCart","args":{"quantity":"2"}}'
```

Respuesta (formato MCP `content`):

```json
{ "content": [{ "type": "text", "text": "{\"success\":true,...}" }] }
```

- Con `--url`, cada llamada abre un navegador headless, ejecuta la
  herramienta sobre el sitio real y devuelve el resultado.
- Sin `--url`, responde en dry-run (selector + args) — útil para depurar.
- CORS abierto (`Access-Control-Allow-Origin: *`), pensado para uso local o
  detrás de tu propia autenticación.

## Ejemplo n8n / Dify

Nodo HTTP Request → `POST http://localhost:8090/api/call` con el JSON de la
herramienta elegida; la lista para el LLM se obtiene de `GET /api/tools`.
