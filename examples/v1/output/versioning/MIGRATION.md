# Migración WebMCP 1.0.0 → 2.0.0

Impacto: **major** · versión sugerida: **2.0.0**

- [rename-tool] Llama a "buscarCatalogo" en lugar de "buscarProductos".
- [drop-tool] La tool "descargarInforme" ya no existe; busca una alternativa en el nuevo contrato.
- [update-selector] Selector de "pagarPedido": #checkout → #checkout-now.
- [add-param] Nuevo parámetro "categoria" en "buscarProductos→buscarCatalogo" (opcional salvo que la descripción diga lo contrario).

> ⚠️ Cambios incompatibles: los agentes con contratos cacheados deben volver a leer el `.webmcp.css` o `/.well-known/webmcp.json`.
