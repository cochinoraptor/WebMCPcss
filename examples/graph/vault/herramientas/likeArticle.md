---
type: tool
name: "likeArticle"
page: "blog-vue"
status: ok
selectors:
  - "main > article > div:nth-of-type(2) > button"
params: []
fragility: high
suggestions:
  - "Sustituye :nth-child por un identificador del propio elemento (id, data-*, aria-label): el orden de los hermanos cambia con facilidad"
  - "Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento"
tags: [webmcp, tool, ok]
---
# 🔧 likeArticle

> Marca el artículo como favorito

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/main - article - div-nth-of-type(2) - button|main > article > div:nth-of-type(2) > button]] |
| Página | [[paginas/blog-vue|blog-vue]] |
| Estado | [[estados/OK|OK]] ✅ |

## Fragilidad: 🔴 high

**Razones**

- Usa :nth-child/:nth-of-type: depende del orden de los hermanos en el DOM
- Cadena de 4 niveles: cualquier cambio intermedio la rompe
- Selector solo de etiquetas (sin id, clase ni atributo): muy ambiguo

**Recomendaciones**

- Sustituye :nth-child por un identificador del propio elemento (id, data-*, aria-label): el orden de los hermanos cambia con facilidad
- Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento
