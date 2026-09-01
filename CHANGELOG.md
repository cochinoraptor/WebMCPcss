# Changelog

Todas las novedades relevantes de WebMCPcss. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versionado
[SemVer](https://semver.org/lang/es/).

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
