# Textos de anuncio — webmcpcss v0.6.x

Borradores listos para pegar. Ajusta el tono a tu gusto.

## X / Twitter (español)

> 🚀 Publiqué webmcpcss en npm: convierte CUALQUIER web en herramientas para
> agentes IA con un archivo CSS.
>
> ✅ Generación automática (sin grabar nada)
> ✅ Servidor MCP para Claude/Cursor
> ✅ Exporta a CrewAI, AutoGen, LangGraph…
> ✅ Auto-repara selectores rotos
>
> npm i -g webmcpcss
> https://github.com/cochinoraptor/WebMCPcss

## X / Twitter (inglés)

> 🚀 Just shipped webmcpcss on npm: turn ANY website into AI-agent tools
> using a plain CSS file.
>
> ✅ Auto-generation (headless scan, no recording)
> ✅ Real MCP server for Claude/Cursor
> ✅ Exports to CrewAI, AutoGen, LangGraph…
> ✅ Self-healing selectors
>
> npm i -g webmcpcss
> https://github.com/cochinoraptor/WebMCPcss

## Reddit (r/LocalLLaMA, r/AI_Agents, r/mcp) — inglés

**Title:** webmcpcss — declare AI-agent tools for any website in a CSS file (MCP server + 8 exporters included)

**Body:**

I've been building an open-source tool that extends the WebMCP idea: you
describe the tools an AI agent can use on a website in a `.webmcp.css` file
(standard CSS with `webmcp-*` properties mapping selectors to actions like
`addToCart` or `login`). No permission from the target site needed.

What it does today (v0.6):

- `webmcpcss generate <url> --auto` — headless scan that detects forms,
  buttons and inputs, infers tool names, picks stable selectors
  (`data-*` → `id` → `name`), and detects the framework (React, Vue,
  Svelte, Angular, Tailwind…).
- `webmcpcss mcp --serve` — a real MCP server (stdio JSON-RPC) so Claude
  Desktop/Code, Cursor, Goose etc. can list AND execute the tools (it
  drives a headless browser). Also an HTTP REST mode.
- `webmcpcss export --format …` — 8 exporters: Claude Code plugin, Cursor
  config, CrewAI/AutoGen/LangGraph Python modules, browser-inject script
  (`window.__WEBMCP_GRAPH__`) for Atlas/Operator-style agents, generic
  JSON Schema.
- Self-healing: when a site redesign breaks a selector, `repair` finds the
  element again by fingerprint (text, attributes, tag) and rewrites the file.
- Knowledge graph + Obsidian export + selector fragility analysis
  (CSS-Modules hashes, Vue scoped attrs, etc.).

MIT, TypeScript, Node 18+, zero paid dependencies. 180+ tests.

`npm i -g webmcpcss` · GitHub: https://github.com/cochinoraptor/WebMCPcss

Feedback and community `.webmcp.css` contributions very welcome — there's a
`community-styles/` directory for popular sites.

## Hacker News (Show HN) — inglés

**Title:** Show HN: Webmcpcss – declare AI-agent tools for any website in a CSS file

**Text:**

CSS selectors are already the language we use to point at things on a page,
so webmcpcss uses CSS itself as the declaration format for agent tools: a
`.webmcp.css` file maps selectors to structured actions
(`webmcp-tool: "addToCart"; webmcp-param-quantity: value(#qty)`).

From that single file you get: an MCP server agents can call (with real
execution through a headless browser), exporters for CrewAI / AutoGen /
LangGraph / Claude Code / Cursor, a browser-injection script for
computer-use agents, and self-healing when selectors break after a
redesign.

It can also bootstrap the file for you: `webmcpcss generate <url> --auto`
scans the page and writes a first draft with stable selectors.

MIT, TypeScript, no paid deps. I'd love feedback on the format itself —
especially from people building agents that browse the web.

https://github.com/cochinoraptor/WebMCPcss
