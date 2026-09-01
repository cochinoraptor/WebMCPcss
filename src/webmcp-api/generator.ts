/**
 * Generador de código para la API imperativa de WebMCP: convierte un
 * `.webmcp.css` en un script de navegador con `registerTool()` por
 * herramienta (CSS → API).
 */
import type { ToolDef, ToolMap } from '../types';

/**
 * Construye el `inputSchema` (JSON Schema) de una herramienta a partir de
 * sus parámetros declarados.
 *
 * @param tool Definición de la herramienta.
 * @returns Esquema JSON `{ type: 'object', properties, required: [] }`.
 */
export function buildInputSchema(tool: ToolDef): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const [name, source] of Object.entries(tool.params)) {
    properties[name] = {
      type: 'string',
      description:
        source.source === 'attr'
          ? `Tomado del atributo ${source.value} del elemento`
          : source.source === 'literal'
            ? `Valor fijo "${source.value}"`
            : `Leído de la página${source.selector ? ` (${source.selector})` : ''}`,
    };
  }
  return { type: 'object', properties, required: [] };
}

/**
 * Genera un script de navegador autocontenido que registra todas las
 * herramientas del tool map con `navigator.modelContext.registerTool()`.
 *
 * @param map Tool map de origen.
 * @param options Opciones del generador.
 * @returns Código JavaScript listo para `<script src="webmcp-tools.js">`.
 */
export function generateApiScript(
  map: ToolMap,
  options: { headerComment?: string } = {},
): string {
  const parts: string[] = [];
  const header = options.headerComment ?? 'Generado por webmcpcss — no editar a mano';
  parts.push(`/* ${header} */`);
  parts.push(`(function () {`);
  parts.push(`  'use strict';`);
  parts.push(`  var mc = navigator.modelContext;`);
  parts.push(`  if (!mc || typeof mc.registerTool !== 'function') {`);
  parts.push(`    console.warn('[webmcp] navigator.modelContext no disponible');`);
  parts.push(`    return;`);
  parts.push(`  }`);
  parts.push(RUNTIME_HELPERS);
  for (const [name, tool] of Object.entries(map.tools)) {
    parts.push(generateToolRegistration(name, tool));
  }
  parts.push(`})();`);
  return `${parts.join('\n')}\n`;
}

/**
 * Genera el bloque `registerTool` de una herramienta concreta.
 */
function generateToolRegistration(name: string, tool: ToolDef): string {
  const description = tool.description ?? `Herramienta ${name} (${tool.selector})`;
  const lines: string[] = [];
  lines.push(`  mc.registerTool({`);
  lines.push(`    name: ${JSON.stringify(name)},`);
  lines.push(`    description: ${JSON.stringify(description)},`);
  lines.push(`    inputSchema: ${JSON.stringify(buildInputSchema(tool))},`);
  lines.push(`    execute: async function (params) {`);
  lines.push(`      params = params || {};`);
  lines.push(
    `      var elements = Array.prototype.slice.call(document.querySelectorAll(${JSON.stringify(tool.selector)}));`,
  );
  lines.push(`      if (elements.length === 0) {`);
  lines.push(
    `        return { success: false, error: 'selector sin elementos: ${escapeForJs(tool.selector)}' };`,
  );
  lines.push(`      }`);
  lines.push(
    `      var el = __webmcpPick(elements, params, ${JSON.stringify(tool.params)});`,
  );
  lines.push(
    `      __webmcpDispatch(el, ${JSON.stringify(tool.trigger ?? { event: 'click' })});`,
  );
  if (tool.confirmation) {
    lines.push(
      `      var confirmed = await __webmcpWaitFor(${JSON.stringify(tool.confirmation)}, 1500);`,
    );
  } else {
    lines.push(`      var confirmed = true;`);
  }
  lines.push(`      return {`);
  lines.push(`        success: confirmed,`);
  lines.push(
    `        params: __webmcpParams(el, params, ${JSON.stringify(tool.params)}),`,
  );
  lines.push(`        confirmed: confirmed`);
  lines.push(`      };`);
  lines.push(`    }`);
  lines.push(`  });`);
  return lines.join('\n');
}

/** Helpers de runtime embebidos en el script generado. */
const RUNTIME_HELPERS = `  var __webmcpText = function (el) {
    return (el.textContent || '').replace(/\\s+/g, ' ').trim();
  };
  var __webmcpParams = function (el, provided, declared) {
    var out = {};
    Object.keys(declared || {}).forEach(function (name) {
      var d = declared[name];
      if (d.source === 'attr') out[name] = el.getAttribute(d.value) || '';
      else if (d.source === 'literal') out[name] = d.value;
      else if (d.source === 'value') {
        var t = d.selector ? document.querySelector(d.selector) : el;
        out[name] = t ? (t.value || '') : '';
      } else if (d.source === 'text') {
        var t2 = d.selector ? document.querySelector(d.selector) : el;
        out[name] = t2 ? __webmcpText(t2) : '';
      }
    });
    Object.keys(provided || {}).forEach(function (k) { out[k] = provided[k]; });
    return out;
  };
  var __webmcpPick = function (elements, provided, declared) {
    var names = Object.keys(provided).filter(function (k) { return declared && k in declared; });
    if (names.length === 0) return elements[0];
    for (var i = 0; i < elements.length; i++) {
      var resolved = __webmcpParams(elements[i], {}, declared);
      var match = names.every(function (k) {
        var want = String(provided[k]).toLowerCase();
        var got = String(resolved[k] || '').toLowerCase();
        return got === want || got.indexOf(want) !== -1 || want.indexOf(got) !== -1;
      });
      if (match) return elements[i];
    }
    return elements[0];
  };
  var __webmcpDispatch = function (el, trigger) {
    if (trigger.on) {
      var target = document.querySelector(trigger.on);
      if (target) { target.dispatchEvent(new Event(trigger.event, { bubbles: true })); }
      return;
    }
    if (trigger.event === 'click') { el.click(); return; }
    el.dispatchEvent(new Event(trigger.event, { bubbles: true }));
  };
  var __webmcpWaitFor = function (selector, timeoutMs) {
    return new Promise(function (resolve) {
      var started = Date.now();
      var check = function () {
        var parts = selector.split(',').map(function (s) { return s.trim(); });
        for (var i = 0; i < parts.length; i++) {
          if (document.querySelector(parts[i])) return resolve(true);
        }
        if (Date.now() - started >= timeoutMs) return resolve(false);
        setTimeout(check, 60);
      };
      check();
    });
  };`;

/**
 * Escapa un texto para incrustarlo en una cadena JS de comillas simples.
 */
function escapeForJs(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
