# AGENTS.md — Tienda de ejemplo

Instrucciones para agentes de IA que operan este sitio mediante WebMCP.

## Reglas

1. Usa siempre las herramientas declaradas; no infieras selectores del DOM.
2. Las herramientas marcadas «requiere confirmación» necesitan aprobación humana antes de ejecutarse.
3. Las herramientas con pago declaran red e importe; respeta los límites de gasto configurados.
4. Lee el contexto antes de actuar (precios, totales, estados).

## Herramientas

### buscarProductos
Busca productos en el catálogo
- Parámetros: `query` (Valor del campo `#q`)
- Confirmación: none
- Permisos: read-only
### anadirAlCarrito
Añade el producto actual al carrito
- Parámetros: `cantidad` (Valor del campo `#qty`)
- Confirmación: .cart-count
- Permisos: restricted
### pagarPedido
Paga el pedido del carrito
- Parámetros: ninguno
- Confirmación: #order-ok
- Permisos: full
### descargarInforme
Descarga el informe premium de ventas (de pago)
- Parámetros: ninguno
- Confirmación: needed
- Permisos: full
- Pago: requerido 0.05 USDC base
### enviarConsulta
Envía una consulta al soporte
- Parámetros: `email` (Valor del campo `#c-email`); `mensaje` (Valor del campo `#c-msg`)
- Confirmación: none
- Permisos: restricted
## Contexto

- `precio` — Lee `.price` como currency
- `articulosCarrito` — Lee `.cart-count` como number
