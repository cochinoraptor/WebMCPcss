---
description: Modifica la página con lenguaje natural ("sube esta imagen al carrusel", "oculta el popup")
---

El usuario describe en lenguaje natural qué quiere cambiar en el sitio.

1. Interpreta primero en seco (sin tocar la página):
   `webmcpcss prompt "$ARGUMENTS" --url https://tienda.example.com --css examples/shopping-cart/webmcp.css --json`
2. Muestra al usuario la acción interpretada (tipo, selector elegido,
   herramienta WebMCP delegada si la hay) y pide confirmación.
3. Solo si confirma, ejecuta:
   `webmcpcss prompt "$ARGUMENTS" --url https://tienda.example.com --css examples/shopping-cart/webmcp.css --execute --screenshot /tmp/webmcp-prompt.png --json`
4. Resume el resultado y adjunta la captura si existe.

Si el usuario aporta imágenes o archivos, pásalos con `--image <ruta>` o
`--file <ruta>`. Nunca ejecutes acciones destructivas (pagos, borrados)
sin confirmación explícita.
