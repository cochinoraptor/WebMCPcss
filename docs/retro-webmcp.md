# Retro-WebMCP (v1.0.0)

Dota de WebMCP a **sitios legacy** (tablas de maquetación, `<font>`, ASP.NET
WebForms, jQuery 1.x, enlaces `javascript:`) **sin tocar su código**:
un escáner propone el `.webmcp.css`, un proxy de compatibilidad lo sirve
inyectado, un inyector lo carga en el navegador para el agente y el publicador
lo comparte en el repositorio comunitario.

- Código: `src/retro/` (`scanner.ts`, `proxy.ts`, `injector.ts`, `repository.ts`)
- CLI: `webmcpcss retro scan | proxy | inject | publish`
- Ejemplo: [`examples/v1/output/retro/`](../examples/v1/output/retro/) (escaneo del fixture `tests/fixtures/legacy-site.html`)

## 1. `retro scan`: del HTML antiguo al contrato

```bash
webmcpcss retro scan https://tienda-antigua.example -o legacy.webmcp.css
webmcpcss retro scan legacy.html --json              # informe completo
webmcpcss retro scan https://… --llm ollama          # mejora nombres/descripciones con un modelo
```

El escáner:

1. **Detecta señales legacy** y calcula `legacyScore` (0-100): `table-layout`,
   `inline-handlers`, `framesets`, `font-tags`, `no-doctype`, `quirks-charset`,
   `form-without-id`, `name-only-inputs`, `image-buttons`, `javascript-links`,
   `old-jquery`, `asp-webforms`, `no-viewport`.
2. **Extrae formularios y acciones** (botones, `input[type=submit|image]`,
   enlaces con `onclick`/`javascript:`) y propone **selectores estables**
   con esta prioridad: `#id` estable > `data-*` > `[name]` > `[title]` >
   `[href]` (o `href^="javascript:fn"`) > `img[alt]` > texto/`onclick`.
   Los ids de WebForms (`ctl00_…`) y los hashes se descartan.
3. **Genera el tool map**: un `webmcp-tool` por acción con `webmcp-param-*`
   para cada campo del formulario, `webmcp-trigger: "submit" on <form>`,
   `webmcp-fingerprint` (para que `webmcpcss repair` pueda recuperarlo),
   `webmcp-legacy: "true"` y `webmcp-confidence`.
4. Añade **notas** accionables (WebForms → ejecutar `repair` tras cada
   despliegue; frames → ejecutar con el frame como documento; etc.).

Con `--llm`, `enhanceRetroWithLlm` renombra tools genéricas (`comprar` →
`anadirAlCarrito`) y reescribe descripciones; si el modelo responde algo
inválido no se cambia nada.

## 2. `retro proxy`: compatibilidad sin desplegar

```bash
webmcpcss retro proxy https://tienda-antigua.example --css legacy.webmcp.css --port 8080
# → http://localhost:8080 sirve el sitio con WebMCP inyectado
```

El proxy (Node `http` + `zlib`, sin dependencias):

- Reenvía todas las peticiones al origen y **descomprime** gzip/deflate/br
  para poder inyectar en `text/html`; el resto de recursos pasa tal cual.
- Inyecta en `<head>`: `<link rel="webmcp" href="/.webmcp/webmcp.css">`,
  `<meta name="webmcp">` y el script del inyector (ver abajo).
- **Reescribe URLs absolutas** y protocolo-relativas (`https://origen`, `//origen`)
  hacia el proxy, también la cabecera `Location` de las redirecciones.
- Sirve `/.webmcp/webmcp.css`, `/.webmcp/graph.json` y
  `/.well-known/webmcp.json`, de modo que `webmcpcss discover http://localhost:8080`
  encuentra el contrato como si fuera nativo.
- `--no-model-context` desactiva el registro en `navigator.modelContext`.

## 3. `retro inject`: en el navegador del agente

```bash
webmcpcss retro inject https://tienda-antigua.example --css legacy.webmcp.css --json
webmcpcss retro inject https://… --css legacy.webmcp.css --browser   # deja Chrome abierto
```

`buildRetroInjectScript(toolMap, css)` produce una IIFE que:

- define `window.__WEBMCP_GRAPH__` (tools + contexto) y
  `window.__WEBMCP_RETRO__ = { version, injectedAt, run(tool, params), context(), status() }`;
- inserta `<style type="text/webmcp" data-webmcpcss="retro">` con el CSS;
- registra cada tool en `navigator.modelContext.registerTool` si existe;
- es idempotente (una segunda inyección no duplica nada).

`injectRetro(page, toolMap, css)` lo aplica con Puppeteer (también en futuras
navegaciones vía `evaluateOnNewDocument`) y devuelve `{ injected, tools[{name, exists}], missing }`.

## 4. `retro publish`: compartirlo

```bash
webmcpcss retro publish legacy.webmcp.css --domain tienda-antigua.example --dry-run
GITHUB_TOKEN=… webmcpcss retro publish legacy.webmcp.css --domain tienda-antigua.example
```

`prepareRetroSubmission` añade una cabecera de procedencia (fecha, `legacyScore`,
señales) y `publishRetro` reutiliza `publishToCommunity` (fork → rama → commit
en `community-styles/<dominio>.webmcp.css` → PR al upstream). Con `--dry-run`
no se toca la red.

## API

```ts
import { retro } from 'webmcpcss';

const html = await retro.fetchHtml('https://tienda-antigua.example');
const scan = retro.scanLegacyHtml(html, 'https://tienda-antigua.example');
// scan.signals, scan.legacyScore, scan.toolMap, scan.notes

const server = retro.createRetroProxy({ target: 'https://tienda-antigua.example', css });
server.listen(8080);

const script = retro.buildRetroInjectScript(scan.toolMap, css, { highlight: true });
```
