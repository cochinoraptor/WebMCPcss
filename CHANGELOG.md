# Changelog

Todas las novedades relevantes de WebMCPcss. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versionado
[SemVer](https://semver.org/lang/es/).

## [0.4.0] - 2026-09-02

### Añadido

- **Mapas de Contenido** (`src/graph/`): grafo de conocimiento + exportación
  Obsidian + análisis de fragilidad. Sin dependencias nuevas (fs nativo,
  plantillas con template literals, Cytoscape.js por CDN). Documentación en
  `docs/GRAPH.md`.
  - **Builder** (`builder.ts`): `buildGraph(files, statusResults?)` — nodos
    `tool`/`selector`/`param`/`page`/`status`, aristas `uses`/`requires`/
    `belongs-to`/`has-status`/`shares-selector`, metadatos agregados
    (totales, statusCounts, fragilitySummary).
  - **Fragilidad** (`fragility.ts`): `analyzeFragility(selector)` con
    detección por patrones de Vue scoped, Svelte, Angular,
    styled-components, Emotion, CSS Modules, JSS/MUI v4, React useId,
    MUI v5, Ant Design, Bootstrap y Tailwind, más heurísticas estructurales
    (`:nth-child`, cadenas largas, selectores solo de etiqueta, ids
    autogenerados). Niveles low/medium/high con razones.
  - **Sugerencias** (`suggestions.ts`): recomendaciones de migración por
    framework (data-tool/data-testid, fingerprints para repair...).
  - **Obsidian** (`obsidian.ts`): `generateObsidianVault()` — carpetas
    `herramientas/`, `selectores/`, `paginas/`, `estados/` + `index.md`,
    frontmatter YAML, backlinks `[[...]]` desde las aristas y nombres de
    archivo sanitizados multiplataforma.
  - **Dashboard** (`dashboard.ts`): HTML autónomo con Cytoscape.js (CDN),
    colores por tipo/fragilidad, panel de metadatos, filtros, estadísticas y
    exportación JSON/PNG; `serveGraphDashboard()` lo sirve con
    `GET /api/graph`.
- **CLI `webmcpcss graph <paths...>`** con `--obsidian`, `--output`,
  `--dashboard`, `--port`, `--with-status`, `--status-file`,
  `--no-fragility` y `--framework`; procesa archivos y carpetas
  recursivamente. Sin destino explícito genera `webmcp-graph.html` estático.
- `validate --save-status [file]` guarda el `ValidationReport` en JSON;
  `validate --graph` y `repair --graph` (re)generan el grafo tras la
  operación (las herramientas reparadas quedan OK).
- **Demo** `examples/graph-demo/` (script que genera graph.json, vault
  Obsidian y HTML desde los ejemplos del repo).
- CI: smoke test del comando `graph` contra `examples/`.

### Tests

- `tests/graph.test.ts`: 30 tests nuevos (utils, fragilidad por framework,
  builder, vault Obsidian, HTML del dashboard e integración CLI real).
- `tests/club-integration.test.ts` + `tests/fixtures/`: 6 tests de
  integración contra el DOM renderizado real de una SPA Vue con clases
  scoped `data-v-*` (fixtures y escenarios aportados por **@ctangarife** en
  el PR #2, adaptados a esta base de código — ¡gracias!).
  Total: 138.

### Mejorado

- **Reparación con generalización a familia** (lección del PR #2 de
  @ctangarife): cuando el selector original apuntaba a una familia de
  elementos (clases, sin id), el selector reparado ahora generaliza
  (`.product-card .quick-add-button`, 10 botones) en lugar de anclarse a un
  atributo único por elemento (`aria-label`, 1 botón). Nuevo campo
  `familySelector` en `ElementSnapshot`.

## [0.3.0] - 2026-09-01

### Añadido

- **Integración con Tailwind CSS** (`src/tailwind/`), sin dependencias nuevas
  (clasificador de utilidades basado en patrones propios, apto para navegador
  y offline). Documentación completa en `docs/TAILWIND.md`.
  - **Inspector** (`inspector.ts`): `classifyClass`, `isTailwindClass`,
    `inspectClassList`, `inspectElement`, `scanDocument` — clasifica clases
    en 13 categorías (layout, flexbox-grid, spacing, sizing, typography,
    colors, backgrounds, borders, effects, transforms, transitions,
    interactivity, other), con soporte de variantes (`md:`, `hover:`),
    negativos y valores arbitrarios, y selectores estables
    (id → data-* → clase propia → nth-of-type).
  - **Editor** (`editor.ts` + `history.ts`): `TailwindEditor` con
    `addClass` / `removeClass` / `replaceClass` / `toggleClass`, aplicación
    inmediata en el DOM, historial undo/redo (`ChangeHistory`), log de
    cambios y `exportDiffs()` (before/after por elemento).
  - **Generador de herramientas** (`tool-generator.ts` + `tool-registry.ts`):
    `generateTailwindTools()` crea herramientas `edit<Id><Categoria>` con
    esquema `{ add, remove, replace }`; `registerTailwindTools()` las
    registra en vivo vía `navigator.modelContext.registerTool()`;
    `buildTailwindToolsScript()` emite un script standalone defensivo.
  - **Escaneo de páginas reales** (`browser-scan.ts`): `scanPage(page)` para
    Puppeteer.
  - **Frameworks** (`frameworks/`): exportación de HTML Tailwind a React
    (`class`→`className`), Vue (SFC) y Angular (componente standalone).
- **CLI `webmcpcss tailwind`** con tres subcomandos y salida coloreada por
  categoría:
  - `tailwind inspect <url> <selector>` — clases agrupadas por categoría.
  - `tailwind generate <url> -o base` — emite `base.js` + `base.webmcp.css`.
  - `tailwind export <url> -s sel -o out.(html|jsx|tsx|vue|component.ts)`.
- **Demo** `examples/tailwind-demo/` (header, card, botón CTA y formulario
  con Tailwind por CDN, 4 herramientas registradas vía
  `navigator.modelContext` + `webmcp.css` declarativo descubrible).

### Tests

- `tests/tailwind.test.ts`: 25 tests nuevos (inspector, editor, historial,
  generador, registro en jsdom con el shim, frameworks). Total: 102.

## [0.2.0] - 2026-09-01

### Añadido

- **Soporte para la API imperativa de WebMCP** (`navigator.modelContext`):
  - Nuevo módulo `src/webmcp-api/` con shim de captura de `registerTool()`,
    `getRegisteredTools()` e invocación de herramientas registradas.
  - Nuevo adaptador `WebMCPApiAdapter` (Puppeteer + API) que implementa
    `PageAdapter` y la nueva capacidad `ApiToolSource`.
  - `WebMCPcss.execute()` cae automáticamente a las herramientas de la API
    cuando no existen en el CSS (`result.via: 'css' | 'api'`).
  - `webmcpcss validate <url> <css> --api` incluye las herramientas
    registradas en el reporte (icono ⚡, kind `api`).
- **Generador de código para la API imperativa**:
  - `webmcpcss generate --api <archivo.webmcp.css> [-o salida.js]` convierte
    un `.webmcp.css` en un script con `registerTool()` por herramienta,
    incluyendo `inputSchema` (JSON Schema) y `execute()` funcional.
  - API programática: `generateApiScript()`, `buildInputSchema()`.
- **Auto-descubrimiento** (`src/proxy/discovery.ts`):
  - Detecta `<meta name="webmcp" content="...">`, `<link rel="webmcp">` y
    `/.well-known/webmcp.json` (`{"stylesheet": "..."}`).
  - Nuevo comando `webmcpcss discover <url>` (sin navegador).
  - `webmcpcss inject` ahora intenta el auto-descubrimiento **antes** del
    fallback a `community-styles/` (`resolveWebMCPStyles()`).
- **Parser: CSS moderno**:
  - Reglas anidadas con `&` y varios niveles (`.card { .btn { ... } }`).
  - Variables CSS: `var(--x)` con fallback y referencias encadenadas.
  - `@import "otro.css";` con guardia anti-ciclos (`parseWebMCPFile()`).
  - Alias `data(x)` → `attr(data-x)` y `aria(x)` → `attr(aria-x)`.
- **Dashboard web** (`webmcpcss dashboard --port 3000 --css archivo.css`):
  - Servidor HTTP sin dependencias (`node:http`) con UI en tiempo real:
    herramientas activas, historial de ejecuciones y estadísticas de
    reparaciones. Endpoints `GET /api/state` y `POST /api/events`.
  - `validate` y `repair` registran eventos en `.webmcpcss/history.json`.
- **Sugerencias con IA (opcional)**: `webmcpcss generate --ai` mejora nombres
  y descripciones usando cualquier endpoint OpenAI-compatible
  (`WEBMCPCSS_AI_API_KEY`, ver `.env.example`). Sin key, se omite con aviso.
- Nuevo ejemplo `examples/api-tools/` (API imperativa + CSS anidado +
  variables + meta tag de descubrimiento).

### Cambiado

- `ValidationEntry.kind` admite el nuevo valor `'api'`.
- `ExecuteResult` incluye `via: 'css' | 'api'`.
- `webmcpcss parse` y los comandos con CSS resuelven `@import`
  (usan `parseWebMCPFile`).
- El build copia los assets del dashboard a `dist/`.

### Tests

- De 26 a **77 tests**: API imperativa (12), generador JS (6),
  descubrimiento (14), parser anidado/variables/imports/alias (12),
  IA e historial (7), más los existentes.

## [0.1.0] - 2026-09-01

- Versión inicial: parser `.webmcp.css` → JSON, clase `WebMCPcss` con
  auto-reparación de selectores (visión), CLI (`generate`, `validate`,
  `repair`, `inject`, `parse`), proxy comunitario y ejemplo shopping-cart.
