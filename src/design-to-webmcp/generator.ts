/**
 * Design-to-WebMCP: generador de `.webmcp.css` desde una estructura de diseño.
 *
 * Cada elemento interactivo se convierte en una herramienta con selector
 * **estable propuesto** (`[data-tool="…"]`), descripción, intención, política
 * de confirmación y, para formularios, parámetros por campo. También genera
 * un HTML de andamiaje con esos mismos `data-tool`, para que diseño y código
 * nazcan alineados.
 */
import { renderComponent, toKebab, toToolName, type IaField } from '../framework/components';
import { serializeToolMap } from '../parser';
import type { ToolMap, ToolSpec } from '../types';
import type { DesignElement, DesignStructure } from './analyzer';

/** Resultado de la generación. */
export interface DesignGeneration {
  toolMap: ToolMap;
  css: string;
  /** HTML de andamiaje con los `data-tool` esperados. */
  scaffoldHtml: string;
  /** Correspondencia elemento de diseño → herramienta. */
  mapping: Array<{ elementId: string; tool: string; selector: string; confidence: number }>;
  warnings: string[];
}

/** Nombre de herramienta único a partir de un elemento. */
function toolNameFor(el: DesignElement, used: Set<string>): string {
  let base: string;
  if (el.kind === 'button') {
    base = toToolName(el.label || el.id, 'doAction');
    if (el.intent === 'submit' && !/submit|send|login|register|pay|buy|checkout|subscribe/i.test(base)) base = `submit${base[0].toUpperCase()}${base.slice(1)}`;
  } else if (el.kind === 'link' || el.kind === 'nav') {
    base = toToolName(`go ${el.label || el.id}`, 'navigate');
  } else if (el.kind === 'form') {
    base = toToolName(el.label || el.id, 'submitForm');
  } else {
    base = toToolName(el.label || el.id, el.kind);
  }
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}${n++}`;
  used.add(name);
  return name;
}

/** ¿La acción debería pedir confirmación? */
function needsConfirmation(el: DesignElement): boolean {
  if (/buscar|search|filtrar|filter|ordenar|sort/i.test(el.label)) return false;
  return /pagar|pay|checkout|comprar|buy|eliminar|delete|borrar|remove|cancelar suscripci|unsubscribe|transfer/i.test(el.label) || el.intent === 'submit';
}

/**
 * Genera tool map + CSS + andamiaje HTML desde la estructura de diseño.
 * @param design Estructura analizada.
 */
export function generateFromDesign(design: DesignStructure): DesignGeneration {
  const map: ToolMap = { tools: {}, context: {} };
  const used = new Set<string>();
  const mapping: DesignGeneration['mapping'] = [];
  const warnings: string[] = [];
  const byId = new Map(design.elements.map((e) => [e.id, e]));
  const childrenOf = (id: string) => design.elements.filter((e) => e.parent === id);
  const consumed = new Set<string>();
  const htmlParts: string[] = [];

  // 1) Formularios: campos → params, botón submit → selector.
  for (const form of design.elements.filter((e) => e.kind === 'form')) {
    const kids = childrenOf(form.id);
    const fields = kids.filter((k) => ['input', 'textarea', 'select', 'checkbox'].includes(k.kind));
    const submit = kids.find((k) => k.kind === 'button' && (k.intent === 'submit' || !k.intent)) ?? kids.find((k) => k.kind === 'button');
    if (fields.length === 0 && !submit) continue;
    const label = submit?.label || form.label || 'Enviar';
    const name = toolNameFor({ ...form, label: submit?.label || form.label }, used);
    const kebab = toKebab(name);
    const params: ToolSpec['params'] = {};
    const iaFields: IaField[] = [];
    fields.forEach((f, i) => {
      const fname = (f.fieldName ?? toToolName(f.label, `field${i + 1}`)).replace(/[^a-zA-Z0-9]/g, '') || `field${i + 1}`;
      let key = fname;
      let k = 2;
      while (params[key]) key = `${fname}${k++}`;
      params[key] = { source: 'value', selector: `#${kebab}-${toKebab(key)}` };
      iaFields.push({ name: key, label: f.label || key, type: f.kind === 'textarea' ? 'textarea' : f.kind === 'select' ? 'select' : /email/i.test(key) ? 'email' : /password|contrase/i.test(key) ? 'password' : 'text', placeholder: f.placeholder, required: f.confidence > 0.5 });
      consumed.add(f.id);
    });
    if (submit) consumed.add(submit.id);
    consumed.add(form.id);
    const selector = `[data-tool="${kebab}-submit"]`;
    map.tools[name] = {
      selector,
      description: `${label}${form.label && form.label !== label ? ` (${form.label})` : ''}`,
      params,
      trigger: { event: 'submit', selector: `#${kebab}-form` },
      confirmation: `[data-confirmation="${kebab}"]`,
      meta: { component: 'form', intent: 'submit', confirmation: needsConfirmation(submit ?? form) ? 'needed' : 'none', accessibility: `aria-label: ${label.replace(/"/g, "'")}`, 'design-id': form.id },
    };
    mapping.push({ elementId: form.id, tool: name, selector, confidence: Math.min(form.confidence, submit?.confidence ?? 1) });
    htmlParts.push(renderComponent('form', { tool: name, label, fields: iaFields, description: label }).html);
  }

  // 2) Navegación: enlaces hijos → herramientas navigate.
  for (const nav of design.elements.filter((e) => e.kind === 'nav')) {
    const links = childrenOf(nav.id).filter((k) => k.kind === 'link' || k.kind === 'button' || k.kind === 'text');
    const items: Array<{ label: string; href?: string; tool?: string }> = [];
    for (const link of links) {
      const name = toolNameFor({ ...link, kind: 'link' }, used);
      const selector = `[data-tool="${toKebab(name)}"]`;
      map.tools[name] = { selector, description: `Navega a ${link.label}`, params: {}, meta: { component: 'nav', intent: 'navigate', confirmation: 'none', accessibility: `aria-label: ${link.label.replace(/"/g, "'")}`, 'design-id': link.id } };
      mapping.push({ elementId: link.id, tool: name, selector, confidence: link.confidence });
      consumed.add(link.id);
      items.push({ label: link.label, href: `/${toKebab(link.label)}`, tool: name });
    }
    consumed.add(nav.id);
    if (items.length) htmlParts.push(renderComponent('nav', { tool: toToolName(nav.label || 'main nav', 'mainNav'), label: nav.label || 'Navegación', items }).html);
  }

  // 3) Botones y enlaces sueltos.
  for (const el of design.elements) {
    if (consumed.has(el.id)) continue;
    if (el.kind !== 'button' && el.kind !== 'link') continue;
    const name = toolNameFor(el, used);
    const selector = `[data-tool="${toKebab(name)}"]`;
    const intent = el.intent ?? (el.kind === 'link' ? 'navigate' : 'action');
    map.tools[name] = {
      selector,
      description: el.kind === 'link' ? `Navega a ${el.label}` : `Pulsa '${el.label}'`,
      params: {},
      meta: { component: 'button', intent, confirmation: needsConfirmation(el) ? 'needed' : 'none', accessibility: `aria-label: ${el.label.replace(/"/g, "'")}`, 'design-id': el.id },
    };
    mapping.push({ elementId: el.id, tool: name, selector, confidence: el.confidence });
    consumed.add(el.id);
    htmlParts.push(renderComponent('button', { tool: name, label: el.label, intent, confirmation: needsConfirmation(el) ? 'needed' : 'none' }).html);
  }

  // 4) Inputs huérfanos (sin form): herramienta fill.
  for (const el of design.elements) {
    if (consumed.has(el.id) || !['input', 'textarea', 'select'].includes(el.kind)) continue;
    const field = el.fieldName ?? toToolName(el.label, 'value');
    const name = toolNameFor({ ...el, label: `set ${field}` }, used);
    const selector = `[data-tool="${toKebab(name)}"]`;
    map.tools[name] = { selector, description: `Rellena ${el.label || field}`, params: { [field]: { source: 'value' } }, trigger: { event: 'change' }, meta: { component: 'button', intent: 'action', confirmation: 'none', accessibility: `aria-label: ${(el.label || field).replace(/"/g, "'")}`, 'design-id': el.id } };
    mapping.push({ elementId: el.id, tool: name, selector, confidence: el.confidence * 0.8 });
    consumed.add(el.id);
    warnings.push(`El campo '${el.label || el.id}' no pertenece a ningún formulario; se generó la herramienta ${name} (change).`);
  }

  // 5) Precios y textos destacados → contexto.
  for (const el of design.elements) {
    if (consumed.has(el.id) || (el.kind !== 'price' && el.kind !== 'heading')) continue;
    const name = toToolName(el.label || el.id, el.kind);
    let key = name;
    let n = 2;
    while (map.context[key] || map.tools[key]) key = `${name}${n++}`;
    const selector = `[data-context="${toKebab(key)}"]`;
    map.context[key] = { selector, format: el.kind === 'price' ? 'currency' : 'text', meta: { 'design-id': el.id } };
    consumed.add(el.id);
  }

  if (Object.keys(map.tools).length === 0) warnings.push('El diseño no contiene elementos interactivos reconocibles.');
  const lowConf = mapping.filter((m) => m.confidence < 0.5);
  if (lowConf.length) warnings.push(`${lowConf.length} herramienta(s) con confianza < 0.5: ${lowConf.map((m) => m.tool).join(', ')}.`);
  const unusedParents = design.elements.filter((e) => !consumed.has(e.id) && byId.has(e.id) && ['card', 'hero', 'list'].includes(e.kind)).length;
  if (unusedParents) warnings.push(`${unusedParents} región(es) (card/hero/list) sin acciones detectadas.`);

  const header = `/* Generado por webmcpcss design analyze — fuente: ${design.source.type} ${design.source.ref} (${design.method}) */\n/* Los selectores [data-tool] son la propuesta: añade esos atributos al implementar el diseño. */\n\n`;
  const css = header + serializeToolMap(map).replace(/^\/\* Generado por WebMCPcss[^\n]*\n\n?/, '');
  const scaffoldHtml = `<!-- Andamiaje generado desde el diseño "${design.title}". Los data-tool coinciden con ${design.title}.webmcp.css -->\n${htmlParts.join('\n\n')}\n`;
  return { toolMap: map, css, scaffoldHtml, mapping, warnings };
}
