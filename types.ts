/**
 * Tipos del módulo de integración con Tailwind CSS.
 */

/** Categorías de utilidades de Tailwind reconocidas por el inspector. */
export type TailwindCategory =
  | 'layout'
  | 'flexbox-grid'
  | 'spacing'
  | 'sizing'
  | 'typography'
  | 'colors'
  | 'backgrounds'
  | 'borders'
  | 'effects'
  | 'transforms'
  | 'transitions'
  | 'interactivity'
  | 'other';

/** Una clase Tailwind clasificada. */
export interface ClassifiedClass {
  /** Clase completa tal cual aparece (`md:hover:bg-blue-500`). */
  raw: string;
  /** Clase base sin variantes (`bg-blue-500`). */
  base: string;
  /** Variantes (responsive, estado...): `['md', 'hover']`. */
  variants: string[];
  /** Categoría asignada. */
  category: TailwindCategory;
}

/** Resultado de inspeccionar un elemento. */
export interface TailwindClasses {
  /** Selector estable del elemento (si se pudo calcular). */
  selector?: string;
  /** Etiqueta del elemento. */
  tag?: string;
  /** Clases agrupadas por categoría. */
  classes: Partial<Record<TailwindCategory, string[]>>;
  /** Todas las clases Tailwind detectadas (en orden). */
  all: string[];
  /** Clases que NO parecen de Tailwind (propias del sitio). */
  unknown: string[];
}

/** Elemento con clases Tailwind encontrado al escanear una página. */
export interface TailwindScanEntry {
  /** Selector estable del elemento. */
  selector: string;
  /** Etiqueta en minúsculas. */
  tag: string;
  /** Identificador legible derivado (para nombres de herramientas). */
  id: string;
  /** Lista cruda de clases del elemento. */
  classList: string[];
  /** Resultado clasificado. */
  inspection: TailwindClasses;
}

/** Descriptor de una herramienta WebMCP generada para editar Tailwind. */
export interface TailwindToolDescriptor {
  /** Nombre de la herramienta (`editCard1Spacing`). */
  name: string;
  /** Descripción legible. */
  description: string;
  /** Selector del elemento objetivo. */
  selector: string;
  /** Categoría que edita (o `all` para clases arbitrarias). */
  category: TailwindCategory | 'all';
  /** Clases actuales de esa categoría (contexto para el agente). */
  currentClasses: string[];
  /** JSON Schema de los argumentos. */
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** Cambio registrado por el editor (para historial y exportación). */
export interface TailwindChange {
  /** Operación realizada. */
  op: 'add' | 'remove' | 'replace' | 'toggle';
  /** Selector del elemento afectado. */
  selector: string;
  /** Clase(s) involucradas. */
  className: string;
  /** Clase nueva (solo en `replace`). */
  newClassName?: string;
  /** Timestamp ISO. */
  ts: string;
}

/** Diff exportable de un elemento editado. */
export interface ElementDiff {
  selector: string;
  /** `class` original completo. */
  before: string;
  /** `class` tras las ediciones. */
  after: string;
}
