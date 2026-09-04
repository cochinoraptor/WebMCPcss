---
type: tool
name: "postComment"
page: "blog-vue"
status: broken
selectors:
  - ".comment-form[data-v-7ba5bd90] .el-button--primary"
params: [body]
fragility: high
framework: "Vue (scoped)"
suggestions:
  - "Añade un atributo estable en el componente (`<button data-tool=\"add-to-cart\">`) y selecciona `[data-tool=\"add-to-cart\"]` en lugar del atributo data-v-*"
  - "Las clases el-* son estables dentro de una versión mayor; añade `data-*` propio si planeas actualizar Element Plus"
  - "Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento"
tags: [webmcp, tool, broken, vue]
---
# 🔧 postComment

> Publica un comentario en el artículo

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/.comment-form-data-v-7ba5bd90- .el-button-primary|.comment-form[data-v-7ba5bd90] .el-button--primary]] |
| Página | [[paginas/blog-vue|blog-vue]] |
| Estado | [[estados/Roto|Roto]] ❌ |

## Parámetros

- **body** — fuente: `value`, selector: `textarea[data-v-7ba5bd90]`

## Fragilidad: 🔴 high

Frameworks detectados: Vue (scoped), Element Plus

**Razones**

- Atributo de scoping de Vue (data-v-*): cambia al recompilar el componente
- Clase de Element Plus (el-*): estable dentro de una versión mayor de la librería

**Recomendaciones**

- Añade un atributo estable en el componente (`<button data-tool="add-to-cart">`) y selecciona `[data-tool="add-to-cart"]` en lugar del atributo data-v-*
- Las clases el-* son estables dentro de una versión mayor; añade `data-*` propio si planeas actualizar Element Plus
- Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento
