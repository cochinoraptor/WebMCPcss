# 🛡️ WebMCPcss

> Haz que **cualquier sitio web** sea nativo para agentes de IA — sin tocar su código fuente — y con **auto-reparación** de selectores cuando el sitio se rediseña.

[![CI](https://github.com/cochinoraptor/WebMCPcss/actions/workflows/ci.yml/badge.svg)](https://github.com/cochinoraptor/WebMCPcss/actions/workflows/ci.yml)
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
webmcpcss validate https://mi-tienda.com webmcp.css --api   # + herramientas de navigator.modelContext

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
webmcpcss graph examples/ --obsidian ./vault --output graph.json
webmcpcss graph examples/ --dashboard                          # Cytoscape en :3100
webmcpcss validate https://mi-tienda.com webmcp.css --save-status --graph

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

## Integración con el estándar WebMCP (navigator.modelContext)

WebMCPcss es un **puente bidireccional** con la API imperativa de WebMCP que
está llegando a Chrome:

**CSS → API:** genera el código `registerTool()` desde tu `.webmcp.css`:

```bash
webmcpcss generate --api webmcp.css -o webmcp-tools.js
# luego en tu sitio: <script src="webmcp-tools.js"></script>
```

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

Documentación completa en [docs/GRAPH.md](docs/GRAPH.md); demo en
`examples/graph-demo/`.

## Proxy comunitario

Si un sitio no publica su propio WebMCP, la comunidad puede aportarlo en
[`community-styles/`](community-styles/README.md). El proxy resuelve el
dominio (con cadena de subdominios) e inyecta el tool map en la página como
`window.__WEBMCP__` + `<style type="text/webmcp">`.

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
- `src/cli.ts` — comandos `generate`, `validate`, `repair`, `inject`, `parse`.

## Contribuir

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md)
para las normas de estilo, el proceso de PR y cómo aportar estilos
comunitarios.

## Licencia

[MIT](LICENSE) © WebMCPcss Contributors
