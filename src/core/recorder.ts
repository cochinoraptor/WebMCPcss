/**
 * Grabador de interacciones para `webmcpcss generate`: captura clics y
 * submits del navegador y deduce un `.webmcp.css` inicial reutilizando la
 * inferencia de selectores estables del modo visión.
 */
import type { ToolMap } from '../types';
import type { ElementInfo } from '../adapters/PageAdapter';
import { selectorProposals } from './vision';
import { isStableClass, normalizeText, splitWords } from '../utils/dom';

/**
 * Shim de grabación: captura huellas (`ElementInfo` serializables) de los
 * elementos accionados y las acumula en `window.__WEBMCP_EVENTS__`.
 */
export const RECORDER_SHIM_SOURCE = `
(function () {
  if (window.__WEBMCP_RECORDER_INSTALLED__) return;
  window.__WEBMCP_RECORDER_INSTALLED__ = true;
  window.__WEBMCP_EVENTS__ = [];
  var record = function (el) {
    if (!el || el.nodeType !== 1) return;
    var attrs = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name === 'class' || a.name === 'id' || a.name === 'style') continue;
      attrs[a.name] = a.value;
    }
    var maybeInput = el;
    window.__WEBMCP_EVENTS__.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      classes: Array.prototype.slice.call(el.classList),
      attrs: attrs,
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      value: typeof maybeInput.value === 'string' ? maybeInput.value : null
    });
    if (window.__WEBMCP_EVENTS__.length > 200) window.__WEBMCP_EVENTS__.shift();
  };
  document.addEventListener('click', function (ev) { record(ev.target); }, true);
  document.addEventListener('submit', function (ev) { record(ev.target); }, true);
})();
`;

/**
 * Construye un tool map a partir de las huellas grabadas.
 *
 * Deduplica por huella (etiqueta + clase estable o prefijo del
 * `aria-label`), infiere un selector estable por grupo y añade como
 * parámetro el `aria-label` o el primer `data-*` estable si existen.
 *
 * @param events Huellas grabadas (pueden repetirse).
 * @returns Tool map inicial listo para revisar a mano.
 */
export function buildToolMapFromEvents(events: ElementInfo[]): ToolMap {
  const groups = new Map<string, { info: ElementInfo; name: string }>();
  let index = 0;
  for (const info of events) {
    const key = signature(info);
    if (!groups.has(key)) {
      groups.set(key, { info, name: suggestName(info, index++) });
    }
  }

  const map: ToolMap = { tools: {}, context: {} };
  for (const { info, name } of groups.values()) {
    const params: ToolMap['tools'][string]['params'] = {};
    if (info.attrs['aria-label']) {
      params['label'] = { source: 'attr', value: 'aria-label' };
    }
    const dataAttr = Object.keys(info.attrs).find(
      (a) => a.startsWith('data-') && !a.startsWith('data-v-'),
    );
    if (dataAttr) {
      params[camel(attrName(dataAttr))] = { source: 'attr', value: dataAttr };
    }
    map.tools[name] = {
      selector: recordedSelector(info),
      params,
      description: describe(info),
      trigger: { event: 'click' },
    };
  }
  return map;
}

/**
 * Selector para una herramienta grabada: preferimos la clase estable
 * compartida (la herramienta se aplica a muchos elementos) por encima de
 * selectores únicos por elemento (`aria-label`, `id`, `data-*` con valor).
 */
function recordedSelector(info: ElementInfo): string {
  const proposals = selectorProposals(info);
  const cls = proposals.find((p) => p.startsWith('.'));
  return cls ?? proposals[0] ?? info.tag;
}

/**
 * Huella de agrupación: etiqueta + clase estable, o etiqueta + primeras
 * palabras del `aria-label` cuando no hay clases estables.
 */
function signature(info: ElementInfo): string {
  const stableClass = info.classes.find(isStableClass);
  if (stableClass) return `${info.tag}.${stableClass}`;
  const aria = splitWords(info.attrs['aria-label'] ?? '')
    .slice(0, 2)
    .join('-');
  if (aria) return `${info.tag}[${aria}]`;
  return `${info.tag}[${splitWords(info.text).slice(0, 2).join('-')}]`;
}

/**
 * Nombre provisional de herramienta a partir de su huella.
 */
function suggestName(info: ElementInfo, index: number): string {
  const source = info.attrs['aria-label'] ?? info.text ?? info.classes[0] ?? info.tag;
  const words = splitWords(source).filter((w) => w.length >= 3 && !/^\d+$/.test(w));
  if (words.length === 0) return `tool${index + 1}`;
  return camel(words.slice(0, 3).join('-'));
}

/**
 * Descripción provisional legible.
 */
function describe(info: ElementInfo): string {
  const base = info.attrs['aria-label'] ?? normalizeText(info.text) ?? '';
  return base ? base.slice(0, 80) : `Acción sobre ${info.tag}`;
}

/**
 * Convierte kebab-case en camelCase.
 */
function camel(value: string): string {
  return value.replace(/-([a-z])/g, (_all, ch: string) => ch.toUpperCase());
}

/**
 * Nombre de parámetro a partir de un atributo (`data-product-id` →
 * `productId`).
 */
function attrName(attr: string): string {
  return attr.replace(/^data-/, '');
}
