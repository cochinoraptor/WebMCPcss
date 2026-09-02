# Demo: Mapas de Contenido (grafo + Obsidian)

Genera el grafo de conocimiento de los ejemplos del repositorio.

```bash
npm run build
node examples/graph-demo/generate-graph.js
```

Produce en esta carpeta (ignorado por git):

- `graph.json` — el grafo (nodos, aristas, metadatos, fragilidad)
- `vault/` — notas Markdown para Obsidian (ábrelo con _Open folder as vault_)
- `graph.html` — visualización interactiva (Cytoscape.js por CDN)

Equivalente con el CLI:

```bash
webmcpcss graph examples/ --output graph.json --obsidian ./vault
webmcpcss graph examples/ --dashboard   # servidor en :3100
```

Más detalles en [docs/GRAPH.md](../../docs/GRAPH.md).
