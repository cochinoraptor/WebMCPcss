---
type: tool
name: "saveSettings"
page: "panel-next"
status: broken
selectors:
  - ".Dashboard_saveButton__3xK9z"
params: [siteName]
fragility: high
framework: "CSS Modules (Next.js)"
suggestions:
  - "El sufijo __hash de Next.js cambia por build: añade `data-tool` en el JSX o usa `[class^=\"styles_nombre__\"]` como último recurso"
  - "Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento"
tags: [webmcp, tool, broken, css-modules]
---
# 🔧 saveSettings

> Guarda la configuración del panel

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/.Dashboard_saveButton__3xK9z|.Dashboard_saveButton__3xK9z]] |
| Página | [[paginas/panel-next|panel-next]] |
| Estado | [[estados/Roto|Roto]] ❌ |

## Parámetros

- **siteName** — fuente: `value`, selector: `.Settings_name__1Ab2C input`

## Fragilidad: 🔴 high

Frameworks detectados: CSS Modules (Next.js)

**Razones**

- Clase de CSS Modules de Next.js (nombre_local__hash): el hash cambia al recompilar

**Recomendaciones**

- El sufijo __hash de Next.js cambia por build: añade `data-tool` en el JSX o usa `[class^="styles_nombre__"]` como último recurso
- Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento
