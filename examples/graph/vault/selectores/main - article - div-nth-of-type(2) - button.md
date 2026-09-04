---
type: selector
selector: "main > article > div:nth-of-type(2) > button"
fragility: high
suggestions:
  - "Sustituye :nth-child por un identificador del propio elemento (id, data-*, aria-label): el orden de los hermanos cambia con facilidad"
  - "Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento"
tags: [webmcp, selector, fragilidad-high]
---
# 🎯 `main > article > div:nth-of-type(2) > button`

Página: [[paginas/blog-vue|blog-vue]]

## Herramientas que lo usan

- [[herramientas/likeArticle|likeArticle]]

## Fragilidad: 🔴 high

**Razones**

- Usa :nth-child/:nth-of-type: depende del orden de los hermanos en el DOM
- Cadena de 4 niveles: cualquier cambio intermedio la rompe
- Selector solo de etiquetas (sin id, clase ni atributo): muy ambiguo

**Recomendaciones**

- Sustituye :nth-child por un identificador del propio elemento (id, data-*, aria-label): el orden de los hermanos cambia con facilidad
- Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento
