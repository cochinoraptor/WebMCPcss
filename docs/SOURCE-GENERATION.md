# Generación desde código fuente (v0.6.0)

`webmcpcss generate <ruta> --from-source` analiza componentes **React
(JSX/TSX), Vue (SFC), Svelte y HTML** sin navegador ni build, y genera el
`.webmcp.css` directamente desde tu repositorio:

```bash
webmcpcss generate ./src/components --from-source -o webmcp.css
webmcpcss generate ./src/Checkout.tsx --from-source
```

## Qué detecta

- Tags interactivos: `<button>`, `<form>`, `<input>`, `<textarea>`,
  `<select>`, `<a>`, y cualquier elemento con handler
  (`onClick`/`onSubmit` en React, `@click`/`@submit` en Vue,
  `on:click`/`on:submit` en Svelte) o `role="button"`.
- Atributos **literales**: `id`, `data-*`, `name`, `aria-label`, `class`
  (`className` de React se normaliza a `class`).
- Texto estático del elemento (para nombres y fingerprints).
- En `.vue` solo se analiza el bloque `<template>`.

## Selectores y avisos

Prioridad de ancla estable: `data-*` → `id` → `name` → `aria-label` →
clases estáticas cortas. Los elementos **sin ancla estable** (por ejemplo
`className={styles.buy}` dinámico) no generan herramienta y producen un
aviso accionable:

```
⚠ Checkout.tsx: <button "Sin ancla"> sin ancla estable — añade id o data-tool
```

Este es el flujo recomendado para equipos: ejecutar `--from-source` en CI y
tratar los avisos como deuda de accesibilidad-para-agentes (añadir
`data-tool="..."` a los elementos accionables).

## Agrupación de parámetros

Los `input`/`textarea`/`select` de un archivo se convierten en
`webmcp-param-*: value(selector)` de las acciones del mismo componente
(heurística: comparten formulario). Los `<form>` generan
`webmcp-trigger: "submit"`.

## Límites deliberados

Es un análisis heurístico de markup, no un compilador:

- Ignora atributos con valores dinámicos (`{expr}`, `:prop`, spread
  `{...props}`) — solo confía en literales.
- No resuelve componentes anidados (`<MiBoton/>`) ni render props.
- Complementa (no sustituye) a `generate --auto`: la vía headless ve el DOM
  final; la vía fuente funciona sin desplegar y sirve como linter.

Para casos complejos, genera desde fuente, valida contra el sitio real
(`webmcpcss validate`) y deja que `repair` ajuste lo que difiera.
