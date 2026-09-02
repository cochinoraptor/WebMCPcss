/**
 * Módulo de Mapas de Contenido: grafo de conocimiento, exportación Obsidian,
 * análisis de fragilidad y dashboard interactivo.
 */
export * from './types';
export { buildGraph } from './builder';
export type { BuildGraphOptions } from './builder';
export { analyzeFragility } from './fragility';
export { suggestionsFor } from './suggestions';
export { generateObsidianVault } from './obsidian';
export { buildGraphHtml, serveGraphDashboard } from './dashboard';
export { sanitizeFileName, yamlEscape, wikiLink, unique, uniqueFileNames } from './utils';
