---
type: tool
name: "search"
page: "tienda"
status: ok
selectors:
  - "[aria-label=\"Buscar productos\"]"
params: [query]
fragility: low
tags: [webmcp, tool, ok]
---
# 🔧 search

> Busca productos por texto

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/-aria-label=-Buscar productos-|[aria-label="Buscar productos"]]] |
| Página | [[paginas/tienda|tienda]] |
| Estado | [[estados/OK|OK]] ✅ |

## Parámetros

- **query** — fuente: `value`

## Fragilidad: 🟢 low

**Razones**

- Usa atributos aria-*: estables y ligados a la semántica del elemento
