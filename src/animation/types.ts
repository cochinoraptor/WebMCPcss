/**
 * Tipos del estándar de animaciones de WebMCPcss (v0.8.0).
 *
 * Una animación se declara en un `.webmcp.css` con propiedades
 * `webmcp-animation-*` y se materializa en el navegador mediante uno de los
 * motores disponibles (CSS, Web Animations API o Three.js). El orquestador
 * decide el motor, gestiona colas por prioridad y resuelve conflictos entre
 * animaciones propias y de terceros (GSAP, Anime.js, CSS existente...).
 */

/** Técnicas de animación soportadas. */
export type AnimationType =
  'parallax' | 'isometric' | '3d-transform' | 'keyframes' | 'three-scene';

/** Prioridad de una animación (de menor a mayor). */
export type AnimationPriority = 'low' | 'normal' | 'high' | 'critical';

/** Motores de ejecución. `auto` deja la elección al orquestador. */
export type AnimationEngineId = 'css' | 'waapi' | 'three';
export type EnginePreference = AnimationEngineId | 'auto';

/** Cuándo se dispara la animación. */
export type AnimationTrigger =
  'load' | 'scroll' | 'hover' | 'click' | 'visible' | 'manual';

/** Estrategias de resolución de conflictos. */
export type ConflictStrategy = 'replace' | 'queue' | 'ignore' | 'merge';

/** Aislamiento opcional del render (solo motores que crean nodos propios). */
export type SandboxMode = 'none' | 'shadow';

/** Capa de un parallax. */
export interface LayerConfig {
  /** Selector CSS de la capa (relativo al documento). */
  selector: string;
  /** Velocidad relativa 0–1 (menor = más lejana/lenta). */
  speed: number;
  /** Profundidad CSS opcional para `translateZ` (p. ej. `-2px`). */
  depth?: string;
}

/** Fotograma clave (nombres de propiedad en camelCase o kebab-case). */
export interface AnimationKeyframe {
  /** Offset 0–1 (opcional: se reparten uniformemente si falta). */
  offset?: number;
  /** Easing propio del tramo. */
  easing?: string;
  /** Resto de propiedades CSS del fotograma. */
  [property: string]: string | number | undefined;
}

/** Capa de una escena Three.js 2.5D. */
export interface ThreeLayerConfig {
  /** URL de la imagen (sprite/plano). Si falta se dibuja un plano de color. */
  image?: string;
  /** Color CSS del plano cuando no hay imagen. */
  color?: string;
  /** Posición en unidades de escena (x, y) y profundidad z (negativo = lejos). */
  position?: { x?: number; y?: number; z?: number };
  /** Ancho y alto en unidades de escena. */
  size?: { width?: number; height?: number };
  /** Cuánto se desplaza con el ratón/scroll (0 = fija, 1 = máximo). */
  parallax?: number;
  /** Rotación continua en rad/s (eje Z). */
  spin?: number;
}

/** Configuración de una escena Three.js. */
export interface ThreeSceneConfig {
  /** Color de fondo (CSS). `transparent` por defecto. */
  background?: string;
  /** Cámara: `orthographic` (2.5D, por defecto) o `perspective`. */
  camera?: 'orthographic' | 'perspective';
  /** Alto visible de la escena en unidades (ortográfica). */
  viewHeight?: number;
  /** Capas/sprites de la escena. */
  layers: ThreeLayerConfig[];
  /** Interacción que mueve la cámara: `mouse`, `scroll`, `both` o `none`. */
  interaction?: 'mouse' | 'scroll' | 'both' | 'none';
  /** URL del módulo ESM de Three.js (por defecto CDN de unpkg). */
  moduleUrl?: string;
  /** Relación de píxeles máxima del renderer (rendimiento). */
  maxPixelRatio?: number;
}

/** Parámetros de una animación (dependen del tipo). */
export interface AnimationParameters {
  /** Duración (`1s`, `500ms` o milisegundos). */
  duration?: string | number;
  /** Retardo (`1s`, `500ms` o milisegundos). */
  delay?: string | number;
  /** Función de easing CSS. */
  easing?: string;
  /** Repeticiones (`infinite` para bucle). */
  iterations?: number | 'infinite';
  /** Dirección (`normal`, `alternate`...). */
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  /** Modo de relleno (`forwards` por defecto). */
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
  /** Capas de un parallax. */
  layers?: LayerConfig[];
  /** Perspectiva (`800px`). Isométrico / 3D. */
  perspective?: string;
  /** Rotación X final (`60deg`). */
  rotationX?: string;
  /** Rotación Y final (`45deg`). */
  rotationY?: string;
  /** Rotación Z final (`-45deg`). */
  rotationZ?: string;
  /** Traslación Z final (`40px`). */
  translationZ?: string;
  /** Escala final. */
  scale?: number;
  /** Fotogramas clave (tipo `keyframes`). */
  keyframes?: AnimationKeyframe[];
  /** Configuración de la escena (tipo `three-scene`). */
  sceneConfig?: ThreeSceneConfig;
  /** Selector del contenedor de scroll para parallax (por defecto la ventana). */
  scrollContainer?: string;
  /** Si es `false`, ignora `prefers-reduced-motion` (por defecto se respeta). */
  respectReducedMotion?: boolean;
  /** Otros parámetros libres (motores personalizados). */
  [extra: string]: unknown;
}

/** Definición completa de una animación declarativa. */
export interface AnimationConfig {
  /** Nombre único (identificador de la animación). */
  name: string;
  /** Técnica. */
  type: AnimationType;
  /** Prioridad. */
  priority: AnimationPriority;
  /** Selector CSS del elemento (o contenedor) a animar. */
  selector: string;
  /** Parámetros según el tipo. */
  parameters: AnimationParameters;
  /** Motor preferido (`auto` por defecto). */
  engine?: EnginePreference;
  /** Disparador (`load` por defecto; `scroll` para parallax). */
  trigger?: AnimationTrigger;
  /** Estrategia de conflicto propia (sobrescribe la global). */
  conflict?: ConflictStrategy;
  /** Aislamiento del render (`none` por defecto). */
  sandbox?: SandboxMode;
  /** Configuración alternativa si la principal no puede ejecutarse. */
  fallback?: AnimationConfig;
  /** Descripción legible (para agentes y documentación). */
  description?: string;
  /** Línea del archivo CSS donde se declaró (informativa). */
  line?: number;
}

/** Conjunto de animaciones parseadas de un archivo. */
export interface AnimationMap {
  /** Animaciones por nombre (en orden de declaración). */
  animations: Record<string, AnimationConfig>;
  /** Avisos no fatales generados durante el parseo. */
  warnings: string[];
}

/** Decisión del resolutor de conflictos. */
export interface ConflictResolution {
  /** `execute` cuando no hay conflicto; si no, la estrategia aplicada. */
  action: 'execute' | ConflictStrategy;
  /** Motivo legible. */
  reason?: string;
  /** Animaciones activas con las que colisiona. */
  conflictsWith: ActiveAnimation[];
  /** Propiedades CSS en disputa. */
  properties: string[];
}

/** Origen de una animación registrada. */
export type AnimationSource = 'webmcpcss' | 'external';

/** Animación registrada en el resolutor (propia o de terceros). */
export interface ActiveAnimation {
  /** Identificador (nombre de la animación o id externo). */
  id: string;
  /** Origen. */
  source: AnimationSource;
  /** Librería o motor (`css`, `waapi`, `three`, `gsap`, `anime`...). */
  library: string;
  /** Prioridad efectiva. */
  priority: AnimationPriority;
  /** Identificadores estables de los elementos afectados. */
  elements: string[];
  /** Propiedades CSS que anima. */
  properties: string[];
  /** Selector original (informativo). */
  selector?: string;
  /** Marca de tiempo de registro. */
  since: number;
}

/** Petición al resolutor. */
export interface ConflictRequest {
  id: string;
  priority: AnimationPriority;
  elements: string[];
  properties: string[];
  /** Estrategia preferida cuando hay empate/derrota (por defecto la global). */
  strategy?: ConflictStrategy;
  selector?: string;
}

/** Capacidades del navegador relevantes para elegir motor. */
export interface BrowserCapabilities {
  /** `Element.prototype.animate` disponible. */
  waapi: boolean;
  /** Contexto WebGL disponible. */
  webgl: boolean;
  /** `ScrollTimeline` nativo. */
  scrollTimeline: boolean;
  /** Animaciones CSS soportadas. */
  cssAnimations: boolean;
  /** `transform-style: preserve-3d` soportado. */
  preserve3d: boolean;
  /** `prefers-reduced-motion: reduce` activo. */
  reducedMotion: boolean;
  /** `window.THREE` ya presente. */
  three: boolean;
  /** Shadow DOM disponible. */
  shadowDom: boolean;
  /** Librerías de animación de terceros detectadas. */
  libraries: ExternalLibrary[];
}

/** Librería de terceros detectada en la página. */
export interface ExternalLibrary {
  /** Identificador (`gsap`, `anime`, `framer-motion`...). */
  id: string;
  /** Nombre legible. */
  name: string;
  /** Versión si se pudo leer. */
  version?: string;
}

/** Referencia a una animación en ejecución. */
export interface AnimationHandle {
  /** Nombre de la animación. */
  name: string;
  /** Motor que la ejecuta. */
  engine: AnimationEngineId;
  /** Elementos afectados. */
  elementCount: number;
  /** Identificadores estables de los elementos. */
  elements: string[];
  /** Propiedades CSS registradas. */
  properties: string[];
  /** Si se aplicó en modo estático por `prefers-reduced-motion`. */
  reducedMotion?: boolean;
  /** Información adicional del motor. */
  details?: Record<string, unknown>;
}

/** Resultado de ejecutar una animación. */
export interface AnimationOutcome {
  /** Nombre de la animación. */
  name: string;
  /** Qué ocurrió. */
  status: 'executed' | 'queued' | 'ignored' | 'replaced-other' | 'failed' | 'dry-run';
  /** Motor usado (si se ejecutó). */
  engine?: AnimationEngineId;
  /** Decisión del resolutor. */
  resolution?: ConflictResolution;
  /** Handle de la animación en curso. */
  handle?: AnimationHandle;
  /** Si se usó la configuración de respaldo. */
  usedFallback?: boolean;
  /** Mensaje legible. */
  message: string;
  /** Error si falló. */
  error?: string;
}

/** Resultado global de una sesión del orquestador. */
export interface OrchestrationResult {
  /** Resultados en el orden procesado (por prioridad). */
  outcomes: AnimationOutcome[];
  /** Capacidades detectadas. */
  capabilities: BrowserCapabilities;
  /** Animaciones externas detectadas antes de empezar. */
  external: ActiveAnimation[];
  /** Duración total en ms. */
  durationMs: number;
  /** ¿Todas las animaciones se ejecutaron o quedaron encoladas sin fallo? */
  success: boolean;
}

/** Entrada de un informe de validación. */
export interface AnimationValidationEntry {
  /** Animación validada. */
  name: string;
  /** Selector comprobado. */
  selector: string;
  /** ¿Existe en el DOM? */
  exists: boolean;
  /** Número de elementos que casan. */
  count: number;
  /** Motor que se elegiría. */
  engine?: AnimationEngineId;
  /** ¿Es compatible con el navegador? */
  compatible: boolean;
  /** Problemas detectados (bloqueantes). */
  errors: string[];
  /** Avisos (no bloqueantes). */
  warnings: string[];
}

/** Conflicto detectado en una simulación. */
export interface PredictedConflict {
  /** Animación que llega después. */
  animation: string;
  /** Animación (propia o externa) con la que colisiona. */
  conflictsWith: string;
  /** Propiedades en disputa. */
  properties: string[];
  /** Acción que tomaría el resolutor. */
  action: ConflictResolution['action'];
  /** Motivo. */
  reason?: string;
}

/** Informe de validación previo a la ejecución. */
export interface AnimationValidationReport {
  /** Entradas por animación. */
  entries: AnimationValidationEntry[];
  /** Conflictos previstos. */
  conflicts: PredictedConflict[];
  /** Capacidades del navegador (si hubo host). */
  capabilities?: BrowserCapabilities;
  /** ¿Sin errores bloqueantes? */
  ok: boolean;
}

/** Opciones del orquestador. */
export interface OrchestratorOptions {
  /** Estrategia global de conflictos (`queue` por defecto). */
  strategy?: ConflictStrategy;
  /** Motor forzado para todas las animaciones. */
  engine?: AnimationEngineId;
  /** Solo planificar: no toca la página. */
  dryRun?: boolean;
  /** Prioridad asignada a las animaciones externas detectadas (`high`). */
  externalPriority?: AnimationPriority;
  /** Si es `false`, no escanea librerías/animaciones externas. */
  detectExternal?: boolean;
  /** Aislamiento por defecto. */
  sandbox?: SandboxMode;
}

/** Plan de una animación (salida de `--dry-run`). */
export interface AnimationPlan {
  name: string;
  type: AnimationType;
  priority: AnimationPriority;
  selector: string;
  engine: AnimationEngineId | null;
  properties: string[];
  trigger: AnimationTrigger;
  strategy: ConflictStrategy;
  /** Motivo si no hay motor compatible. */
  unsupportedReason?: string;
}

/** Orden numérico de prioridades. */
export const PRIORITY_ORDER: Record<AnimationPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  critical: 3,
};

/** Tipos válidos (para validación). */
export const ANIMATION_TYPES: readonly AnimationType[] = [
  'parallax',
  'isometric',
  '3d-transform',
  'keyframes',
  'three-scene',
];

/** Prioridades válidas. */
export const ANIMATION_PRIORITIES: readonly AnimationPriority[] = [
  'low',
  'normal',
  'high',
  'critical',
];

/** Estrategias válidas. */
export const CONFLICT_STRATEGIES: readonly ConflictStrategy[] = [
  'replace',
  'queue',
  'ignore',
  'merge',
];

/** Disparadores válidos. */
export const ANIMATION_TRIGGERS: readonly AnimationTrigger[] = [
  'load',
  'scroll',
  'hover',
  'click',
  'visible',
  'manual',
];
