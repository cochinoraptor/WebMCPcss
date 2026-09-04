---
name: webmcp-browser
description: Opera sitios web mediante sus herramientas WebMCP declaradas en examples/shopping-cart/webmcp.css (addToCart, applyCoupon). Úsala cuando la tarea implique interactuar con https://tienda.example.com: añadir al carrito, rellenar formularios, validar/reparar selectores, modificar la página por prompt o aplicar animaciones.
license: MIT
allowed-tools:
  - browser_get_webmcp_graph
  - browser_validate_selector
  - browser_repair_selector
  - browser_prompt
  - browser_animate
  - bash
---

# WebMCP browser skill (webmcpcss v0.9.0)

## Flujo recomendado

1. **Descubre**: llama a `browser_get_webmcp_graph` (con `live=true` si
   necesitas saber qué selectores siguen vivos). Reenvía el mensaje
   `{"type": "webmcp_graph"}` a los sub-agentes que vayan a operar la página.
2. **Actúa**: ejecuta la herramienta del sitio a través del servidor MCP
   (`webmcpcss_<herramienta>`) o con bash:
   `webmcpcss run https://tienda.example.com examples/shopping-cart/webmcp.css <herramienta> --args '{...}'`.
3. **Si algo falla**: `browser_validate_selector` para diagnosticar y
   `browser_repair_selector` (primero sin `apply`) para proponer un arreglo.
4. **Cambios libres**: `browser_prompt` interpreta órdenes en lenguaje
   natural; pide confirmación antes de `execute=true`.
5. **Animaciones**: `browser_animate` con `dry_run=true` muestra plan y
   conflictos con GSAP/Framer/CSS del sitio; aplica solo tras revisarlos.

## Reglas

- Nunca inventes selectores: usa los del grafo o los devueltos por repair.
- Acciones destructivas (pagar, borrar, enviar) requieren confirmación humana.
- Comparte el grafo como mensaje estructurado en vez de re-escanear la página.

## Herramientas del sitio

- `addToCart` — Añade el producto actual al carrito
- `applyCoupon` — Aplica un cupón de descuento
