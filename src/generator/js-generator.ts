/**
 * Generador de código JavaScript para la API imperativa de WebMCP.
 *
 * Convierte un {@link ToolMap} (parseado de un `.webmcp.css`) en un script
 * que registra cada herramienta con `document.modelContext.registerTool()`,
 * siguiendo el estándar WebMCP propuesto para Chrome. Así, un sitio puede
 * empezar declarando sus herramientas en CSS y "graduarse" a la API nativa
 * sin reescribir nada a mano.
 */
import type { ParamSpec, ToolMap, ToolSpec } from '../types';
import { MODEL_CONTEXT_EXPR, MODEL_CONTEXT_MISSING_MSG } from '../standard/model-context';

/** Opciones del generador de código. */
export interface JsGeneratorOptions {
  /** Incluye un bloque de comentario con ejemplo de uso. Por defecto `true`. */
  includeExample?: boolean;
  /** Nombre del banner del archivo generado. */
  banner?: string;
}

/**
 * Construye el JSON Schema de entrada de una herramienta a partir de sus
 * parámetros escribibles (`value(...)`). Los parámetros de solo lectura
 * (`attr`, `text`, `literal`) se devuelven como salida, no como entrada.
 *
 * @param tool Especificación de la herramienta.
 */
export function buildInputSchema(tool: ToolSpec): {
  type: 'object';
  properties: Record<string, { type: string; description: string }>;
  required: string[];
} {
  const properties: Record<string, { type: string; description: string }> = {};
  const required: string[] = [];
  for (const [name, spec] of Object.entries(tool.params)) {
    if (spec.source === 'value') {
      // `webmcp-doc-<param>` (v1.1.0) documenta el parámetro como
      // `toolparamdescription` en la API declarativa.
      const documented = tool.meta?.[`doc-${name}`];
      properties[name] = {
        type: 'string',
        description:
          documented ||
          (spec.selector
            ? `Valor para el campo ${spec.selector}`
            : 'Valor para el propio elemento'),
      };
      required.push(name);
    }
  }
  return { type: 'object', properties, required };
}

/** Emite el código JS que lee un parámetro de solo lectura. */
function emitReadParam(name: string, spec: ParamSpec, toolSelector: string): string {
  const key = JSON.stringify(name);
  switch (spec.source) {
    case 'attr': {
      const attr = JSON.stringify(spec.value ?? '');
      return [
        `      out[${key}] = el.getAttribute(${attr}) ??`,
        `        el.closest('[' + ${attr} + ']')?.getAttribute(${attr}) ?? null;`,
      ].join('\n');
    }
    case 'text': {
      const sel = JSON.stringify(spec.selector ?? toolSelector);
      return `      out[${key}] = document.querySelector(${sel})?.textContent?.trim() ?? null;`;
    }
    case 'literal':
      return `      out[${key}] = ${JSON.stringify(spec.value ?? '')};`;
    default:
      return '';
  }
}

/** Emite el código JS que escribe un parámetro `value(...)`. */
function emitWriteParam(name: string, spec: ParamSpec, toolSelector: string): string {
  const key = JSON.stringify(name);
  const sel = JSON.stringify(spec.selector ?? toolSelector);
  return [
    `      if (args && args[${key}] !== undefined) {`,
    `        const input = document.querySelector(${sel});`,
    `        if (!input) throw new Error('Campo no encontrado: ' + ${sel});`,
    `        input.value = String(args[${key}]);`,
    `        input.dispatchEvent(new Event('input', { bubbles: true }));`,
    `        input.dispatchEvent(new Event('change', { bubbles: true }));`,
    `        out[${key}] = args[${key}];`,
    `      }`,
  ].join('\n');
}

/** Emite el cuerpo de la función `execute` de una herramienta. */
function emitExecuteBody(tool: ToolSpec): string {
  const sel = JSON.stringify(tool.selector);
  const lines: string[] = [
    `      const el = document.querySelector(${sel});`,
    `      if (!el) throw new Error('Elemento no encontrado: ' + ${sel});`,
    `      const out = {};`,
  ];

  for (const [name, spec] of Object.entries(tool.params)) {
    lines.push(
      spec.source === 'value'
        ? emitWriteParam(name, spec, tool.selector)
        : emitReadParam(name, spec, tool.selector),
    );
  }

  const trigger = tool.trigger ?? { event: 'click' };
  const targetSel = JSON.stringify(trigger.selector ?? tool.selector);
  if (trigger.event === 'submit') {
    lines.push(
      `      const target = document.querySelector(${targetSel});`,
      `      const form = target instanceof HTMLFormElement ? target : target?.closest('form');`,
      `      if (!form) throw new Error('Formulario no encontrado: ' + ${targetSel});`,
      `      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));`,
    );
  } else {
    lines.push(`      document.querySelector(${targetSel})?.click();`);
  }

  if (tool.confirmation) {
    lines.push(
      `      out.confirmed = !!document.querySelector(${JSON.stringify(tool.confirmation)});`,
    );
  }

  lines.push(`      return { content: [{ type: 'text', text: JSON.stringify(out) }] };`);
  return lines.filter(Boolean).join('\n');
}

/**
 * Genera un script JavaScript autoejecutable que registra todas las
 * herramientas del tool map con `document.modelContext.registerTool()`
 * (estándar WebMCP; cae a `navigator.modelContext` en navegadores antiguos).
 *
 * El script generado:
 * - Comprueba que `modelContext` exista (con aviso si no).
 * - Registra cada herramienta con nombre, descripción, `inputSchema` y una
 *   función `execute` que reproduce la semántica del `.webmcp.css`.
 * - Devuelve resultados en el formato `{ content: [{ type, text }] }` del
 *   estándar WebMCP.
 *
 * @param map Tool map parseado del `.webmcp.css`.
 * @param options Opciones de generación.
 * @returns Código JavaScript listo para incluir con `<script src=...>`.
 */
export function generateApiScript(
  map: ToolMap,
  options: JsGeneratorOptions = {},
): string {
  const includeExample = options.includeExample ?? true;
  const banner =
    options.banner ??
    'Generado por WebMCPcss (webmcpcss generate --api) - https://github.com/cochinoraptor/WebMCPcss';

  const toolBlocks = Object.entries(map.tools).map(([name, tool]) => {
    const schema = buildInputSchema(tool);
    return [
      `  mc.registerTool({`,
      `    name: ${JSON.stringify(name)},`,
      `    description: ${JSON.stringify(tool.description ?? `Herramienta "${name}" definida en .webmcp.css`)},`,
      `    inputSchema: ${JSON.stringify(schema)},`,
      `    async execute(args) {`,
      emitExecuteBody(tool),
      `    },`,
      `  });`,
    ].join('\n');
  });

  const example = includeExample
    ? [
        '/*',
        ' * Ejemplo de uso (desde un agente):',
        ' *',
        Object.keys(map.tools)
          .slice(0, 1)
          .map(
            (n) =>
              ` *   const result = await document.modelContext.executeTool?.("${n}", {...});`,
          )
          .join('\n'),
        ' *   // o deja que el agente del navegador descubra las herramientas registradas.',
        ' */',
      ].join('\n')
    : '';

  return [
    `/* ${banner} */`,
    example,
    `(function () {`,
    `  'use strict';`,
    `  // Estándar WebMCP: document.modelContext (canónico); navigator.modelContext es el alias obsoleto (Chrome < 150).`,
    `  const mc = ${MODEL_CONTEXT_EXPR};`,
    `  if (!mc || typeof mc.registerTool !== 'function') {`,
    `    console.warn('[WebMCPcss] ${MODEL_CONTEXT_MISSING_MSG}; las herramientas no se registraron.');`,
    `    return;`,
    `  }`,
    toolBlocks.join('\n\n'),
    `  console.info('[WebMCPcss] ${Object.keys(map.tools).length} herramienta(s) WebMCP registradas.');`,
    `})();`,
  ]
    .filter(Boolean)
    .join('\n');
}
