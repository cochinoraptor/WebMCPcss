# 🌍 Community Styles

Repositorio comunitario de archivos `.webmcp.css` para sitios web populares.
Si un sitio no publica su propio WebMCP, ¡la comunidad puede hacerlo por él!

## ¿Cómo funciona?

El proxy comunitario de WebMCPcss busca aquí un archivo para el dominio que
estás visitando y lo inyecta en la página, exponiendo las herramientas al
agente de IA vía `window.__WEBMCP__`.

Orden de resolución para `shop.eu.example.com`:

1. `community-styles/shop.eu.example.com.webmcp.css`
2. `community-styles/shop.eu.example.com/webmcp.css`
3. `community-styles/eu.example.com.webmcp.css` (y así subiendo por la cadena)
4. `community-styles/example.com.webmcp.css`

## Cómo contribuir un estilo

1. Crea un archivo llamado `<dominio>.webmcp.css` (sin `www.`, en minúsculas).
   Ejemplo: `amazon.com.webmcp.css`.
2. Declara las herramientas con propiedades `webmcp-*`:

   ```css
   /* @validate-url: https://example.com  (opcional: URL para validación en CI) */
   #search-input {
     webmcp-tool: "search";
     webmcp-description: "Busca productos en el sitio";
     webmcp-param-query: value();
     webmcp-trigger: "submit" on form[role="search"];
   }
   ```

3. Verifica localmente antes de abrir el PR:

   ```bash
   npx webmcpcss parse community-styles/tudominio.com.webmcp.css
   npx webmcpcss validate https://tudominio.com community-styles/tudominio.com.webmcp.css
   ```

4. Abre un Pull Request. El CI parseará tu archivo y, si incluiste el
   comentario `@validate-url`, validará los selectores con Puppeteer.

## Buenas prácticas

- **Prefiere selectores estables**: atributos `data-*`, IDs semánticos o
  `aria-label`. Evita clases autogeneradas (`css-1x2y3z`).
- **Documenta cada herramienta** con `webmcp-description`.
- **No incluyas herramientas destructivas** (borrar cuenta, pagos) sin
  `webmcp-confirmation`.
- Un archivo por dominio. Para variantes regionales usa la cadena de dominios.
