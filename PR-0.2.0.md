# Pull Request: v0.2.0 — Integración con el ecosistema WebMCP

> **Rama sugerida:** `feat/v0.2.0-webmcp-ecosystem` → `main`
>
> Para publicarlo:
>
> ```bash
> git checkout -b feat/v0.2.0-webmcp-ecosystem
> git add -A && git commit -m "feat: v0.2.0 — API imperativa, generador JS, auto-descubrimiento, CSS moderno, dashboard e IA"
> git push -u origin feat/v0.2.0-webmcp-ecosystem
> gh pr create --title "feat: v0.2.0 — Integración con el ecosistema WebMCP" --body-file docs/PR-0.2.0.md
> ```

## 🎯 Resumen

Esta PR posiciona a WebMCPcss como **el puente entre el estándar WebMCP
(la API imperativa `navigator.modelContext` que llega a Chrome) y el mundo
declarativo del CSS**. Implementa las mejoras 1–4 (prioritarias) y 5–6
(opcionales) de la propuesta de evolución.

## ✨ Cambios

### Mejora 1 — Soporte para la API imperativa de WebMCP ★★★☆☆

- Nuevo módulo `src/webmcp-api/` (shim de captura auto-contenido,
  `getRegisteredTools()`, invocación de herramientas).
- Nuevo `WebMCPApiAdapter` (implementa `PageAdapter` + nueva capacidad
  `ApiToolSource`; el shim se instala **antes** de navegar).
- `WebMCPcss.execute()` cae a las herramientas de la API cuando no están en
  el CSS (`result.via: 'css' | 'api'`); las del CSS tienen prioridad.
- `webmcpcss validate <url> <css> --api` incluye las herramientas API (⚡).

### Mejora 2 — Generador de código para la API imperativa ★★★☆☆

- `webmcpcss generate --api <css> [-o salida.js]`: emite un
  `registerTool()` por herramienta con `description`, `inputSchema`
  (JSON Schema derivado de los params `value()`) y un `execute()` funcional
  que reproduce la semántica del CSS (fill + click/submit + confirmación).
- El test suite **ejecuta el código generado** en jsdom y verifica que las
  herramientas registradas funcionan de verdad.

### Mejora 3 — Auto-descubrimiento ★★☆☆☆

- `src/proxy/discovery.ts`: `<meta name="webmcp">`, `<link rel="webmcp">` y
  `/.well-known/webmcp.json` (`{"stylesheet": "..."}`), con fetch inyectable.
- Nuevo comando `webmcpcss discover <url>` (sin navegador).
- `webmcpcss inject` intenta descubrimiento **antes** de `community-styles/`
  (`resolveWebMCPStyles()`).

### Mejora 4 — CSS anidado, variables y @import ★★☆☆☆

- Reglas anidadas multi-nivel con `&`.
- `var(--x, fallback)` con referencias encadenadas y límite anti-bucles.
- `@import` con guardia anti-ciclos (`parseWebMCPFile()`); todos los
  comandos del CLI lo resuelven.
- Bonus: alias `data(x)` → `attr(data-x)` y `aria(x)` → `attr(aria-x)`.

### Mejora 5 — Dashboard visual (opcional) ★★☆☆☆

- `webmcpcss dashboard --port 3000 --css archivo.css`: servidor `node:http`
  **sin dependencias nuevas** + UI (herramientas activas, historial,
  estadísticas de reparaciones; refresco cada 2 s).
- `validate`/`repair` registran eventos en `.webmcpcss/history.json`;
  endpoint `POST /api/events` para procesos externos.

### Mejora 6 — Sugerencias con IA (opcional) ★★★★☆

- `webmcpcss generate --ai`: mejora nombres/descripciones con cualquier
  endpoint OpenAI-compatible. 100% opcional (sin `WEBMCPCSS_AI_API_KEY` se
  omite con aviso). Ver `.env.example`. Parseo de respuesta tolerante y
  testeado sin red.

## 🧪 Verificación

- [x] `npm run build` sin errores (TS estricto)
- [x] `npm test` → **77/77 tests** (antes 26)
- [x] `npm run lint` y `npm run format:check` limpios
- [x] E2E con Chromium real:
  - `validate --api` sobre `examples/api-tools/` → 4/4 (2 CSS + 2 API ⚡)
  - `generate --api` → JS válido y funcional
  - `discover` sobre servidor local con meta tag → encontrado
  - Ejecución de herramienta API desde `WebMCPcss.execute()` → `via: 'api'`
  - Dashboard sirviendo `/` y `/api/state` con datos reales

## 📁 Archivos nuevos

```
src/webmcp-api/{index,api-client}.ts    src/generator/{index,js-generator,ai-suggester}.ts
src/adapters/webmcp-api-adapter.ts      src/proxy/discovery.ts
src/dashboard/server.ts                 src/dashboard/public/{index.html,style.css,app.js}
src/utils/history.ts                    examples/api-tools/{index.html,webmcp.css}
tests/{webmcp-api,js-generator,discovery,extras}.test.ts
.env.example                            CHANGELOG.md
```

## ⚠️ Breaking changes

Ninguno. Toda la API v0.1.0 se mantiene; los cambios son aditivos
(`ValidationEntry.kind` añade `'api'`, `ExecuteResult` añade `via`).
