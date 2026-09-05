# Changelog

Todas las novedades relevantes de WebMCPcss. Formato basado en
[Keep a Changelog](https://keepachangelog.com/es/1.1.0/); versionado
[SemVer](https://semver.org/lang/es/).

## [1.2.1] - 2026-09-05

Versión de mantenimiento: sitio web responsive, referencia completa de la CLI,
enlaces del hub corregidos, `puppeteer` 24 y documentación de seguridad.
Sin cambios de API.

### Añadido

- **`docs/CLI.md`**: referencia completa de los 29 comandos de la CLI con todas
  sus opciones, subcomandos, códigos de salida y variables de entorno; enlazada
  desde el README (es/en).
- **`.env.example`** documenta todas las variables que lee la CLI
  (`GITHUB_TOKEN`, `FIGMA_TOKEN`, `WEBMCP_JWT_SECRET`, `WEBMCP_WALLET_KEY`,
  `WEBMCPCSS_HUB_URL`/`_DIR`, `PUPPETEER_*`).
- Tests para `rewriteDocHref` y la cursiva con guiones bajos del conversor
  Markdown del hub.

### Cambiado

- **Sitio del Component Hub**: el conversor Markdown (`src/hub/markdown.ts`)
  reescribe los enlaces entre guías escritos para GitHub (`./uso.md#seccion`) a
  las rutas del sitio (`../uso/#seccion`) y acepta cursiva `_texto_` (la que
  produce Prettier) sin tocar identificadores `snake_case`.
- **Formato**: `npm run format` / `format:check` cubren también `scripts/`,
  los Markdown (raíz y `docs/`) y los workflows; Prettier no reformatea los
  bloques de código incrustados en Markdown (`embeddedLanguageFormatting: off`)
  para conservar los ejemplos `.webmcp.css` tal cual.
- **`SECURITY.md`**: tabla de versiones soportadas (1.2.x / 1.0.x), nota sobre el
  Component Hub y aviso conocido de `npm audit` (`extract-zip`, solo afecta a la
  descarga de Chrome; mitigación con `PUPPETEER_EXECUTABLE_PATH`).
- **Dependencias**: `puppeteer` 23 → **24.43** (última rama compatible con Node
  18; 25 exige Node ≥ 22.12). Verificado con Chrome real en `validate`,
  `standard check`, `a11y audit`, `animate --screenshot` y `validate-conflicts`.
- **Dependencias** (sin cambios de API): `commander` 12 → **13.1** (última versión
  CommonJS compatible con Node 18; 14 exige Node 20 y 15 es ESM-only), `eslint` 8 → 9
  (flat config `eslint.config.js` con `typescript-eslint` 8 y `@eslint/js`),
  `vitest` 2 → 3, `jsdom` 24 → 26, `typescript` → 5.9, `prettier` → 3.9,
  `eslint-config-prettier` → 10. Se mantienen `chalk` 4 (5/6 son ESM-only) y
  `@types/node` 20 para seguir soportando Node 18.
- CI/CD: `actions/setup-node` v7, `actions/configure-pages` v6,
  `actions/upload-pages-artifact` v5, `actions/deploy-pages` v5,
  `github/codeql-action` v4 (PRs de Dependabot #8–#12).

### Corregido

- **Sitio web responsive** (auditado con Chrome real en 320/375/414/768/1024/1440
  px: 11 páginas y los 58 previews de componentes, 0 desbordamientos):
  - Landing: menú hamburguesa accesible (`aria-expanded`, Esc, cierre al
    navegar) por debajo de 1100 px — antes la navegación desaparecía sin
    alternativa; rejillas con `minmax(min(320px, 100%), 1fr)` para pantallas de
    320 px; tabla de agentes con scroll horizontal en vez de recorte; botón de
    GitHub compacto y CTAs a ancho completo en móviles pequeños.
  - Component Hub: los bloques de código, comandos y tablas ya no ensanchan la
    página (`min-width: 0` en las rejillas, scroll interno); editor en vivo
    apilado bajo la previsualización; botones «Copiar» a ancho completo; los
    modos Tablet/Móvil de la previsualización no desbordan en pantallas
    estrechas; tipografías y márgenes ajustados para móvil.
  - Componentes: `core-checkout-form` 1.0.1 (inputs con `box-sizing`, fila de
    cupón apilable) y emulación MUI (toolbar apilable, `h3` fluido).
- Enlaces rotos en `docs/hub/getting-started.md` (sitio generado), `docs/PROMPT.md`
  y `docs/good-first-issues/` (ahora apuntan a `docs/CLI.md`).
- README (es): orden de los ejemplos 17 → 18 → 19; `docs/standard.md` y la
  landing (`site/index.html`: 29 comandos, 571 tests) actualizados.

## [1.2.0] - 2026-09-05

**WebMCPcss Component Hub**: catálogo visual e interactivo de componentes
IA-First (`.webmcp.css` + `component.json`) para Tailwind CSS, Bootstrap 5,
Material UI, shadcn/ui y CSS puro, publicado en GitHub Pages
(`/components/`, índice `/api/components.json`) y consumible desde la CLI, el
servidor MCP y la API. Sin dependencias nuevas (generador estático propio);
compatible con todo lo anterior.

### Añadido

- **Catálogo `components/`** — 58 componentes con metadatos completos
  (82 herramientas): botones (primario, secundario, outline, con icono),
  tarjetas (ProductCard, ProfileCard), formularios (LoginForm, ContactForm con
  la API declarativa `toolname`/`tooldescription`/`toolparamtitle`), layout
  (Navbar, Hero) en las cinco librerías; animaciones core (fade-in, slide-up,
  pulse, 2.5D isométrico) e inteligentes (checkout-form con
  `webmcp-permissions`, smart-product-card, hero-section con parallax,
  parallax-scene con Three.js). Cada `component.json` declara `controls`
  (editor en vivo), `promptExamples`, `animateExamples`, `related` y `usage`.
- **Módulo `hub`** (`src/hub/`, `import { hub } from 'webmcpcss'`):
  `loadHub`/`validateMeta`/`buildHubIndex`/`filterEntries`/`hubIndexSchema`,
  `buildHubSite`/`checkHubSite` (generador estático sin dependencias, con
  conversor Markdown propio), cliente `fetchHubIndex`/`listComponents`/
  `fetchComponent`/`importComponent`/`updateComponents`/`mergeIntoCss` (lock
  `.webmcpcss/components.lock.json`, marcadores `@webmcpcss-component`,
  _fallback_ al catálogo empaquetado cuando el hub remoto no responde),
  `prepareComponent`/`publishComponent` (fork + rama + PR), `buildDemoSite`,
  y las herramientas MCP `callHubTool`/`HUB_TOOL_SCHEMAS`.
- **Sitio estático** (`site/components/**`, `site/api/**`): inicio, catálogo
  con filtros por categoría/librería y búsqueda en vivo (estado en la URL),
  búsqueda, favoritos (`localStorage`), docs (primeros pasos, uso, contribuir),
  acerca de y una página por componente con preview en iframe
  (escritorio/tablet/móvil), **editor en vivo** (color, radio, tamaño,
  animación), código con botón copiar, comando de import, tabla de
  herramientas/contexto/animaciones, ejemplos `prompt`/`animate` y enlaces al
  mismo componente en otras librerías. Meta `webmcp-hub`, `link rel=alternate`
  JSON, JSON-LD (`WebSite`+`SearchAction`, `ItemList`, `SoftwareSourceCode`,
  `TechArticle`), sitemap y robots. Si el navegador soporta WebMCP, el propio
  sitio registra `searchComponents`/`getComponent`/`toggleFavorite` en
  `document.modelContext`. Accesible (skip link, teclado, `aria-live`,
  `prefers-reduced-motion`) y responsive.
- **Comando `webmcpcss components`** (`src/cli-components.ts`):
  `list [--category] [--library] [--search]`, `show <id>`,
  `import <id...> [--output] [--merge] [--force]`, `update [id...] [--dry-run]`,
  `demo [--output] [--library] [--ids]`,
  `publish <css> --name --category [--library] [--html] [--dry-run]` y
  `build [--check]`; todos con `--json`, `--hub <url>` / `WEBMCPCSS_HUB_URL`
  y `--offline`.
- **Servidor MCP**: opción `hub` en `McpCore` y flags
  `webmcpcss mcp --serve --hub [--hub-url] [--hub-output] [--hub-offline]`
  que añaden las herramientas `list_components`, `get_component` e
  `import_component` y las rutas `GET /api/components[/:id]` en modo HTTP; con
  `--hub` el servidor arranca aunque no exista el `.webmcp.css`.
- **Build y CI**: `npm run build:hub` (`scripts/build-hub.ts`) regenera el
  sitio; el job `component-hub` de CI comprueba (`--check`) que
  `site/components/` y `site/api/components.json` estén al día. La carpeta
  `components/` se incluye en el paquete npm para el modo sin conexión.
- **Docs**: `docs/hub.md`, `docs/hub/{getting-started,component-usage,contributing}.md`,
  README (es/en) y `examples/component-hub/`.
- **Tests**: `tests/hub.test.ts` y `tests/cli-components.test.ts` (27 tests:
  catálogo y validación, índice y esquema, Markdown, sitio, cliente contra un
  hub servido en local, lock/merge/update, demo, MCP HTTP, publicación con API
  de GitHub simulada y CLI end-to-end). Total: 569 tests.

### Corregido

- `webmcpcss mcp --no-prompt` / `--no-animate` no desactivaban los ejecutores
  (Commander expone las negaciones como `prompt: false` / `animate: false`).

## [1.1.0] - 2026-09-05

Alineación con el **estándar WebMCP** (borrador del W3C WebML Community Group,
origin trial en Chrome): ubicación canónica `document.modelContext`, soporte
completo de la **API declarativa** y endurecimiento de la cadena de publicación.
Sin dependencias nuevas; compatible con todos los `.webmcp.css` existentes.

### Añadido

- **Módulo `standard`** (`src/standard/`, `import { standard } from 'webmcpcss'`):
  - `getModelContext(win)`, `modelContextLocation(win)` (`'document' | 'navigator' | 'none'`),
    `defineModelContext(win, value)` y las constantes `MODEL_CONTEXT_CANONICAL`,
    `MODEL_CONTEXT_EXPR` (expresión ES5 `document.modelContext || navigator.modelContext`).
  - API declarativa: `extractDeclarativeTools(html)` / `extractDeclarativeToolsFromDocument(doc)`
    leen `toolname`, `tooldescription`, `toolautosubmit`, `toolparamtitle` y
    `toolparamdescription` (con las mismas reglas que el navegador: ambos
    atributos obligatorios, `toolparamtitle` → `name` → `id` → `<label>`;
    `required`; opciones de `<select>` como enum); `declarativeToolsToToolMap()`
    los convierte en un contrato; `toolMapToDeclarative()`,
    `applyDeclarativeToHtml()` y `buildDeclarativeRuntimeScript()` hacen el
    camino inverso (HTML anotado, parche JSON o script en tiempo de ejecución).
- **Comando `webmcpcss standard`** (`src/cli-standard.ts`):
  - `standard scan <html|url> [-o css] [--merge css] [--json]` — atributos declarativos → `.webmcp.css`.
  - `standard compile <css> [--html in] [-o out] [--script out.js] [--force] [--json]` — `.webmcp.css` → atributos declarativos.
  - `standard check <url> [--json]` — dónde expone la página `modelContext`
    (`document` / alias `navigator` / ninguna), herramientas imperativas
    registradas, formularios declarativos, avisos (uso del alias obsoleto) y
    veredicto `agentReady`.
- **Propiedad `webmcp-doc-<param>`**: descripción de un parámetro
  (⇄ `toolparamdescription`). `generate --api` la usa como `description` en el
  `inputSchema`; el round-trip HTML → CSS → JS no pierde documentación.
- `generate --auto` y `retro scan` detectan los formularios ya anotados con la
  API declarativa: conservan nombre, descripción y parámetros
  (`webmcp-source: "declarative"`) y desplazan a la herramienta que se habría
  inferido para ese formulario. `RetroScan.declarative` lista sus nombres.
- `README.en.md` (README principal en inglés) y `docs/standard.md`.
- `.github/dependabot.yml` (npm + GitHub Actions, semanal, agrupado) y
  `.github/workflows/codeql.yml` (CodeQL `javascript-typescript`,
  `security-and-quality`, en push/PR y semanal).

### Cambiado

- **`document.modelContext` en todo el código generado y ejecutado en el
  navegador** — `generate --api`, `export --format browser-inject`,
  `retro inject`/`retro proxy`, `tailwind generate` y la clase `WebMCPcss`
  (`via: 'api'`) — con fallback al alias obsoleto `navigator.modelContext`
  (deprecado en Chromium 150). El shim de `WebMCPApiAdapter` /
  `validate --api` / `mcp` detecta la API nativa en cualquiera de las dos
  ubicaciones, la espeja en ambas y, si no existe, publica el polyfill en las
  dos, ahora con `registerTool`, `unregisterTool`, `provideContext`,
  `clearContext`, `getTools` y `executeTool`.
- `npm-publish.yml`: publicación por **trusted publishing (OIDC)** con
  `--provenance`, sin `NPM_TOKEN`; job previo que ejecuta lint/build/tests,
  comprueba que la versión coincide con el tag de la release e **instala el
  tarball en limpio** para verificar exports y CLI antes de publicar (la
  lección de la 1.0.0). Se dispara con `release: published` o manualmente.
- README: sección «Integración con el estándar WebMCP» reescrita, comando
  nº 18 `standard`, 46 agentes; sitio web actualizado a 1.1.0.

### Notas de migración

- No hace falta cambiar ningún `.webmcp.css`.
- Regenera los scripts con `webmcpcss generate --api` (o `export --format browser-inject`)
  para eliminar el aviso de obsolescencia de Chrome; los antiguos siguen
  funcionando mientras exista el alias.
- Para que `npm-publish.yml` funcione hay que configurar una vez el _trusted
  publisher_ en npmjs.com (paquete → Settings → Trusted publisher → GitHub
  Actions: `cochinoraptor/WebMCPcss`, workflow `npm-publish.yml`) y opcionalmente
  el _environment_ `npm` en GitHub con revisores.

## [1.0.1] - 2026-09-05

### Corregido

- `import { design } from 'webmcpcss'` funciona como documentan el README y
  `docs/design-to-webmcp.md`: `design` es un alias del namespace
  `designToWebmcp` (que se mantiene).

## [1.0.0] - 2026-09-05

Las **diez ideas innovadoras**: diez módulos independientes que convierten
WebMCPcss en una plataforma completa para sitios nativos de IA. Sin
dependencias nuevas (Node nativo `http`/`zlib`/`crypto`/`fetch`, Puppeteer ya
presente; `ethers` como peer opcional cargado dinámicamente; Figma y LLM por
`fetch` + variables de entorno). 116 tests nuevos (515 en total), cobertura

> 80 % en cada módulo. Guías en `docs/` y salidas reales en `examples/v1/`.

### Añadido

- **IA-First Framework** (`src/framework/`): componentes `IAButton`, `IAForm`,
  `IACard`, `IANav`, `IAHero`, `IAGrid` con `webmcp-component`,
  `webmcp-intent: submit|cancel|navigate|action|read`,
  `webmcp-confirmation: needed|none` (la post-condición pasa a
  `webmcp-confirmation-selector`) y `webmcp-accessibility`; `renderComponent`,
  `validateIaFirst`, `initProject`, `assist` (heurístico o LLM). CLI
  `webmcpcss init [--framework ia-first|minimal]` y `webmcpcss assist "<petición>"`.
- **Design-to-WebMCP** (`src/design-to-webmcp/`): `analyzeImage` (LLM con
  visión), `analyzeFigma` (REST API), `analyzeDescription` (heurística ES/EN);
  `generateFromDesign` (contrato + andamiaje + mapping), `validateDesign`
  (`ok|missing|moved|relabeled`, puntuación), `optimizeToolMap`
  (nombres, descripciones, selectores, confirmaciones, formatos,
  `iaFriendlyScore`). CLI `design analyze|validate|optimize`.
- **Retro-WebMCP** (`src/retro/`): `scanLegacyHtml` (13 señales legacy,
  `legacyScore`, selectores estables con prioridad id > data > name > title >
  href, fingerprints, notas), `enhanceRetroWithLlm`; proxy de compatibilidad
  (`createRetroProxy`: descompresión gzip/deflate/br, inyección de
  `<link rel="webmcp">`/`<meta>`/script, reescritura de URLs absolutas y
  protocolo-relativas y de `Location`, rutas `/.webmcp/webmcp.css`,
  `/.webmcp/graph.json`, `/.well-known/webmcp.json`); inyector
  (`buildRetroInjectScript` → `window.__WEBMCP_GRAPH__` y
  `window.__WEBMCP_RETRO__`, `injectRetro` con Puppeteer); publicación
  comunitaria (`prepareRetroSubmission`, `publishRetro`). CLI
  `retro scan|proxy|inject|publish`.
- **A11y-MCP** (`src/a11y/`): 16 reglas WCAG 2.2 AA evaluadas en la página,
  `summarizeAudit` (puntuación, por impacto y regla), `passesThresholds`,
  correcciones declarativas (`buildA11yToolMap`/`buildA11yCss` con
  `webmcp-accessibility`, `webmcp-a11y-rule`, `webmcp-a11y-impact`),
  `buildA11yFixScript`, `buildA11yWorkflow`. CLI `a11y audit|fix` (`--min-score`,
  `--fail-on`, `--ci`).
- **Test-MCP** (`src/testing/`): `buildTestPlan` (existencia, parámetros,
  confirmación, formato y ejecución segura), `generateTests` (Playwright TS /
  Cypress JS), `runTestPlan` con `puppeteerProbe`, `toJUnit`,
  `buildTestWorkflow`. CLI `test generate|run`.
- **Version-MCP** (`src/versioning/`): `createSnapshot` (hash por tool,
  presencia y huella con página), `diffSnapshots` (renombres, selectores,
  parámetros, permisos, contexto; impacto SemVer y `suggestedVersion`),
  `buildMigration`/`applyMigration` con notas para agentes, `verifySnapshot`.
  CLI `version snapshot|diff|migrate`.
- **Doc-MCP** (`src/doc/`): `buildDocModel` (parámetros, pagos, permisos,
  fragilidad, ejemplos CLI/MCP/REST/prompt), `renderHtml` (autocontenido, con
  buscador, filtros y pestañas), `renderMarkdown`, `renderLlmsTxt`,
  `renderAgentsMd`, `generateDocs`; servidor con recarga
  (`createDocServer`/`startDocServer`). CLI `doc generate|serve`.
- **Security-MCP** (`src/security/`): `webmcp-permissions:
read-only|restricted|full`, `webmcp-requires: none|auth|oauth|jwt|session`,
  `webmcp-scope`, `webmcp-risk`, `webmcp-rate-limit`; `inferPermissionLevel`,
  `policyFor`, `authorizeTool`, `filterToolMapForAgent`, `validateSecurity`
  (hallazgos `invalid-permissions`, `underdeclared`, `payment-without-auth`,
  `full-without-confirmation`, `write-without-auth`,
  `selector-inline-handler`…), `suggestPolicies` (overlay parseable), JWT HS256
  sin dependencias (`createAgentToken`/`verifyJwt`), `agentFromHeaders`. CLI
  `security validate [--agent --suggest --suggest-output --strict]` y
  `security token`.
- **Recommender-MCP** (`src/recommender/`): `recommend(goal, map)` con
  sinónimos ES/EN por raíz compartida, extracción de parámetros, puntuación
  por nombre/descripción/parámetros, ajuste por historial por host,
  penalización de acciones sensibles no solicitadas, login primero;
  `refineWithLlm`, `recordOutcome`. Historial: eventos `recommend` y `payment`
  y buckets `recommendations`/`payments` en `computeStats`. CLI `recommend`.
- **Web3-MCP** (`src/web3/`): `webmcp-payment: required|optional|none`,
  `webmcp-network` (nombre o chainId, sin restricción), `webmcp-amount`,
  `webmcp-pay-to`, `webmcp-payment-protocol: x402|onchain`; `NETWORKS` (8
  redes con USDC), `AgentWallet` con límites `perTx`/`perSession`/`perDay`/
  receptores/redes; micropagos **x402** (`buildX402Requirements`,
  `signX402Authorization` EIP-3009, `createPaymentGate`,
  `createLocalFacilitator`, `X402Client`); `buildWalletConnectorScript`
  (MetaMask/WalletConnect, `eth_signTypedData_v4`, `eth_sendTransaction`);
  `getBalance`/`sendPayment`/`deployContract` con `ethers` opcional
  (`setEthersModule` para pruebas); contrato de referencia
  `WebMCPPayments.sol`; `validatePayments`. CLI `web3 validate|balance|pay|deploy`.
- **CLI** (`src/cli-v1.ts`): todos los comandos anteriores; con `--json` solo
  el JSON va a stdout.
- **API**: `src/index.ts` exporta los namespaces `framework`, `design`,
  `retro`, `a11y`, `testing`, `versioning`, `doc`, `security`, `recommender`,
  `web3`.
- **Parser**: las propiedades `webmcp-*` no reconocidas se conservan en
  `meta`; `webmcp-confirmation: needed|none` va a `meta.confirmation` y el
  selector de post-condición a `webmcp-confirmation-selector`.
- **LLM**: `LlmRequest.images` para modelos con visión.
- Documentación: `docs/ia-first-framework.md`, `design-to-webmcp.md`,
  `retro-webmcp.md`, `a11y.md`, `testing.md`, `versioning.md`,
  `doc-generation.md`, `security.md`, `recommender.md`, `web3.md`. Ejemplos:
  `examples/v1/` (contrato de tienda, `regen.sh` y la salida de los diez
  módulos).
- CI: smoke test de los comandos v1.0.0 sin navegador y comprobación de que
  `examples/v1/` está al día.

### Cambiado

- `webmcp-confirmation` admite ahora `needed|none` además de un selector
  (compatibilidad total: los selectores siguen funcionando como antes).

### Notas

- «NanoCrawl» de la especificación se implementa como perfil **x402/USDC**
  (HTTP 402 + autorización USDC firmada sin gas para el agente); ver
  `docs/web3.md`.

## [0.9.0] - 2026-09-04

Cierra los huecos pendientes de las especificaciones de Mapas de Contenido,
integración con agentes y conflictos de animación. Sin dependencias nuevas.

### Añadido

- **Fragilidad con framework** (`src/graph/fragility.ts`): cada selector
  devuelve además `framework` (y `frameworks`) con patrones nuevos para
  CSS Modules de Next.js (`nombre_local__hash`) y Vite/Astro (`_local_hash`),
  scoping de Astro, Element Plus (`.el-*`), ids de React `useId` y
  selectores de solo etiqueta; `summarizeFrameworks()` y
  `metadata.frameworkSummary` en el grafo. La CLI imprime
  «Frameworks detectados».
- **Vault Obsidian** (`src/graph/obsidian.ts`): frontmatter ampliado
  (`framework`, `suggestions`, tags por framework y estado), tabla de
  frameworks en `index.md` y rutas relativas al proyecto (vault portable).
- **Dashboard** (`src/graph/dashboard.ts`): filtros por estado, fragilidad,
  página y **framework**, panel de estadísticas con frameworks detectados,
  exportación **PNG/SVG/JSON**, `buildGraphSvg()` y ruta `/api/graph.svg`.
  Nueva opción `graph --svg <archivo>` (SVG estático sin navegador) y flags
  explícitos `--fragility` / `--no-fragility`.
- **Plugin de Claude Code** completo: `.mcp.json`, comandos
  `/webmcpcss:prompt` y `/webmcpcss:animate`, skill `webmcp-audit`
  (auditoría de fragilidad) y manifiesto con la versión del paquete.
- **Cursor**: snippets `webmcp:` (bloques de herramienta con candidatos de
  selector estable por cada herramienta declarada), regla
  `.cursor/rules/webmcpcss.mdc`, `stableSelectorCandidates()` y
  `export --format cursor --register` que fusiona el servidor en
  `~/.cursor/mcp.json`.
- **DeerFlow** (`export --format deerflow`): herramientas Python del grupo
  `browser` (`browser_get_webmcp_graph`, `browser_validate_selector`,
  `browser_repair_selector`, `browser_prompt`, `browser_animate`) que
  devuelven mensajes estructurados, fragmento `deerflow-tools.yaml`,
  `extensions_config.json` con servidor MCP y routing, skill
  `webmcp-browser` y README.
- **Flomny** (`export --format flomny` y `mcp --serve --flomny`): servidor
  MCP dedicado `FlomnyMcpCore` con `list_tools`, `get_tool_info`,
  `get_selector_status`, `suggest_repair`, `execute_prompt` y
  `apply_animation` (stdio y HTTP), `flomny-mcp.json` y
  `workflow.example.json`. `McpCore` es ahora extensible
  (`serverInfo()`, `extraTools()`, `callExtraTool()`).
- **`webmcpcss validate-conflicts <archivo> --url <url>`**: simulación en
  seco de conflictos con las animaciones del sitio (GSAP, Framer Motion,
  Anime.js, CSS/WAAPI), informe JSON (`-o`, `--json`), `--strict` para CI,
  `--conflict-strategy`, `--type` y `--sandbox`.
- **`animate --sandbox`**: aísla todas las animaciones en un shadow root.
- `src/version.ts` (`VERSION`) compartido por CLI, servidores MCP y
  exportadores.
- Documentación: `docs/conflict-resolution.md`, `docs/agents/deerflow.md`,
  `docs/agents/flomny.md`; actualizados `docs/GRAPH.md`, `docs/AGENTS.md`,
  `docs/agents/claude-code.md`, `docs/agents/cursor.md`, `docs/PROMPT.md`,
  `docs/animation.md`, `docs/cli-animate.md` y README.
- Ejemplos: `examples/graph/` (tres sitios con distintos frameworks,
  `graph.json`, `graph.svg` y vault Obsidian versionados, `regen.sh`),
  `examples/agents/deerflow/` y `examples/agents/flomny/`; ejemplos de
  Claude Code y Cursor regenerados.
- Tests: `tests/graph-v090.test.ts`, `tests/exporters-editors.test.ts`,
  `tests/exporters-agents.test.ts` (396 pruebas en total; cobertura de
  `src/graph` y `src/exporters` > 98 %).
- CI: exportación de los 10 formatos, smoke del servidor Flomny,
  `validate-conflicts` con navegador y comprobación de que
  `examples/graph/` está al día.

### Cambiado

- `EXPORT_FORMATS` pasa de 8 a 10 formatos (`deerflow`, `flomny`).
- `graph` guarda rutas relativas al directorio de trabajo en los metadatos
  de página (antes absolutas).
- `docs/AGENTS.md`: Flomny usa el formato `flomny`; se añade DeerFlow
  (46 entradas).

## [0.8.0] - 2026-09-04

### Añadido

- **Estándar de animaciones declarativas** (`webmcpcss animate`): nuevo
  módulo `src/animation/` que parsea propiedades `webmcp-animation-*`
  (tipos `parallax`, `isometric`, `3d-transform`, `keyframes` y
  `three-scene`; prioridades `low`/`normal`/`high`/`critical`; atajos de
  duración, easing, rotaciones, capas y escena; `fallback` por referencia o
  JSON inline; anidamiento, `var()` e `@import`).
- **Motores** con interfaz común (`supports`/`execute`/`cleanup`): CSS
  (`@keyframes` y clases inyectadas, parallax por scroll), WAAPI
  (`Element.animate`, `composite: add`, `ScrollTimeline`) y Three.js
  (escena 2.5D en el contenedor, opcionalmente en Shadow DOM; requiere
  WebGL; Three.js se toma de `window.THREE` o de `moduleUrl`, sin
  dependencia nueva).
- **Orquestador** con colas por prioridad, selección automática de motor
  según capacidades del navegador, `prefers-reduced-motion`, fallbacks y
  registro de animaciones activas (`active`/`stop`/`stopAll`).
- **Resolutor de conflictos** por elemento y propiedad con estrategias
  `replace`, `queue`, `ignore` y `merge`; detección automática de
  animaciones externas (`@keyframes` y transiciones del sitio, WAAPI ajenas,
  GSAP, Anime.js, Framer Motion, Velocity, Lottie, AOS, ScrollMagic…) y
  `registerExternal()`/`releaseExternal()` para animaciones JS propias.
- **Validadores**: existencia de selectores y capas, compatibilidad de
  motor (WebGL, WAAPI), simulación de conflictos con informe (`--dry-run`).
- **CLI** `webmcpcss animate <archivo> --url … [--type css|waapi|three]
[--conflict-strategy replace|queue|ignore|merge] [--dry-run] [-o]
[--screenshot] [--json]`; sin `--url` genera un runtime autocontenido
  (`webmcpcss-animation.js` + `animations.json` + `index.html`).
- **Herramienta MCP `webmcpcss_animate`** (`animationFile | css`, `url`,
  `strategy`, `engine`, `dryRun`, `screenshot`) en `mcp --serve`, ruta
  `POST /api/animate` en modo HTTP y opción `--no-animate`.
- Historial: nuevo tipo de evento `animate`.
- Documentación (`docs/animation.md`, `docs/animation-conflicts.md`,
  `docs/cli-animate.md`), demo `examples/animation/index.html` y ejemplos
  `parallax`, `isometric`, `3d-transform` y `three-scene`.

### Decisiones

- Cero dependencias nuevas: el runtime del navegador se genera concatenando
  los módulos compilados del propio paquete; Three.js se carga solo si una
  animación `three-scene` lo necesita.
- Las animaciones externas se registran con prioridad `high`: una animación
  `normal` nunca las pisa; `critical` (o `high` + `replace`) las sustituye.

## [0.7.0] - 2026-09-03

### Añadido

- **Modificación de sitios con lenguaje natural** (`webmcpcss prompt`):
  nuevo módulo `src/prompt/` que interpreta órdenes en español/inglés
  (`upload`, `changeColor`, `delete`, `move`, `click`, `fill`, `hide`,
  `setText`, `setStyle`, `other`), localiza el elemento de forma progresiva
  (selector → herramienta WebMCPcss → LLM → texto/`<label>`/placeholder →
  visión → sondas → sugerencias) y ejecuta la acción sobre el DOM o
  delegando en la herramienta del `.webmcp.css` correspondiente.
  Dry-run por defecto; `--execute` aplica; `--screenshot`, `-o` y `--json`
  para evidencia. Guía en `docs/PROMPT.md`, ejemplo en `examples/prompt/`.
- **Cliente LLM opcional** (`ollama`, `openai`, `anthropic`) configurado
  exclusivamente por variables de entorno (`WEBMCP_LLM_PROVIDER`,
  `WEBMCP_OLLAMA_MODEL`, `WEBMCP_OPENAI_API_KEY`,
  `WEBMCP_ANTHROPIC_API_KEY`, `WEBMCP_LLM_TIMEOUT_MS`…), con intérprete
  heurístico incorporado como respaldo. Sin dependencias nuevas (`fetch`
  nativo).
- **Herramienta MCP `webmcpcss_prompt`** en `mcp --serve` (stdio y HTTP,
  `POST /api/prompt`; desactivable con `--no-prompt`).
- `AssetManager`: archivos locales, URLs `http(s)` y `data:` URIs con
  detección MIME propia, límite de 25 MB y limpieza de temporales.
- Interfaz `DomMutator` (`setStyles`, `setText`, `remove`, `hide`, `move`,
  `uploadFiles`, `screenshot`) implementada por `PuppeteerAdapter` y
  `DomAdapter`.
- Historial: entradas de tipo `prompt` con estadísticas propias.
- 67 tests nuevos (271 en total).

### Cambiado

- `dom-utils`: los candidatos interactivos incluyen `<label>` y `<form>`
  (mejora la localización de campos por etiqueta).

## [0.6.1] - 2026-09-02

### Añadido

- **Community styles reales, verificados en vivo** (2026-09-02):
  `wikipedia.org` (portal), `en.wikipedia.org` (artículos),
  `news.ycombinator.com` y `mercadolibre.com.co` — selectores comprobados
  contra el HTML real de cada sitio; los dos primeros y HN se validan
  automáticamente en CI con Puppeteer (`@validate-url`).
- **Índice comunitario `community-styles/index.json`**: descubrimiento en
  una sola petición HTTP (dominio → herramientas → archivo raw).
  Builder en `src/community/index-builder.ts`, script
  `npm run build:community-index` y check de frescura en CI.
- README de community-styles renovado: tabla de estilos, consumo por
  agentes vía raw.githubusercontent y flujo de contribución con
  `webmcpcss publish`.
- Gobernanza del repositorio: `CODE_OF_CONDUCT.md` (Contributor
  Covenant 2.1), `SECURITY.md` (política de reportes y consideraciones de
  uso) y plantilla de Pull Request con checklist para estilos comunitarios.
- `package.json`: campos `homepage` y `bugs` (mejora la página en npm).
- 7 tests nuevos (204 en total).

## [0.6.0] - 2026-09-02

### Añadido

- **Generación desde código fuente** (`generate <ruta> --from-source`):
  analiza componentes React (JSX/TSX), Vue (SFC), Svelte y HTML sin
  navegador ni build (`src/generator/source-scanner.ts`). Extrae elementos
  interactivos (tags + handlers `onClick`/`@click`/`on:click`), respeta solo
  atributos literales, agrupa inputs como parámetros por componente y emite
  avisos accionables para elementos sin ancla estable ("añade id o
  data-tool"). Guía en `docs/SOURCE-GENERATION.md`.
- **Publicación comunitaria con PR automático**
  (`publish <css> --domain <dominio> [--token|GITHUB_TOKEN]`,
  `src/community/publish.ts`): valida el archivo, hace fork (idempotente),
  crea rama, sube `community-styles/<dominio>.webmcp.css` y abre el Pull
  Request al upstream — todo con la API REST de GitHub y fetch nativo. Sin
  token, imprime los pasos manuales.
- **Difusión**: badges de npm (versión y descargas) en el README y
  borradores de anuncio para X/Reddit/Hacker News en `docs/ANNOUNCEMENT.md`.
- `toCamelName` exportado desde el generador (reutilizado por ambos
  escáneres).
- 17 tests nuevos: parser de atributos JSX/Vue/Svelte, selectores estables
  desde fuente, integración fs con carpeta temporal, y flujo completo de
  publish contra una API de GitHub simulada (http nativo).

### Decisiones

- Sin parser AST (babel/vue-compiler): heurísticas de markup con límites
  documentados — cubre atributos literales, ignora dinámicos con aviso.
  Cero dependencias nuevas también en esta versión.

## [0.5.0] - 2026-09-02

### Añadido

- **Generación automática sin grabación** (`generate --auto`): escaneo
  headless de la página (`src/generator/scanner.ts`, auto-contenido para
  `page.evaluate` y jsdom) que detecta formularios, campos, botones y
  enlaces de acción; el analyzer (`src/generator/analyzer.ts`) infiere
  nombres de herramienta (`login`, `search`, `subscribe`...), convierte los
  campos en `webmcp-param-*: value(selector)` y elige selectores estables
  (`data-*` → `id` → `name`/`aria-label` → clases estables →
  `:nth-of-type`). Incluye detección de framework: React, Next, Vue,
  Svelte, Angular, MUI, AntD, Bootstrap y Tailwind.
- **Servidor MCP** (`webmcpcss mcp --serve`), sin dependencias nuevas:
  - Modo **stdio** (JSON-RPC 2.0 por líneas): `initialize`, `tools/list`,
    `tools/call`, `resources/list`, `resources/read` (`webmcp://source` y
    `webmcp://graph`). Compatible con Claude Desktop/Code, Cursor, Goose,
    Windsurf y cualquier cliente MCP.
  - Modo **HTTP REST** (`--http -p 8090`, módulo `http` nativo):
    `GET /api/tools`, `GET /api/graph`, `POST /api/call`.
  - Con `--url`, `tools/call` ejecuta de verdad con Puppeteer
    (`WebMCPcss.execute`); sin `--url`, responde dry-run.
- **Exportadores multi-agente** (`src/exporters/`, comando
  `webmcpcss export <css> --format <fmt> -o <dir> [--url]`): `mcp-config`
  (snippet `mcpServers`), `claude-code` (plugin con comandos slash),
  `cursor` (mcp.json + guía), `crewai` (módulo Python `@tool`), `autogen`
  (JSON Schema + `register_with_autogen`), `langgraph` (`@tool` de
  langchain_core + grafo JSON), `browser-inject` (IIFE con
  `window.__WEBMCP_GRAPH__` y registro opcional en
  `navigator.modelContext`) y `json-schema` (function calling genérico).
- **Comando `run`**: `webmcpcss run <url> <css> <tool> --args '{json}'` —
  ejecuta una herramienta y escribe solo JSON en stdout (es lo que invocan
  los módulos Python generados).
- **Documentación de agentes**: `docs/AGENTS.md` (tabla de 45 agentes →
  formato) y 10 guías en `docs/agents/` (Claude Code, Cursor, clientes MCP,
  CrewAI, AutoGen, LangGraph, agentes de navegador, JSON Schema, REST,
  Obsidian).
- **Ejemplos generados por agente** en `examples/agents/` (8 formatos desde
  `examples/shopping-cart/webmcp.css`) + `scripts/regen-agent-examples.sh`.
- **Tests nuevos** (42): scanner/analyzer con jsdom, todos los formatos de
  exportación, núcleo MCP, transporte stdio con streams en memoria y API
  HTTP real en puerto efímero.
- **CI**: smoke test de los 8 exportadores y del handshake MCP stdio sobre
  `dist/`.

### Arreglado

- `serializeToolMap` generaba CSS inválido cuando el selector del trigger
  contenía pseudo-clases (`form:nth-of-type(2)`): ahora se cita
  (`webmcp-trigger: "submit" on "form:nth-of-type(2)"`) y
  `parseTriggerValue` des-cita el selector.

### Decisiones

- Cero dependencias nuevas de producción: `http`/`readline` nativos en vez
  de express, sin fs-extra/handlebars; jsdom sigue siendo solo devDependency
  (el scanner es auto-contenido).
- Roadmap (no incluido en 0.5.0): generación desde código fuente
  React/Vue/Svelte y `publish` con PR automático al repositorio comunitario.

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
