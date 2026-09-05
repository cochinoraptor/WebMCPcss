# 🛡️ WebMCPcss

> Haz que **cualquier sitio web** sea nativo para agentes de IA — sin tocar su código fuente — y con **auto-reparación** de selectores cuando el sitio se rediseña.

🌐 **Sitio web:** [cochinoraptor.github.io/WebMCPcss](https://cochinoraptor.github.io/WebMCPcss/) · 🇬🇧 **English:** [README.en.md](README.en.md)

[![CI](https://github.com/cochinoraptor/WebMCPcss/actions/workflows/ci.yml/badge.svg)](https://github.com/cochinoraptor/WebMCPcss/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/webmcpcss.svg)](https://www.npmjs.com/package/webmcpcss)
[![npm downloads](https://img.shields.io/npm/dm/webmcpcss.svg)](https://www.npmjs.com/package/webmcpcss)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## ¿Qué es WebMCPcss?

WebMCPcss extiende el estándar **WebMCP** con una idea simple: describir las
herramientas que un agente de IA puede usar en una web mediante un archivo
**`.webmcp.css`** — CSS estándar con propiedades personalizadas `webmcp-*`:

```css
/* webmcp.css */
[data-product] .btn-add {
  webmcp-tool: 'addToCart';
  webmcp-param-productid: attr(data-product-id);
  webmcp-param-quantity: value(#qty-input);
  webmcp-confirmation: '.cart-badge';
}

.product-price {
  webmcp-context: 'price';
  webmcp-format: 'currency';
}
```

WebMCPcss lo convierte en un **tool map** JSON que cualquier agente entiende:

```json
{
  "tools": {
    "addToCart": {
      "selector": "[data-product] .btn-add",
      "params": {
        "productId": { "source": "attr", "value": "data-product-id" },
        "quantity": { "source": "value", "selector": "#qty-input" }
      }
    }
  },
  "context": {
    "price": { "selector": ".product-price", "format": "currency" }
  }
}
```

### 🩹 Auto-reparación

Los sitios se rediseñan y los selectores se rompen. Cuando eso pasa, WebMCPcss:

1. Detecta que el selector ya no existe.
2. Activa el modo **visión**: busca el elemento por huella (atributos `data-*`,
   texto visible, etiqueta, posición aproximada) entre los candidatos de la página.
3. Infiere un **selector estable nuevo** (prioridad: `data-*` → `id` → `name`/
   `aria-label` → clases estables).
4. Actualiza el tool map en memoria y **reintenta** la acción.

## Instalación

```bash
# Global (CLI)
npm install -g webmcpcss

# O como dependencia de tu proyecto
npm install webmcpcss
```

Desde el repositorio:

```bash
git clone https://github.com/cochinoraptor/WebMCPcss.git
cd WebMCPcss
npm install
npm run build
npm link   # opcional: habilita el comando global `webmcpcss`
```

## Uso del CLI

```bash
# 1) Grabar interacciones en un navegador y generar un .webmcp.css
webmcpcss generate https://mi-tienda.com -o webmcp.css
webmcpcss generate https://mi-tienda.com --ai        # + nombres/descripciones con IA

# 2) Validar que los selectores existan en la página
webmcpcss validate https://mi-tienda.com webmcp.css
webmcpcss validate https://mi-tienda.com webmcp.css --api   # + herramientas de document.modelContext

# 3) Reparar automáticamente los selectores rotos (reescribe el archivo)
webmcpcss repair https://mi-tienda.com webmcp.css

# 4) Convertir el CSS en código JS de la API imperativa de WebMCP
webmcpcss generate --api webmcp.css -o webmcp-tools.js

# 5) ¿El sitio publica WebMCP? (meta tag o .well-known, sin navegador)
webmcpcss discover https://mi-tienda.com

# 6) Dashboard web con herramientas, historial y estadísticas
webmcpcss dashboard --port 3000 --css webmcp.css

# 7) Tailwind CSS: inspeccionar, generar herramientas de edición y exportar
webmcpcss tailwind inspect https://mi-sitio.com "#header"
webmcpcss tailwind generate https://mi-sitio.com -o my-tools   # → my-tools.js + my-tools.webmcp.css
webmcpcss tailwind export https://mi-sitio.com -s "#card" -o Card.jsx

# 8) Mapas de Contenido: grafo de conocimiento, Obsidian y fragilidad
webmcpcss graph examples/ --obsidian ./vault --output graph.json --fragility
webmcpcss graph examples/ --dashboard                          # Cytoscape en :3100 (filtros + export PNG/SVG/JSON)
webmcpcss graph examples/ --svg graph.svg                      # v0.9.0: SVG estático sin navegador
webmcpcss validate https://mi-tienda.com webmcp.css --save-status --graph

# 9) v0.5.0 — Generación automática SIN grabación (escaneo headless)
webmcpcss generate https://mi-tienda.com --auto -o webmcp.css

# 9b) v0.6.0 — Generación desde código fuente (React/Vue/Svelte, sin navegador)
webmcpcss generate ./src/components --from-source -o webmcp.css

# 10) v0.5.0 — Exportar para cualquier agente IA
webmcpcss export webmcp.css --format claude-code -o ./claude-plugin --url https://mi-tienda.com
webmcpcss export webmcp.css --format crewai -o ./crew --url https://mi-tienda.com
webmcpcss export webmcp.css --format cursor --register          # v0.9.0: escribe ~/.cursor/mcp.json
webmcpcss export webmcp.css --format deerflow -o ./deerflow     # v0.9.0: tools browser_* + skill
webmcpcss export webmcp.css --format flomny -o ./flomny         # v0.9.0: servidor MCP dedicado
# formatos: mcp-config, claude-code, cursor, deerflow, flomny, crewai, autogen,
#           langgraph, browser-inject, json-schema

# 11) v0.5.0 — Servidor MCP (stdio) o API REST
webmcpcss mcp --serve --css webmcp.css --url https://mi-tienda.com
webmcpcss mcp --serve --http -p 8090 --css webmcp.css --url https://mi-tienda.com
webmcpcss mcp --serve --flomny --css webmcp.css --url https://mi-tienda.com   # v0.9.0: list_tools, get_selector_status…

# 12) v0.5.0 — Ejecutar una herramienta y obtener JSON (para wrappers)
webmcpcss run https://mi-tienda.com webmcp.css addToCart --args '{"quantity":"2"}'

# 13) v0.6.0 — Publicar al repositorio comunitario (fork + PR automáticos)
webmcpcss publish webmcp.css --domain mi-tienda.com --token ghp_xxx   # o GITHUB_TOKEN

# 14) v0.7.0 — Modificar el sitio con lenguaje natural (dry-run sin --execute)
webmcpcss prompt "cambia el color del botón Añadir al carrito a verde" --url https://mi-tienda.com --css webmcp.css
webmcpcss prompt "sube esta imagen al carrusel" --url https://mi-sitio.com --image ./foto.png --execute
webmcpcss prompt "oculta el popup de cookies" --url https://mi-sitio.com --execute --screenshot despues.png

# 15) v0.8.0 — Animaciones declarativas (parallax, isométrico, 3D, keyframes, Three.js)
webmcpcss animate animations.webmcp.css --url https://mi-sitio.com --dry-run          # plan + conflictos
webmcpcss animate animations.webmcp.css --url https://mi-sitio.com --screenshot hero.png
webmcpcss animate animations.webmcp.css -o ./public/webmcp-animation                  # runtime para el sitio
webmcpcss animate animations.webmcp.css --url https://mi-sitio.com --sandbox          # v0.9.0: aislado en shadow root

# 16) v0.9.0 — Validar conflictos con GSAP/Framer/CSS del sitio sin ejecutar nada (CI)
webmcpcss validate-conflicts animations.webmcp.css --url https://mi-sitio.com --strict -o informe.json

# 18) v1.1.0 — Estándar WebMCP: API declarativa (toolname/tooldescription) ⇄ .webmcp.css y document.modelContext
webmcpcss standard scan https://mi-tienda.com -o webmcp.css                            # lee <form toolname …> y genera el contrato
webmcpcss standard compile webmcp.css --html index.html -o index.webmcp.html           # añade toolname/tooldescription/toolparamtitle al HTML
webmcpcss standard compile webmcp.css --script webmcp-declarative.js                   # o los aplica en tiempo de ejecución
webmcpcss standard check https://mi-tienda.com                                         # ¿document.modelContext? ¿qué tools expone la página?

# 17) v1.0.0 — Las diez ideas: framework IA-First, diseño, legacy, a11y, tests, versiones, docs, seguridad, recomendador, Web3
webmcpcss init mi-tienda --framework ia-first                                          # proyecto con componentes WebMCP
webmcpcss assist "crea un formulario de contacto con nombre, email y mensaje" -o ./contacto
webmcpcss design analyze --image mockup.png --llm openai -o design.webmcp.css --scaffold scaffold.html
webmcpcss design validate --design design.json --css design.webmcp.css --url https://mi-tienda.com
webmcpcss design optimize webmcp.css -o webmcp.optimizado.css
webmcpcss retro scan https://tienda-antigua.example -o legacy.webmcp.css                # sitios legacy sin tocar código
webmcpcss retro proxy https://tienda-antigua.example --css legacy.webmcp.css --port 8080
webmcpcss retro inject https://tienda-antigua.example --css legacy.webmcp.css --browser
webmcpcss retro publish legacy.webmcp.css --domain tienda-antigua.example
webmcpcss a11y audit --url https://mi-tienda.com --min-score 85 --fail-on critical     # WCAG 2.2 AA para agentes y personas
webmcpcss a11y fix --url https://mi-tienda.com -o a11y.webmcp.css --script a11y-fix.js
webmcpcss test generate --file webmcp.css --framework playwright --execute -o webmcp.spec.ts
webmcpcss test run --url https://mi-tienda.com --file webmcp.css --junit junit.xml
webmcpcss version snapshot --file webmcp.css --url https://mi-tienda.com --tag 1.0.0 -o v1.json
webmcpcss version diff v1.json v2.json                                                  # impacto semver + renombres
webmcpcss version migrate v1.json v2.json -o webmcp.migrado.css --notes MIGRATION.md
webmcpcss doc generate --file webmcp.css -o webmcp-docs                                 # HTML + MD + JSON + llms.txt + AGENTS.md
webmcpcss doc serve --file webmcp.css --port 3000
webmcpcss security validate --file webmcp.css --agent "bot:restricted:orders:pay" --strict
webmcpcss security token --agent "bot:restricted" --secret "$WEBMCP_JWT_SECRET"
webmcpcss recommend "compra 2 zapatillas rojas" --url https://mi-tienda.com             # aprende del historial
webmcpcss web3 validate --file webmcp.css --connector wallet-connector.js               # pagos por tool, x402/USDC
webmcpcss web3 balance --address 0x… --network base
webmcpcss web3 pay --to 0x… --amount 0.05 --currency USDC --network base --max-tx 0.1
webmcpcss web3 deploy --contract build/WebMCPPayments.json --network base --args 0x…

# Extra: parsear a JSON sin navegador, e inyectar (descubrimiento → comunidad)
webmcpcss parse webmcp.css
webmcpcss inject https://example.com --dir ./community-styles
```

Todos los comandos aceptan URLs `http(s)://`, rutas locales a HTML y `--verbose`.

## Uso como librería (API)

```ts
import puppeteer from 'puppeteer';
import * as fs from 'fs';
import { parseWebMCP, WebMCPcss, PuppeteerAdapter } from 'webmcpcss';

const toolMap = parseWebMCP(fs.readFileSync('webmcp.css', 'utf8'));

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://mi-tienda.com/producto/123');

const webmcp = new WebMCPcss(toolMap, new PuppeteerAdapter(page));

// Ejecutar una herramienta (con auto-reparación transparente)
const result = await webmcp.execute('addToCart', { quantity: '2' });
// → { success: true, data: { productId: 'SKU-42', quantity: '2', confirmed: true } }

// Leer contexto
const price = await webmcp.getContext('price'); // → "249.900"

await browser.close();
```

¿Sin navegador? `DomAdapter` funciona sobre cualquier `Document` (jsdom, DOM
real en una extensión, etc.).

## Ejemplo paso a paso (2 minutos)

El repo incluye una tienda demo en `examples/shopping-cart/`:

```bash
# Validar el ejemplo contra su HTML local
webmcpcss validate examples/shopping-cart/index.html examples/shopping-cart/webmcp.css

# Romper un selector a propósito y ver la auto-reparación en acción
sed -i 's/.btn-add/.boton-que-no-existe/' examples/shopping-cart/webmcp.css
webmcpcss validate examples/shopping-cart/index.html examples/shopping-cart/webmcp.css  # ✖ roto
webmcpcss repair examples/shopping-cart/index.html examples/shopping-cart/webmcp.css    # ✔ reparado
webmcpcss validate examples/shopping-cart/index.html examples/shopping-cart/webmcp.css  # ✔ OK
```

## Sintaxis `.webmcp.css`

| Propiedad               | Descripción                                           | Ejemplo                                   |
| ----------------------- | ----------------------------------------------------- | ----------------------------------------- |
| `webmcp-tool`           | Declara una herramienta sobre el selector de la regla | `webmcp-tool: "addToCart";`               |
| `webmcp-param-<nombre>` | Parámetro de la herramienta                           | `webmcp-param-qty: value(#qty);`          |
| `webmcp-trigger`        | Evento de disparo (por defecto `click`)               | `webmcp-trigger: "submit" on .form;`      |
| `webmcp-confirmation`   | Selector que debe existir tras la acción              | `webmcp-confirmation: ".cart-badge";`     |
| `webmcp-description`    | Descripción legible                                   | `webmcp-description: "Añade al carrito";` |
| `webmcp-context`        | Declara un dato de solo lectura                       | `webmcp-context: "price";`                |
| `webmcp-format`         | Formato del contexto (`currency`, `number`, `text`)   | `webmcp-format: "currency";`              |

Fuentes de parámetros: `attr(nombre-atributo)`, `data(x)` (alias de `attr(data-x)`), `aria(x)` (alias de `attr(aria-x)`), `value(selector?)`, `text(selector?)`, `"literal"`.

### CSS moderno (v0.2.0)

El parser soporta **reglas anidadas** (con `&`), **variables CSS** y **`@import`**:

```css
@import 'base.webmcp.css';

:root {
  --qty-field: #qty-input;
}

[data-product] {
  .btn-add {
    webmcp-tool: 'addToCart';
    webmcp-param-quantity: value(var(--qty-field));
  }
}
```

## Integración con el estándar WebMCP (`document.modelContext`)

WebMCPcss es un **puente bidireccional** con el estándar WebMCP (W3C WebML CG)
que ya se prueba en Chrome. Sigue el borrador actual: la API vive en
**`document.modelContext`** y todo el código que genera usa el patrón
recomendado `document.modelContext || navigator.modelContext` (el nombre
antiguo, `navigator.modelContext`, es un alias obsoleto desde Chromium 150).
Guía completa: [docs/standard.md](docs/standard.md).

**CSS → API imperativa:** genera el código `registerTool()` desde tu `.webmcp.css`:

```bash
webmcpcss generate --api webmcp.css -o webmcp-tools.js
# luego en tu sitio: <script src="webmcp-tools.js"></script>
```

**CSS ⇄ API declarativa (v1.1.0):** el estándar también permite anotar
formularios con `toolname`, `tooldescription`, `toolautosubmit`,
`toolparamtitle` y `toolparamdescription`; el navegador deriva el JSON Schema
del propio formulario. WebMCPcss compila en ambos sentidos:

```bash
webmcpcss standard scan index.html -o webmcp.css             # atributos → .webmcp.css
webmcpcss standard compile webmcp.css --html index.html      # .webmcp.css → atributos en el HTML
webmcpcss standard compile webmcp.css --script decl.js       # … o aplicados en tiempo de ejecución
webmcpcss standard check https://mi-tienda.com               # dónde está modelContext y qué tools expone la página
```

```css
/* Lo que produce `standard scan` para <form id="search" toolname="searchProducts" …> */
#search button[type='submit'] {
  webmcp-tool: 'searchProducts';
  webmcp-description: 'Busca productos en el catálogo';
  webmcp-param-q: value(#search input[name= 'q']);
  webmcp-trigger: 'submit' on #search;
  webmcp-source: 'declarative';
  webmcp-doc-q: 'Palabras clave del producto'; /* ⇄ toolparamdescription */
}
```

`generate --auto` y `retro scan` también detectan los formularios ya anotados y
conservan su nombre, descripción y parámetros en el contrato generado.

**API → WebMCPcss:** consume herramientas que el sitio ya registró:

```ts
import { WebMCPApiAdapter, WebMCPcss, parseWebMCP } from 'webmcpcss';

const adapter = await WebMCPApiAdapter.create(page); // ANTES de page.goto()
await page.goto('https://sitio-con-webmcp.com');

const webmcp = new WebMCPcss(parseWebMCP(css), adapter);
await webmcp.listApiTools(); // herramientas registradas por el sitio
await webmcp.execute('searchFlights', {}); // via: 'api' si no está en el CSS
```

## Auto-descubrimiento

Un sitio puede publicar su WebMCP para que cualquier agente lo encuentre sin
navegar la página:

```html
<!-- Opción A: meta tag -->
<meta name="webmcp" content="/webmcp.css" />
<!-- Opción B: link -->
<link rel="webmcp" href="/webmcp.css" />
```

```json
// Opción C: GET /.well-known/webmcp.json
{ "stylesheet": "/webmcp.css" }
```

`webmcpcss discover <url>` lo comprueba al instante, y `webmcpcss inject`
prueba el descubrimiento **antes** de caer a `community-styles/`.

## Integración con Tailwind CSS (v0.3.0)

Agentes de IA pueden **inspeccionar y editar en tiempo real** los estilos
Tailwind de una página vía herramientas WebMCP — sin dependencias nuevas
(clasificador de utilidades basado en patrones propios):

```ts
import {
  scanDocument,
  generateTailwindTools,
  registerTailwindTools,
  TailwindEditor,
} from 'webmcpcss';

// Genera y registra herramientas editCard1Spacing, editHeaderColors...
registerTailwindTools(window, generateTailwindTools(scanDocument(document)));

// O edita a mano, con undo/redo y diffs exportables:
const editor = new TailwindEditor();
editor.replaceClass(document.querySelector('#card'), 'p-4', 'p-8');
editor.undo();
editor.exportDiffs(); // [{ selector, before, after }]
```

CLI: `webmcpcss tailwind inspect | generate | export` (HTML, JSX, Vue,
Angular). Demo lista en `examples/tailwind-demo/`. Documentación completa en
[docs/TAILWIND.md](docs/TAILWIND.md).

## Mapas de Contenido (v0.4.0): grafo, Obsidian y fragilidad

Convierte tus `.webmcp.css` en un **grafo de conocimiento navegable** y en
**documentación Obsidian** con análisis de fragilidad de selectores:

```bash
# Vault de Obsidian con backlinks, frontmatter y análisis de fragilidad
webmcpcss graph examples/ --obsidian ./vault

# Dashboard interactivo (Cytoscape.js) con filtros y exportación JSON/PNG
webmcpcss graph examples/ --dashboard

# JSON con estado de selectores para CI/CD
webmcpcss validate https://mi-tienda.com webmcp.css --save-status
webmcpcss graph . --output graph.json --with-status
```

El análisis de fragilidad detecta patrones de **React (CSS-in-JS, useId),
Vue scoped, Svelte, Angular, CSS Modules, styled-components, Emotion,
Tailwind, Bootstrap, MUI y Ant Design**, clasifica cada selector
(🟢 low / 🟡 medium / 🔴 high) y sugiere migraciones a alternativas estables
(`data-tool`, ids semánticos, fingerprints para `repair`).

| Selector                                                    | Nivel     | Recomendación                      |
| ----------------------------------------------------------- | --------- | ---------------------------------- |
| `[data-tool="buy"]`, `#add-to-cart`                         | 🟢 low    | el patrón ideal                    |
| `.MuiButton-contained`, `.ant-btn`, `.btn-primary`          | 🟢 low    | estable por design system          |
| `.bg-blue-500.px-4` (Tailwind), `:nth-child(3)`             | 🟡 medium | añade id/data-*                    |
| `[data-v-7ba5bd90]`, `.sc-bdVaJa`, `.css-1q2w3e4`, `.jss42` | 🔴 high   | hash de build: migra a `data-tool` |

Desde v0.9.0 cada selector lleva además el **framework detectado**
(`CSS Modules (Next.js)`, `Vue (scoped)`, `styled-components`, `MUI v5`,
`Element Plus`, `Bootstrap`…), el grafo incluye `frameworkSummary`, el
dashboard filtra por estado/fragilidad/página/framework y exporta PNG/SVG/JSON,
y `--svg` genera el grafo estático sin navegador.

Documentación completa en [docs/GRAPH.md](docs/GRAPH.md); demos en
`examples/graph-demo/` y vault de referencia en
[`examples/graph/`](examples/graph/README.md).

## Integración universal con agentes (v0.5.0)

WebMCPcss habla los cuatro dialectos que cubren el ecosistema de agentes:
**MCP (stdio)**, **API REST**, **JSON Schema** y **módulos Python**. Más de
**46 agentes soportados** — tabla completa y guías en
[docs/AGENTS.md](docs/AGENTS.md).

| Agente                                                                              | Integración                                                                                                                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Desktop, Windsurf, Goose, Cline, Continue, Copilot, Gemini CLI, Codex CLI... | `export --format mcp-config` + `mcp --serve` ([guía](docs/agents/mcp-clients.md))                                                                                        |
| Claude Code                                                                         | `export --format claude-code` → plugin con `/webmcpcss:*` (generate, validate, repair, run, prompt, animate) + skill `webmcp-audit` ([guía](docs/agents/claude-code.md)) |
| Cursor                                                                              | `export --format cursor [--register]` → `~/.cursor/mcp.json`, snippets `webmcp:` y regla `.mdc` ([guía](docs/agents/cursor.md))                                          |
| DeerFlow (ByteDance)                                                                | `export --format deerflow` → tools Python `browser_*` + skill + `extensions_config.json` ([guía](docs/agents/deerflow.md))                                               |
| Flomny                                                                              | `export --format flomny` + `mcp --serve --flomny` → servidor MCP dedicado ([guía](docs/agents/flomny.md))                                                                |
| CrewAI                                                                              | `export --format crewai` → módulo Python `@tool` ([guía](docs/agents/crewai.md))                                                                                         |
| AutoGen / AG2                                                                       | `export --format autogen` → JSON Schema + registro ([guía](docs/agents/autogen.md))                                                                                      |
| LangGraph / LangChain                                                               | `export --format langgraph` → `TOOLS` listos ([guía](docs/agents/langgraph.md))                                                                                          |
| ChatGPT Atlas, Operator, Mariner, Comet, Skyvern...                                 | `export --format browser-inject` → `window.__WEBMCP_GRAPH__` ([guía](docs/agents/browser-agents.md))                                                                     |
| LlamaIndex, Semantic Kernel, function calling genérico                              | `export --format json-schema` ([guía](docs/agents/json-schema.md))                                                                                                       |
| Manus, Devin, n8n, Dify, agentes propios                                            | `mcp --serve --http` → REST ([guía](docs/agents/rest-api.md))                                                                                                            |

Además, `generate --auto` crea el `.webmcp.css` inicial **sin grabar nada**:
escanea la página headless, detecta formularios/botones/campos, infiere
nombres de herramienta (`login`, `search`, `addToCart`...), detecta el
framework (React, Next, Vue, Svelte, Angular, MUI, AntD, Bootstrap,
Tailwind) y elige selectores estables (`data-*` → `id` → `name`/`aria-label`
→ clases estables). Ejemplos generados por agente en
[`examples/agents/`](examples/agents/README.md).

Desde v0.6.0 también puedes generar **desde el código fuente** de tus
componentes React/Vue/Svelte, sin navegador ni deploy
(`generate --from-source`, [guía](docs/SOURCE-GENERATION.md)), y **publicar
al repositorio comunitario con un PR automático** (`publish --domain`,
fork + rama + commit + pull request vía API de GitHub).

## Modificación con lenguaje natural (v0.7.0)

`webmcpcss prompt` traduce órdenes en español o inglés a acciones
estructuradas (`upload`, `changeColor`, `delete`, `move`, `click`, `fill`,
`hide`, `setText`, `setStyle`, `other`), **localiza el elemento de forma
progresiva** (selector → herramienta WebMCPcss → LLM → texto/etiquetas →
visión → sondas) y lo ejecuta sobre la página con evidencia y captura.
Sin `--execute` solo muestra lo que haría.

```bash
webmcpcss prompt "pon la cantidad en 3" --url https://mi-tienda.com --execute
webmcpcss prompt "move the logo to the top" --url https://mi-sitio.com --llm ollama --execute
```

- Funciona **sin LLM** (intérprete heurístico) y mejora con **Ollama, OpenAI
  o Anthropic** configurados solo por variables de entorno
  (`WEBMCP_LLM_PROVIDER`, `WEBMCP_OLLAMA_MODEL`, `WEBMCP_OPENAI_API_KEY`,
  `WEBMCP_ANTHROPIC_API_KEY`…). Cero dependencias nuevas.
- Si el elemento pertenece a una herramienta del `.webmcp.css`, la acción se
  delega en ella (con auto-reparación incluida).
- Disponible también como herramienta MCP **`webmcpcss_prompt`** en
  `mcp --serve` (`{ prompt, url?, files?, dryRun?, screenshot? }`), como
  `POST /api/prompt` en modo HTTP y como API (`PromptManager`).
- Seguridad: dry-run por defecto, lista blanca de estilos, validación de
  colores/URLs/archivos (25 MB) e historial de cada acción.

Guía completa: [docs/PROMPT.md](docs/PROMPT.md) · ejemplo:
[`examples/prompt/`](examples/prompt/README.md).

## Animaciones declarativas (v0.8.0)

`webmcpcss animate` lee animaciones declaradas en CSS —**parallax,
isométrico, 3D transform, keyframes y escenas 2.5D con Three.js**— y las
aplica en un navegador headless (o genera un runtime de ≈85 KB para el
sitio) eligiendo el motor adecuado (**CSS**, **WAAPI** o **Three.js**) y
**sin pisar** las animaciones que la página ya tenga (GSAP, Framer Motion,
Anime.js, `@keyframes` propios…).

```css
#hero {
  webmcp-animation: 'heroParallax';
  webmcp-animation-type: parallax;
  webmcp-animation-layers:
    '.sky' 0.1,
    '.mountains' 0.4,
    '.ground' 0.75;
}
.hero .title {
  webmcp-animation: 'titleIn';
  webmcp-animation-priority: high;
  webmcp-animation-keyframes: '[{"opacity":0,"transform":"translateY(24px)"},{"opacity":1,"transform":"none"}]';
}
#scene {
  webmcp-animation: 'depth';
  webmcp-animation-type: three-scene;
  webmcp-animation-scene: '{"layers":[{"color":"#1d4ed8","position":{"z":-4},"parallax":0.2}]}';
  webmcp-animation-fallback: '{"type":"keyframes","keyframes":[{"opacity":0.6},{"opacity":1}]}';
}
```

```bash
webmcpcss animate animations.webmcp.css --url https://mi-sitio.com --conflict-strategy queue --screenshot hero.png
```

- Prioridades `low` → `critical` y estrategias de conflicto `replace`,
  `queue`, `ignore` y `merge` (fusión solo de propiedades componibles).
  Las animaciones externas se detectan automáticamente o se registran con
  `registerExternal()`.
- Validación previa (selectores, capas, WebGL, conflictos previstos) y
  `--dry-run`; `fallback` por animación; respeto de `prefers-reduced-motion`;
  Shadow DOM opcional para las escenas.
- Disponible como herramienta MCP **`webmcpcss_animate`**
  (`{ animationFile | css, url?, strategy?, engine?, dryRun?, screenshot? }`),
  como `POST /api/animate` y como API (`animateWithPage`, `animateInWindow`,
  `AnimationOrchestrator`). Cero dependencias nuevas (Three.js se carga desde
  la página o por URL solo si se usa).

- v0.9.0: `validate-conflicts` simula los conflictos con las animaciones del
  sitio y devuelve un informe JSON (`--strict` para CI), `--sandbox` aísla
  todo en un shadow root y el resolutor se documenta en
  [docs/conflict-resolution.md](docs/conflict-resolution.md).

Guías: [docs/animation.md](docs/animation.md) ·
[docs/animation-conflicts.md](docs/animation-conflicts.md) ·
[docs/conflict-resolution.md](docs/conflict-resolution.md) ·
[docs/cli-animate.md](docs/cli-animate.md) · ejemplos:
[`examples/animation/`](examples/animation/).

## Las diez ideas innovadoras (v1.0.0)

La versión 1.0.0 añade diez módulos independientes, sin dependencias nuevas,
que convierten WebMCPcss en una plataforma completa para sitios nativos de IA.
Cada uno tiene su guía en `docs/`, su API en `webmcpcss` (namespace propio) y
salidas reales en [`examples/v1/`](examples/v1/).

| #   | Módulo                 | Qué hace                                                                                                                                                                                  | CLI                                   | Guía                                                |
| --- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| 1   | **IA-First Framework** | Componentes (`IAButton`, `IAForm`, `IACard`, `IANav`, `IAHero`, `IAGrid`) que nacen con `webmcp-component`, `webmcp-intent`, `webmcp-confirmation: needed\|none` y `webmcp-accessibility` | `init`, `assist`                      | [ia-first-framework.md](docs/ia-first-framework.md) |
| 2   | **Design-to-WebMCP**   | De imagen / Figma / texto a `.webmcp.css` + andamiaje; valida el sitio contra el diseño; optimiza contratos                                                                               | `design analyze\|validate\|optimize`  | [design-to-webmcp.md](docs/design-to-webmcp.md)     |
| 3   | **Retro-WebMCP**       | Escanea sitios legacy, proxy de compatibilidad que inyecta WebMCP, inyector en navegador, publicación comunitaria                                                                         | `retro scan\|proxy\|inject\|publish`  | [retro-webmcp.md](docs/retro-webmcp.md)             |
| 4   | **A11y-MCP**           | Auditoría WCAG 2.2 AA, correcciones declarativas (`webmcp-accessibility`) y puerta de calidad en CI                                                                                       | `a11y audit\|fix`                     | [a11y.md](docs/a11y.md)                             |
| 5   | **Test-MCP**           | Genera suites Playwright/Cypress desde el contrato, las ejecuta con Puppeteer y emite JUnit                                                                                               | `test generate\|run`                  | [testing.md](docs/testing.md)                       |
| 6   | **Version-MCP**        | Snapshots, diff semántico con detección de renombres e impacto SemVer, migraciones para agentes                                                                                           | `version snapshot\|diff\|migrate`     | [versioning.md](docs/versioning.md)                 |
| 7   | **Doc-MCP**            | Documentación interactiva: HTML autocontenido, Markdown, JSON, `llms.txt`, `AGENTS.md`; servidor con recarga                                                                              | `doc generate\|serve`                 | [doc-generation.md](docs/doc-generation.md)         |
| 8   | **Security-MCP**       | `webmcp-permissions: read-only\|restricted\|full`, `webmcp-requires`, scopes, rate-limit, JWT HS256 sin dependencias, auditoría                                                           | `security validate\|token`            | [security.md](docs/security.md)                     |
| 9   | **Recommender-MCP**    | Recomienda tools para un objetivo en lenguaje natural, con parámetros, aprendiendo del historial; refinado LLM opcional                                                                   | `recommend`                           | [recommender.md](docs/recommender.md)               |
| 10  | **Web3-MCP**           | `webmcp-payment`/`webmcp-network`/`webmcp-amount`, billetera de agente con límites, micropagos x402/USDC sin gas, MetaMask/WalletConnect, saldo/pago/deploy con `ethers` opcional         | `web3 validate\|balance\|pay\|deploy` | [web3.md](docs/web3.md)                             |

```ts
import {
  framework,
  design,
  retro,
  a11y,
  testing,
  versioning,
  doc,
  security,
  recommender,
  web3,
  standard, // v1.1.0: document.modelContext + API declarativa
} from 'webmcpcss';
```

## Proxy comunitario

Si un sitio no publica su propio WebMCP, la comunidad puede aportarlo en
[`community-styles/`](community-styles/README.md). El proxy resuelve el
dominio (con cadena de subdominios) e inyecta el tool map en la página como
`window.__WEBMCP__` + `<style type="text/webmcp">`.

Ya incluye definiciones **verificadas en vivo** para Wikipedia, Hacker News
y MercadoLibre Colombia, y un índice consultable por agentes en una sola
petición HTTP:
[`community-styles/index.json`](community-styles/index.json).

```bash
webmcpcss inject https://www.example.com --dir ./community-styles
```

## Desarrollo

```bash
npm install        # instala dependencias
npm run build      # compila TypeScript a dist/
npm test           # tests unitarios (Vitest, sin navegador)
npm run lint       # ESLint
npm run format     # Prettier
```

Estructura relevante:

- `src/parser/` — parseo/serialización de `.webmcp.css` (postcss).
- `src/core/` — clase `WebMCPcss`, reparación (`repair.ts`) y visión (`vision.ts`).
- `src/adapters/` — `PageAdapter` (interfaz), `PuppeteerAdapter`, `DomAdapter`.
- `src/proxy/` — proxy comunitario e inyección de estilos.
- `src/cli.ts` — comandos `generate`, `validate`, `repair`, `inject`, `parse`…; `src/cli-v1.ts` — comandos v1.0.0; `src/cli-standard.ts` — `standard scan|compile|check` (v1.1.0).
- `src/standard/` — alineación con el estándar WebMCP: `document.modelContext` (con fallback) y API declarativa (`toolname`/`tooldescription`…).
- `src/framework/`, `src/design-to-webmcp/`, `src/retro/`, `src/a11y/`, `src/testing/`, `src/versioning/`, `src/doc/`, `src/security/`, `src/recommender/`, `src/web3/` — los diez módulos v1.0.0.

## Contribuir

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md)
para las normas de estilo, el proceso de PR y cómo aportar estilos
comunitarios.

## Licencia

[MIT](LICENSE) © WebMCPcss Contributors
