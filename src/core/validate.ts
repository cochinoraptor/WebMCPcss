/**
 * Validación: comprueba que los selectores del tool map resuelvan a al
 * menos un elemento de la página actual.
 */
import type { PageAdapter } from '../adapters/PageAdapter';
import type { ValidationEntry, ValidationReport, ToolMap } from '../types';

/**
 * Valida herramientas y contextos de un tool map contra la página.
 *
 * Si el adaptador implementa `ApiToolSource`, incluye también las
 * herramientas registradas vía `navigator.modelContext` (kind `api`).
 *
 * @param adapter Página actual.
 * @param map Tool map a validar.
 * @returns Reporte con una entrada por herramienta/contexto.
 */
export async function validateToolMap(
  adapter: PageAdapter,
  map: ToolMap,
): Promise<ValidationReport> {
  const entries: ValidationEntry[] = [];

  for (const [name, tool] of Object.entries(map.tools)) {
    const count = (await adapter.queryAll(tool.selector)).length;
    entries.push({
      kind: 'css',
      type: 'tool',
      name,
      selector: tool.selector,
      count,
      ok: count > 0,
    });
  }

  for (const [name, ctx] of Object.entries(map.context)) {
    const count = (await adapter.queryAll(ctx.selector)).length;
    entries.push({
      kind: 'css',
      type: 'context',
      name,
      selector: ctx.selector,
      count,
      ok: count > 0,
    });
  }

  const apiSource = adapter as PageAdapter & {
    listApiTools?: () => Promise<{ name: string }[]>;
  };
  if (typeof apiSource.listApiTools === 'function') {
    try {
      const apiTools = await apiSource.listApiTools();
      for (const tool of apiTools) {
        entries.push({
          kind: 'api',
          type: 'tool',
          name: tool.name,
          selector: '-',
          count: 1,
          ok: true,
        });
      }
    } catch {
      // La página no expone la API: se omite sin romper la validación CSS.
    }
  }

  return { target: adapter.url, entries, ok: entries.every((e) => e.ok) };
}
