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

`graph.metadata` incluye totales, `statusCounts` y `fragilitySummary`.

## Análisis de fragilidad

`analyzeFragility(selector, framework?)` devuelve `{ level, reasons,
suggestions, frameworks }` con nivel `low` / `medium` / `high`.

| Framework / patrón                             | Ejemplo                       | Nivel     | Por qué                        |
| ---------------------------------------------- | ----------------------------- | --------- | ------------------------------ |
| Vue scoped                                     | `[data-v-7ba5bd90]`           | 🔴 high   | hash regenerado al recompilar  |
| Svelte                                         | `.svelte-1x8r9z2`             | 🔴 high   | hash por build                 |
| Angular                                        | `[_ngcontent-c12]`            | 🔴 high   | encapsulación generada         |
| styled-components                              | `.sc-bdVaJa`                  | 🔴 high   | hash CSS-in-JS                 |
| Emotion                                        | `.css-1q2w3e4`                | 🔴 high   | hash CSS-in-JS                 |
| CSS Modules                                    | `.Button__primary___a3xk9`    | 🔴 high   | hash de compilación            |
| JSS / MUI v4                                   | `.jss42`, `.makeStyles-x-3`   | 🔴 high   | índice por orden de montaje    |
| React useId                                    | `#«r1»`, `#:r0:`              | 🔴 high   | id por sesión/render           |
| Tailwind como selector                         | `.bg-blue-500.px-4`           | 🟡 medium | cambia con cada retoque visual |
| `:nth-child` / cadenas largas / solo etiquetas | `div>ul>li:nth-child(3)`      | 🟡/🔴     | depende de la estructura       |
| MUI v5                                         | `.MuiButton-contained`        | 🟢 low    | estable, acoplado a versión    |
| Ant Design / Bootstrap                         | `.ant-btn`, `.btn-primary`    | 🟢 low    | design system estable          |
| **`#id` semántico / `[data-*]`**               | `#add-to-cart`, `[data-tool]` | 🟢 low    | **lo recomendado**             |

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
├── index.md              # estadísticas + enlaces a todo
├── herramientas/*.md     # frontmatter YAML (type, page, status, fragility, tags)
├── selectores/*.md       # estado, fragilidad, herramientas que lo usan
├── paginas/*.md          # herramientas por página
└── estados/OK.md, Rotos.md
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
OK/roto), clic en nodo → panel de metadatos + resaltado de vecinos, filtros
por tipo y fragilidad, estadísticas y exportación **JSON/PNG**. También
expone `GET /api/graph`.

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
  --no-fragility        desactiva el análisis (activo por defecto)
  --framework <fw>      framework principal (afina sugerencias)
```

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
webmcpcss graph examples/ --obsidian ./docs-vault --output graph.json
webmcpcss graph examples/ --dashboard
```

Ver también `examples/graph-demo/` para un script reproducible.
