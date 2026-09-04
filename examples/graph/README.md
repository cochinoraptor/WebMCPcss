# Ejemplo: Mapas de Contenido (grafo, fragilidad y vault Obsidian)

Salida **de referencia** del comando `webmcpcss graph` (v0.9.0) sobre tres
sitios ficticios con distintos frameworks, incluida en el repositorio para
que puedas ver el resultado sin ejecutar nada:

```
examples/graph/
├── src/
│   ├── tienda.webmcp.css       # selectores estables (data-tool, #id, aria-label)
│   ├── panel-next.webmcp.css   # Next.js (CSS Modules) + MUI v5
│   ├── blog-vue.webmcp.css     # Vue scoped + Element Plus + styled-components
│   └── status.json             # resultado de `validate --save-status` (simulado)
├── graph.json                  # grafo: nodos, aristas, fragilidad, frameworkSummary, statusCounts
├── graph.svg                   # grafo estático (--svg, sin navegador)
├── vault/                      # vault de Obsidian (32 notas con frontmatter y backlinks)
│   ├── index.md
│   ├── herramientas/*.md
│   ├── selectores/*.md
│   ├── paginas/*.md
│   └── estados/{OK,Roto}.md
└── regen.sh                    # regenera todo lo anterior
```

## Cómo se generó

```bash
npm run build
bash examples/graph/regen.sh
# equivale a:
webmcpcss graph examples/graph/src --fragility \
  --status-file examples/graph/src/status.json \
  --output examples/graph/graph.json \
  --svg examples/graph/graph.svg \
  --obsidian examples/graph/vault
```

Resumen que imprime el comando:

```
Grafo: 39 nodos, 60 aristas (13 herramientas, 13 selectores, 3 páginas)
Fragilidad: 🟢 7 · 🟡 1 · 🔴 5
Estado: ✔ 9 · ✖ 4
Frameworks detectados: MUI v5 (3) · Element Plus (2) · CSS Modules (Next.js) (2) · Vue (scoped) (1) · styled-components (1)
```

| Selector                                             | Nivel     | Framework             | Sugerencia principal                           |
| ---------------------------------------------------- | --------- | --------------------- | ---------------------------------------------- |
| `[data-tool="add-to-cart"]`, `#checkout-button`      | 🟢 low    | —                     | patrón ideal                                   |
| `.MuiChip-label`                                     | 🟢 low    | MUI v5                | estable; añade `data-testid` para desacoplarte |
| `.MuiTabs-root .MuiTab-root:nth-child(3)`            | 🟡 medium | MUI v5                | sustituye `:nth-child` por id/data-*           |
| `.Dashboard_saveButton__3xK9z`                       | 🔴 high   | CSS Modules (Next.js) | añade `data-tool` en el JSX                    |
| `.comment-form[data-v-7ba5bd90] .el-button--primary` | 🔴 high   | Vue (scoped)          | `data-tool` en el componente                   |
| `.sc-bdVaJa.sc-htpNat`                               | 🔴 high   | styled-components     | pasa `data-tool` como prop                     |
| `main > article > div:nth-of-type(2) > button`       | 🔴 high   | —                     | identificador propio + `webmcp-fingerprint`    |

## Explorar el vault

Abre `examples/graph/vault` en Obsidian con **Open folder as vault**. Cada
nota lleva frontmatter (`type`, `name`, `page`, `status`, `selectors`,
`params`, `fragility`, `framework`, `suggestions`, `tags`), así que puedes
usar Dataview o la búsqueda nativa:

```
tag:#broken            → herramientas rotas
["fragility": high]    → selectores frágiles
tag:#css-modules       → todo lo generado por CSS Modules
```

`index.md` enlaza páginas, herramientas, selectores y la tabla de frameworks;
los nodos `estados/OK.md` y `estados/Roto.md` agrupan las herramientas por
resultado de validación. El **Graph view** de Obsidian reproduce el mismo
grafo que `graph.svg` gracias a los backlinks `[[…]]`.

## Dashboard interactivo

```bash
webmcpcss graph examples/graph/src --status-file examples/graph/src/status.json --dashboard
```

Sirve en `http://localhost:3100` un dashboard Cytoscape.js con filtros por
**estado**, **fragilidad**, **página** y **framework**, panel de estadísticas
y exportación a PNG/SVG/JSON (`/api/graph`, `/api/graph.svg`).

Documentación: [docs/GRAPH.md](../../docs/GRAPH.md).
