/**
 * Tipos compartidos de WebMCPcss.
 *
 * Definen la forma del "tool map" (mapa de herramientas) que resulta de
 * parsear un archivo `.webmcp.css`, así como las estructuras auxiliares
 * usadas por la lógica de auto-reparación.
 */

/** Origen del valor de un parámetro de herramienta. */
export type ParamSource = 'attr' | 'value' | 'text' | 'literal';

/**
 * Especificación de un parámetro de una herramienta WebMCP.
 *
 * Ejemplos en CSS:
 * - `webmcp-param-productId: attr(data-product-id);` → `{ source: 'attr', value: 'data-product-id' }`
 * - `webmcp-param-quantity: value(#qty-input);`      → `{ source: 'value', selector: '#qty-input' }`
 * - `webmcp-param-code: value();`                    → `{ source: 'value' }` (el propio elemento)
 */
export interface ParamSpec {
  /** De dónde se obtiene / a dónde se escribe el valor. */
  source: ParamSource;
  /** Nombre del atributo (para `source: 'attr'`) o valor literal. */
  value?: string;
  /** Selector CSS del elemento asociado (para `value(...)` o `text(...)`). */
  selector?: string;
}

/** Disparador de una herramienta: evento y selector objetivo opcional. */
export interface TriggerSpec {
  /** Evento a disparar: `click`, `submit`, `change`... Por defecto `click`. */
  event: string;
  /** Selector del elemento sobre el que se dispara. Por defecto, el de la herramienta. */
  selector?: string;
}

/**
 * Huella digital de un elemento, capturada al generar o validar el archivo.
 * Se usa como pista para re-localizar el elemento cuando su selector se rompe.
 */
export interface Fingerprint {
  /** Nombre de etiqueta en minúsculas (`button`, `input`...). */
  tag?: string;
  /** Texto visible (recortado). */
  text?: string;
  /** Atributos relevantes (data-*, id, name, type, aria-label...). */
  attrs?: Record<string, string>;
}

/** Especificación de una herramienta WebMCP. */
export interface ToolSpec {
  /** Selector CSS del elemento principal de la herramienta. */
  selector: string;
  /** Descripción legible para humanos/agentes. */
  description?: string;
  /** Parámetros que la herramienta acepta. */
  params: Record<string, ParamSpec>;
  /** Selector que debe existir tras ejecutar la acción (confirmación). */
  confirmation?: string;
  /** Cómo se dispara la acción (por defecto `click` sobre `selector`). */
  trigger?: TriggerSpec;
  /** Huella para auto-reparación. */
  fingerprint?: Fingerprint;
  /**
   * Propiedades `webmcp-*` adicionales (v1.0.0) que no forman parte del
   * núcleo pero que consumen los módulos extendidos: `intent`, `component`,
   * `accessibility`, `permissions`, `payment`, `network`, `amount`,
   * `requires`, `risk`… Se guardan sin el prefijo `webmcp-` y con el valor
   * ya sin comillas. Ausente si la regla no declara ninguna.
   */
  meta?: WebMCPMeta;
}

/**
 * Bolsa de metadatos `webmcp-*` extendidos (clave sin prefijo → valor).
 * Ejemplo: `webmcp-intent: "submit"` → `{ intent: 'submit' }`.
 */
export type WebMCPMeta = Record<string, string>;

/** Especificación de un dato de contexto (solo lectura). */
export interface ContextSpec {
  /** Selector CSS del elemento a leer. */
  selector: string;
  /** Formato sugerido: `currency`, `number`, `text`, `date`... */
  format?: string;
  /** Huella para auto-reparación. */
  fingerprint?: Fingerprint;
  /** Propiedades `webmcp-*` extendidas (ver {@link WebMCPMeta}). */
  meta?: WebMCPMeta;
}

/** Resultado de parsear un archivo `.webmcp.css`. */
export interface ToolMap {
  tools: Record<string, ToolSpec>;
  context: Record<string, ContextSpec>;
}

/** Instantánea serializable de un elemento del DOM (para visión/reparación). */
export interface ElementSnapshot {
  /** Selector estable inferido para el elemento. */
  selector: string;
  /**
   * Selector de "familia": generaliza a todos los elementos equivalentes
   * (misma etiqueta y clases estables, p. ej. `.product-card .card-add` para
   * un botón repetido por tarjeta). Presente solo si matchea ≥2 elementos.
   * Lección del PR #2 (@ctangarife): un selector de herramienta debe
   * generalizar; la clase compartida gana al aria-label único.
   */
  familySelector?: string;
  /** Etiqueta en minúsculas. */
  tag: string;
  /** Texto visible recortado (máx. ~120 chars). */
  text: string;
  /** Atributos relevantes. */
  attrs: Record<string, string>;
  /** ¿El elemento es visible? */
  visible: boolean;
  /** Posición aproximada, si está disponible. */
  rect?: { x: number; y: number; width: number; height: number };
}

/** Resultado de ejecutar una herramienta con `WebMCPcss.execute`. */
export interface ExecuteResult {
  success: boolean;
  /** Datos recolectados: params leídos, confirmación, etc. */
  data?: Record<string, unknown>;
  /** Mensaje de error si `success` es false. */
  error?: string;
  /** `true` si la ejecución requirió auto-reparación del selector. */
  repaired?: boolean;
  /** Nuevo selector si hubo reparación. */
  newSelector?: string;
  /** Origen de la herramienta ejecutada: definición CSS o API imperativa. */
  via?: 'css' | 'api';
}

/**
 * Metadatos de una herramienta registrada mediante la API imperativa de
 * WebMCP (`document.modelContext.registerTool()`).
 */
export interface RegisteredToolInfo {
  /** Nombre de la herramienta. */
  name: string;
  /** Descripción legible. */
  description?: string;
  /** JSON Schema de los argumentos de entrada, si el sitio lo declaró. */
  inputSchema?: unknown;
}

/** Resultado de una reparación individual. */
export interface RepairResult {
  /** Nombre de la herramienta o dato de contexto. */
  name: string;
  /** Tipo de entrada reparada. */
  kind: 'tool' | 'context';
  /** ¿Se encontró un reemplazo? */
  repaired: boolean;
  oldSelector: string;
  newSelector?: string;
  /** Confianza [0, 1] del emparejamiento. */
  score?: number;
}

/** Resultado de validar un selector contra una página. */
export interface ValidationEntry {
  name: string;
  kind: 'tool' | 'context' | 'param' | 'confirmation' | 'trigger' | 'api';
  selector: string;
  ok: boolean;
  /**
   * `true` si el selector es de aparición diferida (p. ej. confirmaciones,
   * que solo existen tras ejecutar la acción). No cuenta como fallo.
   */
  optional?: boolean;
}

/** Reporte completo de validación. */
export interface ValidationReport {
  url: string;
  total: number;
  passed: number;
  failed: number;
  entries: ValidationEntry[];
}
