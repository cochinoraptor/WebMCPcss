---
type: tool
name: "planName"
page: "panel-next"
status: ok
selectors:
  - ".MuiChip-label"
params: []
fragility: low
framework: "MUI v5"
suggestions:
  - "Las clases Mui*-slot son razonablemente estables, pero fija la versión de MUI o añade `data-testid` para desacoplarte"
tags: [webmcp, tool, ok, mui-v5]
---
# 🔧 planName

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/.MuiChip-label|.MuiChip-label]] |
| Página | [[paginas/panel-next|panel-next]] |
| Estado | [[estados/OK|OK]] ✅ |

## Fragilidad: 🟢 low

Frameworks detectados: MUI v5

**Razones**

- Clase de MUI (Mui*-slot): estable entre builds, pero acoplada a la versión de la librería

**Recomendaciones**

- Las clases Mui*-slot son razonablemente estables, pero fija la versión de MUI o añade `data-testid` para desacoplarte
