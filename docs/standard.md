# Alineación con el estándar WebMCP (desde v1.1.0)

WebMCPcss **extiende** WebMCP, no lo sustituye. Esta guía explica cómo, desde
la versión 1.1.0, WebMCPcss sigue el borrador actual del estándar (W3C WebML
Community Group, impulsado por Google y Microsoft) en sus dos puntos más
visibles:

1. La API imperativa vive en **`document.modelContext`** (antes
   `navigator.modelContext`).
2. La **API declarativa**: formularios anotados con `toolname`,
   `tooldescription`, `toolautosubmit`, `toolparamtitle` y
   `toolparamdescription`, de los que el navegador deriva el JSON Schema.

- Código: `src/standard/` (`model-context.ts`, `declarative.ts`)
- CLI: `webmcpcss standard scan | compile | check`
- API: `import { standard } from 'webmcpcss'`
- Tests: `tests/standard.test.ts`

## 1. `document.modelContext` con fallback

El borrador de mayo–julio de 2026 movió el getter de `navigator` a `document`
(un documento, no un contexto de navegación, es quien registra herramientas).
Chromium 150 mantiene `navigator.modelContext` como **alias obsoleto** con
aviso en consola y lo eliminará. El patrón recomendado es:

```js
const mc = document.modelContext || navigator.modelContext;
if (mc) mc.registerTool({ name, description, inputSchema, execute });
```

Todo lo que WebMCPcss genera o ejecuta en el navegador usa ese patrón:

| Dónde                                            | Qué cambia en 1.1.0                                                                                              |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `generate --api` (`webmcp-tools.js`)             | Registra en `document.modelContext` con fallback; mensaje claro si no hay API                                    |
| `export --format browser-inject`                 | Idem                                                                                                             |
| `retro inject` / `retro proxy`                   | Idem                                                                                                             |
| `tailwind generate` (`my-tools.js`)              | Idem                                                                                                             |
| `WebMCPApiAdapter` / `validate --api` / `mcp`    | El shim detecta la API nativa en `document` **o** `navigator`, la espeja en ambas y, si no existe, la polyfillea |
| `WebMCPcss.execute()` (via `api`)                | Busca la herramienta en la ubicación canónica                                                                    |
| Código nuevo con `standard.getModelContext(win)` | Devuelve la API esté donde esté; `standard.modelContextLocation(win)` → `'document' \| 'navigator' \| 'none'`    |

La expresión exacta que se inyecta (`standard.MODEL_CONTEXT_EXPR`) es ES5 puro,
así que funciona también en los navegadores antiguos a los que apunta
Retro-WebMCP.

### Comprobar una página: `standard check`

```bash
webmcpcss standard check https://mi-tienda.com
webmcpcss standard check ./index.html --json
```

Informa de:

- `nativeLocation`: dónde expone el navegador la API (`document`, solo el alias
  `navigator`, o `none`, que es lo normal fuera de Chrome 146+ con WebMCP).
- `imperativeTools`: herramientas que la página registró con `registerTool()` /
  `provideContext()` (capturadas con el shim de WebMCPcss aunque el navegador
  no tenga la API).
- `declarativeTools`: formularios con `toolname` + `tooldescription`.
- `warnings`: p. ej. scripts inline que usan `navigator.modelContext` **sin** el
  nombre canónico.
- `agentReady`: `true` si la página expone al menos una herramienta.

## 2. API declarativa ⇄ `.webmcp.css`

La API declarativa cubre el caso más común —un formulario— sin JavaScript:

```html
<form
  id="search"
  action="/search"
  toolname="searchProducts"
  tooldescription="Busca productos en el catálogo"
  toolautosubmit
>
  <label for="q">Buscar</label>
  <input
    id="q"
    name="q"
    type="search"
    required
    toolparamdescription="Palabras clave del producto"
  />
  <select name="cat" toolparamtitle="category">
    <option value="all">Todas</option>
    <option value="shoes">Zapatos</option>
  </select>
  <button type="submit">Buscar</button>
</form>
```

Reglas del estándar que WebMCPcss respeta:

- `toolname` **y** `tooldescription` son obligatorios; si falta uno, el navegador
  no registra la herramienta y WebMCPcss emite un aviso (y tampoco la genera).
- `toolparamtitle` es la clave de la propiedad en el JSON Schema; si falta se usa
  `name` (y después `id`, el texto del `<label>` normalizado o `paramN`).
- `toolparamdescription` es la descripción; si falta se toma del `<label>`
  asociado, del `placeholder` o de `aria-label`.
- `required` marca el parámetro como requerido; las `<option>` de un `<select>`
  se convierten en `enum`.
- `toolautosubmit` permite al agente enviar el formulario sin intervención; sin
  él, WebMCPcss lo traduce como `webmcp-confirmation: needed`.

### Atributos → contrato: `standard scan`

```bash
webmcpcss standard scan index.html -o webmcp.css
webmcpcss standard scan https://mi-tienda.com --merge webmcp.css -o webmcp.css   # el CSS existente gana
webmcpcss standard scan index.html --json
```

Salida para el formulario anterior:

```css
#search button[type='submit'] {
  webmcp-tool: 'searchProducts';
  webmcp-description: 'Busca productos en el catálogo';
  webmcp-param-q: value(#q);
  webmcp-param-category: value(#search select[name= 'cat']);
  webmcp-trigger: 'submit' on #search;
  webmcp-source: 'declarative';
  webmcp-intent: 'submit';
  webmcp-autosubmit: 'true';
  webmcp-doc-q: 'Palabras clave del producto';
}
```

La propiedad **`webmcp-doc-<param>`** (nueva en 1.1.0) conserva la
`toolparamdescription` de cada parámetro; `generate --api` la usa como
`description` en el `inputSchema`, así que el round-trip HTML → CSS → JS no
pierde documentación.

`generate --auto` y `retro scan` ejecutan la misma extracción: los formularios
ya anotados sustituyen a la herramienta que se habría inferido para ellos
(`webmcp-source: 'declarative'`) y el resto de la página se sigue infiriendo
como siempre.

### Contrato → atributos: `standard compile`

```bash
# Anota el HTML (respeta los atributos ya presentes salvo --force)
webmcpcss standard compile webmcp.css --html index.html -o index.webmcp.html

# Parche JSON (para tu propio build)
webmcpcss standard compile webmcp.css -o declarative.json

# Script que aplica los atributos al cargar la página (sitios que no puedes tocar)
webmcpcss standard compile webmcp.css --script webmcp-declarative.js
```

Solo las herramientas que envían un formulario (`webmcp-trigger: 'submit' on
<form>`, o cuyo selector es un `<form>` / botón de envío) tienen equivalente
declarativo. Las demás (`click` en un botón suelto, parámetros de solo lectura
como `attr()`/`text()`) se listan en `imperativeOnly` / `skipped` y siguen
cubiertas por `generate --api`. Ambas capas conviven: el estándar permite mezclar
formularios declarativos y `registerTool()` en la misma página.

> **Ojo:** `provideContext()` sustituye **todas** las herramientas registradas,
> incluidas las declarativas. El código que genera WebMCPcss usa `registerTool()`
> una por una precisamente para no pisar los formularios anotados.

## API

```ts
import { standard } from 'webmcpcss';

// Ubicación de la API
standard.MODEL_CONTEXT_CANONICAL; // 'document.modelContext'
standard.getModelContext(window); // API nativa o undefined
standard.modelContextLocation(window); // 'document' | 'navigator' | 'none'

// HTML → herramientas declarativas → ToolMap
const scan = standard.extractDeclarativeTools(html); // { tools, warnings }
const toolMap = standard.declarativeToolsToToolMap(scan.tools, baseToolMap?);

// ToolMap → atributos declarativos
const compilation = standard.toolMapToDeclarative(toolMap); // { patches, imperativeOnly }
const { html: annotated, applied, notFound, fieldsNotFound } = standard.applyDeclarativeToHtml(html, compilation);
const script = standard.buildDeclarativeRuntimeScript(compilation); // IIFE para el navegador
```

`extractDeclarativeToolsFromDocument(document)` es la variante autocontenida
para `page.evaluate()` (es la que usan `generate --auto` y `standard check`).

## Compatibilidad

- **Contratos existentes:** ningún cambio necesario. `.webmcp.css` anteriores se
  parsean igual; `webmcp-doc-*` y `webmcp-source` son metadatos opcionales.
- **Código generado antes de 1.1.0:** sigue funcionando mientras Chromium
  mantenga el alias; regenera con `generate --api` para eliminar el aviso de
  obsolescencia.
- **Tests antiguos** que buscan `navigator.modelContext` en el código generado
  siguen pasando: la expresión incluye ambos nombres.
