/**
 * Generador de herramientas WebMCP a partir de un escaneo Tailwind.
 *
 * Para cada elemento con clases Tailwind genera herramientas por categoría:
 * `editCard1Spacing`, `editHeaderColors`, `editSubmitBtnTypography`... Cada
 * herramienta acepta `{ add, remove, replace }` y opera sobre el `classList`
 * del elemento en tiempo real.
 *
 * También puede emitir un script JS standalone (sin dependencias) que
 * registra esas herramientas vía `navigator.modelContext.registerTool()`.
 */
import type {
  TailwindCategory,
  TailwindScanEntry,
  TailwindToolDescriptor,
} from './types';

/** Categorías que generan herramienta propia (las más útiles para agentes). */
const TOOL_CATEGORIES: TailwindCategory[] = [
  'spacing',
  'colors',
  'typography',
  'layout',
  'sizing',
  'borders',
  'effects',
];

/** Pasa un nombre de categoría a PascalCase (`flexbox-grid` → `FlexboxGrid`). */
function pascal(category: string): string {
  return category
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

/**
 * Genera descriptores de herramientas de edición Tailwind para una página.
 *
 * @param entries Resultado de `scanDocument()` (o equivalente serializado).
 * @param options `categories`: limitar categorías; `includeGeneric`: añadir
 *   además una herramienta `edit<Id>Classes` sin restricción de categoría.
 * @returns Lista de descriptores listos para registrar o serializar.
 */
export function generateTailwindTools(
  entries: TailwindScanEntry[],
  options: { categories?: TailwindCategory[]; includeGeneric?: boolean } = {},
): TailwindToolDescriptor[] {
  const categories = options.categories ?? TOOL_CATEGORIES;
  const tools: TailwindToolDescriptor[] = [];

  for (const entry of entries) {
    for (const category of categories) {
      const current = entry.inspection.classes[category];
      if (!current || current.length === 0) continue;
      tools.push({
        name: `edit${entry.id}${pascal(category)}`,
        description:
          `Edita las clases Tailwind de ${category} del elemento <${entry.tag}> ` +
          `(${entry.selector}). Clases actuales: ${current.join(' ')}`,
        selector: entry.selector,
        category,
        currentClasses: current,
        inputSchema: {
          type: 'object',
          properties: {
            add: {
              type: 'string',
              description: `Clases Tailwind a añadir (separadas por espacio), p. ej. "p-8 mt-4"`,
            },
            remove: {
              type: 'string',
              description: 'Clases a eliminar (separadas por espacio)',
            },
            replace: {
              type: 'string',
              description: 'Reemplazo "vieja:nueva", p. ej. "p-4:p-8"',
            },
          },
        },
      });
    }
    if (options.includeGeneric) {
      tools.push({
        name: `edit${entry.id}Classes`,
        description:
          `Edita cualquier clase del elemento <${entry.tag}> (${entry.selector}). ` +
          `Clases actuales: ${entry.classList.join(' ')}`,
        selector: entry.selector,
        category: 'all',
        currentClasses: entry.classList,
        inputSchema: {
          type: 'object',
          properties: {
            add: {
              type: 'string',
              description: 'Clases a añadir (separadas por espacio)',
            },
            remove: { type: 'string', description: 'Clases a eliminar' },
            replace: { type: 'string', description: 'Reemplazo "vieja:nueva"' },
          },
        },
      });
    }
  }
  return tools;
}

/**
 * Ejecuta los argumentos `{ add, remove, replace }` de una herramienta
 * Tailwind sobre un elemento. Compartida por el registro en memoria y el
 * script generado (se serializa en el script).
 *
 * @param el Elemento objetivo.
 * @param args Argumentos de la herramienta.
 * @returns Resumen de la operación.
 */
export function applyToolArgs(
  el: Element,
  args: { add?: string; remove?: string; replace?: string },
): { added: string[]; removed: string[]; classList: string } {
  const added: string[] = [];
  const removed: string[] = [];
  if (args.replace) {
    const [oldCls, newCls] = args.replace.split(':').map((s) => s.trim());
    if (oldCls && el.classList.contains(oldCls)) {
      el.classList.remove(oldCls);
      removed.push(oldCls);
    }
    if (newCls) {
      el.classList.add(newCls);
      added.push(newCls);
    }
  }
  for (const cls of (args.remove ?? '').split(/\s+/).filter(Boolean)) {
    if (el.classList.contains(cls)) {
      el.classList.remove(cls);
      removed.push(cls);
    }
  }
  for (const cls of (args.add ?? '').split(/\s+/).filter(Boolean)) {
    if (!el.classList.contains(cls)) {
      el.classList.add(cls);
      added.push(cls);
    }
  }
  return { added, removed, classList: el.getAttribute('class') ?? '' };
}

/**
 * Genera un script JS standalone que registra las herramientas en
 * `navigator.modelContext` (con guard defensivo si la API no existe).
 *
 * @param tools Descriptores generados por `generateTailwindTools()`.
 * @returns Código JavaScript listo para incluir con `<script src>`.
 */
export function buildTailwindToolsScript(tools: TailwindToolDescriptor[]): string {
  const descriptors = JSON.stringify(
    tools.map(({ name, description, selector, inputSchema }) => ({
      name,
      description,
      selector,
      inputSchema,
    })),
    null,
    2,
  );

  return `/**
 * Herramientas WebMCP de edición Tailwind — generado por WebMCPcss.
 * ${tools.length} herramienta(s). No editar a mano.
 */
(function () {
  'use strict';
  var mc = typeof navigator !== 'undefined' ? navigator.modelContext : undefined;
  if (!mc || typeof mc.registerTool !== 'function') {
    console.warn('[WebMCPcss] navigator.modelContext no disponible; herramientas Tailwind no registradas.');
    return;
  }

  var TOOLS = ${descriptors.replace(/\n/g, '\n  ')};

  function applyArgs(el, args) {
    var added = [], removed = [];
    if (args && args.replace) {
      var parts = args.replace.split(':');
      var oldCls = (parts[0] || '').trim();
      var newCls = (parts[1] || '').trim();
      if (oldCls && el.classList.contains(oldCls)) { el.classList.remove(oldCls); removed.push(oldCls); }
      if (newCls) { el.classList.add(newCls); added.push(newCls); }
    }
    ((args && args.remove) || '').split(/\\s+/).forEach(function (cls) {
      if (cls && el.classList.contains(cls)) { el.classList.remove(cls); removed.push(cls); }
    });
    ((args && args.add) || '').split(/\\s+/).forEach(function (cls) {
      if (cls && !el.classList.contains(cls)) { el.classList.add(cls); added.push(cls); }
    });
    return { added: added, removed: removed, classList: el.getAttribute('class') || '' };
  }

  TOOLS.forEach(function (tool) {
    mc.registerTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      async execute(args) {
        var el = document.querySelector(tool.selector);
        if (!el) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Elemento no encontrado: ' + tool.selector }) }] };
        }
        var result = applyArgs(el, args || {});
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, selector: tool.selector, added: result.added, removed: result.removed, classList: result.classList }) }] };
      },
    });
  });

  console.log('[WebMCPcss] ' + TOOLS.length + ' herramienta(s) Tailwind registradas.');
})();
`;
}
