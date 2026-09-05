/**
 * Retro-WebMCP: inyector en tiempo real.
 *
 * Genera el script que expone `window.__WEBMCP_GRAPH__` (y opcionalmente
 * registra las herramientas en `document.modelContext`) y lo inyecta en una
 * página abierta con Puppeteer, con un observador de mutaciones para
 * sobrevivir a navegaciones SPA parciales.
 */
import type { Page } from 'puppeteer';
import type { ToolMap } from '../types';
import { VERSION } from '../version';

/** Opciones del script de inyección. */
export interface RetroInjectOptions {
  /** Registrar en document.modelContext (def. true). */
  registerModelContext?: boolean;
  /** Marcar visualmente los elementos con herramientas (depuración). */
  highlight?: boolean;
}

/**
 * Construye el script autocontenido de inyección.
 * @param toolMap Tool map.
 * @param css CSS original (se adjunta como `<style type="text/webmcp">`).
 * @param opts Opciones.
 */
export function buildRetroInjectScript(
  toolMap: ToolMap,
  css: string,
  opts: RetroInjectOptions = {},
): string {
  const graph = JSON.stringify({
    version: VERSION,
    generatedBy: 'webmcpcss retro',
    tools: Object.entries(toolMap.tools).map(([name, t]) => ({
      name,
      description: t.description ?? '',
      selector: t.selector,
      params: Object.fromEntries(
        Object.entries(t.params).map(([p, s]) => [
          p,
          { type: 'string', source: s.source, selector: s.selector, value: s.value },
        ]),
      ),
      trigger: t.trigger ?? { event: 'click' },
      confirmation: t.confirmation,
      meta: t.meta,
    })),
    context: Object.entries(toolMap.context).map(([name, c]) => ({
      name,
      selector: c.selector,
      format: c.format,
    })),
  }).replace(/</g, '\\u003c');
  const register = opts.registerModelContext !== false;
  return `(function(){
'use strict';
if (window.__WEBMCP_RETRO__) return;
var GRAPH = ${graph};
try { Object.defineProperty(window, '__WEBMCP_GRAPH__', { value: GRAPH, configurable: true }); } catch (e) { window.__WEBMCP_GRAPH__ = GRAPH; }
window.__WEBMCP_RETRO__ = { version: GRAPH.version, injectedAt: new Date().toISOString() };
if (!document.querySelector('style[data-webmcpcss="retro"]')) {
  var s = document.createElement('style'); s.type = 'text/webmcp'; s.setAttribute('data-webmcpcss', 'retro');
  s.textContent = ${JSON.stringify(css)}; (document.head || document.documentElement).appendChild(s);
}
function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
function readParam(spec, el) {
  var target = spec.selector ? q(spec.selector) : el;
  if (!target) return null;
  if (spec.source === 'attr') return target.getAttribute(spec.value);
  if (spec.source === 'text') return (target.textContent || '').trim();
  if (spec.source === 'literal') return spec.value;
  return 'value' in target ? target.value : null;
}
function writeParam(spec, el, val) {
  var target = spec.selector ? q(spec.selector) : el;
  if (!target || spec.source !== 'value') return;
  target.value = val; target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true }));
}
function run(tool, args) {
  var el = q(tool.selector);
  if (!el) return { success: false, error: 'No existe ' + tool.selector };
  Object.keys(tool.params || {}).forEach(function (p) { if (args && args[p] != null) writeParam(tool.params[p], el, String(args[p])); });
  var ev = (tool.trigger && tool.trigger.event) || 'click';
  var trg = tool.trigger && tool.trigger.selector ? q(tool.trigger.selector) : el;
  if (ev === 'submit' && trg && trg.tagName === 'FORM') { if (trg.requestSubmit) trg.requestSubmit(); else trg.submit(); }
  else if (ev === 'click' && trg) { trg.click(); }
  else if (trg) { trg.dispatchEvent(new Event(ev, { bubbles: true })); }
  return { success: true, tool: tool.name };
}
window.__WEBMCP_RETRO__.run = function (name, args) { var t = GRAPH.tools.filter(function (x) { return x.name === name; })[0]; return t ? run(t, args) : { success: false, error: 'Herramienta desconocida' }; };
window.__WEBMCP_RETRO__.context = function () { var out = {}; GRAPH.context.forEach(function (c) { var el = q(c.selector); out[c.name] = el ? (el.textContent || '').trim() : null; }); return out; };
window.__WEBMCP_RETRO__.status = function () { return GRAPH.tools.map(function (t) { return { name: t.name, exists: !!q(t.selector) }; }); };
${
  register
    ? `var mc = (typeof document !== 'undefined' && document.modelContext) || (typeof navigator !== 'undefined' && navigator.modelContext) || undefined;
if (mc && typeof mc.registerTool === 'function') {
  GRAPH.tools.forEach(function (t) {
    try { mc.registerTool({ name: t.name, description: t.description, inputSchema: { type: 'object', properties: Object.fromEntries(Object.keys(t.params||{}).map(function(p){return [p,{type:'string'}];})) }, execute: function (args) { var r = run(t, args); return { content: [{ type: 'text', text: JSON.stringify(r) }] }; } }); } catch (e) {}
  });
}`
    : ''
}
${opts.highlight ? `GRAPH.tools.forEach(function (t) { var el = q(t.selector); if (el) { el.style.outline = '2px dashed #38bdf8'; el.setAttribute('data-webmcp-tool', t.name); } });` : ''}
})();`;
}

/** Resultado de la inyección en Puppeteer. */
export interface RetroInjectResult {
  injected: boolean;
  tools: Array<{ name: string; exists: boolean }>;
  missing: string[];
}

/**
 * Inyecta el script en una página de Puppeteer (y en futuras navegaciones).
 * @param page Página ya navegada.
 * @param toolMap Tool map.
 * @param css CSS.
 * @param opts Opciones.
 */
export async function injectRetro(
  page: Page,
  toolMap: ToolMap,
  css: string,
  opts: RetroInjectOptions = {},
): Promise<RetroInjectResult> {
  const script = buildRetroInjectScript(toolMap, css, opts);
  await page.evaluateOnNewDocument(script);
  await page.evaluate(script);
  const tools = (await page.evaluate(
    () =>
      (
        window as unknown as {
          __WEBMCP_RETRO__?: { status: () => Array<{ name: string; exists: boolean }> };
        }
      ).__WEBMCP_RETRO__?.status() ?? [],
  )) as Array<{ name: string; exists: boolean }>;
  return {
    injected: tools.length > 0 || Object.keys(toolMap.tools).length === 0,
    tools,
    missing: tools.filter((t) => !t.exists).map((t) => t.name),
  };
}
