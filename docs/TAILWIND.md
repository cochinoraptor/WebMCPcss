# Integración con Tailwind CSS

WebMCPcss incluye un módulo completo (`src/tailwind/`) para que agentes de IA
inspeccionen y **editen en tiempo real** los estilos Tailwind de una página a
través de herramientas WebMCP.

## Sin dependencias nuevas (decisión de diseño)

El clasificador de clases se basa en **patrones propios** (regex que cubren
las utilidades core de Tailwind v3/v4) en lugar de depender del paquete
`tailwindcss`:

- Cero dependencias añadidas al proyecto.
- Funciona **dentro del navegador** (los patrones se serializan en los
  scripts generados) y offline.
- No necesita acceso al `tailwind.config` del sitio.

Soporta variantes (`md:`, `hover:`, `dark:`...), negativos (`-mt-2`) y
valores arbitrarios (`p-[13px]`, `bg-[#1da1f2]`). Las clases `text-*`,
`bg-*` y `border-*` se desambiguan entre `colors` y su otra categoría
comparando contra la paleta estándar de Tailwind.

**Categorías:** `layout`, `flexbox-grid`, `spacing`, `sizing`, `typography`,
`colors`, `backgrounds`, `borders`, `effects`, `transforms`, `transitions`,
`interactivity`, `other`.

## Inspector

```ts
import { inspectElement, inspectClassList, scanDocument } from 'webmcpcss';

const info = inspectElement(document.querySelector('.card'));
// {
//   selector: 'section.feature-card',
//   tag: 'section',
//   classes: {
//     spacing: ['p-6'],
//     colors: ['bg-white'],
//     borders: ['rounded-xl'],
//     effects: ['shadow-md'],
//   },
//   all: ['p-6', 'bg-white', 'rounded-xl', 'shadow-md'],
//   unknown: ['feature-card'],
// }

// Escanear toda la página:
const entries = scanDocument(document); // [{ selector, tag, id, classList, inspection }]
```

Los selectores generados son **estables**: `id` → `data-*` único → clase
propia del sitio → `tag:nth-of-type(n)`. Nunca se usan clases Tailwind como
selector (cambiarían justo al editarlas).

## Editor con undo/redo

```ts
import { TailwindEditor } from 'webmcpcss';

const editor = new TailwindEditor();
const card = document.querySelector('#card');

editor.addClass(card, 'shadow-lg'); // aplicado al DOM al instante
editor.replaceClass(card, 'p-4', 'p-8');
editor.toggleClass(card, 'hidden');
editor.removeClass(card, 'bg-white');

editor.undo(); // deshace removeClass
editor.redo(); // lo reaplica
editor.getChanges(); // log cronológico de operaciones
editor.exportDiffs(); // [{ selector, before: 'p-4 bg-white', after: 'p-8 shadow-lg' }]
```

`exportDiffs()` es la vía para llevar los cambios de una sesión en vivo de
vuelta al código fuente: devuelve el atributo `class` original y el actual
de cada elemento tocado.

## Generador de herramientas WebMCP

Escanea una página y genera una herramienta por elemento y categoría
(`editFeatureCardSpacing`, `editSiteHeaderColors`, ...), cada una con el
esquema `{ add, remove, replace }`:

```ts
import {
  scanDocument,
  generateTailwindTools,
  registerTailwindTools, // registro en vivo (navegador / jsdom)
  buildTailwindToolsScript, // script standalone para <script src>
} from 'webmcpcss';

const tools = generateTailwindTools(scanDocument(document));
registerTailwindTools(window, tools); // navigator.modelContext.registerTool()
```

Ejemplo de llamada por parte de un agente:

```js
await agent.execute('editFeatureCardColors', {
  replace: 'bg-white:bg-slate-900',
  add: 'text-white ring-2 ring-indigo-400',
});
```

## CLI

```bash
# Inspeccionar las clases de un elemento (salida coloreada por categoría)
webmcpcss tailwind inspect https://mi-sitio.com "#header"

# Generar herramientas para toda la página
webmcpcss tailwind generate https://mi-sitio.com -o my-tools
#   → my-tools.js           (script standalone con registerTool defensivo)
#   → my-tools.webmcp.css   (declaración documental con webmcp-categories)

# Exportar el HTML resultante (con las clases actuales del DOM)
webmcpcss tailwind export https://mi-sitio.com -s "#card" -o Card.jsx   # React
webmcpcss tailwind export https://mi-sitio.com -s "#card" -o Card.vue   # Vue SFC
webmcpcss tailwind export https://mi-sitio.com -s "#card" -o card.component.ts -f angular
webmcpcss tailwind export https://mi-sitio.com -o page.html             # HTML plano
```

Notas:

- `inspect`/`generate`/`export` aceptan URLs `http(s)://` o rutas locales.
- El framework de `export` se deduce de la extensión (`.jsx`/`.tsx` → React,
  `.vue` → Vue, `*.component.ts` → Angular) o se fuerza con `-f`.
- `export` captura el **DOM servido** (snapshot). Para exportar los cambios
  hechos durante una sesión de edición en vivo usa
  `TailwindEditor.exportDiffs()`.

## Exportación a frameworks

`src/tailwind/frameworks/` convierte HTML Tailwind en componentes:

- **React** — `class` → `className`, `for` → `htmlFor`, void elements
  autocerrados, envuelto en un componente funcional.
- **Vue** — SFC de Vue 3 con el fragmento en `<template>`.
- **Angular** — componente standalone con template inline y selector
  kebab-case.

```ts
import { formatForFramework } from 'webmcpcss';
formatForFramework('<div class="p-4">Hola</div>', 'react', 'Hello');
```

## Demo

`examples/tailwind-demo/` contiene una página completa (header, tarjeta,
botón CTA y formulario con Tailwind por CDN) que registra 4 herramientas de
edición vía `navigator.modelContext`, más un `webmcp.css` declarativo
descubrible con `webmcpcss discover`. Instrucciones de uso en 5 minutos en
su `README.md`.

## Compatibilidad del `webmcp.css` generado

`tailwind generate` emite un `*.webmcp.css` con propiedades adicionales como
`webmcp-categories`. El parser de WebMCPcss **ignora sin error** cualquier
propiedad `webmcp-*` desconocida, por lo que estos archivos siguen siendo
válidos para `validate`, `parse` y el resto del ecosistema.
