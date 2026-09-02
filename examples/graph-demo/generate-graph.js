/**
 * Demo del módulo de Mapas de Contenido.
 *
 * Genera, a partir de los ejemplos del repositorio:
 *  - un grafo JSON (graph.json)
 *  - un vault de Obsidian (vault/)
 *  - un HTML estático interactivo (graph.html)
 *
 * Uso:  node examples/graph-demo/generate-graph.js
 * (requiere `npm run build` previo)
 */
const fs = require('fs');
const path = require('path');
const {
  buildGraph,
  generateObsidianVault,
  buildGraphHtml,
  parseWebMCPFile,
} = require('../../dist/src');

const root = path.resolve(__dirname, '../..');
const files = [
  'examples/shopping-cart/webmcp.css',
  'examples/api-tools/webmcp.css',
  'examples/tailwind-demo/webmcp.css',
].map((rel) => ({ path: rel, toolMap: parseWebMCPFile(path.join(root, rel)) }));

const graph = buildGraph(files, undefined, { fragility: true });
const outDir = __dirname;

fs.writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify(graph, null, 2));
generateObsidianVault(graph, path.join(outDir, 'vault'), { vaultName: 'WebMCPcss demo' });
fs.writeFileSync(path.join(outDir, 'graph.html'), buildGraphHtml(graph));

console.log('✔ graph.json, vault/ y graph.html generados en examples/graph-demo/');
console.log(`  ${graph.nodes.length} nodos, ${graph.edges.length} aristas`);
console.log('  Abre vault/ en Obsidian ("Open folder as vault") o graph.html en el navegador.');
