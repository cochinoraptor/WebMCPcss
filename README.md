# 🛡️ GuardianMCP

> Haz que **cualquier sitio web** sea nativo para agentes de IA — sin tocar su código fuente — y con **auto-reparación** de selectores cuando el sitio se rediseña.

[![CI](https://github.com/guardian-mcp/GuardianMCP/actions/workflows/ci.yml/badge.svg)](https://github.com/guardian-mcp/GuardianMCP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## ¿Qué es GuardianMCP?

GuardianMCP extiende el estándar **WebMCP** con una idea simple: describir las
herramientas que un agente de IA puede usar en una web mediante un archivo
**`.webmcp.css`** — CSS estándar con propiedades personalizadas `webmcp-*`:

```css
/* webmcp.css */
[data-product] .btn-add {
  webmcp-tool: "addToCart";
  webmcp-param-productId: attr(data-product-id);
  webmcp-param-quantity: value(#qty-input);
  webmcp-confirmation: ".cart-badge";
}

.product-price {
  webmcp-context: "price";
  webmcp-format: "currency";
}
```

GuardianMCP lo convierte en un **tool map** JSON que cualquier agente entiende:

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

Los sitios se rediseñan y los selectores se rompen. Cuando eso pasa, Guardian:

1. Detecta que el selector ya no existe.
2. Activa el modo **visión**: busca el elemento por huella (atributos `data-*`,
   texto visible, etiqueta, posición aproximada) entre los candidatos de la página.
3. Infiere un **selector estable nuevo** (prioridad: `data-*` → `id` → `name`/
   `aria-label` → clases estables).
4. Actualiza el tool map en memoria y **reintenta** la acción.

## Instalación

```bash
# Global (CLI)
npm install -g guardian-mcp

# O como dependencia de tu proyecto
npm install guardian-mcp
```

Desde el repositorio:

```bash
git clone https://github.com/guardian-mcp/GuardianMCP.git
cd GuardianMCP
npm install
npm run build
npm link   # opcional: habilita el comando global `guardian`
```

## Uso del CLI

```bash
# 1) Grabar interacciones en un navegador y generar un .webmcp.css
guardian generate https://mi-tienda.com -o webmcp.css

# 2) Validar que los selectores existan en la página
guardian validate https://mi-tienda.com webmcp.css

# 3) Reparar automáticamente los selectores rotos (reescribe el archivo)
guardian repair https://mi-tienda.com webmcp.css

# Extra: parsear a JSON sin navegador, e inyectar estilos comunitarios
guardian parse webmcp.css
guardian inject https://example.com --dir ./community-styles
```

Todos los comandos aceptan URLs `http(s)://`, rutas locales a HTML y `--verbose`.

## Uso como librería (API)

```ts
import puppeteer from 'puppeteer';
import * as fs from 'fs';
import { parseWebMCP, GuardianMCP, PuppeteerAdapter } from 'guardian-mcp';

const toolMap = parseWebMCP(fs.readFileSync('webmcp.css', 'utf8'));

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto('https://mi-tienda.com/producto/123');

const guardian = new GuardianMCP(toolMap, new PuppeteerAdapter(page));

// Ejecutar una herramienta (con auto-reparación transparente)
const result = await guardian.execute('addToCart', { quantity: '2' });
// → { success: true, data: { productId: 'SKU-42', quantity: '2', confirmed: true } }

// Leer contexto
const price = await guardian.getContext('price'); // → "249.900"

await browser.close();
```

¿Sin navegador? `DomAdapter` funciona sobre cualquier `Document` (jsdom, DOM
real en una extensión, etc.).

## Ejemplo paso a paso (2 minutos)

El repo incluye una tienda demo en `examples/shopping-cart/`:

```bash
# Validar el ejemplo contra su HTML local
guardian validate examples/shopping-cart/index.html examples/shopping-cart/webmcp.css

# Romper un selector a propósito y ver la auto-reparación en acción
sed -i 's/.btn-add/.boton-que-no-existe/' examples/shopping-cart/webmcp.css
guardian validate examples/shopping-cart/index.html examples/shopping-cart/webmcp.css  # ✖ roto
guardian repair examples/shopping-cart/index.html examples/shopping-cart/webmcp.css    # ✔ reparado
guardian validate examples/shopping-cart/index.html examples/shopping-cart/webmcp.css  # ✔ OK
```

## Sintaxis `.webmcp.css`

| Propiedad | Descripción | Ejemplo |
|---|---|---|
| `webmcp-tool` | Declara una herramienta sobre el selector de la regla | `webmcp-tool: "addToCart";` |
| `webmcp-param-<nombre>` | Parámetro de la herramienta | `webmcp-param-qty: value(#qty);` |
| `webmcp-trigger` | Evento de disparo (por defecto `click`) | `webmcp-trigger: "submit" on .form;` |
| `webmcp-confirmation` | Selector que debe existir tras la acción | `webmcp-confirmation: ".cart-badge";` |
| `webmcp-description` | Descripción legible | `webmcp-description: "Añade al carrito";` |
| `webmcp-context` | Declara un dato de solo lectura | `webmcp-context: "price";` |
| `webmcp-format` | Formato del contexto (`currency`, `number`, `text`) | `webmcp-format: "currency";` |

Fuentes de parámetros: `attr(nombre-atributo)`, `value(selector?)`, `text(selector?)`, `"literal"`.

## Proxy comunitario

Si un sitio no publica su propio WebMCP, la comunidad puede aportarlo en
[`community-styles/`](community-styles/README.md). El proxy resuelve el
dominio (con cadena de subdominios) e inyecta el tool map en la página como
`window.__WEBMCP__` + `<style type="text/webmcp">`.

```bash
guardian inject https://www.example.com --dir ./community-styles
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
- `src/guardian/` — clase `GuardianMCP`, reparación (`repair.ts`) y visión (`vision.ts`).
- `src/adapters/` — `PageAdapter` (interfaz), `PuppeteerAdapter`, `DomAdapter`.
- `src/proxy/` — proxy comunitario e inyección de estilos.
- `src/cli.ts` — comandos `generate`, `validate`, `repair`, `inject`, `parse`.

## Contribuir

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md)
para las normas de estilo, el proceso de PR y cómo aportar estilos
comunitarios.

## Licencia

[MIT](LICENSE) © GuardianMCP Contributors
