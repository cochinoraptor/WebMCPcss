# Obsidian (documentación viva para humanos y agentes)

El módulo de grafo exporta el tool map como bóveda Markdown con frontmatter
y backlinks:

```bash
webmcpcss graph tienda.webmcp.css --obsidian ./vault
```

Genera una nota por herramienta/selector/página con enlaces `[[...]]`, de
modo que el grafo de Obsidian refleja el grafo de herramientas. Los agentes
de documentación (o RAG sobre la bóveda) pueden consultar:

- qué herramientas existen y qué parámetros aceptan,
- qué selectores comparten página,
- el estado (OK/roto) y la fragilidad si se generó tras `validate --save-status`.

Ver la guía completa del grafo en [`../GRAPH.md`](../GRAPH.md) (nodos,
aristas, dashboard con Cytoscape y análisis de fragilidad).
