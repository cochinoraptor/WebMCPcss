# WebMCPcss Component Hub (v1.2.0)

Catálogo **IA-First** de componentes de interfaz que llevan su propio contrato
para agentes (`.webmcp.css`), adaptados a **Tailwind CSS**, **Bootstrap 5**,
**Material UI**, **shadcn/ui** y CSS puro (_core_). Se publica como sitio
estático en GitHub Pages y se consume desde la CLI, el servidor MCP o
directamente como JSON.

| Recurso                   | URL                                                                    |
| ------------------------- | ---------------------------------------------------------------------- |
| Sitio                     | <https://cochinoraptor.github.io/WebMCPcss/components/>                |
| Índice para agentes       | <https://cochinoraptor.github.io/WebMCPcss/api/components.json>        |
| JSON Schema del índice    | <https://cochinoraptor.github.io/WebMCPcss/api/schema/components.json> |
| Fuente de los componentes | [`components/`](../components/)                                        |
| Guías del sitio           | [`docs/hub/`](hub/) (primeros pasos, uso, contribuir)                  |

> Decisión de diseño: **cero dependencias nuevas**. El sitio se genera con un
> generador propio (`src/hub/site.ts`) en HTML + CSS + JavaScript vanilla; no hay
> Astro/React ni un segundo `package.json`. La URL pública es configurable con
> `WEBMCPCSS_HUB_URL` (o `--hub <url>` en la CLI) para hubs privados o _mirrors_.

## Contenido del catálogo

58 componentes en la primera versión (`components/`):

| Categoría     | Componentes                                                                                | Librerías                              |
| ------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| `buttons`     | Button Primary, Secondary, Outline, Icon                                                   | core, tailwind, bootstrap, mui, shadcn |
| `cards`       | Product Card, Profile Card                                                                 | core, tailwind, bootstrap, mui, shadcn |
| `forms`       | Login Form, Contact Form (API declarativa WebMCP)                                          | core, tailwind, bootstrap, mui, shadcn |
| `layout`      | Navbar, Hero                                                                               | core, tailwind, bootstrap, mui, shadcn |
| `animations`  | Fade In, Slide Up, Pulse, 2.5D Isometric                                                   | core                                   |
| `intelligent` | Checkout Form, Smart Product Card, Hero Section (parallax), Parallax Scene (Three.js 2.5D) | core                                   |

Cada componente es una carpeta con:

```
components/adapters/tailwind/button-primary/
├── component.json              # id, nombre, categoría, librería, versión, descripción,
│                               # tags, controls (editor), promptExamples, animateExamples, related, usage
├── button-primary.webmcp.css   # contrato: webmcp-tool, params, intent, confirmation, permissions…
├── button-primary.html         # marcado de ejemplo (data-tool, aria-*, toolname/tooldescription…)
└── preview.css                 # (opcional) solo para la previsualización del sitio
```

Los ids son `<library>-<slug>` (`tailwind-button-primary`, `core-checkout-form`).
Los selectores del contrato usan atributos estables (`data-tool`, `data-context`,
`data-component`, `data-form`), nunca clases de estilo.

## CLI `webmcpcss components`

```bash
webmcpcss components list [--category <cat>] [--library <lib>] [--search <texto>] [--json]
webmcpcss components show <id> [--json]
webmcpcss components import <id...> [--output <dir>] [--merge <archivo.css>] [--force] [--json]
webmcpcss components update [id...] [--dry-run] [--merge <archivo.css>] [--json]
webmcpcss components demo [--output <dir>] [--library <lib>] [--ids a,b,c] [--json]
webmcpcss components publish <css> --name "Nombre" --category <cat> [--library <lib>] [--html <f>]
                              [--description <t>] [--tags a,b] [--author <n>] [--component-version <v>]
                              [--token <t> | GITHUB_TOKEN] [--dry-run] [--json]
webmcpcss components build [--components <dir>] [--out <dir>] [--docs <dir>] [--base-url <url>] [--check]
```

Opciones comunes: `--hub <url>` (o `WEBMCPCSS_HUB_URL`) y `--offline` (solo el
catálogo empaquetado en npm). Si el hub remoto no responde, la CLI **cae
automáticamente al catálogo empaquetado**, así que `list`/`import` funcionan sin
conexión.

- **`import`** escribe `<output>/<id>/` (por defecto `webmcp-components/`) y
  registra id, versión y hash en `.webmcpcss/components.lock.json`. Con
  `--merge` añade el contrato a un CSS existente dentro de un bloque
  `/* @webmcpcss-component <id> v<versión> */ … /* @end webmcpcss-component <id> */`
  que se reemplaza al actualizar.
- **`update`** compara el hash del lock con el del índice; `--dry-run` solo
  informa (`up-to-date`, `outdated`, `missing-remote`).
- **`demo`** genera `index.html` + `webmcp.css` unificado + archivos por
  componente (+ runtime de animaciones si hay build), listo para
  `webmcpcss mcp --serve --css demo/webmcp.css --url http://localhost:PUERTO`.
- **`publish`** valida el CSS (`parseWebMCP` + `parseAnimations`), genera
  `component.json` (y un HTML mínimo si no se indica `--html`), hace fork,
  crea la rama `hub/<id>-…`, sube los tres archivos a
  `components/community/<id>/` y abre el PR. El token va **solo** en
  `GITHUB_TOKEN`/`--token`.
- **`build`** (mantenedores) regenera `site/components/**` y
  `site/api/components.json`; `--check` falla si están desactualizados (CI).

## Servidor MCP: descubrimiento e importación por agentes

```bash
webmcpcss mcp --serve --css webmcp.css --hub                  # stdio
webmcpcss mcp --serve --http -p 8090 --hub [--hub-output ./src/components] [--hub-offline]
```

Con `--hub` el servidor anuncia tres herramientas más (sin `--hub` la lista de
herramientas es idéntica a 1.1.x):

| Herramienta        | Argumentos                                   | Descripción                                                                        |
| ------------------ | -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `list_components`  | `category?`, `library?`, `search?`, `limit?` | Lista con filtros (id, nombre, herramientas, comando de import, URL de la página). |
| `get_component`    | `id`, `includeSource?`                       | Metadatos + herramientas + contexto + animaciones + HTML y CSS completos.          |
| `import_component` | `id`, `output?`, `merge?`, `force?`          | Escribe el componente en el proyecto y lo registra en el lock.                     |

Rutas REST equivalentes en modo `--http`: `GET /api/components?category&library&search&limit`
y `GET /api/components/:id[?source=0]`. `--hub` permite arrancar el servidor
**sin** `.webmcp.css` (solo descubrimiento/importación).

Programáticamente: `new McpCore({ toolMap, hub: { hubUrl, outputDir, readOnly } })`.

## Sitio estático

`npm run build:hub` (o `webmcpcss components build`) genera:

| Ruta                                   | Contenido                                                                                                                                                                                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `components/`                          | inicio: cifras, categorías, librerías, destacados, cómo funciona, "para agentes"                                                                                                                                                                                           |
| `components/catalog/`                  | catálogo con filtros por categoría/librería y búsqueda en vivo (estado en la URL: `?q=&category=&library=`)                                                                                                                                                                |
| `components/search/`                   | búsqueda (autofocus)                                                                                                                                                                                                                                                       |
| `components/favorites/`                | favoritos en `localStorage` + comando de import conjunto                                                                                                                                                                                                                   |
| `components/docs/…`                    | guías renderizadas desde `docs/hub/*.md` (conversor Markdown propio)                                                                                                                                                                                                       |
| `components/about/`                    | acerca de                                                                                                                                                                                                                                                                  |
| `components/<id>/`                     | detalle: preview en iframe (escritorio/tablet/móvil), **editor en vivo** (color, radio, tamaño, animación), pestañas de código con copiar, comando de import, tabla de herramientas/contexto/animaciones, ejemplos `prompt`/`animate`, mismo componente en otras librerías |
| `components/<id>/preview.html`         | página del iframe: carga la librería desde CDN (Tailwind Play CDN, Bootstrap 5.3, tokens shadcn, emulación MUI), el `.webmcp.css` y el runtime de animaciones si el componente declara alguna                                                                              |
| `components/assets/`                   | `hub.css`, `hub.js`, `preview.css`, `preview.js`, `index.js` (índice embebido), `webmcp-animation.js`                                                                                                                                                                      |
| `api/components.json`                  | índice público (ver esquema)                                                                                                                                                                                                                                               |
| `components/sitemap.xml`, `robots.txt` | SEO                                                                                                                                                                                                                                                                        |

Para agentes, cada página incluye `<meta name="webmcp-hub" content="true">`,
`<meta name="webmcp-hub-index" content="…/api/components.json">`,
`<link rel="alternate" type="application/json">` y JSON-LD (`WebSite` +
`SearchAction`, `ItemList`, `SoftwareSourceCode` por componente, `TechArticle`
en docs). Si el navegador soporta WebMCP, `hub.js` registra en
`document.modelContext` las herramientas `searchComponents`, `getComponent` y
`toggleFavorite`.

Accesibilidad: enlace "saltar al contenido", navegación por teclado en pestañas
(flechas), `aria-pressed` en filtros/favoritos, `aria-live` en resultados,
`prefers-reduced-motion`, contraste alto y diseño responsive (grid fluido, editor
apilado en < 900 px).

## Índice `api/components.json`

```json
{
  "name": "WebMCPcss Component Hub",
  "version": "1.2.0",
  "generatedAt": "2026-09-05T…",
  "baseUrl": "https://cochinoraptor.github.io/WebMCPcss",
  "categories": [{ "id": "buttons", "label": "Botones", "count": 20 }, …],
  "libraries": [{ "id": "tailwind", "label": "Tailwind CSS", "count": 10 }, …],
  "components": [
    {
      "id": "tailwind-button-primary",
      "name": "Button Primary",
      "category": "buttons",
      "library": "tailwind",
      "version": "1.0.0",
      "description": "…",
      "tags": ["button", "primary", "submit", "cta", "tailwind"],
      "tools": [{ "name": "clickButton", "selector": "[data-tool=\"clickButton\"]", "description": "…", "params": [], "intent": "submit", "confirmation": "none" }],
      "context": [],
      "animations": [],
      "hash": "…",
      "files": { "css": "components/tailwind-button-primary/button-primary.webmcp.css", "html": "…", "meta": "…", "page": "components/tailwind-button-primary/" },
      "importCommand": "npx webmcpcss components import tailwind-button-primary",
      "promptExamples": ["cambia el color del botón primario a verde"],
      "animateExamples": ["aplica una animación de pulsación al botón primario"]
    }
  ]
}
```

## API programática

```ts
import { hub } from 'webmcpcss';

const { components } = await hub.listComponents({ library: 'shadcn', category: 'cards' });
await hub.importComponent('shadcn-product-card', { output: './src/components', merge: './webmcp.css' });
await hub.updateComponents({ dryRun: true });
const site = hub.buildHubSite({ componentsDir: 'components', siteDir: 'site', docsDir: 'docs/hub' });
const prepared = hub.prepareComponent({ cssPath: 'mi.webmcp.css', name: 'Mi botón', category: 'buttons' });
```

Exportaciones principales: `loadHub`, `buildHubIndex`, `filterEntries`,
`buildHubSite`, `checkHubSite`, `fetchHubIndex`, `listComponents`,
`fetchComponent`, `importComponent`, `updateComponents`, `mergeIntoCss`,
`prepareComponent`, `publishComponent`, `buildDemoSite`, `callHubTool`,
`HUB_TOOL_SCHEMAS`, `HUB_CATEGORIES`, `HUB_LIBRARIES`.

## Estructura del código

- `src/hub/types.ts` — tipos y etiquetas (categorías, librerías, `ComponentMeta`, `HubIndex`, lock).
- `src/hub/loader.ts` — carga/validación de `components/`, índice, filtro, JSON Schema.
- `src/hub/site.ts` + `src/hub/assets.ts` — generador del sitio (páginas, preview, CSS/JS vanilla).
- `src/hub/markdown.ts` — conversor Markdown → HTML sin dependencias.
- `src/hub/client.ts` — índice remoto/empaquetado, import/update/merge, lock, `prepareComponent`.
- `src/hub/publish.ts` — fork + rama + commits + PR (mismo flujo que `webmcpcss publish`).
- `src/hub/demo.ts` — sitio de demostración.
- `src/hub/mcp-tools.ts` — herramientas MCP; `src/exporters/mcp-server.ts` las expone con la opción `hub`.
- `src/cli-components.ts` — subcomandos `components`.
- `scripts/build-hub.ts` — `npm run build:hub [-- --check]` (CI comprueba que el sitio esté al día).
- `tests/hub.test.ts`, `tests/cli-components.test.ts` — 27 tests (catálogo, índice, sitio, cliente contra un hub servido en local, MCP, publish simulado, CLI end-to-end).
