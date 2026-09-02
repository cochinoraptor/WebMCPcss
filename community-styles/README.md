# 🌍 Community Styles

Repositorio comunitario de archivos `.webmcp.css` para sitios web populares.
Si un sitio no publica su propio WebMCP, ¡la comunidad puede hacerlo por él!

## Estilos disponibles

| Dominio                                                 | Herramientas                                                                 | Validación CI     |
| ------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------- |
| [wikipedia.org](wikipedia.org.webmcp.css)               | `search`, `setSearchLanguage` + contexto `siteTitle`                         | ✅ automática     |
| [en.wikipedia.org](en.wikipedia.org.webmcp.css)         | `search`, `openLanguageMenu` + contexto `articleTitle`                       | ✅ automática     |
| [news.ycombinator.com](news.ycombinator.com.webmcp.css) | `search`, `goToNewest`, `goToSubmit`, `goToLogin` + contexto `topStoryTitle` | ✅ automática     |
| [mercadolibre.com.co](mercadolibre.com.co.webmcp.css)   | `search`, `submitSearch`                                                     | manual (anti-bot) |
| [example.com](example.com.webmcp.css)                   | plantilla de ejemplo                                                         | —                 |

El índice completo, siempre al día, está en [`index.json`](index.json).

## Consumo por agentes (sin clonar el repo)

Un agente puede descubrir y usar las definiciones con dos peticiones HTTP:

```bash
# 1. ¿Qué dominios tienen definición?
curl -s https://raw.githubusercontent.com/cochinoraptor/WebMCPcss/main/community-styles/index.json

# 2. Descargar la del dominio que interesa
curl -s https://raw.githubusercontent.com/cochinoraptor/WebMCPcss/main/community-styles/wikipedia.org.webmcp.css
```

Y con el CLI, todo junto:

```bash
webmcpcss run https://www.wikipedia.org community-styles/wikipedia.org.webmcp.css search --args '{"query":"WebMCP"}'
```

## ¿Cómo funciona?

El proxy comunitario de WebMCPcss busca aquí un archivo para el dominio que
estás visitando y lo inyecta en la página, exponiendo las herramientas al
agente de IA vía `window.__WEBMCP__`.

Orden de resolución para `shop.eu.example.com`:

1. `community-styles/shop.eu.example.com.webmcp.css`
2. `community-styles/shop.eu.example.com/webmcp.css`
3. `community-styles/eu.example.com.webmcp.css` (y así subiendo por la cadena)
4. `community-styles/example.com.webmcp.css`

Gracias a la cadena, `wikipedia.org.webmcp.css` también aplica a
`en.wikipedia.org`, `es.wikipedia.org`, etc.

## Cómo contribuir un estilo

La vía rápida (fork + PR automáticos):

```bash
webmcpcss generate https://tudominio.com --auto -o tudominio.com.webmcp.css
webmcpcss validate https://tudominio.com tudominio.com.webmcp.css
webmcpcss publish tudominio.com.webmcp.css --domain tudominio.com --token ghp_xxx
```

O manualmente:

1. Crea un archivo llamado `<dominio>.webmcp.css` (sin `www.`, en minúsculas).
   Ejemplo: `amazon.com.webmcp.css`.
2. Declara las herramientas con propiedades `webmcp-*`:

   ```css
   /* @validate-url: https://example.com  (opcional: URL para validación en CI) */
   #search-input {
     webmcp-tool: 'search';
     webmcp-description: 'Busca productos en el sitio';
     webmcp-param-query: value();
     webmcp-trigger: 'submit' on form[role= 'search'];
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
