---
type: tool
name: "subscribe"
page: "blog-vue"
status: ok
selectors:
  - ".el-input__inner[placeholder=\"Tu email\"]"
params: [email]
fragility: low
framework: "Element Plus"
suggestions:
  - "Las clases el-* son estables dentro de una versión mayor; añade `data-*` propio si planeas actualizar Element Plus"
tags: [webmcp, tool, ok, element-plus]
---
# 🔧 subscribe

> Suscribe el email al boletín

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/.el-input__inner-placeholder=-Tu email-|.el-input__inner[placeholder="Tu email"]]] |
| Página | [[paginas/blog-vue|blog-vue]] |
| Estado | [[estados/OK|OK]] ✅ |

## Parámetros

- **email** — fuente: `value`

## Fragilidad: 🟢 low

Frameworks detectados: Element Plus

**Razones**

- Clase de Element Plus (el-*): estable dentro de una versión mayor de la librería

**Recomendaciones**

- Las clases el-* son estables dentro de una versión mayor; añade `data-*` propio si planeas actualizar Element Plus
