# Agentes de navegador (Atlas, Operator, Mariner, Comet, Skyvern...)

Los agentes que controlan un navegador no necesitan servidor: se les inyecta
un script que publica el mapa de herramientas en la propia página.

```bash
webmcpcss export tienda.webmcp.css --format browser-inject -o ./inject --url https://tienda.com
```

Genera `webmcp-inject.js` (IIFE sin dependencias) que:

1. Expone `window.__WEBMCP_GRAPH__` con nombre, descripción, selector y
   parámetros de cada herramienta.
2. Si existe `navigator.modelContext` (API WebMCP nativa), registra además
   las herramientas con `registerTool`.

## Cómo inyectarlo

**Puppeteer / Playwright** (Skyvern, Browser Use, Stagehand...):

```js
const script = fs.readFileSync('inject/webmcp-inject.js', 'utf8');
await page.evaluate(script); // página ya cargada
await page.evaluateOnNewDocument(script); // o en cada navegación
const graph = await page.evaluate(() => window.__WEBMCP_GRAPH__);
```

**Extensión Chrome / chrome.debugger** (Atlas, Operator, Mariner, Comet):
usa `Runtime.evaluate` con el contenido del script, o cárgalo como
userscript (Tampermonkey) con `@match` del dominio.

## Qué gana el agente

En lugar de "mirar" la página con visión, consulta el grafo:

```js
const tool = window.__WEBMCP_GRAPH__.tools.find((t) => t.name === 'addToCart');
document.querySelector(tool.selector).click(); // preciso y determinista
```

Ejemplo generado: [`examples/agents/browser-inject/`](../../examples/agents/browser-inject/).
