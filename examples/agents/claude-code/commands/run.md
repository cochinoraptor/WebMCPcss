---
description: Ejecuta una herramienta WebMCP en el sitio (addToCart, login...)
---

Ejecuta `webmcpcss run <url> examples/shopping-cart/webmcp.css <herramienta> --args '<json>'`
con Bash usando los argumentos del usuario ($ARGUMENTS) y devuelve el
resultado JSON.

Herramientas disponibles en examples/shopping-cart/webmcp.css:
- **addToCart** (productId, quantity): Añade el producto actual al carrito
- **applyCoupon** (code): Aplica un cupón de descuento
