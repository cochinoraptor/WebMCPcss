/**
 * Construcción del grafo de conocimiento a partir de archivos `.webmcp.css`
 * parseados y, opcionalmente, resultados de validación.
 *
 * Nodos: `tool`, `selector`, `param`, `page`, `status`.
 * Aristas: tool —uses→ selector, tool —requires→ param,
 * selector —belongs-to→ page, tool —has-status→ status,
 * tool —shares-selector→ tool (selector compartido).
 */
import * as path from 'path';
import { analyzeFragility } from './fragility';
import type { Graph, GraphEdge, GraphNode, ParsedFile, StatusResult } from './types';

/** Opciones del builder. */
export interface BuildGraphOptions {
  /** Analizar fragilidad de cada selector (def. true). */
  fragility?: boolean;
  /** Framework principal declarado (afina sugerencias). */
  framework?: string;
}

/** Deriva un nombre de página legible a partir de la ruta del archivo. */
function pageNameFor(file: ParsedFile): string {
  const dir = path.basename(path.dirname(path.resolve(file.path)));
  const base = path.basename(file.path).replace(/\.webmcp\.css$|\.css$/i, '');
  if (base && base !== 'webmcp') return base;
  return dir || base || 'página';
}

/**
 * Construye el grafo a partir de archivos parseados.
 *
 * @param files Archivos `.webmcp.css` parseados (ruta + tool map).
 * @param statusResults Resultados de `validate` (opcional): añaden nodos
 *   `status` (OK/roto) y aristas `has-status` a las herramientas.
 * @param options Fragilidad y framework declarado.
 * @returns Grafo con nodos, aristas y metadatos agregados.
 */
export function buildGraph(
  files: ParsedFile[],
  statusResults?: StatusResult[],
  options: BuildGraphOptions = {},
): Graph {
  const withFragility = options.fragility !== false;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();

  const addNode = (node: GraphNode): GraphNode => {
    const existing = nodes.get(node.id);
    if (existing) return existing;
    nodes.set(node.id, node);
    return node;
  };
  const addEdge = (source: string, target: string, type: GraphEdge['type']): void => {
    const key = `${source}|${type}|${target}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target, type });
  };

  // Estado por herramienta (name → ok) a partir de los resultados de validate.
  const statusByTool = new Map<string, boolean>();
  for (const result of statusResults ?? []) {
    for (const entry of result.entries) {
      if (entry.kind === 'tool' || entry.kind === 'context') {
        // Un fallo en cualquier entrada de la herramienta la marca como rota.
        const prev = statusByTool.get(entry.name);
        statusByTool.set(
          entry.name,
          (prev ?? true) && (entry.ok || entry.optional === true),
        );
      }
    }
  }

  // selector → herramientas que lo usan (para shares-selector).
  const toolsBySelector = new Map<string, string[]>();

  for (const file of files) {
    const pageName = pageNameFor(file);
    const pageId = `page:${pageName}`;
    addNode({
      id: pageId,
      type: 'page',
      label: pageName,
      metadata: { path: file.path },
    });

    const allEntries: Array<
      [
        string,
        { selector: string; description?: string; params?: Record<string, unknown> },
        'tool' | 'context',
      ]
    > = [
      ...Object.entries(file.toolMap.tools).map(
        ([n, t]) => [n, t, 'tool'] as [string, typeof t, 'tool'],
      ),
      ...Object.entries(file.toolMap.context).map(
        ([n, c]) => [n, { selector: c.selector, params: {} }, 'context'] as never,
      ),
    ];

    for (const [name, spec, kind] of allEntries) {
      const toolId = `tool:${name}`;
      addNode({
        id: toolId,
        type: 'tool',
        label: name,
        metadata: {
          kind,
          description: spec.description,
          selector: spec.selector,
          params: Object.keys(spec.params ?? {}),
          page: pageName,
        },
      });
      addEdge(toolId, pageId, 'belongs-to');

      // Nodo selector (+ fragilidad).
      const selectorId = `selector:${spec.selector}`;
      const selNode = addNode({
        id: selectorId,
        type: 'selector',
        label: spec.selector,
        metadata: {},
      });
      if (withFragility && !selNode.metadata?.fragility) {
        selNode.metadata = {
          ...selNode.metadata,
          fragility: analyzeFragility(spec.selector, options.framework),
        };
      }
      addEdge(toolId, selectorId, 'uses');
      addEdge(selectorId, pageId, 'belongs-to');
      toolsBySelector.set(spec.selector, [
        ...(toolsBySelector.get(spec.selector) ?? []),
        toolId,
      ]);

      // Parámetros.
      for (const [pName, pSpec] of Object.entries(
        (spec.params ?? {}) as Record<string, { source?: string; selector?: string }>,
      )) {
        const paramId = `param:${name}.${pName}`;
        addNode({
          id: paramId,
          type: 'param',
          label: pName,
          metadata: { tool: name, source: pSpec.source, selector: pSpec.selector },
        });
        addEdge(toolId, paramId, 'requires');
      }

      // Estado (si hay resultados de validación).
      if (statusByTool.has(name)) {
        const ok = statusByTool.get(name) === true;
        const statusId = ok ? 'status:ok' : 'status:broken';
        addNode({
          id: statusId,
          type: 'status',
          label: ok ? 'OK' : 'Roto',
          metadata: { ok },
        });
        addEdge(toolId, statusId, 'has-status');
      }
    }
  }

  // Selectores compartidos entre herramientas.
  for (const toolIds of toolsBySelector.values()) {
    const uniqueTools = [...new Set(toolIds)];
    for (let i = 0; i < uniqueTools.length; i++) {
      for (let j = i + 1; j < uniqueTools.length; j++) {
        addEdge(uniqueTools[i], uniqueTools[j], 'shares-selector');
      }
    }
  }

  // Metadatos agregados.
  const allNodes = [...nodes.values()];
  const fragilitySummary: Record<string, number> = {};
  for (const n of allNodes) {
    if (n.type !== 'selector') continue;
    const frag = n.metadata?.fragility as { level?: string } | undefined;
    if (frag?.level)
      fragilitySummary[frag.level] = (fragilitySummary[frag.level] ?? 0) + 1;
  }
  const okCount = edges.filter(
    (e) => e.type === 'has-status' && e.target === 'status:ok',
  ).length;
  const brokenCount = edges.filter(
    (e) => e.type === 'has-status' && e.target === 'status:broken',
  ).length;

  return {
    nodes: allNodes,
    edges,
    metadata: {
      totalTools: allNodes.filter((n) => n.type === 'tool').length,
      totalSelectors: allNodes.filter((n) => n.type === 'selector').length,
      totalPages: allNodes.filter((n) => n.type === 'page').length,
      ...(statusResults && statusResults.length > 0
        ? { statusCounts: { ok: okCount, broken: brokenCount } }
        : {}),
      ...(withFragility ? { fragilitySummary } : {}),
    },
  };
}
