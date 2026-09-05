/**
 * Design-to-WebMCP: optimizador «IA-friendly».
 *
 * Revisa un `.webmcp.css` (generado desde un diseño o escrito a mano) y
 * propone/aplica mejoras que facilitan la operación por agentes:
 *
 * - selectores frágiles → `[data-tool]` estable (con `webmcp-fingerprint`),
 * - herramientas sin descripción / con descripción genérica,
 * - acciones sensibles sin política de confirmación,
 * - falta de `webmcp-accessibility` (aria-label),
 * - nombres no camelCase o ambiguos (`action3`),
 * - parámetros sin selector propio dentro de formularios,
 * - datos de contexto sin formato.
 */
import { toKebab } from '../framework/components';
import { analyzeFragility } from '../graph/fragility';
import { serializeToolMap } from '../parser';
import type { ToolMap } from '../types';

/** Sugerencia de optimización. */
export interface OptimizationSuggestion {
  tool: string;
  kind:
    | 'selector'
    | 'description'
    | 'confirmation'
    | 'accessibility'
    | 'naming'
    | 'params'
    | 'format';
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** ¿Se puede aplicar automáticamente? */
  autofix: boolean;
  before?: string;
  after?: string;
}

/** Resultado de la optimización. */
export interface OptimizationResult {
  suggestions: OptimizationSuggestion[];
  /** Tool map optimizado (si `apply`). */
  toolMap: ToolMap;
  css: string;
  applied: number;
  /** Puntuación IA-friendly 0-100 antes y después. */
  scoreBefore: number;
  scoreAfter: number;
}

/** Palabras que indican acción sensible. */
const SENSITIVE =
  /pagar|pay|checkout|comprar|buy|purchase|eliminar|delete|borrar|remove|transfer|enviar dinero|cancelar cuenta|unsubscribe|baja/i;

/** Calcula la puntuación IA-friendly (0-100) de un tool map. */
export function iaFriendlyScore(map: ToolMap): number {
  const tools = Object.entries(map.tools);
  if (tools.length === 0) return 0;
  let points = 0;
  const max = tools.length * 5;
  for (const [name, t] of tools) {
    if (analyzeFragility(t.selector).level === 'low') points += 1.5;
    else if (analyzeFragility(t.selector).level === 'medium') points += 0.75;
    if (
      t.description &&
      t.description.length > 8 &&
      !/^(Acción|Pulsa) /.test(t.description)
    )
      points += 1;
    if (
      t.meta?.confirmation ||
      t.confirmation ||
      !SENSITIVE.test(`${name} ${t.description ?? ''}`)
    )
      points += 1;
    if (t.meta?.accessibility) points += 0.75;
    if (/^[a-z][a-zA-Z0-9]*$/.test(name) && !/^(action|tool|button|form)\d*$/.test(name))
      points += 0.75;
  }
  return Math.round((points / max) * 100);
}

/**
 * Analiza y opcionalmente aplica las optimizaciones.
 * @param map Tool map de entrada (no se muta).
 * @param options `apply` para devolver el mapa optimizado.
 */
export function optimizeToolMap(
  map: ToolMap,
  options: { apply?: boolean } = {},
): OptimizationResult {
  const suggestions: OptimizationSuggestion[] = [];
  const out: ToolMap = JSON.parse(JSON.stringify(map)) as ToolMap;
  let applied = 0;
  const apply = options.apply === true;

  for (const [name, tool] of Object.entries(out.tools)) {
    const frag = analyzeFragility(tool.selector);
    if (frag.level !== 'low' && !/^\[data-tool=/.test(tool.selector)) {
      const after = `[data-tool="${toKebab(name)}"]`;
      suggestions.push({
        tool: name,
        kind: 'selector',
        severity: frag.level === 'high' ? 'error' : 'warning',
        message: `Selector ${frag.level === 'high' ? 'frágil' : 'mejorable'} (${frag.reasons[0] ?? frag.level}). Añade data-tool="${toKebab(name)}" al elemento y usa ${after}.`,
        autofix: true,
        before: tool.selector,
        after,
      });
      if (apply) {
        (tool.meta ??= {})['legacy-selector'] = tool.selector;
        tool.selector = after;
        applied++;
      }
    }
    if (
      !tool.description ||
      tool.description.length < 8 ||
      /^(Acción|Pulsa) '?[^']*'?$/.test(tool.description)
    ) {
      const after = humanDescription(name, tool.description);
      suggestions.push({
        tool: name,
        kind: 'description',
        severity: 'warning',
        message:
          'Descripción ausente o genérica: los agentes eligen herramientas por su descripción.',
        autofix: true,
        before: tool.description,
        after,
      });
      if (apply) {
        tool.description = after;
        applied++;
      }
    }
    const sensitive = SENSITIVE.test(`${name} ${tool.description ?? ''}`);
    if (sensitive && !tool.meta?.confirmation) {
      suggestions.push({
        tool: name,
        kind: 'confirmation',
        severity: 'error',
        message:
          'Acción sensible sin política de confirmación: añade webmcp-confirmation: "needed".',
        autofix: true,
        after: 'needed',
      });
      if (apply) {
        (tool.meta ??= {}).confirmation = 'needed';
        applied++;
      }
    } else if (!sensitive && !tool.meta?.confirmation && !tool.confirmation) {
      suggestions.push({
        tool: name,
        kind: 'confirmation',
        severity: 'info',
        message:
          'Declara webmcp-confirmation: "none" para que el agente no tenga que preguntar.',
        autofix: true,
        after: 'none',
      });
      if (apply) {
        (tool.meta ??= {}).confirmation = 'none';
        applied++;
      }
    }
    if (!tool.meta?.accessibility) {
      const after = `aria-label: ${(tool.description ?? name).replace(/"/g, "'").slice(0, 60)}`;
      suggestions.push({
        tool: name,
        kind: 'accessibility',
        severity: 'warning',
        message: 'Sin webmcp-accessibility: declara el aria-label esperado del elemento.',
        autofix: true,
        after,
      });
      if (apply) {
        (tool.meta ??= {}).accessibility = after;
        applied++;
      }
    }
    if (
      !/^[a-z][a-zA-Z0-9]*$/.test(name) ||
      /^(action|tool|button|form)\d*$/.test(name)
    ) {
      suggestions.push({
        tool: name,
        kind: 'naming',
        severity: 'warning',
        message: `Nombre '${name}' poco descriptivo o no camelCase; renómbralo según la acción (p. ej. addToCart).`,
        autofix: false,
      });
    }
    for (const [pName, spec] of Object.entries(tool.params)) {
      if (spec.source === 'value' && !spec.selector && tool.trigger?.event === 'submit') {
        suggestions.push({
          tool: name,
          kind: 'params',
          severity: 'warning',
          message: `El parámetro '${pName}' lee el valor del propio botón de envío; indica el campo con value(#selector).`,
          autofix: false,
        });
      }
    }
  }
  for (const [name, ctx] of Object.entries(out.context)) {
    if (!ctx.format) {
      const hint = `${name} ${ctx.selector}`;
      const after = /price|precio|total|amount|importe|cost/i.test(hint)
        ? 'currency'
        : /count|cantidad|qty|number|num|stock/i.test(hint)
          ? 'number'
          : /date|fecha|time|hora/i.test(hint)
            ? 'date'
            : 'text';
      suggestions.push({
        tool: name,
        kind: 'format',
        severity: 'info',
        message: `Dato de contexto sin webmcp-format; sugerido "${after}".`,
        autofix: true,
        after,
      });
      if (apply) {
        ctx.format = after;
        applied++;
      }
    }
  }
  const result = apply ? out : map;
  return {
    suggestions,
    toolMap: result,
    css: serializeToolMap(result),
    applied,
    scoreBefore: iaFriendlyScore(map),
    scoreAfter: iaFriendlyScore(result),
  };
}

/** Descripción legible desde el nombre camelCase. */
function humanDescription(name: string, current?: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  const verbs: Record<string, string> = {
    add: 'Añade',
    remove: 'Elimina',
    delete: 'Elimina',
    go: 'Navega a',
    open: 'Abre',
    close: 'Cierra',
    submit: 'Envía',
    send: 'Envía',
    search: 'Busca',
    buy: 'Compra',
    pay: 'Paga',
    login: 'Inicia sesión',
    logout: 'Cierra sesión',
    register: 'Registra',
    subscribe: 'Suscribe',
    apply: 'Aplica',
    set: 'Establece',
    select: 'Selecciona',
    toggle: 'Alterna',
    save: 'Guarda',
    cancel: 'Cancela',
    checkout: 'Finaliza la compra',
  };
  const [first, ...rest] = words.split(' ');
  const verb = verbs[first];
  if (verb) return `${verb} ${rest.join(' ')}`.trim();
  if (current && current.length >= 8) return current;
  return `Ejecuta la acción '${words}'`;
}
