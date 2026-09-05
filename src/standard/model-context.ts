/**
 * Localización de la API imperativa de WebMCP en el navegador.
 *
 * El borrador del estándar (W3C WebML CG, mayo/julio de 2026) movió el
 * getter de `navigator.modelContext` a **`document.modelContext`**: las
 * herramientas pertenecen a una página, no al navegador. Chromium 150
 * marca `navigator.modelContext` como obsoleto (sigue existiendo como alias
 * y se eliminará en una versión futura).
 *
 * WebMCPcss usa siempre la forma canónica y cae al alias antiguo cuando es
 * lo único disponible, de modo que el código generado funciona en Chrome
 * 146–149 (solo `navigator`), en Chrome 150+ (ambos) y en el futuro (solo
 * `document`).
 */

/** Superficie mínima de `modelContext` que usa WebMCPcss. */
export interface ModelContextLike {
  registerTool(tool: {
    name: string;
    description?: string;
    inputSchema?: unknown;
    execute?: (args: unknown) => unknown;
    [k: string]: unknown;
  }): unknown;
  unregisterTool?(name: string): unknown;
  provideContext?(ctx: unknown): unknown;
  clearContext?(): unknown;
  getTools?(): unknown;
  executeTool?(name: string, args: unknown): unknown;
  [k: string]: unknown;
}

/** Ubicaciones conocidas de la API, de la canónica a la más antigua. */
export const MODEL_CONTEXT_LOCATIONS = [
  'document.modelContext',
  'navigator.modelContext',
] as const;

/** Ubicación canónica según el borrador vigente del estándar. */
export const MODEL_CONTEXT_CANONICAL = MODEL_CONTEXT_LOCATIONS[0];

/**
 * Expresión JavaScript (ES5, sin dependencias) que resuelve la API en el
 * navegador. Pensada para incrustarse en código generado:
 *
 * ```js
 * var mc = ${MODEL_CONTEXT_EXPR};
 * ```
 */
export const MODEL_CONTEXT_EXPR =
  "((typeof document !== 'undefined' && document.modelContext) || (typeof navigator !== 'undefined' && navigator.modelContext) || undefined)";

/** Mensaje estándar cuando la API no está disponible. */
export const MODEL_CONTEXT_MISSING_MSG =
  'document.modelContext no está disponible (Chrome 146+ con WebMCP activado)';

/**
 * Devuelve la API imperativa disponible en una `window` (real o jsdom):
 * primero `document.modelContext`, después el alias `navigator.modelContext`.
 *
 * @param win Objeto `window`. Por defecto, `globalThis`.
 * @returns La API o `undefined`.
 */
export function getModelContext(
  win?: Window | typeof globalThis,
): ModelContextLike | undefined {
  const w = (win ?? globalThis) as unknown as {
    document?: { modelContext?: ModelContextLike };
    navigator?: { modelContext?: ModelContextLike };
  };
  const fromDoc = w.document?.modelContext;
  if (fromDoc && typeof fromDoc.registerTool === 'function') return fromDoc;
  const fromNav = w.navigator?.modelContext;
  if (fromNav && typeof fromNav.registerTool === 'function') return fromNav;
  return undefined;
}

/**
 * Indica dónde está expuesta la API en una `window`.
 *
 * @param win Objeto `window`.
 * @returns `'document'`, `'navigator'` (solo el alias obsoleto) o `'none'`.
 */
export function modelContextLocation(
  win?: Window | typeof globalThis,
): 'document' | 'navigator' | 'none' {
  const w = (win ?? globalThis) as unknown as {
    document?: { modelContext?: unknown };
    navigator?: { modelContext?: unknown };
  };
  if (w.document?.modelContext) return 'document';
  if (w.navigator?.modelContext) return 'navigator';
  return 'none';
}

/**
 * Define `value` como `modelContext` en `document` y, como alias de
 * compatibilidad, en `navigator`. Silencioso si alguna de las dos no admite
 * la propiedad (p. ej. objetos congelados).
 *
 * @param win Objeto `window`.
 * @param value API a instalar.
 */
export function defineModelContext(
  win: Window | typeof globalThis,
  value: ModelContextLike,
): void {
  const w = win as unknown as { document?: object; navigator?: object };
  for (const target of [w.document, w.navigator]) {
    if (!target) continue;
    try {
      Object.defineProperty(target, 'modelContext', {
        value,
        configurable: true,
        writable: true,
      });
    } catch {
      try {
        (target as Record<string, unknown>).modelContext = value;
      } catch {
        /* objeto no extensible */
      }
    }
  }
}
