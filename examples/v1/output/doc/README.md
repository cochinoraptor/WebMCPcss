# Tienda de ejemplo

> Generado por webmcpcss@1.0.0 · 5 herramientas · 2 datos de contexto · https://tienda.test

## Herramientas

| Herramienta | Descripción | Parámetros | Confirmación | Intención |
| --- | --- | --- | --- | --- |
| [`buscarProductos`](#buscarproductos) | Busca productos en el catálogo | `query` | none | action |
| [`anadirAlCarrito`](#anadiralcarrito) | Añade el producto actual al carrito | `cantidad` | .cart-count | action |
| [`pagarPedido`](#pagarpedido) | Paga el pedido del carrito | — | #order-ok | submit |
| [`descargarInforme`](#descargarinforme) | Descarga el informe premium de ventas (de pago) | — | needed | — |
| [`enviarConsulta`](#enviarconsulta) | Envía una consulta al soporte | `email`, `mensaje` | none | submit |

### buscarProductos

Busca productos en el catálogo

- **Selector:** `#search-btn`
- **Disparador:** `click`
- **Confirmación:** `none`
- **Permisos:** `read-only`
- **Fragilidad:** low

| Parámetro | Origen | Descripción |
| --- | --- | --- |
| `query` | value | Valor del campo `#q` |

```bash
webmcpcss run https://tienda.test examples/v1/tienda.webmcp.css buscarProductos --args '{"query":"<query>"}'
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "buscarProductos",
    "arguments": {
      "query": "<query>"
    }
  }
}
```

### anadirAlCarrito

Añade el producto actual al carrito

- **Selector:** `#add-to-cart`
- **Disparador:** `click`
- **Confirmación:** `.cart-count`
- **Permisos:** `restricted`
- **Fragilidad:** low

| Parámetro | Origen | Descripción |
| --- | --- | --- |
| `cantidad` | value | Valor del campo `#qty` |

```bash
webmcpcss run https://tienda.test examples/v1/tienda.webmcp.css anadirAlCarrito --args '{"cantidad":"<cantidad>"}'
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "anadirAlCarrito",
    "arguments": {
      "cantidad": "<cantidad>"
    }
  }
}
```

### pagarPedido

Paga el pedido del carrito

- **Selector:** `#checkout`
- **Disparador:** `click`
- **Confirmación:** `#order-ok`
- **Permisos:** `full`
- **Fragilidad:** low

```bash
webmcpcss run https://tienda.test examples/v1/tienda.webmcp.css pagarPedido
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "pagarPedido",
    "arguments": {}
  }
}
```

### descargarInforme

Descarga el informe premium de ventas (de pago)

- **Selector:** `#report`
- **Disparador:** `click`
- **Confirmación:** `needed`
- **Permisos:** `full`
- **Pago:** requerido · 0.05 USDC (base)
- **Fragilidad:** low

```bash
webmcpcss run https://tienda.test examples/v1/tienda.webmcp.css descargarInforme
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "descargarInforme",
    "arguments": {}
  }
}
```

### enviarConsulta

Envía una consulta al soporte

- **Selector:** `#contact-form button[type="submit"]`
- **Disparador:** `click`
- **Confirmación:** `none`
- **Permisos:** `restricted`
- **Fragilidad:** low

| Parámetro | Origen | Descripción |
| --- | --- | --- |
| `email` | value | Valor del campo `#c-email` |
| `mensaje` | value | Valor del campo `#c-msg` |

```bash
webmcpcss run https://tienda.test examples/v1/tienda.webmcp.css enviarConsulta --args '{"email":"<email>","mensaje":"<mensaje>"}'
```

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "enviarConsulta",
    "arguments": {
      "email": "<email>",
      "mensaje": "<mensaje>"
    }
  }
}
```

## Contexto (solo lectura)

| Dato | Selector | Formato |
| --- | --- | --- |
| `precio` | `.price` | currency |
| `articulosCarrito` | `.cart-count` | number |
