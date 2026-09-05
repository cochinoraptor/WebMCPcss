---
type: tool
name: "addToCart"
page: "tienda"
status: ok
selectors:
  - "[data-tool=\"add-to-cart\"]"
params: [productId, quantity]
fragility: low
tags: [webmcp, tool, ok]
---
# 🔧 addToCart

> Añade el producto actual al carrito

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/-data-tool=-add-to-cart-|[data-tool="add-to-cart"]]] |
| Página | [[paginas/tienda|tienda]] |
| Estado | [[estados/OK|OK]] ✅ |

## Parámetros

- **productId** — fuente: `attr`
- **quantity** — fuente: `value`, selector: `#qty-input`

## Fragilidad: 🟢 low

**Razones**

- Usa atributos data-*: el patrón más estable (contrato explícito con agentes)
