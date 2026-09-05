/**
 * Tipos del módulo `prompt` (v0.7.0): modificación de sitios web mediante
 * lenguaje natural.
 *
 * Flujo: `prompt` → {@link PromptAction} (intérprete) → {@link ElementMatch}
 * (buscador de elementos) → {@link ActionOutcome} (ejecutor) →
 * {@link PromptResult} (orquestador, con evidencia y auditoría).
 */
import type { ElementSnapshot, ToolMap } from '../types';

/**
 * Acciones soportadas. Las siete primeras son las del diseño original;
 * `hide`, `setText` y `setStyle` son extensiones frecuentes que evitan caer
 * en `other`.
 */
export type PromptActionType =
  | 'upload'
  | 'changeColor'
  | 'delete'
  | 'move'
  | 'click'
  | 'fill'
  | 'hide'
  | 'setText'
  | 'setStyle'
  | 'other';

/** Lista canónica de acciones (útil para validar salidas del LLM). */
export const PROMPT_ACTIONS: readonly PromptActionType[] = [
  'upload',
  'changeColor',
  'delete',
  'move',
  'click',
  'fill',
  'hide',
  'setText',
  'setStyle',
  'other',
];

/** Dónde se recoloca un elemento respecto a su destino (acción `move`). */
export type Placement = 'before' | 'after' | 'inside' | 'start';

/** Parámetros de una acción (todos opcionales; dependen de la acción). */
export interface PromptParameters {
  /** Ruta, URL o data-URI del archivo a subir (`upload`). */
  file?: string;
  /** Varios archivos a subir (`upload`). */
  files?: string[];
  /** Color CSS ya normalizado (`red`, `#ff0000`, `rgb(...)`) (`changeColor`). */
  color?: string;
  /** Propiedad CSS a colorear: `color`, `background-color`, `border-color`. */
  property?: string;
  /** Texto a escribir (`fill`) o nuevo contenido (`setText`). */
  text?: string;
  /** Coordenadas absolutas de destino (`move` posicional). */
  position?: { x: number; y: number };
  /** Descripción del elemento destino (`move` estructural). */
  destination?: string;
  /** Posición relativa al destino (`move`). */
  placement?: Placement;
  /** Aplica a todos los elementos que casen (`delete`, `hide`). */
  all?: boolean;
  /** Nombre de una herramienta del `.webmcp.css` a ejecutar (`other`). */
  tool?: string;
  /** Argumentos para la herramienta (`other`). */
  args?: Record<string, string>;
  /** Estilos arbitrarios (`setStyle`). */
  styles?: Record<string, string>;
}

/** Acción estructurada extraída de un prompt. */
export interface PromptAction {
  /** Tipo de acción. */
  action: PromptActionType;
  /** Descripción del elemento objetivo (o un selector CSS si es evidente). */
  target: string;
  /**
   * Selector CSS propuesto por el intérprete (normalmente el LLM, que ve los
   * candidatos de la página). El buscador lo verifica antes de usarlo.
   */
  selector?: string;
  /** Parámetros de la acción. */
  parameters: PromptParameters;
  /** Confianza [0, 1] de la interpretación. */
  confidence?: number;
  /** Quién interpretó el prompt. */
  source?: 'llm' | 'heuristic';
  /** Prompt original. */
  rawPrompt?: string;
  /** Explicación breve (la da el LLM o la heurística). */
  reasoning?: string;
}

/** Contexto opcional de la página para ayudar al LLM a interpretar. */
export interface PageContext {
  url?: string;
  title?: string;
  /** Instantáneas de elementos candidatos (de `adapter.snapshot()`). */
  candidates?: ElementSnapshot[];
  /** Nombres de herramientas disponibles en el `.webmcp.css`. */
  tools?: string[];
}

/** Opciones de interpretación de un prompt. */
export interface InterpretOptions {
  /** Archivos adjuntos por el usuario (`--image`, `--file`). */
  files?: string[];
  /** Texto adicional (`--text`), p. ej. el valor a rellenar. */
  text?: string;
  /** URL objetivo (informativa). */
  url?: string;
  /** Contexto de la página (mejora la interpretación con LLM). */
  context?: PageContext;
}

/** Estrategia con la que se localizó el elemento. */
export type FindStrategy = 'selector' | 'tool' | 'llm' | 'text' | 'vision' | 'probe';

/** Elemento localizado en la página. */
export interface ElementMatch {
  /** Selector CSS del elemento. */
  selector: string;
  /** Estrategia que lo encontró. */
  strategy: FindStrategy;
  /** Confianza [0, 1]. */
  confidence: number;
  /** Etiqueta en minúsculas, si se conoce. */
  tag?: string;
  /** Texto visible, si se conoce. */
  text?: string;
  /** Atributos relevantes, si se conocen. */
  attrs?: Record<string, string>;
  /** Herramienta del tool map asociada (estrategia `tool`). */
  tool?: string;
}

/** Resultado de la búsqueda de un elemento. */
export interface FindResult {
  /** Mejor coincidencia, o `null` si no se encontró. */
  match: ElementMatch | null;
  /** Sugerencias legibles cuando no hay coincidencia (para ser más específico). */
  suggestions: string[];
  /** Estrategias intentadas, en orden. */
  tried: FindStrategy[];
}

/** Resultado de ejecutar una acción sobre la página. */
export interface ActionOutcome {
  success: boolean;
  /** Mensaje legible. */
  message: string;
  /** Detalles estructurados (selector, archivos, estilos aplicados...). */
  details?: Record<string, unknown>;
  /** Error si `success` es false. */
  error?: string;
  /** `tool` si se delegó en una herramienta WebMCP (con auto-reparación). */
  via?: 'dom' | 'tool';
}

/** Entrada del registro de auditoría de una ejecución. */
export interface AuditEntry {
  /** Timestamp ISO 8601. */
  ts: string;
  /** Fase: `interpret`, `find`, `execute`, `evidence`, `error`. */
  phase: 'interpret' | 'find' | 'execute' | 'evidence' | 'error';
  /** Mensaje. */
  message: string;
  /** Datos adicionales. */
  data?: Record<string, unknown>;
}

/** Evidencia recogida tras la ejecución. */
export interface PromptEvidence {
  /** Ruta de la captura de pantalla (si el adaptador la soporta). */
  screenshot?: string;
  /** Captura en base64 (PNG) para transportes sin sistema de archivos (MCP). */
  screenshotBase64?: string;
  /** Instantánea del elemento tras la acción. */
  after?: ElementSnapshot | null;
}

/** Resultado completo de `PromptManager.run()`. */
export interface PromptResult {
  /** Prompt original. */
  prompt: string;
  /** URL de la página (si se conoce). */
  url?: string;
  /** Acción interpretada. */
  action: PromptAction;
  /** Elemento localizado (si se llegó a buscar). */
  match?: ElementMatch | null;
  /** `true` si solo se interpretó/localizó sin modificar la página. */
  dryRun: boolean;
  /** `true` si la acción llegó a ejecutarse. */
  executed: boolean;
  /** Éxito global (en dry-run: interpretación + localización correctas). */
  success: boolean;
  /** Resultado de la ejecución. */
  outcome?: ActionOutcome;
  /** Error global si `success` es false. */
  error?: string;
  /** Sugerencias cuando no se encontró el elemento. */
  suggestions?: string[];
  /** Evidencia (captura, estado posterior). */
  evidence?: PromptEvidence;
  /** Registro de auditoría de todas las fases. */
  log: AuditEntry[];
  /** Duración total en milisegundos. */
  durationMs: number;
}

/** Opciones de `PromptManager.run()`. */
export interface RunOptions extends InterpretOptions {
  /** Solo interpretar y localizar; no modificar la página (por defecto `false`). */
  dryRun?: boolean;
  /** Ruta donde guardar una captura tras ejecutar (si el adaptador lo soporta). */
  screenshot?: string;
  /** Incluir la captura en base64 en el resultado (transportes MCP). */
  screenshotBase64?: boolean;
  /** Archivo de historial donde registrar el evento (`false` para no registrar). */
  historyFile?: string | false;
  /** Umbral mínimo de confianza para aceptar una localización por visión. */
  threshold?: number;
}

/** Proveedores de LLM soportados. */
export type LlmProvider = 'ollama' | 'openai' | 'anthropic';

/** Configuración resuelta de un proveedor LLM. */
export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  baseUrl: string;
  apiKey?: string;
  /** Tiempo máximo por petición (ms). Por defecto 60 000. */
  timeoutMs?: number;
}

/** Petición de completado. */
export interface LlmRequest {
  system: string;
  user: string;
  /** Pide al proveedor salida JSON cuando lo soporta. */
  json?: boolean;
  temperature?: number;
  /**
   * Imágenes adjuntas (v1.0.0) como data-URLs `data:image/png;base64,…`.
   * Se envían a modelos con visión (OpenAI `image_url`, Anthropic `image`,
   * Ollama `images`).
   */
  images?: string[];
  /** Límite de tokens de salida (si el proveedor lo soporta). */
  maxTokens?: number;
}

/** Cliente LLM mínimo (una sola operación: completar). */
export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  /** Devuelve el texto de la respuesta del modelo. */
  complete(req: LlmRequest): Promise<string>;
}

/** Información de un asset (archivo) resuelto y listo para subir. */
export interface ResolvedAsset {
  /** Ruta local (temporal si vino de URL o data-URI). */
  path: string;
  /** Nombre de archivo. */
  name: string;
  /** Tipo MIME detectado. */
  mimeType: string;
  /** Tamaño en bytes. */
  size: number;
  /** Origen. */
  source: 'local' | 'url' | 'data';
  /** `true` si `path` es temporal y debe limpiarse. */
  temporary: boolean;
}

/** Opciones del gestor de assets. */
export interface AssetOptions {
  /** Tamaño máximo permitido en bytes (por defecto 25 MB). */
  maxBytes?: number;
  /** Carpeta temporal (por defecto `os.tmpdir()/webmcpcss-assets`). */
  tmpDir?: string;
  /** Implementación de `fetch` (inyectable en tests). */
  fetchImpl?: typeof fetch;
  /** Tiempo máximo de descarga (ms). Por defecto 30 000. */
  timeoutMs?: number;
}

/** Contexto que el ejecutor necesita además del adaptador. */
export interface ExecuteContext {
  /** Tool map del `.webmcp.css` (permite delegar en herramientas). */
  toolMap?: ToolMap;
  /** Localizador para elementos secundarios (destino de `move`). */
  findElement?: (description: string) => Promise<ElementMatch | null>;
  /** Opciones para resolver assets. */
  assetOptions?: AssetOptions;
  /** Ejecutor de herramientas WebMCP (inyectado por el orquestador). */
  runTool?: (tool: string, args: Record<string, string>) => Promise<unknown>;
}
