/**
 * Intérprete de prompts: traduce una orden en lenguaje natural (español o
 * inglés) a una {@link PromptAction} estructurada.
 *
 * Dos vías, en este orden:
 * 1. **LLM** (si hay proveedor configurado): recibe el prompt, los archivos
 *    adjuntos y un resumen de los elementos de la página; responde JSON.
 *    La salida se valida y normaliza antes de aceptarla.
 * 2. **Heurísticas locales** (siempre disponibles, sin red): verbos por
 *    acción, extracción de colores, texto entrecomillado, destinos de
 *    `move`, etc. También sirven de fallback si el LLM falla o responde
 *    algo inválido.
 */
import { humanize } from '../core/vision';
import type { ElementSnapshot } from '../types';
import { logger } from '../utils/logger';
import { extractJsonObject } from './llm-client';
import type {
  InterpretOptions,
  LlmClient,
  Placement,
  PromptAction,
  PromptActionType,
  PromptParameters,
} from './types';
import { PROMPT_ACTIONS } from './types';
import {
  detectKinds,
  findColor,
  fold,
  foldKeepLength,
  looksLikeSelector,
} from './vocabulary';

/** System prompt enviado al LLM. */
export const INTERPRETER_SYSTEM_PROMPT = [
  'Eres un asistente que traduce comandos en lenguaje natural a acciones estructuradas',
  'para modificar un sitio web. Extrae la acción, el elemento objetivo y los parámetros.',
  'Devuelve SOLO un objeto JSON con este formato, sin texto adicional:',
  '{',
  '  "action": "upload" | "changeColor" | "delete" | "move" | "click" | "fill" | "hide" | "setText" | "setStyle" | "other",',
  '  "target": "descripción breve del elemento objetivo",',
  '  "selector": "selector CSS del elemento si aparece en los candidatos (opcional)",',
  '  "parameters": {',
  '    "file": "ruta del archivo a subir (upload)",',
  '    "color": "color CSS (changeColor)",',
  '    "property": "color | background-color | border-color (changeColor)",',
  '    "text": "texto a escribir (fill) o nuevo contenido (setText)",',
  '    "destination": "descripción del elemento destino (move)",',
  '    "placement": "before | after | inside | start (move)",',
  '    "position": {"x": 0, "y": 0},',
  '    "all": true,',
  '    "tool": "nombre de herramienta WebMCP disponible (other)",',
  '    "args": {"param": "valor"},',
  '    "styles": {"propiedad-css": "valor"}',
  '  },',
  '  "confidence": 0.0-1.0,',
  '  "reasoning": "explicación en una frase"',
  '}',
  'Reglas: usa "hide" para ocultar y "delete" para eliminar; "fill" solo para campos de',
  'formulario; "setText" para cambiar el texto visible de un elemento; si el usuario',
  'adjuntó archivos y habla de subir/poner/cambiar una imagen, la acción es "upload".',
  'Si existe una herramienta WebMCP que cumpla la orden, usa "other" con "tool".',
  'Incluye solo los parámetros relevantes.',
].join('\n');

/** Máximo de candidatos de página incluidos en el prompt del LLM. */
const MAX_CANDIDATES_IN_PROMPT = 60;

/**
 * Construye el mensaje de usuario para el LLM con prompt, adjuntos y
 * contexto de la página (candidatos resumidos y herramientas disponibles).
 *
 * @param prompt Orden del usuario.
 * @param options Adjuntos, URL y contexto.
 */
export function buildInterpreterUserPrompt(
  prompt: string,
  options: InterpretOptions = {},
): string {
  const lines = [`Comando: ${prompt}`];
  if (options.files && options.files.length > 0) {
    lines.push(`Archivos adjuntos: ${options.files.join(', ')}`);
  }
  if (options.text) lines.push(`Texto adicional: ${options.text}`);
  const ctx = options.context;
  if (ctx?.url || options.url) lines.push(`URL: ${ctx?.url ?? options.url}`);
  if (ctx?.title) lines.push(`Título de la página: ${ctx.title}`);
  if (ctx?.tools && ctx.tools.length > 0) {
    lines.push(`Herramientas WebMCP disponibles: ${ctx.tools.join(', ')}`);
  }
  if (ctx?.candidates && ctx.candidates.length > 0) {
    lines.push('Elementos de la página (selector | tag | texto | atributos):');
    for (const c of summarizeCandidates(ctx.candidates)) lines.push(`- ${c}`);
  }
  return lines.join('\n');
}

/** Resume candidatos en una línea cada uno, priorizando los visibles. */
function summarizeCandidates(candidates: ElementSnapshot[]): string[] {
  const sorted = [...candidates].sort((a, b) => Number(b.visible) - Number(a.visible));
  return sorted.slice(0, MAX_CANDIDATES_IN_PROMPT).map((c) => {
    const attrs = Object.entries(c.attrs)
      .filter(([k]) => k !== 'href')
      .map(([k, v]) => `${k}=${v.slice(0, 30)}`)
      .join(' ');
    return `${c.selector} | ${c.tag} | ${c.text.slice(0, 50)} | ${attrs}`.trim();
  });
}

/* ------------------------------------------------------------------ */
/* Normalización de la salida del LLM                                  */
/* ------------------------------------------------------------------ */

/** Sinónimos de acción que un LLM podría devolver. */
const ACTION_ALIASES: Record<string, PromptActionType> = {
  remove: 'delete',
  eliminar: 'delete',
  borrar: 'delete',
  quitar: 'delete',
  ocultar: 'hide',
  esconder: 'hide',
  type: 'fill',
  input: 'fill',
  write: 'fill',
  escribir: 'fill',
  rellenar: 'fill',
  press: 'click',
  tap: 'click',
  pulsar: 'click',
  clic: 'click',
  color: 'changeColor',
  changecolor: 'changeColor',
  change_color: 'changeColor',
  recolor: 'changeColor',
  style: 'setStyle',
  setstyle: 'setStyle',
  set_style: 'setStyle',
  css: 'setStyle',
  text: 'setText',
  settext: 'setText',
  set_text: 'setText',
  replace_text: 'setText',
  rename: 'setText',
  mover: 'move',
  reorder: 'move',
  subir: 'upload',
  attach: 'upload',
  file: 'upload',
  tool: 'other',
  execute: 'other',
  run: 'other',
};

/** Normaliza el nombre de acción devuelto por un LLM. */
export function normalizeActionName(value: unknown): PromptActionType | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if ((PROMPT_ACTIONS as readonly string[]).includes(raw)) return raw as PromptActionType;
  const alias = ACTION_ALIASES[raw.toLowerCase()];
  return alias ?? null;
}

/**
 * Valida y normaliza un objeto devuelto por el LLM. Descarta campos con
 * tipos incorrectos en vez de fallar; devuelve `null` si no hay acción
 * reconocible.
 *
 * @param obj Objeto JSON del modelo.
 * @param prompt Prompt original (se conserva en la acción).
 */
export function normalizeLlmAction(
  obj: Record<string, unknown>,
  prompt: string,
): PromptAction | null {
  const action = normalizeActionName(obj.action);
  if (!action) return null;
  const target = typeof obj.target === 'string' ? obj.target.trim() : '';
  const rawParams =
    typeof obj.parameters === 'object' && obj.parameters !== null
      ? (obj.parameters as Record<string, unknown>)
      : {};
  const params: PromptParameters = {};
  const str = (k: string): string | undefined =>
    typeof rawParams[k] === 'string' && (rawParams[k] as string).trim()
      ? (rawParams[k] as string).trim()
      : undefined;

  params.file = str('file');
  if (Array.isArray(rawParams.files)) {
    const files = rawParams.files.filter((f): f is string => typeof f === 'string');
    if (files.length > 0) params.files = files;
  }
  params.color = str('color');
  params.property = str('property');
  params.text = typeof rawParams.text === 'string' ? rawParams.text : undefined;
  params.destination = str('destination');
  const placement = str('placement');
  if (placement && ['before', 'after', 'inside', 'start'].includes(placement)) {
    params.placement = placement as Placement;
  }
  const pos = rawParams.position as { x?: unknown; y?: unknown } | undefined;
  if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
    params.position = { x: pos.x, y: pos.y };
  }
  if (typeof rawParams.all === 'boolean') params.all = rawParams.all;
  params.tool = str('tool');
  if (typeof rawParams.args === 'object' && rawParams.args !== null) {
    const args: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawParams.args as Record<string, unknown>)) {
      if (v !== null && v !== undefined) args[k] = String(v);
    }
    if (Object.keys(args).length > 0) params.args = args;
  }
  if (typeof rawParams.styles === 'object' && rawParams.styles !== null) {
    const styles: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawParams.styles as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'number') styles[k] = String(v);
    }
    if (Object.keys(styles).length > 0) params.styles = styles;
  }
  // Limpiar claves undefined para una salida JSON compacta.
  for (const k of Object.keys(params) as Array<keyof PromptParameters>) {
    if (params[k] === undefined) delete params[k];
  }

  const confidence =
    typeof obj.confidence === 'number' ? Math.max(0, Math.min(1, obj.confidence)) : 0.7;
  const selector =
    typeof obj.selector === 'string' && obj.selector.trim()
      ? obj.selector.trim()
      : undefined;
  return {
    action,
    target: target || (selector ?? ''),
    selector,
    parameters: params,
    confidence,
    source: 'llm',
    rawPrompt: prompt,
    reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : undefined,
  };
}

/* ------------------------------------------------------------------ */
/* Heurísticas locales                                                  */
/* ------------------------------------------------------------------ */

/** Sufijos enclíticos del español (`ocúltalo`, `bórrame`, `súbela`). */
const CLITIC = '(?:lo|la|los|las|le|les|me|nos|te|se)?';

/** Crea un patrón de verbo con enclíticos opcionales y límite de palabra. */
function verb(stems: string): RegExp {
  return new RegExp(`\\b(?:${stems})${CLITIC}\\b`);
}

/** Patrones de verbo por acción (texto ya normalizado). Orden = prioridad. */
const VERB_RULES: Array<{ action: PromptActionType; re: RegExp }> = [
  {
    action: 'upload',
    re: verb('sub(?:e|ir|a|ime)|carga(?:r|me)?|adjunta(?:r)?|upload|attach'),
  },
  {
    action: 'hide',
    re: verb('ocult(?:a|ar|e|ame)|escond(?:e|er|a)|hide|conceal|collapse'),
  },
  {
    action: 'delete',
    re: verb(
      'elimin(?:a|ar|e|ame)|borr(?:a|ar|e|ame)|quit(?:a|ar|e|ame)|remuev(?:e|a)|remov(?:er|e)|delete|remove|suprim(?:e|ir)',
    ),
  },
  {
    action: 'move',
    re: verb(
      'muev(?:e|a|eme)|mov(?:er|elo|ela)|traslad(?:a|ar)|reubic(?:a|ar)|coloc(?:a|ar)|pon(?:er)?\\s+(?:arriba|abajo|antes|despues|debajo|encima|al\\s+(?:inicio|principio|final|lado))|move|reorder|relocate|drag',
    ),
  },
  {
    action: 'changeColor',
    re: verb('colore(?:a|ar)|pint(?:a|ar|e)|color|colour|recolor|tinte'),
  },
  {
    action: 'fill',
    re: verb(
      'rellen(?:a|ar|e|ame)|llen(?:a|ar|e)|escrib(?:e|ir|a|eme)|teclea(?:r)?|introduc(?:e|ir)|ingres(?:a|ar|e)|complet(?:a|ar)|fill|type|enter|input|write',
    ),
  },
  {
    action: 'setText',
    // El verbo termina ANTES del sustantivo (texto/título...), que queda como objetivo.
    re: /\b(?:renombr(?:a|ar)|retitul(?:a|ar)|rename|retitle|(?:reemplaz(?:a|ar)|cambi(?:a|ar|e)|modific(?:a|ar)|set|change|replace|edit(?:a|ar)?)(?=\s+(?:el|la|the)?\s*(?:texto|titulo|nombre|etiqueta|contenido|label|heading|title|text|name|caption|wording)\b))/,
  },
  {
    action: 'click',
    re: verb(
      'clic|click|clica(?:r)?|clique(?:a|ar)|puls(?:a|ar|e)|presion(?:a|ar|e)|aprieta|toca(?:r)?|abr(?:e|ir|ime)|acept(?:a|ar)|cierr(?:a|e)|cerrar|env(?:ia|iar)|submit|press|tap|open|close|accept|dismiss|send',
    ),
  },
];

/** Expresiones de posición relativa para `move` (es/en). */
const PLACEMENT_RULES: Array<{ placement: Placement; re: RegExp }> = [
  {
    placement: 'before',
    re: /\b(antes\s+de(l)?|encima\s+de(l)?|arriba\s+de(l)?|sobre\s+(el|la|los|las)|above|before|on\s+top\s+of)\b/,
  },
  {
    placement: 'after',
    re: /\b(despues\s+de(l)?|debajo\s+de(l)?|abajo\s+de(l)?|bajo\s+(el|la|los|las)|tras\s+(el|la)|below|after|under(neath)?)\b/,
  },
  {
    placement: 'start',
    re: /\b(al\s+(inicio|principio|comienzo)\s+de(l)?|at\s+the\s+(start|beginning|top)\s+of)\b/,
  },
  {
    placement: 'inside',
    re: /\b(dentro\s+de(l)?|adentro\s+de(l)?|en\s+el\s+interior\s+de(l)?|al\s+final\s+de(l)?|inside|into|within|at\s+the\s+end\s+of)\b/,
  },
];

/** Palabras que separan objetivo y valor en órdenes `fill`/`setText`. */
const VALUE_SEPARATOR =
  /\s+(?:con|by|to|a|por|as|que\s+diga|que\s+ponga|to\s+say|with)\s+/;

/** Texto entrecomillado (dobles, simples, tipográficas o «»). */
const QUOTED = /["“”«»']([^"“”«»']{1,500})["“”«»']/;

/** Quita comillas envolventes de un texto. */
function unquote(s: string): string {
  return s.replace(/^["“”«»']+|["“”«»']+$/g, '').trim();
}

/** Recorta artículos/preposiciones iniciales y verbos auxiliares. */
function trimLeadingNoise(s: string): string {
  return s
    .trim()
    .replace(
      /^(?:(?:por\s+favor|please|quiero|necesito|quisiera|puedes|podrias|debes|hay\s+que|i\s+want\s+to|i\s+need\s+to|can\s+you|could\s+you|would\s+you)\s+)+/,
      '',
    )
    .replace(/^(?:que\s+)?(?:se\s+)?/, '')
    .replace(
      /^(?:(?:el|la|los|las|un|una|unos|unas|al|del|de|en|a|the|a|an|this|that|este|esta|ese|esa|my|mi)\s+)+/,
      '',
    )
    .trim();
}

/** Recorta ruido final: `por favor`, signos de puntuación. */
function trimTrailingNoise(s: string): string {
  return s
    .trim()
    .replace(/\s+(por\s+favor|please|ahora|now|ya)$/, '')
    .replace(/[.!?,;:]+$/, '')
    .replace(/\s+(y|e|o|u|and|or|to|a|al|en|in|into|on|de|del|of|the|el|la)$/, '')
    .trim();
}

/** Encuentra la posición del verbo principal y el texto tras él. */
function afterVerb(folded: string, re: RegExp): string | null {
  const m = re.exec(folded);
  if (!m) return null;
  return folded.slice(m.index + m[0].length).trim();
}

/** Elimina pronombres enclíticos y palabras `me/nos` tras el verbo. */
function stripCliticStart(s: string): string {
  return s.replace(/^(me|nos|le|lo|la|los|las|it|them)\s+/, '').trim();
}

/**
 * Extrae la descripción del objetivo para acciones simples (click, delete,
 * hide, upload): texto tras el verbo, sin ruido ni complementos de valor.
 */
function extractSimpleTarget(folded: string, verbRe: RegExp): string {
  let rest = afterVerb(folded, verbRe) ?? folded;
  rest = stripCliticStart(rest);
  // Cortar complementos típicos que no describen el objetivo.
  rest = rest.split(/\s+(?:para|to|so\s+that|porque|because|y\s+luego|and\s+then)\s+/)[0];
  return trimTrailingNoise(trimLeadingNoise(rest));
}

/** Busca una herramienta cuyo nombre humanizado aparezca en el prompt. */
function matchToolName(folded: string, tools: string[]): string | null {
  let best: { name: string; len: number } | null = null;
  for (const name of tools) {
    const words = humanize(name);
    if (!words) continue;
    if (folded.includes(words) || folded.replace(/\s+/g, '') === fold(name)) {
      if (!best || words.length > best.len) best = { name, len: words.length };
    }
  }
  return best?.name ?? null;
}

/** Resultado interno de la heurística: acción + texto original recortado. */
interface HeuristicOutcome {
  action: PromptAction;
}

/**
 * Interpreta un prompt SIN LLM, con reglas léxicas para español e inglés.
 * Siempre devuelve una acción (en el peor caso `other` con confianza baja).
 *
 * @param prompt Orden del usuario.
 * @param options Adjuntos y texto adicional.
 */
export function interpretHeuristically(
  prompt: string,
  options: InterpretOptions = {},
): PromptAction {
  let original = prompt.replace(/\s+/g, ' ').trim();
  let folded = foldKeepLength(original);
  const files = [...(options.files ?? [])];
  const params: PromptParameters = {};
  let action: PromptActionType | null = null;
  let verbRe: RegExp | null = null;

  // 0) Selector CSS explícito: `#id`, `.clase`… se usa tal cual.
  const selectorMatch = /(?:^|\s)([#.[][^\s"']+|[a-z]+[#.[][^\s"']*)/.exec(original);
  const explicitSelector =
    selectorMatch && looksLikeSelector(selectorMatch[1]) ? selectorMatch[1] : undefined;
  // Con selector explícito, el resto del texto describe la acción, no el objetivo.
  if (explicitSelector) {
    original = original.replace(explicitSelector, ' ').replace(/\s+/g, ' ').trim();
    folded = foldKeepLength(original);
  }

  // 1) Detectar el verbo (primer patrón que aparezca en el texto).
  let bestIndex = Number.POSITIVE_INFINITY;
  for (const rule of VERB_RULES) {
    const m = rule.re.exec(folded);
    if (m && m.index < bestIndex) {
      bestIndex = m.index;
      action = rule.action;
      verbRe = rule.re;
    }
  }

  // 2) Señales fuertes que reordenan prioridades.
  const color = findColor(folded);
  const mentionsColor = /\b(color|colour|fondo|background)\b/.test(folded);
  if (
    color &&
    (action === null || action === 'setText' || action === 'fill' || mentionsColor)
  ) {
    // "cambia el color del botón a rojo", "pon el fondo azul", "botón rojo".
    if (
      action !== 'changeColor' &&
      (mentionsColor ||
        action === null ||
        /\b(pon|poner|cambia|cambiar|haz|hacer|make|set|change|turn)\b/.test(folded))
    ) {
      action = 'changeColor';
      verbRe =
        /\b(cambi(a|ar|e)|pon(er|le|lo|la)?|haz|hacer|make|set|change|turn|paint|pint(a|ar))\b/;
    }
  }
  if (
    files.length > 0 &&
    (action === null ||
      action === 'fill' ||
      action === 'setText' ||
      action === 'click' ||
      action === 'move')
  ) {
    // Con adjuntos, "pon esta imagen en el carrusel" es una subida.
    if (
      /\b(imagen|foto|image|photo|picture|archivo|file|logo|video|documento|pdf|csv)\b/.test(
        folded,
      ) ||
      action === null
    ) {
      action = 'upload';
      verbRe =
        /\b(sub(e|ir|a|ime)|carga(r|me)?|adjunta(r)?|upload|attach|pon(er|le|lo|la|me)?|coloc(a|ar)|cambi(a|ar)|reemplaz(a|ar)|usa(r)?|put|place|add|replace|use|set|change|agreg(a|ar)|anad(e|ir))\b/;
    }
  }
  if (
    action === null &&
    /\b(cambi(a|ar|e)|modific(a|ar)|reemplaz(a|ar)|actualiz(a|ar)|change|modify|replace|update|set)\b/.test(
      folded,
    )
  ) {
    // "cambia el título a X" sin verbo específico.
    const hasValue = QUOTED.test(original) || VALUE_SEPARATOR.test(folded);
    const mentionsTextNoun =
      /\b(texto|titulo|nombre|etiqueta|contenido|label|heading|title|text|name|caption)\b/.test(
        folded,
      );
    // "set quantity to 2" (campo) → fill; "cambia el título a X" → setText.
    action = !hasValue ? 'other' : mentionsTextNoun ? 'setText' : 'fill';
    verbRe =
      /\b(cambi(a|ar|e)|modific(a|ar)|reemplaz(a|ar)|actualiz(a|ar)|change|modify|replace|update|set)\b/;
  }
  const STYLE_WORDS =
    /\b(mas\s+grande|mas\s+pequen[oa]|bigger|smaller|larger|en\s+negrita|negrita|bold|cursiva|italic|subraya(do|r)?|underline|centra(r|do|lo|la)?|center|mayuscula(s)?|uppercase|\d+\s*px)\b/;
  if (
    action === null &&
    /\b(pon(er|le|lo|la)?|put|set|make|haz|hacer)\b/.test(folded) &&
    !STYLE_WORDS.test(folded)
  ) {
    // "pon la cantidad en 3" / "set quantity to 2" / pon "Hola" en el buscador
    // → rellenar un campo con un valor.
    const quotedFirst =
      /\b(?:pon(?:er|le|lo|la)?|put|set)\s+["“«']([^"”»']+)["”»']\s+(?:en|in|into|on)\s+(.+)$/.exec(
        folded,
      );
    const valued =
      /\b(?:pon(?:er|le|lo|la)?|put|set)\s+(?:el|la|los|las|the)?\s*(.+?)\s+(?:en|a|to|=)\s+["“«']?([^"”»']+?)["”»']?$/.exec(
        folded,
      );
    if (quotedFirst) {
      const q = QUOTED.exec(original);
      return {
        action: 'fill',
        target: trimTrailingNoise(trimLeadingNoise(quotedFirst[2])),
        parameters: { text: q ? q[1] : quotedFirst[1] },
        confidence: 0.7,
        source: 'heuristic',
        rawPrompt: prompt.trim(),
        reasoning: 'Patrón "pon <texto> en <campo>" interpretado como relleno de campo.',
      };
    }
    if (valued && !detectKinds(valued[2]).length && !findColor(valued[2])) {
      const valueStart =
        original.length -
        valued[2].length -
        (folded.length - (valued.index + valued[0].length));
      const rawValue = original.slice(valueStart, valueStart + valued[2].length);
      return {
        action: 'fill',
        target: trimTrailingNoise(trimLeadingNoise(valued[1])),
        parameters: { text: unquote(rawValue) },
        confidence: 0.6,
        source: 'heuristic',
        rawPrompt: prompt.trim(),
        reasoning: 'Patrón "pon <campo> en <valor>" interpretado como relleno de campo.',
      };
    }
  }
  if (action === null && /\b(pon(er|le|lo|la)?|put|set|make|haz|hacer)\b/.test(folded)) {
    action = 'setStyle';
    verbRe = /\b(pon(er|le|lo|la)?|put|set|make|haz|hacer)\b/;
  }
  // "haz el título más grande" → setStyle
  if (
    /\b(mas\s+grande|mas\s+pequen[oa]|bigger|smaller|larger|en\s+negrita|bold|cursiva|italic|subraya|underline|centra(r|do)?|center|mayuscula|uppercase)\b/.test(
      folded,
    ) &&
    action !== 'changeColor'
  ) {
    action = 'setStyle';
    verbRe = verbRe ?? /\b(pon(er|le|lo|la)?|haz|hacer|make|set)\b/;
  }
  if (action === null) {
    // ¿La orden nombra una herramienta WebMCP disponible? ("subscribe newsletter con x")
    const toolHit = matchToolName(folded, options.context?.tools ?? []);
    if (toolHit) {
      const sep = VALUE_SEPARATOR.exec(folded);
      const value = sep
        ? trimTrailingNoise(unquote(original.slice(sep.index + sep[0].length)))
        : undefined;
      const q = QUOTED.exec(original);
      return {
        action: 'other',
        target: toolHit,
        parameters: {
          tool: toolHit,
          ...(q?.[1] || value || options.text
            ? { text: q?.[1] ?? value ?? options.text }
            : {}),
        },
        confidence: 0.6,
        source: 'heuristic',
        rawPrompt: prompt.trim(),
        reasoning: `La orden nombra la herramienta WebMCP "${toolHit}".`,
      };
    }
    return {
      action: 'other',
      target: trimTrailingNoise(trimLeadingNoise(original)),
      parameters: {},
      confidence: 0.2,
      source: 'heuristic',
      rawPrompt: prompt.trim(),
      reasoning: 'No se reconoció ningún verbo de acción; se devuelve la orden completa.',
    };
  }

  // 3) Extraer parámetros por acción.
  let target = '';
  let confidence = 0.6;
  const quoted = QUOTED.exec(original);

  switch (action) {
    case 'changeColor': {
      params.color = color?.value;
      params.property = /\b(fondo|background|relleno)\b/.test(folded)
        ? 'background-color'
        : /\b(borde|border)\b/.test(folded)
          ? 'border-color'
          : undefined;
      let rest = afterVerb(folded, verbRe!) ?? folded;
      rest = stripCliticStart(rest);
      // Quitar la mención del color y palabras de color/fondo.
      if (color) rest = rest.replace(color.raw, ' ');
      rest = rest
        .replace(
          /\b(el|la|los|las|the)?\s*(color|colour|fondo|background|borde|border)\s*(de|del|of)?\b/g,
          ' ',
        )
        .replace(/\b(a|en|to|into|con|with|de|of|por|by|como|as)\s*$/g, ' ')
        .replace(/\s+(a|en|to|into|con|with|por|by|como|as)\s+$/, ' ')
        .replace(/\s{2,}/g, ' ')
        .trim();
      target = trimTrailingNoise(trimLeadingNoise(rest)) || 'page';
      if (params.property === undefined && target === 'page')
        params.property = 'background-color';
      confidence = color ? 0.8 : 0.4;
      break;
    }
    case 'fill':
    case 'setText': {
      // Valor: texto entrecomillado > tras separador (con/a/to/by) > --text.
      let value: string | undefined;
      let rest = afterVerb(folded, verbRe!) ?? folded;
      rest = stripCliticStart(rest);
      if (quoted) {
        value = quoted[1];
        rest = rest.replace(foldKeepLength(quoted[0]), ' ');
        rest = rest.replace(VALUE_SEPARATOR, ' ');
      } else {
        const sepMatch = VALUE_SEPARATOR.exec(rest);
        if (sepMatch) {
          const offset = folded.length - (afterVerb(folded, verbRe!) ?? folded).length;
          const restStartInOriginal = original.length - rest.length;
          void offset;
          const valueStartInRest = sepMatch.index + sepMatch[0].length;
          value = original.slice(restStartInOriginal + valueStartInRest).trim();
          value = trimTrailingNoise(unquote(value));
          rest = rest.slice(0, sepMatch.index);
        }
      }
      if (!value && options.text) value = options.text;
      params.text = value;
      rest = trimLeadingNoise(rest.replace(/\s+en\s*$/, ''));
      if (action === 'setText') {
        // "texto del botón" → "botón"; "título" se conserva como objetivo.
        rest = rest.replace(
          /^(?:texto|contenido|etiqueta|text|label|wording|caption)\s+(?:de|del|de\s+la|of|of\s+the|the)\s+(?=\S)/,
          '',
        );
      }
      target = trimTrailingNoise(rest);
      // "escribe hola en el buscador" (valor antes del objetivo).
      if (!quoted && !VALUE_SEPARATOR.test(folded) && action === 'fill') {
        const inMatch = /^(.+?)\s+(?:en|in|into|on)\s+(.+)$/.exec(rest);
        if (inMatch && !detectKinds(inMatch[1]).length) {
          const restStartInOriginal = original.length - rest.length;
          params.text = trimTrailingNoise(
            unquote(
              original.slice(
                restStartInOriginal,
                restStartInOriginal + inMatch[1].length,
              ),
            ),
          );
          target = trimTrailingNoise(trimLeadingNoise(inMatch[2]));
        }
      }
      confidence = params.text ? 0.75 : 0.45;
      break;
    }
    case 'move': {
      let rest = afterVerb(folded, verbRe!) ?? folded;
      rest = stripCliticStart(rest);
      let placement: Placement | undefined;
      let destination: string | undefined;
      let earliest = Number.POSITIVE_INFINITY;
      for (const rule of PLACEMENT_RULES) {
        const m = rule.re.exec(rest);
        if (m && m.index < earliest) {
          earliest = m.index;
          placement = rule.placement;
          destination = rest.slice(m.index + m[0].length);
          rest = rest.slice(0, m.index);
        }
      }
      const pos = /\(?\s*(-?\d+)\s*[,;x]\s*(-?\d+)\s*\)?/.exec(
        rest + ' ' + (destination ?? ''),
      );
      if (pos) params.position = { x: Number(pos[1]), y: Number(pos[2]) };
      const TOP =
        /\s*\b(?:(?:hacia|hasta|to|a|al)\s+)?(?:(?:el|la|the)\s+)?(?:arriba(?:\s+del\s+todo)?|al\s+principio|al\s+inicio|top|up)\b/;
      const BOTTOM =
        /\s*\b(?:(?:hacia|hasta|to|a|al)\s+)?(?:(?:el|la|the)\s+)?(?:abajo(?:\s+del\s+todo)?|al\s+final|bottom|down)\b/;
      if (!placement && TOP.test(rest)) {
        placement = 'start';
        destination = destination ?? 'body';
        rest = rest.replace(TOP, ' ');
      } else if (!placement && BOTTOM.test(rest)) {
        placement = 'inside';
        destination = destination ?? 'body';
        rest = rest.replace(BOTTOM, ' ');
      }
      params.placement = placement;
      params.destination = destination
        ? trimTrailingNoise(trimLeadingNoise(destination))
        : undefined;
      target = trimTrailingNoise(trimLeadingNoise(rest));
      confidence = params.destination || params.position ? 0.7 : 0.4;
      break;
    }
    case 'upload': {
      params.file = files[0];
      if (files.length > 1) params.files = files;
      let rest = afterVerb(folded, verbRe!) ?? folded;
      rest = stripCliticStart(rest);
      // "sube esta imagen en/al carrusel" → objetivo = carrusel.
      rest = rest.split(/\s+(?:por|con|with|using|usando)\s+/)[0];
      const dest = /\s+(?:en|al|a|dentro\s+de(?:l)?|into|in|to|on|onto)\s+(.+)$/.exec(
        rest,
      );
      const IMAGE_WORDS =
        /\b(?:esta|este|esa|ese|this|that|the|el|la|mi|my|nueva|nuevo|new)?\s*(?:imagen|imagenes|foto|fotos|image|photo|picture|archivo|file|video|documento|pdf|csv)\b/g;
      if (dest) {
        target = trimTrailingNoise(trimLeadingNoise(dest[1]));
      } else if (rest.replace(IMAGE_WORDS, ' ').trim()) {
        // "reemplaza el logo por esta foto" → objetivo = logo.
        target = trimTrailingNoise(trimLeadingNoise(rest.replace(IMAGE_WORDS, ' ')));
      } else {
        target = '';
      }
      if (!target) target = 'file input';
      if (files.length === 0 && !quoted) {
        // Quizá el usuario escribió la ruta en el prompt.
        const pathMatch = /((?:\.{0,2}\/|[a-z]:\\|https?:\/\/|data:)[^\s"']+)/i.exec(
          original,
        );
        if (pathMatch) params.file = pathMatch[1];
      } else if (files.length === 0 && quoted) {
        params.file = quoted[1];
      }
      confidence = params.file ? 0.8 : 0.5;
      break;
    }
    case 'setStyle': {
      const styles: Record<string, string> = {};
      if (/\b(mas\s+grande|bigger|larger|agrand(a|ar))\b/.test(folded))
        styles['font-size'] = '1.25em';
      if (/\b(mas\s+pequen[oa]|smaller|reduc(e|ir))\b/.test(folded))
        styles['font-size'] = '0.85em';
      if (/\b(negrita|bold)\b/.test(folded)) styles['font-weight'] = 'bold';
      if (/\b(cursiva|italic)\b/.test(folded)) styles['font-style'] = 'italic';
      if (/\b(subraya(do|r)?|underline)\b/.test(folded))
        styles['text-decoration'] = 'underline';
      if (/\b(centra(r|do|lo|la)?|center)\b/.test(folded))
        styles['text-align'] = 'center';
      if (/\b(mayuscula(s)?|uppercase)\b/.test(folded))
        styles['text-transform'] = 'uppercase';
      const px = /(\d+)\s*px/.exec(folded);
      if (px && !styles['font-size']) styles['font-size'] = `${px[1]}px`;
      params.styles = Object.keys(styles).length > 0 ? styles : undefined;
      let rest = afterVerb(folded, verbRe!) ?? folded;
      rest = stripCliticStart(rest)
        .replace(
          /\b(mas\s+grande|mas\s+pequen[oa]|bigger|smaller|larger|en\s+negrita|negrita|bold|en\s+cursiva|cursiva|italic|subraya(do|r)?|underline|centra(r|do|lo|la)?|center|en\s+mayusculas?|mayusculas?|uppercase|\d+\s*px)\b/g,
          ' ',
        )
        .replace(/\s{2,}/g, ' ')
        .trim();
      target = trimTrailingNoise(trimLeadingNoise(rest));
      confidence = params.styles ? 0.7 : 0.3;
      break;
    }
    case 'other': {
      target = trimTrailingNoise(trimLeadingNoise(original));
      confidence = 0.3;
      break;
    }
    default: {
      // click, delete, hide
      target = extractSimpleTarget(folded, verbRe!);
      if (/\b(todos|todas|all|every|cada)\b/.test(folded) && action !== 'click') {
        params.all = true;
        target = target
          .replace(/\b(todos|todas|all|every|cada)\s+(los|las|the)?\s*/g, '')
          .trim();
      }
      confidence = target ? 0.7 : 0.4;
    }
  }

  // Un objetivo compuesto solo por artículos/preposiciones no describe nada.
  if (/^(?:(?:el|la|los|las|un|una|the|a|an|de|del|en|al|to|in)\s*)+$/.test(target))
    target = '';
  // Si el objetivo quedó vacío pero hay un selector explícito, úsalo.
  if (explicitSelector && (!target || looksLikeSelector(target)))
    target = explicitSelector;
  // Recuperar el texto ORIGINAL del objetivo (con mayúsculas/acentos) cuando
  // sea posible: buscamos el fragmento normalizado dentro del original.
  const idx = folded.indexOf(target);
  const originalTarget = idx >= 0 ? original.slice(idx, idx + target.length) : target;

  for (const k of Object.keys(params) as Array<keyof PromptParameters>) {
    if (params[k] === undefined) delete params[k];
  }
  const result: HeuristicOutcome = {
    action: {
      action,
      target: originalTarget || target,
      selector: explicitSelector,
      parameters: params,
      confidence,
      source: 'heuristic',
      rawPrompt: prompt.trim(),
      reasoning: `Verbo reconocido para "${action}" mediante reglas locales.`,
    },
  };
  if (!result.action.selector) delete result.action.selector;
  return result.action;
}

/**
 * Interpreta un prompt con el LLM si está disponible, con fallback a las
 * heurísticas locales. Los archivos adjuntos se propagan siempre a
 * `parameters.file(s)` para la acción `upload`.
 *
 * @param prompt Orden del usuario.
 * @param options Adjuntos, URL y contexto de página.
 * @param llm Cliente LLM (o `null` para heurísticas puras).
 */
export async function interpretPrompt(
  prompt: string,
  options: InterpretOptions = {},
  llm: LlmClient | null = null,
): Promise<PromptAction> {
  const trimmed = prompt.trim();
  if (!trimmed) throw new Error('El prompt está vacío.');

  if (llm) {
    try {
      const raw = await llm.complete({
        system: INTERPRETER_SYSTEM_PROMPT,
        user: buildInterpreterUserPrompt(trimmed, options),
        json: true,
        temperature: 0,
      });
      const obj = extractJsonObject(raw);
      const action = obj ? normalizeLlmAction(obj, trimmed) : null;
      if (action) {
        applyAttachments(action, options);
        logger.debug(
          `prompt: LLM ${llm.provider}/${llm.model} → ${action.action} "${action.target}"`,
        );
        return action;
      }
      logger.warn('LLM: respuesta sin JSON válido; usando heurísticas locales.');
    } catch (err) {
      logger.warn(
        `LLM: fallo (${err instanceof Error ? err.message : String(err)}); usando heurísticas locales.`,
      );
    }
  }
  const action = interpretHeuristically(trimmed, options);
  applyAttachments(action, options);
  return action;
}

/** Propaga adjuntos/texto del CLI a los parámetros si faltan. */
function applyAttachments(action: PromptAction, options: InterpretOptions): void {
  const files = options.files ?? [];
  if (action.action === 'upload') {
    if (!action.parameters.file && files.length > 0) action.parameters.file = files[0];
    if (!action.parameters.files && files.length > 1) action.parameters.files = files;
  }
  if (
    (action.action === 'fill' || action.action === 'setText') &&
    !action.parameters.text
  ) {
    if (options.text) action.parameters.text = options.text;
  }
}

/** Utilidad exportada para tests y depuración: texto normalizado. */
export { fold as normalizePrompt };
