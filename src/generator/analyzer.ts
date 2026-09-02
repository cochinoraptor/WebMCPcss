/**
 * Analyzer del generador automático: convierte un {@link PageScan} en un
 * {@link ToolMap} con nombres de herramienta inferidos, parámetros por campo
 * y selectores estables — sin grabación de interacciones.
 */
import type { ToolMap } from '../types';
import type { PageScan, ScannedForm } from './scanner';

/** Frameworks reconocidos por el detector. */
export type DetectedFramework =
  | 'react'
  | 'next'
  | 'vue'
  | 'svelte'
  | 'angular'
  | 'mui'
  | 'antd'
  | 'bootstrap'
  | 'tailwind'
  | 'unknown';

/**
 * Deduce el framework principal a partir de los marcadores del scanner.
 * @param scan Resultado del escaneo.
 * @returns Lista ordenada (principal primero); `['unknown']` si no hay señal.
 */
export function detectFramework(scan: PageScan): DetectedFramework[] {
  const order: DetectedFramework[] = [
    'next',
    'react',
    'vue',
    'svelte',
    'angular',
    'mui',
    'antd',
    'bootstrap',
    'tailwind',
  ];
  const found = order.filter((f) => scan.frameworkMarkers.includes(f));
  return found.length > 0 ? found : ['unknown'];
}

/** camelCase seguro a partir de texto libre. */
export function toCamelName(text: string, fallback: string): string {
  const words = text
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .filter(Boolean);
  if (words.length === 0) return fallback;
  return words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

/** Alias interno. */
const camel = toCamelName;

/** Nombre de herramienta para un formulario. */
function formToolName(form: ScannedForm, index: number): string {
  const source =
    form.submitText ||
    form.id ||
    (form.action ? (form.action.split(/[/?#]/).filter(Boolean).pop() ?? '') : '');
  const base = camel(source, `submitForm${index + 1}`);
  // Heurísticas comunes.
  if (/login|signin|acced|entrar|iniciar/i.test(source)) return 'login';
  if (/search|buscar/i.test(source)) return 'search';
  if (/suscri|subscribe|newsletter/i.test(source)) return 'subscribe';
  if (/regist|signup|crear cuenta/i.test(source)) return 'register';
  if (/contact|enviar mensaje/i.test(source)) return 'contact';
  return base;
}

/** Nombre de parámetro para un campo. */
function paramName(field: ScannedForm['fields'][number], index: number): string {
  const source = field.name || field.label || field.placeholder || field.type;
  const cleaned = camel(source, `param${index + 1}`);
  return cleaned.replace(/[^a-zA-Z0-9]/g, '') || `param${index + 1}`;
}

/** Limpia una descripción para serialización CSS segura (sin comillas dobles). */
function desc(text: string): string {
  return text.replace(/"/g, "'");
}

/**
 * Construye un ToolMap automático a partir del escaneo de la página.
 *
 * - Cada formulario → herramienta con `webmcp-param-*` por campo (fuente
 *   `value(selector)`) y trigger submit sobre el botón de envío.
 * - Cada botón/enlace de acción suelto → herramienta de click.
 *
 * @param scan Resultado de `scanInteractiveElementsInPage`.
 * @returns Tool map listo para serializar como `.webmcp.css`.
 */
export function buildAutoToolMap(scan: PageScan): ToolMap {
  const map: ToolMap = { tools: {}, context: {} };
  const used = new Set<string>();
  const uniqueName = (base: string): string => {
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}${n++}`;
    used.add(name);
    return name;
  };

  scan.forms.forEach((form, i) => {
    const name = uniqueName(formToolName(form, i));
    const params: ToolMap['tools'][string]['params'] = {};
    form.fields.forEach((field, j) => {
      let pName = paramName(field, j);
      while (params[pName]) pName = `${pName}${j + 1}`;
      params[pName] = { source: 'value', selector: field.selector };
    });
    map.tools[name] = {
      selector: form.submitSelector,
      description: form.submitText
        ? desc(`Formulario: ${form.submitText}`)
        : desc(`Envía el formulario ${form.id || form.action || i + 1}`),
      params,
      trigger: { event: 'submit', selector: form.selector },
      fingerprint: { tag: 'button', text: form.submitText },
    };
  });

  scan.actions.forEach((action, i) => {
    const source = action.text || action.ariaLabel || action.id || action.name;
    const name = uniqueName(camel(source, `action${i + 1}`));
    map.tools[name] = {
      selector: action.selector,
      description: action.ariaLabel
        ? desc(action.ariaLabel)
        : action.text
          ? desc(`Pulsa '${action.text}'`)
          : undefined,
      params: {},
      fingerprint: {
        tag: action.tag,
        text: action.text,
        attrs: action.ariaLabel ? { 'aria-label': action.ariaLabel } : undefined,
      },
    };
  });

  return map;
}
