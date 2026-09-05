# 🛡️ WebMCPcss

> Make **any website** native for AI agents — without touching its source code — with **self-healing** selectors when the site is redesigned.

🌐 **Website:** [cochinoraptor.github.io/WebMCPcss](https://cochinoraptor.github.io/WebMCPcss/) · 🇪🇸 **Español:** [README.md](README.md)

[![CI](https://github.com/cochinoraptor/WebMCPcss/actions/workflows/ci.yml/badge.svg)](https://github.com/cochinoraptor/WebMCPcss/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/webmcpcss.svg)](https://www.npmjs.com/package/webmcpcss)
[![npm downloads](https://img.shields.io/npm/dm/webmcpcss.svg)](https://www.npmjs.com/package/webmcpcss)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## What is WebMCPcss?

WebMCPcss extends the **WebMCP** standard with a simple idea: describe the tools
an AI agent can use on a website in a **`.webmcp.css`** file — plain CSS with
`webmcp-*` custom properties:

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

WebMCPcss turns it into a JSON **tool map** any agent understands:

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

### 🩹 Self-healing

Sites get redesigned and selectors break. When that happens, WebMCPcss:

1. Detects that the selector no longer exists.
2. Switches to **vision** mode: looks for the element by fingerprint (`data-*`
   attributes, visible text, tag, approximate position) among the page candidates.
3. Infers a **new stable selector** (priority: `data-*` → `id` → `name` /
   `aria-label` → stable classes).
4. Updates the in-memory tool map and **retries** the action.

### Zero new dependencies, one CLI

Everything ships in a single package with four production dependencies
(`chalk`, `commander`, `postcss`, `puppeteer`): parser, self-healing runtime,
automatic generation, MCP server, 10 export formats for **46 agents**, natural
language site editing, declarative animations, and the ten v1.0.0 modules
(IA-First framework, design-to-WebMCP, legacy sites, accessibility, testing,
versioning, docs, security, recommender, Web3 payments).

## Install

```bash
# Global (CLI)
npm install -g webmcpcss

# Or as a project dependency
npm install webmcpcss
```

From the repository:

```bash
git clone https://github.com/cochinoraptor/WebMCPcss.git
cd WebMCPcss
npm install
npm run build
npm link   # optional: enables the global `webmcpcss` command
```

## CLI usage

```bash
# 1) Record interactions in a browser and generate a .webmcp.css
webmcpcss generate https://my-shop.com -o webmcp.css
webmcpcss generate https://my-shop.com --ai            # + names/descriptions with AI

# 2) Validate that the selectors exist on the page
webmcpcss validate https://my-shop.com webmcp.css
webmcpcss validate https://my-shop.com webmcp.css --api   # + tools from document.modelContext

# 3) Automatically repair broken selectors (rewrites the file)
webmcpcss repair https://my-shop.com webmcp.css

# 4) Turn the CSS into JS code for the WebMCP imperative API
webmcpcss generate --api webmcp.css -o webmcp-tools.js

# 5) Does the site publish WebMCP? (meta tag or .well-known, no browser)
webmcpcss discover https://my-shop.com

# 6) Web dashboard with tools, history and statistics
webmcpcss dashboard --port 3000 --css webmcp.css

# 7) Tailwind CSS: inspect, generate editing tools and export
webmcpcss tailwind inspect https://my-site.com "#header"
webmcpcss tailwind generate https://my-site.com -o my-tools   # → my-tools.js + my-tools.webmcp.css
webmcpcss tailwind export https://my-site.com -s "#card" -o Card.jsx

# 8) Content maps: knowledge graph, Obsidian vault and fragility
webmcpcss graph examples/ --obsidian ./vault --output graph.json --fragility
webmcpcss graph examples/ --dashboard                          # Cytoscape on :3100
webmcpcss graph examples/ --svg graph.svg                      # static SVG, no browser

# 9) Automatic generation WITHOUT recording (headless scan)
webmcpcss generate https://my-shop.com --auto -o webmcp.css
# 9b) From source code (React/Vue/Svelte, no browser)
webmcpcss generate ./src/components --from-source -o webmcp.css

# 10) Export for any AI agent
webmcpcss export webmcp.css --format claude-code -o ./claude-plugin --url https://my-shop.com
webmcpcss export webmcp.css --format cursor --register          # writes ~/.cursor/mcp.json
# formats: mcp-config, claude-code, cursor, deerflow, flomny, crewai, autogen,
#          langgraph, browser-inject, json-schema

# 11) MCP server (stdio) or REST API
webmcpcss mcp --serve --css webmcp.css --url https://my-shop.com
webmcpcss mcp --serve --http -p 8090 --css webmcp.css --url https://my-shop.com

# 12) Run a tool and get JSON (for wrappers)
webmcpcss run https://my-shop.com webmcp.css addToCart --args '{"quantity":"2"}'

# 13) Publish to the community repository (automatic fork + PR)
webmcpcss publish webmcp.css --domain my-shop.com --token ghp_xxx   # or GITHUB_TOKEN

# 14) Edit the site with natural language (dry-run without --execute)
webmcpcss prompt "make the Add to cart button green" --url https://my-shop.com --css webmcp.css --execute

# 15) Declarative animations (parallax, isometric, 3D, keyframes, Three.js)
webmcpcss animate animations.webmcp.css --url https://my-site.com --dry-run
webmcpcss animate animations.webmcp.css -o ./public/webmcp-animation

# 16) Validate conflicts with the site's GSAP/Framer/CSS without running anything (CI)
webmcpcss validate-conflicts animations.webmcp.css --url https://my-site.com --strict -o report.json

# 17) v1.0.0 — the ten modules
webmcpcss init my-shop --framework ia-first
webmcpcss assist "create a contact form with name, email and message" -o ./contact
webmcpcss design analyze --image mockup.png --llm openai -o design.webmcp.css --scaffold scaffold.html
webmcpcss retro scan https://old-shop.example -o legacy.webmcp.css            # legacy sites, no code changes
webmcpcss retro proxy https://old-shop.example --css legacy.webmcp.css --port 8080
webmcpcss a11y audit --url https://my-shop.com --min-score 85 --fail-on critical
webmcpcss test generate --file webmcp.css --framework playwright --execute -o webmcp.spec.ts
webmcpcss version diff v1.json v2.json                                         # semver impact + renames
webmcpcss doc generate --file webmcp.css -o webmcp-docs                        # HTML + MD + JSON + llms.txt + AGENTS.md
webmcpcss security validate --file webmcp.css --agent "bot:restricted:orders:pay" --strict
webmcpcss recommend "buy 2 red sneakers" --url https://my-shop.com
webmcpcss web3 pay --to 0x… --amount 0.05 --currency USDC --network base --max-tx 0.1

# 18) v1.1.0 — WebMCP standard: declarative API (toolname/tooldescription) ⇄ .webmcp.css, document.modelContext
webmcpcss standard scan https://my-shop.com -o webmcp.css                     # read <form toolname …> → contract
webmcpcss standard compile webmcp.css --html index.html -o index.webmcp.html  # add toolname/tooldescription/toolparamtitle
webmcpcss standard compile webmcp.css --script webmcp-declarative.js          # …or apply them at runtime
webmcpcss standard check https://my-shop.com                                  # where is modelContext? which tools does the page expose?

# 19) v1.2.0 — Component Hub: AI-first components for Tailwind, Bootstrap, MUI, shadcn and plain CSS
webmcpcss components list --library tailwind --category forms                 # catalog (remote or bundled)
webmcpcss components import tailwind-login-form --output ./src/components --merge webmcp.css
webmcpcss components update --dry-run                                         # new versions in the hub?
webmcpcss components demo --output ./demo --library bootstrap                 # local demo site
webmcpcss components publish my-button.webmcp.css --name "My button" --category buttons  # fork + PR to the hub
webmcpcss mcp --serve --http --hub                                            # + list_components / get_component / import_component

# Extra: parse to JSON without a browser, and inject (discovery → community)
webmcpcss parse webmcp.css
webmcpcss inject https://example.com --dir ./community-styles
```

Every command accepts `http(s)://` URLs, local HTML paths and `--verbose`.
Run `webmcpcss <command> --help` for all options.

## Library usage (API)

```ts
import puppeteer from 'puppeteer';
import * as fs from 'fs';
import { parseWebMCP, WebMCPcss, PuppeteerAdapter } from 'webmcpcss';

const toolMap = parseWebMCP(fs.readFileSync('webmcp.css', 'utf8'));

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://my-shop.com/product/123');

const webmcp = new WebMCPcss(toolMap, new PuppeteerAdapter(page));

// Run a tool (with transparent self-healing)
const result = await webmcp.execute('addToCart', { quantity: '2' });
// → { success: true, data: { productId: 'SKU-42', quantity: '2', confirmed: true } }

// Read context
const price = await webmcp.getContext('price'); // → "249.900"

await browser.close();
```

No browser? `DomAdapter` works on any `Document` (jsdom, a real DOM inside an
extension, etc.).

Namespaces: `framework`, `design`, `retro`, `a11y`, `testing`, `versioning`,
`doc`, `security`, `recommender`, `web3`, `standard`, `hub` (v1.2.0).

## `.webmcp.css` syntax

| Property              | Description                                      | Example                               |
| --------------------- | ------------------------------------------------ | ------------------------------------- |
| `webmcp-tool`         | Declares a tool on the rule's selector           | `webmcp-tool: "addToCart";`           |
| `webmcp-param-<name>` | Tool parameter                                   | `webmcp-param-qty: value(#qty);`      |
| `webmcp-trigger`      | Trigger event (default `click`)                  | `webmcp-trigger: "submit" on .form;`  |
| `webmcp-confirmation` | Selector that must exist after the action        | `webmcp-confirmation: ".cart-badge";` |
| `webmcp-description`  | Human-readable description                       | `webmcp-description: "Adds to cart";` |
| `webmcp-doc-<param>`  | Parameter description (⇄ `toolparamdescription`) | `webmcp-doc-qty: "Units to add";`     |
| `webmcp-context`      | Declares read-only data                          | `webmcp-context: "price";`            |
| `webmcp-format`       | Context format (`currency`, `number`, `text`)    | `webmcp-format: "currency";`          |

Parameter sources: `attr(attribute-name)`, `data(x)` (alias of `attr(data-x)`),
`aria(x)` (alias of `attr(aria-x)`), `value(selector?)`, `text(selector?)`,
`"literal"`. The parser supports **nested rules** (with `&`), **CSS variables**
and **`@import`**. Extra `webmcp-*` properties (`webmcp-permissions`,
`webmcp-payment`, `webmcp-accessibility`, `webmcp-intent`…) are documented in
each module guide under [`docs/`](docs/).

## Component Hub (v1.2.0)

A visual, interactive catalog of **AI-first components** — buttons, cards, forms,
layout, animations and intelligent components — each shipping its own
`.webmcp.css` + `component.json`, adapted to **Tailwind**, **Bootstrap 5**,
**Material UI**, **shadcn/ui** and plain CSS (58 components, 82 tools).

- 🌐 Site: [cochinoraptor.github.io/WebMCPcss/components](https://cochinoraptor.github.io/WebMCPcss/components/)
  — category/library filters, live search, favorites, preview with a **live
  editor** (color, size, animation), copy code and import command.
- 🤖 Agent index: [`/api/components.json`](https://cochinoraptor.github.io/WebMCPcss/api/components.json)
  (+ `webmcp-hub` meta and JSON-LD on every page).
- 🧰 CLI: `webmcpcss components list|show|import|update|demo|publish|build`
  (lock file `.webmcpcss/components.lock.json`, marker-based merge into your CSS).
- 🔌 MCP: `webmcpcss mcp --serve --hub` adds `list_components`, `get_component`
  and `import_component` (+ `GET /api/components` in HTTP mode).
- 📦 Offline: the catalog ships inside the npm package (`components/`).

```bash
npx webmcpcss components import shadcn-product-card --output ./src/components --merge webmcp.css
```

Full guide: [docs/hub.md](docs/hub.md) · contribute components:
[docs/hub/contributing.md](docs/hub/contributing.md).

## WebMCP standard integration (`document.modelContext`)

WebMCPcss is a **bidirectional bridge** with the WebMCP standard (W3C WebML CG)
already shipping behind Chrome's origin trial. It follows the current draft:
the API lives at **`document.modelContext`** and every generated snippet uses
the recommended `document.modelContext || navigator.modelContext` pattern
(`navigator.modelContext` is a deprecated alias since Chromium 150).
Full guide: [docs/standard.md](docs/standard.md).

**CSS → imperative API:** generate the `registerTool()` code from your `.webmcp.css`:

```bash
webmcpcss generate --api webmcp.css -o webmcp-tools.js
# then on your site: <script src="webmcp-tools.js"></script>
```

**CSS ⇄ declarative API (v1.1.0):** the standard also lets you annotate forms
with `toolname`, `tooldescription`, `toolautosubmit`, `toolparamtitle` and
`toolparamdescription`; the browser derives the JSON Schema from the form.
WebMCPcss compiles both ways:

```bash
webmcpcss standard scan index.html -o webmcp.css             # attributes → .webmcp.css
webmcpcss standard compile webmcp.css --html index.html      # .webmcp.css → attributes in the HTML
webmcpcss standard compile webmcp.css --script decl.js       # …or applied at runtime
webmcpcss standard check https://my-shop.com                 # where modelContext lives, which tools the page exposes
```

`generate --auto` and `retro scan` also detect already-annotated forms and keep
their name, description and parameters in the generated contract.

**API → WebMCPcss:** consume tools the site already registered:

```ts
import { WebMCPApiAdapter, WebMCPcss, parseWebMCP } from 'webmcpcss';

const adapter = await WebMCPApiAdapter.create(page); // BEFORE page.goto()
await page.goto('https://site-with-webmcp.com');

const webmcp = new WebMCPcss(parseWebMCP(css), adapter);
await webmcp.listApiTools(); // tools registered by the site
await webmcp.execute('searchFlights', {}); // via: 'api' when not in the CSS
```

## Auto-discovery

A site can publish its WebMCP so any agent finds it without browsing the page:

```html
<meta name="webmcp" content="/webmcp.css" />
<!-- or -->
<link rel="webmcp" href="/webmcp.css" />
```

```json
// or GET /.well-known/webmcp.json
{ "stylesheet": "/webmcp.css" }
```

`webmcpcss discover <url>` checks it instantly; `webmcpcss inject` tries
discovery **before** falling back to `community-styles/`.

## Universal agent integration

WebMCPcss speaks the four dialects that cover the agent ecosystem: **MCP
(stdio)**, **REST API**, **JSON Schema** and **Python modules**. **46 agents**
are supported — full table and guides in [docs/AGENTS.md](docs/AGENTS.md).

| Agent                                                                         | Integration                                                             |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Claude Desktop, Windsurf, Goose, Cline, Continue, Copilot, Gemini CLI, Codex… | `export --format mcp-config` + `mcp --serve`                            |
| Claude Code                                                                   | `export --format claude-code` → plugin with `/webmcpcss:*` + skill      |
| Cursor                                                                        | `export --format cursor [--register]` → `~/.cursor/mcp.json` + `.mdc`   |
| DeerFlow (ByteDance)                                                          | `export --format deerflow` → Python `browser_*` tools + skill           |
| Flomny                                                                        | `export --format flomny` → dedicated MCP server                         |
| CrewAI / AutoGen / LangGraph                                                  | `export --format crewai\|autogen\|langgraph` → Python tools             |
| Any HTTP client                                                               | `mcp --serve --http` → REST + JSON Schema                               |
| Browser extensions / userscripts                                              | `export --format browser-inject` → registers on `document.modelContext` |

## The ten v1.0.0 modules

| #   | Module                 | What it does                                                                                              | CLI                                   | Guide                                               |
| --- | ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------- |
| 1   | **IA-First Framework** | Components born with `webmcp-component`, `webmcp-intent`, `webmcp-confirmation`, `webmcp-accessibility`   | `init`, `assist`                      | [ia-first-framework.md](docs/ia-first-framework.md) |
| 2   | **Design-to-WebMCP**   | From image / Figma / text to `.webmcp.css` + scaffold; validates the site against the design              | `design analyze\|validate\|optimize`  | [design-to-webmcp.md](docs/design-to-webmcp.md)     |
| 3   | **Retro-WebMCP**       | Scans legacy sites, compatibility proxy injecting WebMCP, in-browser injector, community publishing       | `retro scan\|proxy\|inject\|publish`  | [retro-webmcp.md](docs/retro-webmcp.md)             |
| 4   | **A11y-MCP**           | WCAG 2.2 AA audit, declarative fixes and CI quality gate                                                  | `a11y audit\|fix`                     | [a11y.md](docs/a11y.md)                             |
| 5   | **Test-MCP**           | Generates Playwright/Cypress suites from the contract, runs them with Puppeteer, emits JUnit              | `test generate\|run`                  | [testing.md](docs/testing.md)                       |
| 6   | **Version-MCP**        | Snapshots, semantic diff with rename detection and SemVer impact, agent migrations                        | `version snapshot\|diff\|migrate`     | [versioning.md](docs/versioning.md)                 |
| 7   | **Doc-MCP**            | Interactive docs: self-contained HTML, Markdown, JSON, `llms.txt`, `AGENTS.md`; live-reload server        | `doc generate\|serve`                 | [doc-generation.md](docs/doc-generation.md)         |
| 8   | **Security-MCP**       | `webmcp-permissions`, `webmcp-requires`, scopes, rate-limit, dependency-free JWT HS256, audit             | `security validate\|token`            | [security.md](docs/security.md)                     |
| 9   | **Recommender-MCP**    | Recommends tools for a natural-language goal, with parameters, learning from history                      | `recommend`                           | [recommender.md](docs/recommender.md)               |
| 10  | **Web3-MCP**           | `webmcp-payment`/`webmcp-network`/`webmcp-amount`, agent wallet with limits, x402/USDC, optional `ethers` | `web3 validate\|balance\|pay\|deploy` | [web3.md](docs/web3.md)                             |

Plus (v1.1.0) the **`standard`** module: `document.modelContext` alignment and
the declarative API compiler — [standard.md](docs/standard.md).

## Community proxy

If a site doesn't publish its own WebMCP, the community can contribute one in
[`community-styles/`](community-styles/README.md). The proxy resolves the domain
(with a subdomain chain) and injects the tool map into the page as
`window.__WEBMCP__` + `<style type="text/webmcp">`. Verified live definitions
for Wikipedia, Hacker News and MercadoLibre Colombia are included, plus an index
agents can query in one HTTP request: [`community-styles/index.json`](community-styles/index.json).

## Development

```bash
npm install        # install dependencies
npm run build      # compile TypeScript to dist/
npm test           # unit tests (Vitest, no browser)
npm run lint       # ESLint
npm run format     # Prettier
```

Relevant structure:

- `src/parser/` — `.webmcp.css` parsing/serialization (postcss).
- `src/core/` — `WebMCPcss` class, repair (`repair.ts`) and vision (`vision.ts`).
- `src/adapters/` — `PageAdapter` (interface), `PuppeteerAdapter`, `DomAdapter`, `WebMCPApiAdapter`.
- `src/standard/` — WebMCP standard alignment (`document.modelContext`, declarative API).
- `src/cli.ts`, `src/cli-v1.ts`, `src/cli-standard.ts` — CLI commands.
- `src/framework/`, `src/design-to-webmcp/`, `src/retro/`, `src/a11y/`, `src/testing/`, `src/versioning/`, `src/doc/`, `src/security/`, `src/recommender/`, `src/web3/` — the ten v1.0.0 modules.

Releases are published to npm from GitHub Actions with **OIDC trusted
publishing** and **provenance** attestations (no long-lived npm tokens).

## Contributing

Contributions are welcome! Read [CONTRIBUTING.md](CONTRIBUTING.md) for style
rules, the PR process and how to contribute community styles.

## License

[MIT](LICENSE) © WebMCPcss Contributors
