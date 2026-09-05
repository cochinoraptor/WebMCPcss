/**
 * Cliente de la API imperativa de WebMCP (`document.modelContext`).
 *
 * El estándar WebMCP propone que los sitios registren herramientas con
 * `document.modelContext.registerTool({ name, description, inputSchema, execute })`
 * (`navigator.modelContext` fue la ubicación original y sigue como alias
 * obsoleto desde Chromium 150). Este módulo permite a WebMCPcss:
 *
 * 1. Instalar un **shim de captura** ANTES de que cargue la página: si el
 *    navegador no implementa `modelContext` aún (o sí lo hace, en cualquiera
 *    de las dos ubicaciones), las llamadas a `registerTool()`/`provideContext()`
 *    quedan registradas en `window.__webmcpApiRegistry`, de donde podemos
 *    leerlas e invocarlas.
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
 * Instala el shim de `modelContext` sobre una `window`.
 *
 * - Si el navegador ya implementa la API (en `document.modelContext` o en el
 *   alias obsoleto `navigator.modelContext`), envuelve `registerTool` para
 *   además anotar cada herramienta en el registro (modo espejo) y expone la
 *   misma instancia en la otra ubicación, de modo que el código del sitio
 *   funcione use el nombre que use.
 * - Si no existe, crea un polyfill mínimo compatible con la superficie
 *   `registerTool()` / `unregisterTool()` / `provideContext()` /
 *   `clearContext()` / `getTools()` / `executeTool()` del estándar y lo
 *   publica en **ambas** ubicaciones.
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

  type MC = Record<string, unknown> & { registerTool?: unknown };
  const doc = w.document as unknown as { modelContext?: MC } | undefined;
  const nav = w.navigator as unknown as { modelContext?: MC } | undefined;
  const native: MC | undefined =
    doc && doc.modelContext && typeof doc.modelContext.registerTool === 'function'
      ? doc.modelContext
      : nav && nav.modelContext && typeof nav.modelContext.registerTool === 'function'
        ? nav.modelContext
        : undefined;

  const record = (tool: { name: string }): void => {
    const idx = registry.tools.findIndex((t) => t.name === tool.name);
    if (idx >= 0) registry.tools[idx] = tool;
    else registry.tools.push(tool);
  };

  const publish = (value: unknown): void => {
    const targets: Array<object | undefined> = [
      doc as object | undefined,
      nav as object | undefined,
    ];
    for (const target of targets) {
      if (!target) continue;
      if ((target as { modelContext?: unknown }).modelContext === value) continue;
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
  };

  if (native) {
    // Modo espejo: la API nativa existe; interceptamos para poder listar.
    const nativeRegister = (native.registerTool as (t: unknown) => unknown).bind(native);
    native.registerTool = (tool: { name: string }) => {
      record(tool);
      return nativeRegister(tool);
    };
    publish(native);
    return;
  }

  // Polyfill mínimo del estándar.
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
    clearContext(): void {
      registry.context.length = 0;
      registry.tools.length = 0;
    },
    unregisterTool(name: string): void {
      const idx = registry.tools.findIndex((t) => t.name === name);
      if (idx >= 0) registry.tools.splice(idx, 1);
    },
    getTools(): Array<{ name: string; description?: unknown; inputSchema?: unknown }> {
      return registry.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    async executeTool(name: string, args: unknown): Promise<unknown> {
      const tool = registry.tools.find((t) => t.name === name);
      if (!tool || typeof tool.execute !== 'function') {
        throw new Error('Herramienta no registrada: ' + name);
      }
      return await (tool.execute as (a: unknown) => unknown)(args);
    },
  };
  publish(shim);
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
