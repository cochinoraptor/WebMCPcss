# Changelog

Todas las novedades relevantes de WebMCPcss. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versionado
[SemVer](https://semver.org/lang/es/).

## [Unreleased]

### Añadido

- **Implementación real de todo lo descrito en 0.1.0/0.2.0** (el
  repositorio era hasta ahora solo un documento de diseño, sin `src/`):
  - `src/parser/` — `parseWebMCP`/`parseWebMCPFile`/`stringifyWebMCP`
    (PostCSS): reglas anidadas con `&`, variables CSS con fallback y
    encadenadas, `@import` con guardia anti-ciclos, alias `data()`/`aria()`.
  - `src/core/` — clase `WebMCPcss` (`execute`/`getContext`), `vision.ts`
    (huella + inferencia de selectores estables), `repair.ts`
    (auto-reparación), `validate.ts`, `recorder.ts` (grabación para
    `generate`).
  - `src/adapters/` — `PageAdapter` (interfaz), `DomAdapter` (jsdom),
    `PuppeteerAdapter`.
  - `src/webmcp-api/` — shim de captura de `registerTool()`,
    `WebMCPApiAdapter`, `generateApiScript()`/`buildInputSchema()`.
  - `src/proxy/` — auto-descubrimiento (meta/link/.well-known), estilos
    comunitarios con cadena de subdominios e inyección
    (`window.__WEBMCP__` + `<style type="text/webmcp">`).
  - `src/cli.ts` — comandos `parse`, `validate`, `repair`, `generate`
    (grabación y `--api`), `discover`, `inject` y `dashboard`.
  - `src/dashboard/` — servidor HTTP sin dependencias con UI de
    herramientas/historial/estadísticas (`GET /api/state`,
    `POST /api/events`) e historial persistente en
    `.webmcpcss/history.json`.
  - **Inyección por URL desde el dashboard**: la UI incluye un formulario
    que resuelve el WebMCP del sitio (auto-descubrimiento →
    `community-styles/`) y lo inyecta en la página viva, mostrando el
    mapa resultante (`POST /api/inject`; directorio comunitario
    configurable con `--community-dir`).
- **Auto-reparación con familias por cobertura**: el selector inferido es
  el que más elementos de la herramienta cubre (la clase compartida gana
  al `aria-label` único por elemento); el empate entre familias distintas
  se marca ambiguo y exige `webmcp-confirmation` (lecciones del POC
  original, verificadas contra el DOM renderizado real de una carta de
  212 productos).
- **Suite de tests (55, Vitest + jsdom, sin navegador)**, incluyendo el
  puerto del POC como test de integración con fixture real
  (`tests/club-integration.test.ts`).
- Ejemplos `examples/shopping-cart/` y `examples/api-tools/`,
  `community-styles/` con estilo ilustrativo, script
  `scripts/validate-community.ts` y workflow de CI (`.github/workflows/ci.yml`,
  Node 18/20/22).

### Cambiado

- `jsdom` pasa a dependencia de runtime (el CLI la usa para validar
  HTML local sin navegador).

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
