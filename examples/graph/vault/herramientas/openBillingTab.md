---
type: tool
name: "openBillingTab"
page: "panel-next"
status: ok
selectors:
  - ".MuiTabs-root .MuiTab-root:nth-child(3)"
params: []
fragility: medium
framework: "MUI v5"
suggestions:
  - "Las clases Mui*-slot son razonablemente estables, pero fija la versión de MUI o añade `data-testid` para desacoplarte"
  - "Sustituye :nth-child por un identificador del propio elemento (id, data-*, aria-label): el orden de los hermanos cambia con facilidad"
tags: [webmcp, tool, ok, mui-v5]
---
# 🔧 openBillingTab

> Abre la pestaña de facturación

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/.MuiTabs-root .MuiTab-root-nth-child(3)|.MuiTabs-root .MuiTab-root:nth-child(3)]] |
| Página | [[paginas/panel-next|panel-next]] |
| Estado | [[estados/OK|OK]] ✅ |

## Fragilidad: 🟡 medium

Frameworks detectados: MUI v5

**Razones**

- Clase de MUI (Mui*-slot): estable entre builds, pero acoplada a la versión de la librería
- Usa :nth-child/:nth-of-type: depende del orden de los hermanos en el DOM

**Recomendaciones**

- Las clases Mui*-slot son razonablemente estables, pero fija la versión de MUI o añade `data-testid` para desacoplarte
- Sustituye :nth-child por un identificador del propio elemento (id, data-*, aria-label): el orden de los hermanos cambia con facilidad
