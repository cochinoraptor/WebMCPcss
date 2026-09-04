# Ejemplo: modificar un sitio con lenguaje natural

Este ejemplo aplica varias órdenes en español sobre la tienda de
demostración [`../shopping-cart/`](../shopping-cart/) usando `webmcpcss prompt`
y la API de librería (`PromptManager`). Guía completa en
[`docs/PROMPT.md`](../../docs/PROMPT.md).

## Desde el CLI

```bash
# Dry-run: solo interpreta y localiza (no toca la página)
webmcpcss prompt "cambia el color del botón Añadir al carrito a verde" \
  --url examples/shopping-cart/index.html --css examples/shopping-cart/webmcp.css

# Ejecutar con captura
webmcpcss prompt "cambia el color del botón Añadir al carrito a verde" \
  --url examples/shopping-cart/index.html --css examples/shopping-cart/webmcp.css \
  --execute --screenshot despues.png

# Rellenar un campo localizado por su <label>
webmcpcss prompt "pon la cantidad en 3" --url examples/shopping-cart/index.html --execute

# Delegar en una herramienta del .webmcp.css (addToCart, con auto-reparación)
webmcpcss prompt "haz clic en Añadir al carrito" \
  --url examples/shopping-cart/index.html --css examples/shopping-cart/webmcp.css --execute --json

# Subir un archivo a un input[type=file]
webmcpcss prompt "sube esta imagen en la foto de perfil" \
  --url https://mi-sitio.com/perfil --image ./foto.png --execute
```

Salida del primer comando con `--execute`:

```
ℹ Acción: changeColor → botón Añadir al carrito [heuristic, confianza 0.80]
    color: green
ℹ Elemento: [data-product] .btn-add (vía tool, 0.50) · herramienta addToCart · "Añadir al carrito"
✔ background-color = green en 1 elemento(s) ([data-product] .btn-add)
ℹ Captura: despues.png
```

## Script de demostración (API de librería)

[`run-demo.js`](run-demo.js) encadena siete órdenes sobre la misma página y
guarda una captura por paso en `output/`:

```bash
npm run build
node examples/prompt/run-demo.js
# con LLM local:
WEBMCP_LLM_PROVIDER=ollama WEBMCP_OLLAMA_MODEL=llama3 node examples/prompt/run-demo.js
```

```
LLM: ninguno (intérprete heurístico)
✔ [01] "cambia el color del botón Añadir al carrito a verde" → changeColor ([data-product] .btn-add vía tool)
✔ [02] "pon la cantidad en 3" → fill (#qty-input vía text)
✔ [03] "escribe "DESCUENTO10" en el campo cupón" → fill (#coupon-code vía text)
✔ [04] "haz el título más grande" → setStyle (h1 vía probe)
✔ [05] "mueve el precio debajo del botón Añadir al carrito" → move ([class*="price" i] vía probe)
✔ [06] "oculta el header" → hide (header vía selector)
✔ [07] "haz clic en Añadir al carrito" → click ([data-product] .btn-add vía tool) Herramienta WebMCP "addToCart" ejecutada

7/7 órdenes aplicadas.
```

Cada paso muestra la **estrategia** con la que se localizó el elemento
(`selector`, `tool`, `llm`, `text`, `vision`, `probe`), útil para entender
por qué se eligió un nodo y ajustar la orden si hace falta.

## Como herramienta MCP

```bash
webmcpcss mcp --serve --css examples/shopping-cart/webmcp.css \
  --url examples/shopping-cart/index.html
```

El servidor publica `addToCart`, `applyCoupon` y `webmcpcss_prompt`; cualquier
cliente MCP (Claude Desktop, Cursor, Goose…) puede llamar a
`webmcpcss_prompt` con `{ "prompt": "oculta el header", "dryRun": true }`.
