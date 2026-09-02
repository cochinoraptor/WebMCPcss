/**
 * Cliente de la API imperativa de WebMCP (`navigator.modelContext`).
 *
 * El estándar WebMCP propone que los sitios registren herramientas con
 * `navigator.modelContext.registerTool({ name, description, inputSchema, execute })`.
 * Este módulo permite a WebMCPcss:
 *
 * 1. Instalar un **shim de captura** ANTES de que cargue la página: si el
 *    navegador no implementa `navigator.modelContext` aún (o sí lo hace),
 *    las llamadas a `registerTool()`/`provideContext()` quedan registradas
 *    en `window.__webmcpApiRegistry`, de donde podemos leerlas e invocarlas.
 * 2. Listar las herramientas registradas ({@link readRegisteredTools}).
 * 3. Invocar una herramienta registrada ({@link invokeRegisteredTool}).
 *
 * Las tres funciones son AUTO-CONTENIDAS (sin referencias externas) para
 * poder serializarse al navegador con `page.evaluate()` de Puppeteer y, a la
 * vez, ejecutarse directamente sobre una `window` de jsdom en los tests.
 */
import type { RegisteredToolInfo } from '../types';

/** Nombre de la variable global donde el shim guarda el registro. */
export const API_REGISTRY_KEY = '__webmcpApiRegistry';

/** Forma interna del registro que mantiene el shim en la página. */
interface ApiRegistry {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
    execute?: (args: unknown) => unknown;
  }>;
  context: unknown[];
}

/**
 * Instala el shim de `navigator.modelContext` sobre una `window`.
 *
 * - Si el navegador ya implementa la API, envuelve `registerTool` para
 *   además anotar cada herramienta en el registro (modo espejo).
 * - Si no existe, crea un polyfill mínimo compatible con la superficie
 *   `registerTool()` / `provideContext()` del estándar propuesto.
 *
 * AUTO-CONTENIDA: apta para `page.evaluateOnNewDocument(installModelContextShim)`.
 *
 * @param win Objeto `window` (real o jsdom).
 */
export function installModelContextShim(win?: Window & { [k: string]: unknown }): void {
  const w = (win ?? globalThis) as Window & { [k: string]: unknown };
  const KEY = '__webmcpApiRegistry';
  if (w[KEY]) return; // ya instalado
  const registry = { tools: [], context: [] } as {
    tools: Array<{ name: string; [k: string]: unknown }>;
    context: unknown[];
  };
  w[KEY] = registry;

  const nav = w.navigator as Navigator & { modelContext?: Record<string, unknown> };
  const native = nav.modelContext;

  const record = (tool: { name: string }): void => {
    const idx = registry.tools.findIndex((t) => t.name === tool.name);
    if (idx >= 0) registry.tools[idx] = tool;
    else registry.tools.push(tool);
  };

  if (native && typeof native.registerTool === 'function') {
    // Modo espejo: la API nativa existe; interceptamos para poder listar.
    const nativeRegister = native.registerTool.bind(native) as (t: unknown) => unknown;
    native.registerTool = (tool: { name: string }) => {
      record(tool);
      return nativeRegister(tool);
    };
    return;
  }

  // Polyfill mínimo del estándar propuesto.
  const shim = {
    registerTool(tool: { name: string }): void {
      if (!tool || typeof tool.name !== 'string') {
        throw new TypeError('registerTool requiere un objeto con "name"');
      }
      record(tool);
    },
    provideContext(ctx: unknown): void {
      registry.context.push(ctx);
    },
    unregisterTool(name: string): void {
      const idx = registry.tools.findIndex((t) => t.name === name);
      if (idx >= 0) registry.tools.splice(idx, 1);
    },
  };
  try {
    Object.defineProperty(nav, 'modelContext', {
      value: shim,
      configurable: true,
    });
  } catch {
    (nav as unknown as Record<string, unknown>).modelContext = shim;
  }
}

/**
 * Lee las herramientas registradas (metadatos serializables, sin las
 * funciones `execute`). AUTO-CONTENIDA para `page.evaluate()`.
 *
 * @param win Objeto `window` con el shim instalado.
 * @returns Lista de herramientas registradas.
 */
export function readRegisteredTools(
  win?: Window & { [k: string]: unknown },
): RegisteredToolInfo[] {
  const w = (win ?? globalThis) as Window & { [k: string]: unknown };
  const registry = w['__webmcpApiRegistry'] as ApiRegistry | undefined;
  if (!registry) return [];
  return registry.tools.map((t) => ({
    name: t.name,
    description: typeof t.description === 'string' ? t.description : undefined,
    inputSchema: t.inputSchema !== undefined ? t.inputSchema : undefined,
  }));
}

/**
 * Invoca la función `execute` de una herramienta registrada.
 * AUTO-CONTENIDA para `page.evaluate()`. El resultado debe ser serializable.
 *
 * @param win Objeto `window` con el shim instalado.
 * @param name Nombre de la herramienta.
 * @param args Argumentos para `execute`.
 * @returns El resultado de la herramienta (posiblemente una promesa resuelta).
 */
export async function invokeRegisteredTool(
  win: (Window & { [k: string]: unknown }) | undefined,
  name: string,
  args: unknown,
): Promise<unknown> {
  const w = (win ?? globalThis) as Window & { [k: string]: unknown };
  const registry = w['__webmcpApiRegistry'] as ApiRegistry | undefined;
  const tool = registry?.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`Herramienta API no registrada: "${name}"`);
  if (typeof tool.execute !== 'function') {
    throw new Error(`La herramienta "${name}" no tiene función execute`);
  }
  return await tool.execute(args);
}
