# Mapas de Contenido: grafo, Obsidian y fragilidad

El módulo `src/graph/` convierte tus archivos `.webmcp.css` en un **grafo de
conocimiento navegable**: qué herramientas existen, qué selectores usan, en
qué páginas viven, qué estado tienen y **cuán frágiles son sus selectores**
según el framework del sitio.

## Sin dependencias nuevas (decisión de diseño)

- Escritura de archivos con `fs` nativo (no `fs-extra`).
- Notas Markdown con template literals (no Handlebars).
- Cytoscape.js se carga **desde CDN** en el HTML del dashboard (no se añade
  a npm).

Coherente con el resto de WebMCPcss: cero dependencias añadidas.

## El grafo

```ts
import { buildGraph, parseWebMCPFile } from 'webmcpcss';

const graph = buildGraph(
  [{ path: 'webmcp.css', toolMap: parseWebMCPFile('webmcp.css') }],
  statusResults, // opcional: ValidationReport de validate --save-status
  { fragility: true, framework: 'vue' },
);
```

**Nodos** (`tool`, `selector`, `param`, `page`, `status`) y **aristas**:

| Arista                            | Significado                              |
| --------------------------------- | ---------------------------------------- |
| `tool —uses→ selector`            | la herramienta actúa sobre ese selector  |
| `tool —requires→ param`           | parámetro de la herramienta              |
| `tool/selector —belongs-to→ page` | página (derivada de la ruta del archivo) |
| `tool —has-status→ status`        | OK/roto según `validate`                 |
| `tool —shares-selector→ tool`     | dos herramientas usan el mismo selector  |

`graph.metadata` incluye totales, `statusCounts`, `fragilitySummary` y
`frameworkSummary` (selectores por framework detectado, v0.9.0).

## Análisis de fragilidad

`analyzeFragility(selector, framework?)` devuelve `{ level, reasons,
suggestions, frameworks, framework? }` con nivel `low` / `medium` / `high`.
`framework` (v0.9.0) es el framework principal detectado (alias de
`frameworks[0]`); `summarizeFrameworks(scores)` agrega una lista de
puntuaciones en `{ framework: nºselectores }`.

| Framework / patrón                             | Ejemplo                                       | Nivel     | Por qué                        |
| ---------------------------------------------- | --------------------------------------------- | --------- | ------------------------------ |
| Vue scoped                                     | `[data-v-7ba5bd90]`                           | 🔴 high   | hash regenerado al recompilar  |
| Svelte                                         | `.svelte-1x8r9z2`                             | 🔴 high   | hash por build                 |
| Angular                                        | `[_ngcontent-c12]`                            | 🔴 high   | encapsulación generada         |
| styled-components                              | `.sc-bdVaJa`                                  | 🔴 high   | hash CSS-in-JS                 |
| Emotion                                        | `.css-1q2w3e4`                                | 🔴 high   | hash CSS-in-JS                 |
| CSS Modules                                    | `.Button__primary___a3xk9`                    | 🔴 high   | hash de compilación            |
| CSS Modules (Next.js)                          | `.styles_button__3xK9z`                       | 🔴 high   | `nombre_local__hash` por build |
| CSS Modules (Vite/Astro)                       | `._button_1x9j8k`                             | 🔴 high   | `_local_hash` por build        |
| Astro                                          | `.astro-J7PV25F6`                             | 🔴 high   | `data-astro-cid-*` por build   |
| JSS / MUI v4                                   | `.jss42`, `.makeStyles-x-3`                   | 🔴 high   | índice por orden de montaje    |
| React useId                                    | `#«r1»`, `#:r0:`                              | 🔴 high   | id por sesión/render           |
| Tailwind como selector                         | `.bg-blue-500.px-4`                           | 🟡 medium | cambia con cada retoque visual |
| `:nth-child` / cadenas largas / solo etiquetas | `div>ul>li:nth-child(3)`                      | 🟡/🔴     | depende de la estructura       |
| MUI v5                                         | `.MuiButton-contained`, `.Mui-selected`       | 🟢 low    | estable, acoplado a versión    |
| Ant Design / Element Plus / Bootstrap          | `.ant-btn`, `.el-button`, `.btn-primary`      | 🟢 low    | design system estable          |
| **`#id` semántico / `[data-*]` / `[aria-*]`**  | `#add-to-cart`, `[data-tool]`, `[aria-label]` | 🟢 low    | **lo recomendado**             |

Cada nivel medio/alto incluye **sugerencias de migración** concretas por
framework (p. ej. «pasa una prop `data-tool` al styled component») y, en
nivel `high`, recuerda definir `webmcp-fingerprint` para que
`webmcpcss repair` pueda re-localizar el elemento mientras migras.

## Exportación a Obsidian

```bash
webmcpcss graph examples/shopping-cart/webmcp.css --obsidian ./vault
```

Genera:

```
vault/
├── index.md              # estadísticas + frameworks detectados + enlaces a todo
├── herramientas/*.md     # frontmatter YAML (type, name, page, status, selectors,
│                         #   params, fragility, framework, suggestions, tags)
├── selectores/*.md       # fragilidad, framework, sugerencias, herramientas que lo usan
├── paginas/*.md          # herramientas por página
└── estados/OK.md, Rotos.md
```

Ejemplo de frontmatter de una herramienta (v0.9.0):

```yaml
---
type: tool
name: 'nextBuy'
page: 'checkout'
status: broken
selectors:
  - '.styles_button__3xK9z'
params: []
fragility: high
framework: 'CSS Modules (Next.js)'
suggestions:
  - 'El sufijo __hash de Next.js cambia por build: añade `data-tool` en el JSX…'
tags: [webmcp, tool, broken, css-modules]
---
```

- Backlinks `[[...]]` generados desde las aristas del grafo.
- Nombres de archivo sanitizados (válidos en Windows/Linux/macOS; los
  caracteres `# . [ ] > < : " / \ | ? *` se reemplazan).
- Abre la carpeta en Obsidian con **"Open folder as vault"** y usa la vista
  de grafo nativa de Obsidian sobre las notas.

## Dashboard interactivo

```bash
webmcpcss graph community-styles/ --dashboard          # http://localhost:3100
webmcpcss graph webmcp.css                             # → webmcp-graph.html estático
```

HTML autónomo con Cytoscape.js (CDN): colores por tipo (herramienta=azul,
selector=verde/amarillo/rojo según fragilidad, página=naranja, estado
OK/roto), clic en nodo → panel de metadatos + resaltado de vecinos.

Filtros (v0.9.0): por **tipo**, **estado** (solo OK / solo rotos; se aplica a
herramientas, selectores y parámetros según el estado de su herramienta),
**fragilidad**, **página** y **framework detectado**. Panel «Frameworks
detectados» con el recuento de selectores por framework y exportación
**JSON / PNG / SVG** (el SVG se construye a partir del layout actual, sin
extensiones de Cytoscape). El servidor expone `GET /api/graph` y
`GET /api/graph.svg`.

Desde Node, `buildGraphSvg(graph)` genera un SVG estático sin navegador
(layout circular por capas) — es lo que usa `graph --svg <file>`.

## CLI completo

```bash
webmcpcss graph <paths...> [opciones]

  <paths...>            archivos .webmcp.css o carpetas (recursivo)
  --obsidian <dir>      exporta el vault de Obsidian
  -o, --output <file>   guarda el grafo en JSON
  --dashboard           sirve el dashboard interactivo
  -p, --port <port>     puerto del dashboard (def. 3100)
  --with-status         usa .webmcp-status.json si existe
  --status-file <file>  archivo de estado alternativo
  --fragility           análisis de fragilidad (activo por defecto)
  --no-fragility        desactiva el análisis
  --svg <file>          exporta el grafo como SVG estático (sin navegador)
  --framework <fw>      framework principal (afina sugerencias)
```

En consola, `graph` imprime además la línea «Frameworks detectados» con el
recuento por framework.

### Integración con validate y repair

```bash
# Guarda el reporte para reutilizarlo en el grafo
webmcpcss validate https://mi-tienda.com webmcp.css --save-status

# Grafo con estado (ideal para CI/CD)
webmcpcss graph . --output graph.json --with-status

# validate/repair pueden regenerar el grafo directamente
webmcpcss validate https://mi-tienda.com webmcp.css --graph
webmcpcss repair  https://mi-tienda.com webmcp.css --graph
```

Tras `repair --graph`, las herramientas reparadas se marcan OK en el grafo.

## Ejemplo completo

```bash
webmcpcss graph examples/ --obsidian ./docs-vault --output graph.json --svg graph.svg
webmcpcss graph examples/ --dashboard
```

Ver también `examples/graph/` (salida Obsidian de referencia, versionada) y
`examples/graph-demo/` (script reproducible).
