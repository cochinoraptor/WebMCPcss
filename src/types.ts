/**
 * Tipos centrales de WebMCPcss: tool map, parámetros, resultados y reportes.
 *
 * Estos tipos son el contrato entre el parser (`.webmcp.css` ⇄ JSON), el
 * núcleo de ejecución y los adaptadores de página.
 */

/**
 * Fuente de un parámetro de herramienta declarada con `webmcp-param-*`.
 *
 * - `attr(nombre)` → lee un atributo del elemento que dispara la herramienta.
 * - `data(x)` / `aria(x)` → alias de `attr(data-x)` / `attr(aria-x)`.
 * - `value(selector?)` → valor de un input (del elemento o del selector dado).
 * - `text(selector?)` → texto normalizado (del elemento o del selector dado).
 * - `"literal"` → cadena fija.
 */
export type ParamSource =
  | { source: 'attr'; value: string }
  | { source: 'value'; selector?: string }
  | { source: 'text'; selector?: string }
  | { source: 'literal'; value: string };

/**
 * Evento de disparo de una herramienta. Por defecto `{ event: 'click' }`.
 * `webmcp-trigger: "submit" on .form` produce `{ event: 'submit', on: '.form' }`.
 */
export interface TriggerSpec {
  /** Nombre del evento DOM (`click`, `submit`, ...). */
  event: string;
  /** Selector alternativo sobre el que disparar el evento. */
  on?: string;
}

/** Herramienta declarada en el CSS con `webmcp-tool`. */
export interface ToolDef {
  /** Selector CSS que identifica los elementos que disparan la herramienta. */
  selector: string;
  /** Parámetros declarados con `webmcp-param-<nombre>`. */
  params: Record<string, ParamSource>;
  /** Descripción legible (`webmcp-description`). */
  description?: string;
  /** Evento de disparo (`webmcp-trigger`). */
  trigger: TriggerSpec;
  /**
   * Selector (o lista separada por comas) que debe existir tras la acción
   * para considerarla confirmada (`webmcp-confirmation`).
   */
  confirmation?: string;
}

/** Dato de solo lectura declarado con `webmcp-context`. */
export interface ContextDef {
  /** Selector CSS del elemento que contiene el dato. */
  selector: string;
  /** Formato del dato (`text`, `currency`, `number`, ...). */
  format: string;
}

/**
 * Mapa de herramientas resultante de parsear un `.webmcp.css`.
 * Es la estructura que la librería mantiene en memoria y que las
 * reparaciones actualizan.
 */
export interface ToolMap {
  /** Herramientas accionables, indexadas por nombre. */
  tools: Record<string, ToolDef>;
  /** Datos de solo lectura, indexados por nombre. */
  context: Record<string, ContextDef>;
}

/** Resultado de ejecutar una herramienta con `WebMCPcss.execute()`. */
export interface ExecuteResult {
  /** `true` si la acción se disparó (y, si había confirmación, se verificó). */
  success: boolean;
  /** Nombre de la herramienta ejecutada. */
  tool: string;
  /** Origen de la herramienta: declarada en CSS o registrada vía API. */
  via: 'css' | 'api';
  /** Detalles de la ejecución (presente cuando la acción se disparó). */
  data?: {
    /** Parámetros finales con los que se ejecutó. */
    params: Record<string, string>;
    /** Si la confirmación (`webmcp-confirmation`) se verificó. */
    confirmed: boolean;
    /** Selector usado realmente (útil tras una reparación). */
    selector?: string;
    /** Trazas de la auto-reparación, si ocurrió. */
    repaired?: { from: string; to: string };
  };
  /** Mensaje de error cuando `success` es `false`. */
  error?: string;
}

/** Entrada del reporte de `validate`. */
export interface ValidationEntry {
  /** Origen de la definición: CSS o API imperativa (`navigator.modelContext`). */
  kind: 'css' | 'api';
  /** Tipo de entrada: herramienta o contexto. */
  type: 'tool' | 'context';
  /** Nombre de la herramienta o del contexto. */
  name: string;
  /** Selector declarado (`-` para herramientas de la API). */
  selector: string;
  /** Número de elementos encontrados en la página. */
  count: number;
  /** `true` si el selector resuelve a al menos un elemento. */
  ok: boolean;
}

/** Reporte completo de una validación. */
export interface ValidationReport {
  /** URL o ruta validada. */
  target: string;
  /** Entradas individuales (herramientas y contextos). */
  entries: ValidationEntry[];
  /** `true` si todas las entradas están ok. */
  ok: boolean;
}

/** Información de una herramienta registrada vía `navigator.modelContext`. */
export interface ApiToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
}
