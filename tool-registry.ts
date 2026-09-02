/**
 * Registro en memoria de herramientas Tailwind vía `navigator.modelContext`.
 *
 * A diferencia del script generado (`buildTailwindToolsScript`), este módulo
 * registra las herramientas directamente sobre un objeto `Window` vivo
 * (navegador o jsdom), lo que permite testearlo con el shim
 * `installModelContextShim()` de `src/webmcp-api`.
 */
import { applyToolArgs } from './tool-generator';
import type { TailwindToolDescriptor } from './types';

/** Forma mínima de `navigator.modelContext` que necesitamos. */
interface ModelContextLike {
  registerTool(tool: {
    name: string;
    description: string;
    inputSchema: unknown;
    execute(args: Record<string, unknown>): Promise<unknown>;
  }): void;
}

/**
 * Registra herramientas de edición Tailwind en `navigator.modelContext`.
 *
 * @param win Ventana objetivo (navegador real o jsdom con shim).
 * @param tools Descriptores generados por `generateTailwindTools()`.
 * @returns Número de herramientas registradas (0 si la API no existe).
 */
export function registerTailwindTools(
  win: Window,
  tools: TailwindToolDescriptor[],
): number {
  const nav = win.navigator as Navigator & { modelContext?: ModelContextLike };
  const mc = nav.modelContext;
  if (!mc || typeof mc.registerTool !== 'function') return 0;

  let count = 0;
  for (const tool of tools) {
    mc.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      execute: async (args: Record<string, unknown>) => {
        const el = win.document.querySelector(tool.selector);
        if (!el) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: `Elemento no encontrado: ${tool.selector}`,
                }),
              },
            ],
          };
        }
        const result = applyToolArgs(el, {
          add: typeof args.add === 'string' ? args.add : undefined,
          remove: typeof args.remove === 'string' ? args.remove : undefined,
          replace: typeof args.replace === 'string' ? args.replace : undefined,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true, selector: tool.selector, ...result }),
            },
          ],
        };
      },
    });
    count++;
  }
  return count;
}
