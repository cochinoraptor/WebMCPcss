/**
 * API declarativa del estándar WebMCP (W3C Web Machine Learning CG).
 *
 * El borrador del estándar permite exponer herramientas sin JavaScript
 * anotando formularios HTML con atributos:
 *
 * | Atributo               | Elemento                       | Significado                              |
 * | ---------------------- | ------------------------------ | ---------------------------------------- |
 * | `toolname`             | `<form>`                       | Nombre de la herramienta (obligatorio)   |
 * | `tooldescription`      | `<form>`                       | Descripción para el agente (obligatorio) |
 * | `toolautosubmit`       | `<form>`                       | El agente puede enviar sin clic humano   |
 * | `toolparamtitle`       | `input`, `select`, `textarea`  | Clave del parámetro en el JSON Schema    |
 * | `toolparamdescription` | `input`, `select`, `textarea`  | Descripción del parámetro                |
 *
 * Este módulo es el **compilador bidireccional** entre esa forma y el
 * `.webmcp.css` de WebMCPcss:
 *
 * - {@link extractDeclarativeTools} lee los atributos de un HTML (string,
 *   sin navegador) y devuelve herramientas declarativas.
 * - {@link declarativeToolsToToolMap} las convierte en un {@link ToolMap}
 *   (para `generate --auto`, `validate`, exportadores, MCP…).
 * - {@link toolMapToDeclarative} hace el camino inverso: a partir de un
 *   `.webmcp.css` calcula los atributos que habría que añadir a cada
 *   formulario, y {@link applyDeclarativeToHtml} los escribe en un HTML.
 * - {@link buildDeclarativeRuntimeScript} genera un script que aplica los
 *   atributos en tiempo de ejecución (para sitios cuyo HTML no se puede
 *   editar: proxy retro, userscripts, `browser-inject`).
 *
 * Sin dependencias: el análisis de HTML se hace con expresiones regulares
 * tolerantes (suficiente para atributos de `<form>` y sus campos) y, cuando
 * hay un `Document` disponible ({@link extractDeclarativeToolsFromDocument}),
 * con el DOM real.
 */
import type { ToolMap, ToolSpec } from '../types';

/** Atributos declarativos del estándar. */
export const DECLARATIVE_ATTRS = {
  toolName: 'toolname',
  toolDescription: 'tooldescription',
  toolAutoSubmit: 'toolautosubmit',
  paramTitle: 'toolparamtitle',
  paramDescription: 'toolparamdescription',
} as const;

/** Parámetro de una herramienta declarativa (campo de formulario). */
export interface DeclarativeParam {
  /** Clave del parámetro (`toolparamtitle` o `name`/`id` del campo). */
  name: string;
  /** Descripción (`toolparamdescription`, `<label>`, `placeholder`…). */
  description?: string;
  /** Selector CSS estable del campo. */
  selector: string;
  /** Tipo HTML del campo (`text`, `email`, `number`, `select`…). */
  inputType: string;
  /** ¿Marcado como `required`? */
  required: boolean;
  /** Opciones de un `<select>` (si aplica). */
  options?: string[];
}

/** Herramienta declarada con atributos `toolname`/`tooldescription`. */
export interface DeclarativeTool {
  name: string;
  description: string;
  /** Selector CSS estable del `<form>`. */
  formSelector: string;
  /** Selector del botón de envío (o el propio formulario). */
  submitSelector: string;
  /** `toolautosubmit` presente. */
  autoSubmit: boolean;
  params: DeclarativeParam[];
  /** Atributos `action`/`method` del formulario, informativos. */
  action?: string;
  method?: string;
}

/** Resultado de {@link extractDeclarativeTools}. */
export interface DeclarativeScan {
  tools: DeclarativeTool[];
  /** Formularios con `toolname` pero sin `tooldescription` (o al revés). */
  warnings: string[];
}

/** Atributos que {@link toolMapToDeclarative} propone para un formulario. */
export interface DeclarativeFormPatch {
  /** Nombre de la herramienta de origen. */
  tool: string;
  /** Selector del `<form>` (el de `webmcp-trigger … on <form>`) o, si `inferred`, el del elemento de la herramienta. */
  formSelector: string;
  /**
   * `true` cuando no se sabe si `formSelector` es un `<form>`: hay que usar
   * el formulario que contiene a ese elemento o a sus campos (`closest('form')`).
   */
  inferred?: boolean;
  /** Advertencia semántica (p. ej. la herramienta se dispara por `click`, no por `submit`). */
  note?: string;
  /** Atributos a poner en el `<form>`. */
  formAttrs: Record<string, string>;
  /** Atributos por campo: selector → atributos. */
  fieldAttrs: Array<{ selector: string; attrs: Record<string, string> }>;
  /** Motivo por el que la herramienta NO se pudo expresar declarativamente. */
  skipped?: string;
}

/** Resultado de {@link toolMapToDeclarative}. */
export interface DeclarativeCompilation {
  patches: DeclarativeFormPatch[];
  /** Herramientas que no son formularios (necesitan la API imperativa). */
  imperativeOnly: string[];
}

/* ------------------------------------------------------------------ */
/* Utilidades de HTML sin dependencias                                 */
/* ------------------------------------------------------------------ */

/**
 * Parsea los atributos de una etiqueta HTML cruda (`<form id="x" toolname=y>`).
 * @param raw Contenido entre `<tag` y `>`.
 */
export function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const key = m[1].toLowerCase();
    if (key === '/' || key === '') continue;
    attrs[key] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

/** Decodifica las entidades HTML más habituales. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** Codifica un valor para ponerlo entre comillas dobles en HTML. */
export function encodeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Escapa texto para incrustarlo en una expresión regular. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Escapa un valor para usarlo dentro de un selector de atributo. */
function cssAttr(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** ¿Identificador seguro para `#id` sin escapar? */
function plainIdent(v: string): boolean {
  return /^[A-Za-z_][\w-]*$/.test(v);
}

/** Texto visible aproximado de un fragmento HTML. */
function textOf(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Convierte texto libre en camelCase (`Correo electrónico` → `correoElectronico`). */
export function toParamKey(text: string, fallback: string): string {
  const words = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 4);
  if (words.length === 0) return fallback;
  const key = words
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
  return /^[0-9]/.test(key) ? `p${key}` : key;
}

/** Selector estable para un formulario a partir de sus atributos. */
function formSelectorFrom(attrs: Record<string, string>, index: number): string {
  if (attrs.id && plainIdent(attrs.id)) return `#${attrs.id}`;
  if (attrs.id) return `form[id=${cssAttr(attrs.id)}]`;
  if (attrs.name) return `form[name=${cssAttr(attrs.name)}]`;
  if (attrs.toolname) return `form[toolname=${cssAttr(attrs.toolname)}]`;
  if (attrs.action) return `form[action=${cssAttr(attrs.action)}]`;
  return `form:nth-of-type(${index + 1})`;
}

/** Selector estable para un campo dentro de su formulario. */
function fieldSelectorFrom(
  tag: string,
  attrs: Record<string, string>,
  formSelector: string,
): string {
  if (attrs.id && plainIdent(attrs.id)) return `#${attrs.id}`;
  if (attrs.id) return `${tag}[id=${cssAttr(attrs.id)}]`;
  if (attrs.name) return `${formSelector} ${tag}[name=${cssAttr(attrs.name)}]`;
  if (attrs.toolparamtitle)
    return `${formSelector} ${tag}[toolparamtitle=${cssAttr(attrs.toolparamtitle)}]`;
  return `${formSelector} ${tag}`;
}

/* ------------------------------------------------------------------ */
/* HTML → herramientas declarativas                                    */
/* ------------------------------------------------------------------ */

const FORM_RE = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
const FIELD_RE = /<(input|select|textarea)\b([^>]*?)\/?>(?:([\s\S]*?)<\/\1>)?/gi;
const LABEL_RE = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
const SUBMIT_RE =
  /<(button)\b([^>]*)>[\s\S]*?<\/button>|<input\b([^>]*\btype\s*=\s*["']?(?:submit|image)["']?[^>]*)\/?>/gi;
const NON_PARAM_TYPES = new Set(['submit', 'button', 'hidden', 'image', 'reset', 'file']);

/**
 * Extrae las herramientas declarativas (`toolname`/`tooldescription`) de un
 * HTML en texto, sin navegador ni dependencias.
 *
 * @param html HTML completo o fragmento.
 * @returns Herramientas y avisos.
 */
export function extractDeclarativeTools(html: string): DeclarativeScan {
  const tools: DeclarativeTool[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let index = -1;
  let m: RegExpExecArray | null;
  FORM_RE.lastIndex = 0;
  while ((m = FORM_RE.exec(html))) {
    index++;
    const attrs = parseAttrs(m[1]);
    const inner = m[2];
    const hasName = typeof attrs.toolname === 'string' && attrs.toolname.trim() !== '';
    const hasDesc =
      typeof attrs.tooldescription === 'string' && attrs.tooldescription.trim() !== '';
    if (!hasName && !hasDesc) continue;
    const formSelector = formSelectorFrom(attrs, index);
    if (!hasName || !hasDesc) {
      // Como el navegador: sin los dos atributos el formulario no se registra.
      warnings.push(
        `${formSelector}: el estándar exige toolname y tooldescription (falta ${hasName ? 'tooldescription' : 'toolname'}); no se registra`,
      );
      continue;
    }
    const name = attrs.toolname.trim();
    if (seen.has(name)) {
      warnings.push(`${formSelector}: toolname "${name}" duplicado; se ignora`);
      continue;
    }
    seen.add(name);

    // Etiquetas <label for=…> del formulario.
    const labels = new Map<string, string>();
    LABEL_RE.lastIndex = 0;
    let lm: RegExpExecArray | null;
    while ((lm = LABEL_RE.exec(inner))) {
      const la = parseAttrs(lm[1]);
      const t = textOf(lm[2]);
      if (la.for && t) labels.set(la.for, t);
    }

    const params: DeclarativeParam[] = [];
    const usedKeys = new Set<string>();
    FIELD_RE.lastIndex = 0;
    let fm: RegExpExecArray | null;
    let fieldIdx = 0;
    while ((fm = FIELD_RE.exec(inner))) {
      const tag = fm[1].toLowerCase();
      const fa = parseAttrs(fm[2]);
      const type = (tag === 'input' ? fa.type || 'text' : tag).toLowerCase();
      if (NON_PARAM_TYPES.has(type)) continue;
      fieldIdx++;
      const label = fa.id ? labels.get(fa.id) : undefined;
      const baseKey =
        fa.toolparamtitle?.trim() ||
        fa.name?.trim() ||
        fa.id?.trim() ||
        (label ? toParamKey(label, '') : '') ||
        `param${fieldIdx}`;
      let key = baseKey;
      let n = 2;
      while (usedKeys.has(key)) key = `${baseKey}${n++}`;
      usedKeys.add(key);
      const options =
        tag === 'select' && fm[3]
          ? Array.from(fm[3].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)).map(
              (o) => parseAttrs(o[1]).value ?? textOf(o[2]),
            )
          : undefined;
      params.push({
        name: key,
        description:
          fa.toolparamdescription?.trim() ||
          label ||
          fa.placeholder?.trim() ||
          fa['aria-label']?.trim() ||
          undefined,
        selector: fieldSelectorFrom(tag, fa, formSelector),
        inputType: type,
        required: 'required' in fa,
        options,
      });
    }

    SUBMIT_RE.lastIndex = 0;
    let submitSelector = formSelector;
    let sm: RegExpExecArray | null;
    while ((sm = SUBMIT_RE.exec(inner))) {
      const isButton = sm[1] === 'button';
      const sa = parseAttrs(isButton ? sm[2] : sm[3]);
      if (isButton && sa.type && sa.type.toLowerCase() !== 'submit') continue;
      const tag = isButton ? 'button' : 'input';
      if (sa.id && plainIdent(sa.id)) submitSelector = `#${sa.id}`;
      else if (isButton) submitSelector = `${formSelector} button[type="submit"]`;
      else submitSelector = `${formSelector} input[type="submit"]`;
      if (!isButton && !sa.type) submitSelector = `${formSelector} ${tag}`;
      break;
    }

    tools.push({
      name,
      description: (attrs.tooldescription ?? '').trim(),
      formSelector,
      submitSelector,
      autoSubmit: 'toolautosubmit' in attrs,
      params,
      action: attrs.action,
      method: attrs.method?.toLowerCase(),
    });
  }
  return { tools, warnings };
}

/**
 * Variante sobre un `Document` real (navegador o jsdom). AUTO-CONTENIDA:
 * apta para `page.evaluate()`.
 *
 * @param doc Documento.
 */
export function extractDeclarativeToolsFromDocument(doc: Document): DeclarativeScan {
  const tools: DeclarativeTool[] = [];
  const warnings: string[] = [];
  const seen: Record<string, boolean> = {};
  const ident = (v: string) => /^[A-Za-z_][\w-]*$/.test(v);
  const q = (v: string) => '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  const forms = Array.from(doc.querySelectorAll('form'));
  forms.forEach((form, index) => {
    const name = (form.getAttribute('toolname') || '').trim();
    const description = (form.getAttribute('tooldescription') || '').trim();
    if (!name && !description) return;
    const id = form.getAttribute('id') || '';
    const fname = form.getAttribute('name') || '';
    const action = form.getAttribute('action') || '';
    const formSelector = id
      ? ident(id)
        ? '#' + id
        : 'form[id=' + q(id) + ']'
      : fname
        ? 'form[name=' + q(fname) + ']'
        : name
          ? 'form[toolname=' + q(name) + ']'
          : action
            ? 'form[action=' + q(action) + ']'
            : 'form:nth-of-type(' + (index + 1) + ')';
    if (!name || !description) {
      warnings.push(
        formSelector +
          ': el estándar exige toolname y tooldescription (falta ' +
          (name ? 'tooldescription' : 'toolname') +
          '); no se registra',
      );
      return;
    }
    if (seen[name]) {
      warnings.push(formSelector + ': toolname "' + name + '" duplicado; se ignora');
      return;
    }
    seen[name] = true;
    const params: DeclarativeParam[] = [];
    const used: Record<string, boolean> = {};
    let fieldIdx = 0;
    Array.from(form.querySelectorAll('input, select, textarea')).forEach((f) => {
      const tag = f.tagName.toLowerCase();
      const type = (
        tag === 'input' ? f.getAttribute('type') || 'text' : tag
      ).toLowerCase();
      if (['submit', 'button', 'hidden', 'image', 'reset', 'file'].indexOf(type) >= 0)
        return;
      fieldIdx++;
      const fid = f.getAttribute('id') || '';
      const fname = f.getAttribute('name') || '';
      const lab = fid ? doc.querySelector('label[for=' + q(fid) + ']') : null;
      const labelText = lab ? (lab.textContent || '').replace(/\s+/g, ' ').trim() : '';
      const base =
        (f.getAttribute('toolparamtitle') || '').trim() ||
        fname ||
        fid ||
        (labelText
          ? labelText
              .normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/[^A-Za-z0-9]+/g, ' ')
              .trim()
              .split(' ')
              .slice(0, 4)
              .map((w, i) =>
                i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
              )
              .join('')
          : '') ||
        'param' + fieldIdx;
      let key = base;
      let n = 2;
      while (used[key]) key = base + n++;
      used[key] = true;
      const selector = fid
        ? ident(fid)
          ? '#' + fid
          : tag + '[id=' + q(fid) + ']'
        : fname
          ? formSelector + ' ' + tag + '[name=' + q(fname) + ']'
          : formSelector + ' ' + tag;
      const options =
        tag === 'select'
          ? Array.from((f as HTMLSelectElement).options).map(
              (o) => o.getAttribute('value') ?? (o.textContent || '').trim(),
            )
          : undefined;
      params.push({
        name: key,
        description:
          (f.getAttribute('toolparamdescription') || '').trim() ||
          labelText ||
          (f.getAttribute('placeholder') || '').trim() ||
          (f.getAttribute('aria-label') || '').trim() ||
          undefined,
        selector,
        inputType: type,
        required: f.hasAttribute('required'),
        options,
      });
    });
    const submit =
      form.querySelector(
        'button[type="submit"], input[type="submit"], input[type="image"]',
      ) || form.querySelector('button:not([type])');
    let submitSelector = formSelector;
    if (submit) {
      const sid = submit.getAttribute('id') || '';
      submitSelector =
        sid && ident(sid)
          ? '#' + sid
          : formSelector +
            ' ' +
            (submit.tagName.toLowerCase() === 'button'
              ? 'button[type="submit"]'
              : 'input[type="submit"]');
      if (submit.tagName.toLowerCase() === 'button' && !submit.getAttribute('type'))
        submitSelector = sid && ident(sid) ? '#' + sid : formSelector + ' button';
    }
    tools.push({
      name,
      description,
      formSelector,
      submitSelector,
      autoSubmit: form.hasAttribute('toolautosubmit'),
      params,
      action: form.getAttribute('action') || undefined,
      method: (form.getAttribute('method') || '').toLowerCase() || undefined,
    });
  });
  return { tools, warnings };
}

/* ------------------------------------------------------------------ */
/* Herramientas declarativas → ToolMap                                 */
/* ------------------------------------------------------------------ */

/**
 * Convierte herramientas declarativas en un {@link ToolMap} de WebMCPcss.
 * Cada campo se vuelve `webmcp-param-<clave>: value(<selector>)`; el envío
 * es `webmcp-trigger: "submit" on <form>`; se conserva la procedencia en
 * `meta.source = "declarative"` y `meta.autosubmit`.
 *
 * @param tools Herramientas declarativas.
 * @param base Tool map existente al que añadir (no se muta).
 */
export function declarativeToolsToToolMap(
  tools: DeclarativeTool[],
  base?: ToolMap,
): ToolMap {
  const map: ToolMap = {
    tools: { ...(base?.tools ?? {}) },
    context: { ...(base?.context ?? {}) },
  };
  for (const t of tools) {
    if (map.tools[t.name]) continue; // el CSS explícito gana
    const spec: ToolSpec = {
      selector: t.submitSelector,
      description: t.description,
      params: {},
      trigger: { event: 'submit', selector: t.formSelector },
      meta: { source: 'declarative', intent: 'submit' },
    };
    if (t.autoSubmit) spec.meta!.autosubmit = 'true';
    else spec.meta!.confirmation = 'needed';
    for (const p of t.params) {
      spec.params[p.name] = { source: 'value', selector: p.selector };
      // `webmcp-doc-<param>`: descripción del parámetro (toolparamdescription).
      if (p.description) spec.meta![`doc-${p.name}`] = p.description;
    }
    map.tools[t.name] = spec;
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* ToolMap → atributos declarativos                                    */
/* ------------------------------------------------------------------ */

/**
 * Calcula los atributos declarativos equivalentes a cada herramienta de un
 * tool map. Solo las herramientas con envío de formulario (`trigger submit`,
 * o cuyo selector apunta a un `<form>`/botón de envío) pueden expresarse con
 * la API declarativa; el resto se lista en `imperativeOnly`.
 *
 * @param map Tool map.
 */
export function toolMapToDeclarative(map: ToolMap): DeclarativeCompilation {
  const patches: DeclarativeFormPatch[] = [];
  const imperativeOnly: string[] = [];
  for (const [name, tool] of Object.entries(map.tools)) {
    const explicitForm =
      tool.trigger?.event === 'submit'
        ? (tool.trigger.selector ?? tool.selector)
        : undefined;
    const writable = Object.entries(tool.params).filter(([, p]) => p.source === 'value');
    if (!explicitForm && writable.length === 0) {
      // Un clic sin campos (addToCart, logout…) no es un formulario: API imperativa.
      imperativeOnly.push(name);
      continue;
    }
    const formSelector = explicitForm ?? tool.selector;
    const readOnly = Object.entries(tool.params).filter(([, p]) => p.source !== 'value');
    const formAttrs: Record<string, string> = {
      toolname: name,
      tooldescription: tool.description || `Herramienta ${name}`,
    };
    const policy = tool.meta?.confirmation;
    const autoSubmit =
      tool.meta?.autosubmit === 'true' || (policy === 'none' && !tool.confirmation);
    if (autoSubmit) formAttrs.toolautosubmit = '';
    const patch: DeclarativeFormPatch = {
      tool: name,
      formSelector,
      inferred: !explicitForm,
      formAttrs,
      fieldAttrs: writable.map(([pName, p]) => {
        const attrs: Record<string, string> = { toolparamtitle: pName };
        const doc = tool.meta?.[`doc-${pName}`];
        if (doc) attrs.toolparamdescription = doc;
        return { selector: p.selector ?? tool.selector, attrs };
      }),
    };
    if (!explicitForm) {
      patch.note = `la herramienta se dispara por ${tool.trigger?.event ?? 'click'} en ${tool.selector}; la API declarativa envía el formulario contenedor: comprueba que su submit realice la misma acción`;
    }
    if (readOnly.length > 0) {
      patch.skipped = `los parámetros de solo lectura (${readOnly
        .map(([n]) => n)
        .join(', ')}) no tienen equivalente declarativo; se mantienen en el .webmcp.css`;
    }
    patches.push(patch);
  }
  return { patches, imperativeOnly };
}

/**
 * Aplica los atributos declarativos a un HTML en texto. Localiza cada
 * `<form>` por `id`, `name`, `action` o índice y cada campo por `id`/`name`.
 * Los atributos ya presentes se respetan salvo `force`.
 *
 * @param html HTML de entrada.
 * @param compilation Resultado de {@link toolMapToDeclarative}.
 * @param opts `force` sobrescribe atributos existentes.
 * @returns HTML modificado y estadísticas (`notFound`: formularios sin
 *   localizar; `fieldsNotFound`: campos `toolparam*` sin localizar).
 */
export function applyDeclarativeToHtml(
  html: string,
  compilation: DeclarativeCompilation,
  opts: { force?: boolean } = {},
): { html: string; applied: string[]; notFound: string[]; fieldsNotFound: string[] } {
  let out = html;
  const applied: string[] = [];
  const notFound: string[] = [];
  const fieldsNotFound: string[] = [];

  const setAttrs = (openTag: string, attrs: Record<string, string>): string => {
    const existing = parseAttrs(openTag.replace(/^<\w+/, '').replace(/\/?>$/, ''));
    let tag = openTag.replace(/\s*\/?>$/, '');
    const selfClose = /\/>$/.test(openTag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k in existing) {
        if (!opts.force) continue;
        tag = tag.replace(
          new RegExp(`\\s${k}(\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+))?`, 'i'),
          '',
        );
      }
      tag += v === '' ? ` ${k}` : ` ${k}="${encodeAttr(v)}"`;
    }
    return tag + (selfClose ? ' />' : '>');
  };

  const matchesForm = (
    attrs: Record<string, string>,
    selector: string,
    index: number,
  ) => {
    const id = attrValue(selector, 'id');
    if (id !== undefined) return attrs.id === id;
    const name = attrValue(selector, 'name');
    if (name !== undefined) return attrs.name === name;
    const action = attrValue(selector, 'action');
    if (action !== undefined) return attrs.action === action;
    const tool = attrValue(selector, 'toolname');
    if (tool !== undefined) return attrs.toolname === tool;
    const nth = /:nth-of-type\((\d+)\)/.exec(selector);
    if (nth) return index === Number(nth[1]) - 1;
    return false;
  };

  /** ¿El HTML interno de un formulario contiene el primer campo del parche? */
  const containsField = (inner: string, patch: DeclarativeFormPatch): boolean => {
    for (const f of patch.fieldAttrs) {
      const key = fieldKey(f.selector);
      if (!key) continue;
      const re = new RegExp(
        `<(?:input|select|textarea)\\b[^>]*\\b${key.attr}\\s*=\\s*["']?${escapeRe(key.value)}["'\\s>]`,
        'i',
      );
      return re.test(inner);
    }
    return false;
  };

  for (const patch of compilation.patches) {
    let found = false;
    let idx = -1;
    out = out.replace(
      /<form\b([^>]*)>([\s\S]*?)<\/form>/gi,
      (whole, rawAttrs: string, inner: string) => {
        idx++;
        if (found) return whole;
        const attrs = parseAttrs(rawAttrs);
        const hit =
          matchesForm(attrs, patch.formSelector, idx) ||
          (patch.inferred === true && containsField(inner, patch));
        if (!hit) return whole;
        found = true;
        const open = whole.slice(0, whole.indexOf('>') + 1);
        return setAttrs(open, patch.formAttrs) + whole.slice(open.length);
      },
    );
    if (!found) {
      notFound.push(`${patch.tool} → ${patch.formSelector}`);
      continue;
    }
    applied.push(patch.tool);
    for (const field of patch.fieldAttrs) {
      const key = fieldKey(field.selector);
      if (!key) {
        fieldsNotFound.push(
          `${patch.tool}.${field.attrs.toolparamtitle} → ${field.selector}`,
        );
        continue;
      }
      let done = false;
      out = out.replace(
        /<(input|select|textarea)\b([^>]*?)(\/?>)/gi,
        (open, _t, rawAttrs) => {
          if (done) return open;
          const attrs = parseAttrs(rawAttrs);
          if (attrs[key.attr] !== key.value) return open;
          done = true;
          return setAttrs(open, field.attrs);
        },
      );
      if (!done)
        fieldsNotFound.push(
          `${patch.tool}.${field.attrs.toolparamtitle} → ${field.selector}`,
        );
    }
  }
  return { html: out, applied, notFound, fieldsNotFound };
}

/**
 * Extrae el valor de `[attr="v"]`, `[attr='v']` o `[attr=v]` de un selector
 * (y `#id` para `attr === 'id'`).
 */
function attrValue(selector: string, attr: string): string | undefined {
  if (attr === 'id') {
    const idM = /#([\w-]+)(?![^[]*\])/.exec(selector);
    if (idM) return idM[1];
  }
  const m = new RegExp(
    `\\[${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\]\\s"']+))\\s*\\]`,
  ).exec(selector);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

/** Clave (`id` o `name`) con la que localizar un campo a partir de su selector. */
function fieldKey(selector: string): { attr: 'id' | 'name'; value: string } | undefined {
  // Solo el último segmento compuesto identifica al campo.
  const last =
    selector
      .trim()
      .split(/\s+(?![^[]*\])/)
      .pop() ?? selector;
  const id = attrValue(last, 'id');
  if (id !== undefined) return { attr: 'id', value: id };
  const name = attrValue(last, 'name');
  if (name !== undefined) return { attr: 'name', value: name };
  return undefined;
}

/**
 * Script (IIFE, ES5) que aplica los atributos declarativos en tiempo de
 * ejecución: para sitios cuyo HTML no se puede editar (proxy retro,
 * userscript, extensión). El navegador con WebMCP declarativo registra las
 * herramientas al ver los atributos.
 *
 * @param compilation Resultado de {@link toolMapToDeclarative}.
 */
export function buildDeclarativeRuntimeScript(
  compilation: DeclarativeCompilation,
): string {
  const data = compilation.patches.map((p) => ({
    f: p.formSelector,
    i: p.inferred ? 1 : 0,
    a: p.formAttrs,
    x: p.fieldAttrs,
  }));
  return `/* WebMCPcss · atributos declarativos WebMCP (toolname/tooldescription) — generado */
(function () {
  'use strict';
  var PATCHES = ${JSON.stringify(data)};
  function set(el, attrs) {
    Object.keys(attrs).forEach(function (k) { if (!el.hasAttribute(k)) el.setAttribute(k, attrs[k]); });
  }
  function apply() {
    var n = 0;
    PATCHES.forEach(function (p) {
      var form = null;
      try { form = document.querySelector(p.f); } catch (e) { form = null; }
      if (form && form.tagName !== 'FORM') form = form.closest ? form.closest('form') : null;
      if (!form && p.i && p.x && p.x.length) {
        var field = null;
        try { field = document.querySelector(p.x[0].selector); } catch (e) { field = null; }
        form = field && field.closest ? field.closest('form') : null;
      }
      if (!form) return;
      set(form, p.a); n++;
      (p.x || []).forEach(function (fx) {
        var el = null;
        try { el = document.querySelector(fx.selector); } catch (e) { el = null; }
        if (el) set(el, fx.attrs);
      });
    });
    return n;
  }
  var applied = apply();
  if (typeof MutationObserver !== 'undefined' && applied < PATCHES.length) {
    var mo = new MutationObserver(function () { if (apply() >= PATCHES.length) mo.disconnect(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }
  window.__WEBMCP_DECLARATIVE__ = { applied: applied, total: PATCHES.length };
})();
`;
}
