---
type: tool
name: "inviteUser"
page: "panel-next"
status: broken
selectors:
  - ".MuiButton-containedPrimary.Users_invite__9QwEr"
params: [email]
fragility: high
framework: "CSS Modules (Next.js)"
suggestions:
  - "El sufijo __hash de Next.js cambia por build: añade `data-tool` en el JSX o usa `[class^=\"styles_nombre__\"]` como último recurso"
  - "Las clases Mui*-slot son razonablemente estables, pero fija la versión de MUI o añade `data-testid` para desacoplarte"
  - "Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento"
tags: [webmcp, tool, broken, css-modules]
---
# 🔧 inviteUser

> Invita a un usuario por email

| Campo | Valor |
| --- | --- |
| Selector | [[selectores/.MuiButton-containedPrimary.Users_invite__9QwEr|.MuiButton-containedPrimary.Users_invite__9QwEr]] |
| Página | [[paginas/panel-next|panel-next]] |
| Estado | [[estados/Roto|Roto]] ❌ |

## Parámetros

- **email** — fuente: `value`, selector: `#:r1:`

## Fragilidad: 🔴 high

Frameworks detectados: CSS Modules (Next.js), MUI v5

**Razones**

- Clase de CSS Modules de Next.js (nombre_local__hash): el hash cambia al recompilar
- Clase de MUI (Mui*-slot): estable entre builds, pero acoplada a la versión de la librería

**Recomendaciones**

- El sufijo __hash de Next.js cambia por build: añade `data-tool` en el JSX o usa `[class^="styles_nombre__"]` como último recurso
- Las clases Mui*-slot son razonablemente estables, pero fija la versión de MUI o añade `data-testid` para desacoplarte
- Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento
