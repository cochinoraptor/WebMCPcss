---
type: tool
name: "shareArticle"
page: "blog-vue"
status: broken
selectors:
  - ".sc-bdVaJa.sc-htpNat"
params: [network]
fragility: high
framework: "styled-components"
suggestions:
  - "Las clases sc-* cambian en cada build: pasa una prop `data-tool` al styled component y selecciona por ella"
  - "Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento"
tags: [webmcp, tool, broken, styled-components]
---
# 🔧 shareArticle

> Comparte el artículo (widget styled-components)

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/.sc-bdVaJa.sc-htpNat|.sc-bdVaJa.sc-htpNat]] |
| Página | [[paginas/blog-vue|blog-vue]] |
| Estado | [[estados/Roto|Roto]] ❌ |

## Parámetros

- **network** — fuente: `attr`

## Fragilidad: 🔴 high

Frameworks detectados: styled-components

**Razones**

- Clase de styled-components (sc-*): hash inestable entre builds

**Recomendaciones**

- Las clases sc-* cambian en cada build: pasa una prop `data-tool` al styled component y selecciona por ella
- Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento
