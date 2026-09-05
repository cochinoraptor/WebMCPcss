# Referencia de la CLI `webmcpcss`

Referencia completa de los **29 comandos** (v1.2.1). Todos aceptan `--help`;
los que reciben una URL aceptan también rutas locales a HTML. La opción global
`--verbose` muestra depuración. Los comandos con `--json` escriben **solo** JSON
en `stdout` (pensados para agentes y CI). Códigos de salida: `0` OK, `1` error
o validación fallida.

```bash
npm i -g webmcpcss        # o: npx webmcpcss <comando>
webmcpcss --version       # 1.2.1
```

Guías temáticas: [estándar WebMCP](standard.md) · [animaciones](animation.md) ·
[prompt](PROMPT.md) · [agentes](agents/) · [Component Hub](hub.md) ·
[seguridad](security.md) · [Web3](web3.md).

## Índice

| Comando                                                             | Qué hace                                                    | Navegador |
| ------------------------------------------------------------------- | ----------------------------------------------------------- | --------- |
| [`generate`](#generate)                                             | Graba/escanea un sitio y genera `.webmcp.css`; `--api` → JS | Sí\*      |
| [`validate`](#validate)                                             | Comprueba que los selectores existen                        | Sí        |
| [`repair`](#repair)                                                 | Repara selectores rotos (visión) y reescribe el archivo     | Sí        |
| [`discover`](#discover)                                             | ¿Publica el sitio WebMCP? (meta / `.well-known`)            | No        |
| [`parse`](#parse)                                                   | `.webmcp.css` → tool map JSON                               | No        |
| [`export`](#export)                                                 | Exporta a 10 formatos de agente                             | No        |
| [`mcp`](#mcp)                                                       | Servidor MCP (stdio o HTTP)                                 | Opcional  |
| [`run`](#run)                                                       | Ejecuta una herramienta y devuelve JSON                     | Sí        |
| [`prompt`](#prompt)                                                 | Modifica una página con lenguaje natural                    | Sí        |
| [`animate`](#animate) / [`validate-conflicts`](#validate-conflicts) | Animaciones declarativas y sus conflictos                   | Opcional  |
| [`publish`](#publish) / [`inject`](#inject)                         | Repositorio comunitario de estilos                          | No / Sí   |
| [`dashboard`](#dashboard) / [`graph`](#graph)                       | Dashboard web y grafo de conocimiento                       | No        |
| [`tailwind`](#tailwind)                                             | Inspección/edición/exportación Tailwind                     | Sí        |
| [`init`](#init) / [`assist`](#assist)                               | Framework IA-First                                          | No        |
| [`design`](#design)                                                 | Design-to-WebMCP                                            | Opcional  |
| [`retro`](#retro)                                                   | Sitios legacy sin tocar su código                           | Sí        |
| [`a11y`](#a11y)                                                     | Auditoría y corrección de accesibilidad                     | Sí        |
| [`test`](#test)                                                     | Genera/ejecuta pruebas desde el contrato                    | Opcional  |
| [`version`](#version)                                               | Snapshots, diffs semver y migraciones                       | Opcional  |
| [`doc`](#doc)                                                       | Documentación HTML/MD/JSON/llms.txt/AGENTS.md               | No        |
| [`security`](#security)                                             | Permisos por tool, JWT de agentes                           | No        |
| [`recommend`](#recommend)                                           | Recomendador de tools con historial                         | Opcional  |
| [`web3`](#web3)                                                     | Pagos x402/USDC y billeteras de agente                      | No        |
| [`standard`](#standard)                                             | API declarativa ⇄ `.webmcp.css`, `document.modelContext`    | `check`   |
| [`components`](#components)                                         | Component Hub: list/import/update/demo/publish              | No        |

\* `generate --from-source` y `generate --api` no necesitan navegador.

---

## `generate`

```
webmcpcss generate <url|html|carpeta> [opciones]
```

| Opción                    | Descripción                                                             |
| ------------------------- | ----------------------------------------------------------------------- |
| `-o, --output <file>`     | archivo de salida (por defecto `webmcp.css`)                            |
| `-t, --timeout <seconds>` | segundos máximos de grabación (120)                                     |
| `--auto`                  | escaneo automático headless: formularios, botones y campos              |
| `--from-source`           | analiza componentes React/Vue/Svelte (archivo o carpeta), sin navegador |
| `--api`                   | `.webmcp.css` → JS con `document.modelContext.registerTool()`           |
| `--ai`                    | mejora nombres/descripciones con IA (`WEBMCPCSS_AI_API_KEY`)            |

```bash
webmcpcss generate https://mi-tienda.com -o webmcp.css          # grabación interactiva
webmcpcss generate https://mi-tienda.com --auto -o webmcp.css   # sin grabar
webmcpcss generate ./src --from-source -o webmcp.css            # desde el código
webmcpcss generate --api webmcp.css -o webmcp-tools.js          # código para el navegador
```

Salida: el `.webmcp.css` (y un resumen de herramientas detectadas). Con
`--from-source` avisa qué elementos necesitan `data-tool`.

## `validate`

```
webmcpcss validate <url> <css> [--api] [--save-status [file]] [--graph [file]]
```

Comprueba cada selector en la página real. `--api` añade las herramientas de
`document.modelContext`; `--save-status` escribe `.webmcp-status.json` (lo usa
`graph --with-status`). **Sale con código 1** si algún selector falla.

## `repair`

```
webmcpcss repair <url> <css> [--dry-run] [--graph [file]]
```

Localiza selectores rotos con visión (captura + heurísticas) y reescribe el
archivo; `--dry-run` solo muestra el plan. Código 1 si no puede reparar todo.

## `discover`

```
webmcpcss discover <url>
```

Sin navegador: busca `<meta name="webmcp">`, `<link rel="webmcp">` y
`/.well-known/webmcp.json`. Imprime dónde está el contrato y cuántas tools tiene.

## `parse`

```
webmcpcss parse <css>
```

Imprime el tool map JSON (herramientas, parámetros, contexto, metadatos
`webmcp-*`). Útil para depurar y para pipelines.

## `export`

```
webmcpcss export <css> -f <formato> [-o <dir>] [--url <url>] [--register]
```

Formatos: `mcp-config`, `claude-code`, `cursor`, `deerflow`, `flomny`, `crewai`,
`autogen`, `langgraph`, `browser-inject`, `json-schema`. `--register` (con
`cursor`) añade el servidor a `~/.cursor/mcp.json`. Guías por agente en
[docs/agents/](agents/).

## `mcp`

```
webmcpcss mcp --serve [--css <file>] [--url <url>] [--http] [-p <port>]
              [--no-prompt] [--no-animate] [--flomny]
              [--hub] [--hub-url <url>] [--hub-output <dir>] [--hub-offline]
              [--llm <provider>] [--model <model>] [--llm-base-url <url>]
```

- Por defecto **stdio JSON-RPC** (Claude Desktop/Code, Cursor, Goose…); con
  `--http` expone `GET /api/tools`, `POST /api/call`, `POST /api/tools/:name`
  (puerto 8090).
- `--url` habilita la ejecución real en `tools/call` (navegador).
- `--hub` añade `list_components`, `get_component`, `import_component` y
  `GET /api/components[/:id]`; con `--hub` el `.webmcp.css` es opcional.
- `--flomny` sirve el conjunto dedicado (`list_tools`, `get_tool_info`,
  `get_selector_status`, `suggest_repair`, `execute_prompt`, `apply_animation`).

```bash
webmcpcss mcp --serve --css webmcp.css --url https://mi-tienda.com
webmcpcss mcp --serve --http -p 8090 --hub
```

## `run`

```
webmcpcss run <url> <css> <tool> [--args '<json>']
```

Ejecuta una herramienta y devuelve `{ ok, result, durationMs… }` en JSON.

## `prompt`

```
webmcpcss prompt "<orden>" --url <url> [--css <file>] [--image <f...>] [--file <f...>]
                 [--text <t>] [--execute | --dry-run] [--screenshot <png>]
                 [-o <json>] [--json] [--no-headless] [--llm …] [--model …]
```

Interpreta la orden (heurístico o LLM: `ollama`/`openai`/`anthropic`) y, solo
con `--execute`, la aplica en la página. Sin `--execute` es un _dry-run_.
Guía: [docs/PROMPT.md](PROMPT.md).

## `animate`

```
webmcpcss animate <animation-file> [--url <url>] [--type css|waapi|three]
                  [--conflict-strategy replace|queue|ignore|merge] [--dry-run]
                  [-o <path>] [--screenshot <png>] [--settle <ms>] [--sandbox]
                  [--json] [--no-headless]
```

Con `--url` aplica las animaciones (`webmcp-animation-*`) en la página; **sin
`--url` genera el runtime JS** en la carpeta `-o` para incluirlo en tu sitio.
`--sandbox` aísla en shadow root. Guía: [docs/animation.md](animation.md).

## `validate-conflicts`

```
webmcpcss validate-conflicts <animation-file> --url <url> [--strict] [-o <json>] [--json]
                             [--type …] [--conflict-strategy …] [--sandbox]
```

Simula (sin ejecutar) los conflictos con GSAP/Framer/Anime.js/CSS ya presentes.
`--strict` sale con código 1 si prevé conflictos (ideal en CI).

## `publish`

```
webmcpcss publish <css> -d <dominio> [--token <t>]
```

Valida el archivo y abre un PR a `community-styles/` (fork automático). El token
va en `GITHUB_TOKEN` (recomendado) o `--token`.

## `inject`

```
webmcpcss inject <url> [-d <dir>] [-r <baseUrl>]
```

Auto-descubre el WebMCP del sitio o usa estilos comunitarios (locales o
remotos) y los inyecta como `window.__WEBMCP__` + `<style type="text/webmcp">`.

## `dashboard`

```
webmcpcss dashboard [-p <port>] [-c <css>]
```

Dashboard web (puerto 3000) con herramientas activas, historial y estadísticas.

## `graph`

```
webmcpcss graph <paths...> [-o <json>] [--obsidian <dir>] [--svg <file>] [--dashboard] [-p <port>]
                [--with-status] [--status-file <f>] [--no-fragility] [--framework <fw>]
```

Grafo de conocimiento (Mapas de Contenido): JSON, vault Obsidian, SVG estático
o dashboard Cytoscape (puerto 3100). Guía: [docs/GRAPH.md](GRAPH.md).

## `tailwind`

| Subcomando                                                 | Descripción                                            |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| `tailwind inspect <url> <sel>`                             | clases Tailwind de un elemento agrupadas por categoría |
| `tailwind generate <url> [-o]`                             | herramientas WebMCP de edición Tailwind para la página |
| `tailwind export <url> [--format html\|jsx\|vue\|angular]` | HTML con las clases actuales                           |

Guía: [docs/TAILWIND.md](TAILWIND.md).

## `init`

```
webmcpcss init [dir] [--framework ia-first|minimal] [-n <name>] [--url <url>] [-f] [--json]
```

Crea un proyecto IA-First (HTML + `.webmcp.css` + config MCP +
`.well-known/webmcp.json`).

## `assist`

```
webmcpcss assist "<petición>" [-o <dir>] [--json] [--llm …] [--model …]
```

Genera `component.html` + `component.webmcp.css` a partir de una petición
("crea un formulario de contacto con nombre, email y mensaje").

## `design`

| Subcomando                                                                                                                    | Descripción                                                |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `design analyze --image <png> \| --figma <url> \| --text "<desc>" -o <css> [--scaffold <html>] [--design-json <f>] [--llm …]` | diseño → `.webmcp.css` + andamiaje                         |
| `design validate --design <json> --css <css> --url <url>`                                                                     | compara el contrato del diseño con el sitio real           |
| `design optimize <css> -o <css>`                                                                                              | mejora nombres, descripciones, selectores y confirmaciones |

## `retro`

| Subcomando                                    | Descripción                                           |
| --------------------------------------------- | ----------------------------------------------------- |
| `retro scan <url> [-o <css>] [--json]`        | propone un `.webmcp.css` para un sitio legacy         |
| `retro proxy <url> --css <css> [--port 8080]` | proxy que sirve el sitio con WebMCP inyectado         |
| `retro inject <url> --css <css> [--browser]`  | abre el sitio con `window.__WEBMCP_GRAPH__` inyectado |
| `retro publish <css> --domain <d>`            | publica en el repositorio comunitario                 |

## `a11y`

| Subcomando                                                                        | Descripción                                      |
| --------------------------------------------------------------------------------- | ------------------------------------------------ |
| `a11y audit --url <url> [--min-score <n>] [--fail-on critical\|serious] [--json]` | auditoría WCAG 2.2 AA (subconjunto práctico)     |
| `a11y fix --url <url> -o <css> [--script <js>]`                                   | correcciones declarativas `webmcp-accessibility` |

## `test`

| Subcomando                                                                                       | Descripción                             |
| ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `test generate --file <css> [--framework playwright\|cypress] [--url <u>] [--execute] -o <spec>` | genera la suite                         |
| `test run --url <url> --file <css> [--junit <xml>] [--json]`                                     | ejecuta el plan sin instalar Playwright |

## `version`

| Subcomando                                                        | Descripción                               |
| ----------------------------------------------------------------- | ----------------------------------------- |
| `version snapshot --file <css> [--url <u>] [--tag <v>] -o <json>` | congela el contrato                       |
| `version diff <a> <b> [--json]`                                   | impacto semver + renombres                |
| `version migrate <a> <b> -o <css> [--notes <md>]`                 | plan de migración y `.webmcp.css` migrado |

## `doc`

| Subcomando                                       | Descripción                                                    |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `doc generate --file <css> -o <dir> [--url <u>]` | `index.html`, `README.md`, `doc.json`, `llms.txt`, `AGENTS.md` |
| `doc serve --file <css> [--port 3000]`           | documentación interactiva con recarga                          |

## `security`

| Subcomando                                                                       | Descripción                                   |
| -------------------------------------------------------------------------------- | --------------------------------------------- |
| `security validate --file <css> [--agent "<id:rol:scopes>"] [--strict] [--json]` | audita `webmcp-permissions`/`webmcp-requires` |
| `security token --agent <id> --secret <s> [--expires <s>]`                       | emite un JWT HS256 de prueba                  |

## `recommend`

```
webmcpcss recommend "<objetivo>" [--url <url>] [--css <file>] [--max-steps <n>]
                    [--record] [--outcome ok|fail] [--json] [--llm …]
```

Propone qué herramientas usar (y en qué orden) para un objetivo; aprende del
historial local en `.webmcpcss/`.

## `web3`

| Subcomando                                                                                | Descripción                                   |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| `web3 validate --file <css> [--connector <js>] [--json]`                                  | audita `webmcp-payment/network/amount/pay-to` |
| `web3 balance --address <0x…> --network <red>`                                            | saldo nativo y USDC (requiere `ethers`)       |
| `web3 pay --to <0x…> --amount <n> --currency USDC\|native --network <red> [--max-tx <n>]` | pago on-chain con límites de gasto            |
| `web3 deploy --contract <json> --network <red> [--args …]`                                | despliega o exporta `WebMCPPayments.sol`      |

## `standard`

| Subcomando                                                                           | Descripción                                                  |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `standard scan <html\|url> [-o <css>] [--merge <css>] [--json]`                      | `<form toolname tooldescription …>` → `.webmcp.css`          |
| `standard compile <css> [--html <in>] [-o <out>] [--script <js>] [--force] [--json]` | `.webmcp.css` → atributos declarativos                       |
| `standard check <url> [--json]`                                                      | dónde vive `modelContext` y qué expone la página (navegador) |

Guía: [docs/standard.md](standard.md).

## `components`

```
webmcpcss components list   [--category <cat>] [--library <lib>] [--search <q>] [--json]
webmcpcss components show   <id> [--json]
webmcpcss components import <id...> [--output <dir>] [--merge <css>] [--force] [--json]
webmcpcss components update [id...] [--dry-run] [--merge <css>] [--json]
webmcpcss components demo   [--output <dir>] [--library <lib>] [--ids a,b] [--json]
webmcpcss components publish <css> --name <n> --category <cat> [--library <lib>] [--html <f>]
                              [--description <t>] [--tags a,b] [--dry-run] [--json]
webmcpcss components build  [--check] [--out <dir>] [--base-url <url>]
```

Opciones comunes: `--hub <url>` (o `WEBMCPCSS_HUB_URL`) y `--offline` (catálogo
incluido en el paquete). Categorías: `buttons`, `cards`, `forms`, `layout`,
`animations`, `intelligent`; librerías: `core`, `tailwind`, `bootstrap`, `mui`,
`shadcn`. Guía: [docs/hub.md](hub.md).

---

## Variables de entorno

| Variable                                                                          | Uso                                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GITHUB_TOKEN`                                                                    | `publish`, `retro publish`, `components publish`         |
| `WEBMCPCSS_HUB_URL` / `WEBMCPCSS_HUB_DIR`                                         | URL del hub / carpeta local del catálogo                 |
| `WEBMCPCSS_AI_API_KEY`, `WEBMCPCSS_AI_BASE_URL`, `WEBMCPCSS_AI_MODEL`             | `generate --ai`                                          |
| `WEBMCP_LLM_PROVIDER`, `WEBMCP_OLLAMA_*`, `WEBMCP_OPENAI_*`, `WEBMCP_ANTHROPIC_*` | LLM de `prompt`/`assist`/`recommend`/MCP                 |
| `WEBMCP_JWT_SECRET`                                                               | `security token` / validación Bearer                     |
| `PUPPETEER_SKIP_DOWNLOAD=true`                                                    | instalar sin descargar Chromium (comandos sin navegador) |
| `PUPPETEER_EXECUTABLE_PATH`                                                       | usar un Chrome/Chromium ya instalado en el sistema       |

Plantilla completa en [`.env.example`](../.env.example).
