/**
 * Retro-WebMCP (v1.0.0): escáner de sitios legacy.
 *
 * Analiza HTML antiguo (tablas de maquetación, formularios sin `id`,
 * `onclick` inline, iframes, `<font>`, `name=` en vez de `id=`…) y propone
 * un `.webmcp.css` con selectores lo más estables posible, más un informe de
 * «señales legacy». Funciona sin navegador a partir del HTML (fetch + parser
 * propio basado en expresiones regulares tolerantes) y, opcionalmente, mejora
 * nombres y descripciones con un LLM.
 */
import { extractJsonObject } from '../prompt/llm-client';
import type { LlmClient } from '../prompt/types';
import {
  declarativeToolsToToolMap,
  extractDeclarativeTools,
} from '../standard/declarative';
import type { ToolMap, ToolSpec } from '../types';

/** Señal de sitio legacy detectada. */
export interface LegacySignal {
  kind:
    | 'table-layout'
    | 'inline-handlers'
    | 'framesets'
    | 'font-tags'
    | 'no-doctype'
    | 'quirks-charset'
    | 'form-without-id'
    | 'name-only-inputs'
    | 'image-buttons'
    | 'javascript-links'
    | 'flash-or-applet'
    | 'old-jquery'
    | 'asp-webforms'
    | 'no-viewport';
  count: number;
  detail: string;
}

/** Elemento interactivo extraído del HTML legacy. */
export interface LegacyElement {
  tag: string;
  attrs: Record<string, string>;
  /** Texto interno visible (recortado). */
  text: string;
  /** Selector propuesto. */
  selector: string;
  /** Confianza en el selector [0,1]. */
  confidence: number;
  /** Formulario contenedor (índice) si aplica. */
  formIndex?: number;
}

/** Formulario legacy. */
export interface LegacyForm {
  index: number;
  attrs: Record<string, string>;
  selector: string;
  fields: LegacyElement[];
  submit?: LegacyElement;
}

/** Resultado del escaneo. */
export interface RetroScan {
  url?: string;
  title: string;
  signals: LegacySignal[];
  /** Puntuación 0-100 de «legacy» (más alto = más antiguo/frágil). */
  legacyScore: number;
  forms: LegacyForm[];
  actions: LegacyElement[];
  toolMap: ToolMap;
  /** Notas para el humano/agente. */
  notes: string[];
  /**
   * Herramientas ya declaradas en el HTML con la API declarativa WebMCP
   * (`toolname`/`tooldescription`, v1.1.0). Se incorporan al tool map con
   * prioridad sobre las inferidas.
   */
  declarative: string[];
}

/** Parsea atributos HTML de una etiqueta de apertura. */
export function parseTagAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase();
    attrs[name] = decodeEntities((m[3] ?? m[4] ?? m[5] ?? '').trim());
  }
  return attrs;
}

/** Entidades HTML frecuentes en sitios antiguos (latin-1). */
const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  euro: '€',
  copy: '©',
  reg: '®',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  ntilde: 'ñ',
  uuml: 'ü',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  Ntilde: 'Ñ',
  Uuml: 'Ü',
  iexcl: '¡',
  iquest: '¿',
  agrave: 'à',
  egrave: 'è',
  ccedil: 'ç',
  ordf: 'ª',
  ordm: 'º',
  middot: '·',
};

/** Decodifica entidades HTML (nombradas frecuentes y numéricas). */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);
}

/** Elimina etiquetas y normaliza espacios (usa `alt` de imágenes como texto). */
function textOf(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(
        /<img\b[^>]*\balt=("([^"]*)"|'([^']*)')[^>]*>/gi,
        (_m, _q, a, b) => ` ${a ?? b ?? ''} `,
      )
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, 80);
}

/** ¿Token de clase/id estable? (no hash, no numérico puro, no ASP.NET ctl00). */
function isStable(token: string): boolean {
  if (!token || token.length < 2) return false;
  if (/^\d+$/.test(token)) return false;
  if (/ctl\d+|_ctl|__VIEWSTATE|__EVENT/i.test(token)) return false;
  if (/^[a-z0-9]{8,}$/i.test(token) && /\d/.test(token) && !/[aeiou]{2}/i.test(token))
    return false;
  return true;
}

/** CSS.escape mínimo para ids/valores. */
function cssEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

/** Propone un selector para un elemento a partir de sus atributos. */
export function proposeSelector(
  tag: string,
  attrs: Record<string, string>,
  context: { formSelector?: string; text?: string; index?: number },
): { selector: string; confidence: number } {
  const t = tag.toLowerCase();
  if (attrs.id && isStable(attrs.id))
    return { selector: `#${cssEscape(attrs.id)}`, confidence: 0.95 };
  const dataAttr = Object.keys(attrs).find(
    (k) => k.startsWith('data-') && attrs[k] && isStable(attrs[k]),
  );
  if (dataAttr)
    return { selector: `[${dataAttr}="${cssEscape(attrs[dataAttr])}"]`, confidence: 0.9 };
  if (attrs.name && isStable(attrs.name)) {
    const base = `${t}[name="${cssEscape(attrs.name)}"]`;
    return {
      selector: context.formSelector ? `${context.formSelector} ${base}` : base,
      confidence: 0.85,
    };
  }
  if (attrs['aria-label'])
    return {
      selector: `${t}[aria-label="${cssEscape(attrs['aria-label'])}"]`,
      confidence: 0.8,
    };
  if (
    t === 'input' &&
    attrs.value &&
    ['submit', 'button', 'image'].includes((attrs.type ?? '').toLowerCase())
  ) {
    const base = `input[type="${attrs.type.toLowerCase()}"][value="${cssEscape(attrs.value)}"]`;
    return {
      selector: context.formSelector ? `${context.formSelector} ${base}` : base,
      confidence: 0.7,
    };
  }
  if (attrs.title)
    return { selector: `${t}[title="${cssEscape(attrs.title)}"]`, confidence: 0.6 };
  if (attrs.href && t === 'a' && !/^javascript:|^#$/i.test(attrs.href)) {
    return { selector: `a[href="${cssEscape(attrs.href)}"]`, confidence: 0.65 };
  }
  if (attrs.href && t === 'a' && /^javascript:/i.test(attrs.href)) {
    const fn = /javascript:\s*([a-zA-Z_$][\w$.]*)/i.exec(attrs.href)?.[1];
    if (fn)
      return { selector: `a[href^="javascript:${cssEscape(fn)}"]`, confidence: 0.5 };
  }
  if (attrs.class) {
    const stable = attrs.class.split(/\s+/).filter(isStable);
    if (stable.length) {
      const base = `${t}.${stable.slice(0, 2).map(cssEscape).join('.')}`;
      return {
        selector: context.formSelector ? `${context.formSelector} ${base}` : base,
        confidence: 0.55,
      };
    }
  }
  if (attrs.onclick) {
    const fn = /([a-zA-Z_$][\w$]*)\s*\(/.exec(attrs.onclick)?.[1];
    if (fn) return { selector: `${t}[onclick*="${cssEscape(fn)}"]`, confidence: 0.5 };
  }
  if (
    context.formSelector &&
    (t === 'button' || (t === 'input' && /submit|image/i.test(attrs.type ?? '')))
  ) {
    return {
      selector: `${context.formSelector} ${t === 'button' ? 'button' : 'input[type="submit"]'}`,
      confidence: 0.45,
    };
  }
  if (attrs.alt)
    return { selector: `${t}[alt="${cssEscape(attrs.alt)}"]`, confidence: 0.55 };
  return { selector: `${t}:nth-of-type(${(context.index ?? 0) + 1})`, confidence: 0.2 };
}

/** Detecta señales de sitio legacy. */
export function detectLegacySignals(html: string): LegacySignal[] {
  const signals: LegacySignal[] = [];
  const count = (re: RegExp) => (html.match(re) ?? []).length;
  const push = (kind: LegacySignal['kind'], n: number, detail: string) => {
    if (n > 0) signals.push({ kind, count: n, detail });
  };
  const tables = count(/<table\b/gi);
  const layoutTables = count(/<table\b[^>]*(cellpadding|cellspacing|border=["']?0)/gi);
  push(
    'table-layout',
    layoutTables,
    `${layoutTables}/${tables} tablas parecen de maquetación`,
  );
  push(
    'inline-handlers',
    count(/\son(click|change|submit|load)\s*=/gi),
    'manejadores inline on*=',
  );
  push('framesets', count(/<(frameset|frame|iframe)\b/gi), 'frames/iframes');
  push(
    'font-tags',
    count(/<(font|center|marquee|blink)\b/gi),
    'etiquetas presentacionales obsoletas',
  );
  if (!/<!doctype\s+html/i.test(html))
    push('no-doctype', 1, 'sin <!DOCTYPE html> (modo quirks o DTD antiguo)');
  if (/<meta[^>]+charset=["']?(iso-8859|windows-125)/i.test(html))
    push('quirks-charset', 1, 'charset no UTF-8');
  push('form-without-id', count(/<form\b(?![^>]*\bid=)[^>]*>/gi), 'formularios sin id');
  push(
    'name-only-inputs',
    count(/<input\b(?![^>]*\bid=)[^>]*\bname=/gi),
    'inputs con name pero sin id',
  );
  push('image-buttons', count(/<input\b[^>]*type=["']?image/gi), 'botones de imagen');
  push('javascript-links', count(/href=["']?javascript:/gi), 'enlaces javascript:');
  push('flash-or-applet', count(/<(object|embed|applet)\b/gi), 'Flash/applets/plugins');
  push('old-jquery', count(/jquery[-.]1\.[0-9]/gi), 'jQuery 1.x');
  push(
    'asp-webforms',
    count(/__VIEWSTATE|ctl00\$|WebForm_DoPostBack/g),
    'ASP.NET WebForms (ids dinámicos, postbacks)',
  );
  if (!/<meta[^>]+name=["']viewport/i.test(html))
    push('no-viewport', 1, 'sin meta viewport (no responsive)');
  return signals;
}

/** Puntuación legacy 0-100 a partir de las señales. */
export function legacyScore(signals: LegacySignal[]): number {
  const weights: Record<LegacySignal['kind'], number> = {
    'table-layout': 12,
    'inline-handlers': 10,
    framesets: 12,
    'font-tags': 8,
    'no-doctype': 10,
    'quirks-charset': 6,
    'form-without-id': 8,
    'name-only-inputs': 6,
    'image-buttons': 5,
    'javascript-links': 8,
    'flash-or-applet': 10,
    'old-jquery': 6,
    'asp-webforms': 12,
    'no-viewport': 5,
  };
  let score = 0;
  for (const s of signals)
    score += weights[s.kind] * Math.min(1, 0.5 + Math.log10(s.count + 1) / 2);
  return Math.min(100, Math.round(score));
}

/** camelCase corto a partir de texto (respeta identificadores ya en camelCase). */
function camel(text: string, fallback: string): string {
  const ident = /^[a-zA-Z][a-zA-Z0-9]*$/.test(text.trim()) ? text.trim() : null;
  if (ident) {
    // Quita prefijos húngaros típicos de sitios antiguos: txtNombre → nombre.
    const stripped = ident.replace(
      /^(txt|btn|frm|ddl|chk|lbl|cmd|lnk|img|rbl|hdn)(?=[A-Z])/,
      '',
    );
    return stripped[0].toLowerCase() + stripped.slice(1);
  }
  const words = decodeEntities(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(
      (w) => w && !/^(el|la|los|las|de|del|un|una|the|a|an|to|of|y|and|en|in)$/i.test(w),
    )
    .slice(0, 3);
  if (!words.length) return fallback;
  return words
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join('');
}

/**
 * Extrae formularios y acciones de un HTML legacy.
 * @param html Documento HTML.
 */
export function extractLegacyElements(html: string): {
  forms: LegacyForm[];
  actions: LegacyElement[];
} {
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const forms: LegacyForm[] = [];
  const formRe = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  let fm: RegExpExecArray | null;
  const formRanges: Array<[number, number]> = [];
  while ((fm = formRe.exec(body))) {
    const attrs = parseTagAttrs(fm[1]);
    const index = forms.length;
    formRanges.push([fm.index, fm.index + fm[0].length]);
    let selector: string;
    if (attrs.id && isStable(attrs.id)) selector = `#${cssEscape(attrs.id)}`;
    else if (attrs.name && isStable(attrs.name))
      selector = `form[name="${cssEscape(attrs.name)}"]`;
    else if (attrs.action) selector = `form[action="${cssEscape(attrs.action)}"]`;
    else selector = `form:nth-of-type(${index + 1})`;
    const fields: LegacyElement[] = [];
    let submit: LegacyElement | undefined;
    const inner = fm[2];
    const ctlRe = /<(input|select|textarea|button)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/gi;
    let cm: RegExpExecArray | null;
    let i = 0;
    while ((cm = ctlRe.exec(inner))) {
      const tag = cm[1].toLowerCase();
      const a = parseTagAttrs(cm[2]);
      const type = (a.type ?? (tag === 'button' ? 'submit' : 'text')).toLowerCase();
      if (['hidden'].includes(type) || /__VIEWSTATE|__EVENT/i.test(a.name ?? ''))
        continue;
      const text = textOf(cm[3] ?? '') || a.value || a.placeholder || a.title || '';
      const { selector: sel, confidence } = proposeSelector(tag, a, {
        formSelector: selector,
        text,
        index: i++,
      });
      const el: LegacyElement = {
        tag,
        attrs: a,
        text,
        selector: sel,
        confidence,
        formIndex: index,
      };
      if (
        type === 'submit' ||
        type === 'image' ||
        (tag === 'button' && type !== 'button' && type !== 'reset')
      ) {
        if (!submit) submit = el;
      } else if (type !== 'reset' && type !== 'button') {
        fields.push(el);
      }
    }
    forms.push({ index, attrs, selector, fields, submit });
  }
  const inForm = (pos: number) => formRanges.some(([s, e]) => pos >= s && pos < e);
  const actions: LegacyElement[] = [];
  const actRe = /<(a|button|input)\b([^>]*)>(?:([\s\S]*?)<\/\1>)?/gi;
  let am: RegExpExecArray | null;
  let idx = 0;
  while ((am = actRe.exec(body))) {
    if (inForm(am.index)) continue;
    const tag = am[1].toLowerCase();
    const a = parseTagAttrs(am[2]);
    if (tag === 'input' && !/button|submit|image/i.test(a.type ?? '')) continue;
    const isAction =
      tag !== 'a' ||
      Boolean(a.onclick) ||
      /^javascript:/i.test(a.href ?? '') ||
      /(login|logout|buscar|search|comprar|buy|cart|carrito|checkout|enviar|submit|contact|registr|sign|download|descargar|pedido|order)/i.test(
        (a.href ?? '') + ' ' + textOf(am[3] ?? '') + ' ' + (a.title ?? ''),
      );
    if (!isAction) continue;
    const text = textOf(am[3] ?? '') || a.value || a.title || a.alt || '';
    const { selector, confidence } = proposeSelector(tag, a, { text, index: idx++ });
    actions.push({ tag, attrs: a, text, selector, confidence });
    if (actions.length >= 40) break;
  }
  return { forms, actions };
}

/**
 * Construye el tool map propuesto para un sitio legacy.
 * @param forms Formularios.
 * @param actions Acciones sueltas.
 */
export function buildRetroToolMap(
  forms: LegacyForm[],
  actions: LegacyElement[],
): ToolMap {
  const map: ToolMap = { tools: {}, context: {} };
  const used = new Set<string>();
  const unique = (base: string) => {
    let n = base;
    let i = 2;
    while (used.has(n)) n = `${base}${i++}`;
    used.add(n);
    return n;
  };
  for (const form of forms) {
    const submitText = form.submit?.text ?? '';
    const base = camel(
      submitText ||
        form.attrs.name ||
        form.attrs.id ||
        form.attrs.action ||
        `form ${form.index + 1}`,
      `form${form.index + 1}`,
    );
    const name = unique(base);
    const params: ToolSpec['params'] = {};
    form.fields.forEach((f, j) => {
      const pName =
        camel(
          f.attrs.name ?? f.attrs.id ?? f.attrs.placeholder ?? `field${j + 1}`,
          `field${j + 1}`,
        ).replace(/[^a-zA-Z0-9]/g, '') || `field${j + 1}`;
      let key = pName;
      let k = 2;
      while (params[key]) key = `${pName}${k++}`;
      params[key] = { source: 'value', selector: f.selector };
    });
    const tool: ToolSpec = {
      selector:
        form.submit?.selector ??
        `${form.selector} input[type="submit"], ${form.selector} button`,
      description: submitText
        ? `Formulario legacy: ${submitText}`
        : `Envía el formulario ${form.attrs.name ?? form.attrs.id ?? form.index + 1}`,
      params,
      trigger: { event: 'submit', selector: form.selector },
      fingerprint: form.submit
        ? {
            tag: form.submit.tag,
            text: form.submit.text,
            attrs: pick(form.submit.attrs, ['name', 'value', 'type', 'id']),
          }
        : undefined,
      meta: { legacy: 'true', confidence: String(form.submit?.confidence ?? 0.4) },
    };
    if (!tool.fingerprint) delete tool.fingerprint;
    map.tools[name] = tool;
  }
  actions.forEach((a, i) => {
    const label =
      a.text ||
      a.attrs.title ||
      a.attrs.alt ||
      a.attrs.name ||
      a.attrs.id ||
      `action${i + 1}`;
    const name = unique(camel(label, `action${i + 1}`));
    map.tools[name] = {
      selector: a.selector,
      description: a.attrs.title
        ? a.attrs.title
        : a.text
          ? `Pulsa '${a.text}'`
          : `Acción ${name}`,
      params: {},
      fingerprint: {
        tag: a.tag,
        text: a.text,
        attrs: pick(a.attrs, ['href', 'name', 'value', 'title', 'alt', 'id']),
      },
      meta: { legacy: 'true', confidence: String(a.confidence) },
    };
  });
  return map;
}

/** Copia solo claves presentes. */
function pick(obj: Record<string, string>, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) if (obj[k]) out[k] = obj[k].slice(0, 80);
  return out;
}

/** Extrae el `<title>` del HTML. */
export function extractTitle(html: string): string {
  return (
    textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '') || 'Sitio legacy'
  );
}

/**
 * Escanea HTML legacy y devuelve el informe + tool map propuesto.
 * @param html HTML de la página.
 * @param url URL de origen (informativa).
 */
export function scanLegacyHtml(html: string, url?: string): RetroScan {
  const signals = detectLegacySignals(html);
  const { forms, actions } = extractLegacyElements(html);
  let toolMap = buildRetroToolMap(forms, actions);
  const notes: string[] = [];
  // Formularios ya anotados con la API declarativa del estándar: conservan
  // nombre, descripción y parámetros y desplazan a la herramienta inferida
  // para el mismo formulario.
  const declarativeScan = extractDeclarativeTools(html);
  const declarative = declarativeScan.tools.map((t) => t.name);
  if (declarativeScan.tools.length > 0) {
    const declaredForms = new Set(declarativeScan.tools.map((t) => t.formSelector));
    for (const [n, t] of Object.entries(toolMap.tools)) {
      if (t.trigger?.selector && declaredForms.has(t.trigger.selector))
        delete toolMap.tools[n];
    }
    toolMap = declarativeToolsToToolMap(declarativeScan.tools, toolMap);
    notes.push(
      `${declarativeScan.tools.length} formulario(s) ya usan la API declarativa WebMCP (${declarative.join(', ')}): se han conservado tal cual.`,
    );
  }
  notes.push(...declarativeScan.warnings);
  const lowConf = Object.entries(toolMap.tools).filter(
    ([, t]) => Number(t.meta?.confidence ?? 1) < 0.5,
  );
  if (lowConf.length)
    notes.push(
      `${lowConf.length} herramienta(s) con selector de baja confianza: revisa ${lowConf.map(([n]) => n).join(', ')}.`,
    );
  if (signals.some((s) => s.kind === 'asp-webforms'))
    notes.push(
      'ASP.NET WebForms: los ids ctl00$… cambian; se han preferido name/value y fingerprints. Considera `webmcpcss repair` tras cada despliegue.',
    );
  if (signals.some((s) => s.kind === 'framesets'))
    notes.push(
      'Hay frames/iframes: las herramientas dentro de un frame requieren ejecutar con el frame como documento.',
    );
  if (signals.some((s) => s.kind === 'javascript-links'))
    notes.push(
      'Enlaces javascript: se seleccionan por texto/onclick; añade data-tool si puedes tocar el HTML.',
    );
  return {
    url,
    title: extractTitle(html),
    signals,
    legacyScore: legacyScore(signals),
    forms,
    actions,
    toolMap,
    notes,
    declarative,
  };
}

/**
 * Descarga el HTML de una URL (fetch nativo, sin navegador).
 * @param url URL http(s).
 * @param fetchImpl Implementación de fetch (tests).
 */
export async function fetchHtml(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await fetchImpl(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; WebMCPcss-retro/1.0)',
      accept: 'text/html,*/*',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  return await res.text();
}

const LLM_SYSTEM = `Eres un experto en accesibilidad y automatización web. Recibes herramientas WebMCP extraídas de un sitio web antiguo (nombres y descripciones generados por heurísticas) y devuelves nombres camelCase claros en inglés y descripciones breves en español.
Responde SOLO JSON: {"tools": {"<nombreActual>": {"name": "<nuevoNombre>", "description": "<descripción>"}}}. No inventes herramientas nuevas.`;

/**
 * Mejora nombres/descripciones del tool map con un LLM (opcional).
 * @returns Número de herramientas renombradas o re-descritas.
 */
export async function enhanceRetroWithLlm(
  scan: RetroScan,
  client: LlmClient,
): Promise<number> {
  const summary = Object.entries(scan.toolMap.tools).map(([name, t]) => ({
    name,
    description: t.description,
    selector: t.selector,
    params: Object.keys(t.params),
    fingerprint: t.fingerprint,
  }));
  let raw: string;
  try {
    raw = await client.complete({
      system: LLM_SYSTEM,
      user: JSON.stringify({ title: scan.title, url: scan.url, tools: summary }),
      json: true,
    });
  } catch {
    return 0;
  }
  const obj = extractJsonObject(raw);
  const tools = (obj?.tools ?? null) as Record<
    string,
    { name?: string; description?: string }
  > | null;
  if (!tools) return 0;
  let changed = 0;
  const next: ToolMap['tools'] = {};
  for (const [name, spec] of Object.entries(scan.toolMap.tools)) {
    const s = tools[name];
    let newName = name;
    if (s?.name && /^[a-zA-Z][a-zA-Z0-9]*$/.test(s.name) && !next[s.name])
      newName = s.name;
    if (s?.description && typeof s.description === 'string')
      spec.description = s.description.slice(0, 160);
    if (newName !== name || s?.description) changed++;
    next[newName] = spec;
  }
  scan.toolMap.tools = next;
  return changed;
}
