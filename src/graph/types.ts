/**
 * Tipos del módulo de Mapas de Contenido (grafo de conocimiento).
 */
import type { ToolMap, ValidationEntry } from '../types';

/** Tipo de nodo del grafo. */
export type NodeType = 'tool' | 'selector' | 'param' | 'page' | 'status';

/** Tipo de arista del grafo. */
export type EdgeType =
  'uses' | 'requires' | 'belongs-to' | 'has-status' | 'shares-selector';

/** Nodo del grafo. */
export interface GraphNode {
  /** Identificador único (`tool:addToCart`, `selector:#buy-btn`...). */
  id: string;
  /** Tipo de nodo. */
  type: NodeType;
  /** Nombre legible. */
  label: string;
  /** Información extra (descripción, parámetros, fragilidad...). */
  metadata?: Record<string, unknown>;
}

/** Arista dirigida del grafo. */
export interface GraphEdge {
  /** ID del nodo origen. */
  source: string;
  /** ID del nodo destino. */
  target: string;
  /** Tipo de relación. */
  type: EdgeType;
}

/** Grafo de conocimiento de un conjunto de archivos `.webmcp.css`. */
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata?: {
    totalTools: number;
    totalSelectors: number;
    totalPages: number;
    statusCounts?: { ok: number; broken: number };
    /** Recuento de selectores por nivel de fragilidad. */
    fragilitySummary?: Record<string, number>;
  };
}

/** Nivel de fragilidad de un selector. */
export type FragilityLevel = 'low' | 'medium' | 'high';

/** Resultado del análisis de fragilidad de un selector. */
export interface FragilityScore {
  level: FragilityLevel;
  /** Razones detectadas (una por patrón encontrado). */
  reasons: string[];
  /** Recomendaciones de migración a alternativas más estables. */
  suggestions: string[];
  /** Frameworks/librerías detectados en el selector. */
  frameworks: string[];
}

/** Archivo `.webmcp.css` parseado, entrada del builder. */
export interface ParsedFile {
  /** Ruta del archivo (se usa para derivar la página). */
  path: string;
  /** Tool map resultante del parser. */
  toolMap: ToolMap;
}

/**
 * Resultado de validación asociado a un archivo/página. Compatible con el
 * `ValidationReport` que guarda `webmcpcss validate --save-status`.
 */
export interface StatusResult {
  /** URL o página validada. */
  url?: string;
  /** Entradas de validación (name/kind/selector/ok). */
  entries: ValidationEntry[];
}

/** Opciones de la exportación a Obsidian. */
export interface ObsidianOptions {
  /** Nombre del vault mostrado en index.md (def. "WebMCPcss"). */
  vaultName?: string;
  /** Incluir análisis de fragilidad en las notas (def. true). */
  fragility?: boolean;
  /** Framework principal, para afinar las sugerencias. */
  framework?: string;
}
