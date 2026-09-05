/**
 * MCP-Recommender (v1.0.0): dado un objetivo en lenguaje natural y un
 * contrato `.webmcp.css`, sugiere qué tools usar, en qué orden y con qué
 * parámetros; aprende del historial local (`.webmcpcss/history.json`) para
 * priorizar tools que funcionaron y penalizar las que fallaron.
 *
 * Funciona sin red mediante puntuación léxica (tokens plegados, sinónimos
 * ES/EN, nombre/descr./params/meta), y puede refinar el plan con un LLM si
 * hay proveedor configurado.
 */
import { extractJsonObject } from '../prompt/llm-client';
import type { LlmClient } from '../prompt/types';
import { fold } from '../prompt/vocabulary';
import type { ToolMap, ToolSpec } from '../types';
import { appendHistory, readHistory, type HistoryEvent } from '../utils/history';
import { VERSION } from '../version';

/** Recomendación de una tool. */
export interface ToolRecommendation {
  tool: string;
  score: number;
  /** Motivos legibles. */
  reasons: string[];
  /** Parámetros sugeridos (extraídos del objetivo). */
  params: Record<string, string>;
  /** Parámetros requeridos que faltan. */
  missingParams: string[];
  /** Estadísticas históricas. */
  history?: { runs: number; ok: number; failed: number; successRate: number };
  requiresConfirmation: boolean;
}

/** Plan recomendado. */
export interface RecommendationPlan {
  goal: string;
  url?: string;
  /** Pasos ordenados. */
  steps: ToolRecommendation[];
  /** Alternativas descartadas con menor puntuación. */
  alternatives: ToolRecommendation[];
  /** Contextos útiles para verificar el resultado. */
  context: Array<{ name: string; selector: string; format?: string; score: number }>;
  /** Fuente del plan. */
  source: 'heuristic' | 'llm';
  confidence: number;
  generatedBy: string;
  /** Explicación para el agente. */
  explanation: string;
}

/** Sinónimos ES/EN (plegados). */
const SYNONYMS: Record<string, string[]> = {
  buscar: ['search', 'find', 'encontrar', 'query', 'lookup'],
  comprar: [
    'buy',
    'purchase',
    'adquirir',
    'checkout',
    'pagar',
    'pay',
    'order',
    'pedir',
    'anadir al carrito',
    'add to cart',
    'carrito',
    'cart',
  ],
  iniciar: [
    'login',
    'log in',
    'sign in',
    'entrar',
    'acceder',
    'autenticar',
    'sesion',
    'session',
  ],
  registrar: ['signup', 'sign up', 'register', 'crear cuenta', 'alta', 'unirse', 'join'],
  enviar: [
    'send',
    'submit',
    'mandar',
    'contactar',
    'contact',
    'mensaje',
    'message',
    'formulario',
    'form',
  ],
  suscribir: ['subscribe', 'newsletter', 'boletin', 'alta'],
  reservar: ['book', 'reserve', 'reserva', 'cita', 'appointment', 'agendar', 'schedule'],
  descargar: ['download', 'bajar', 'exportar', 'export'],
  eliminar: ['delete', 'remove', 'borrar', 'quitar', 'cancel', 'cancelar'],
  ver: [
    'view',
    'show',
    'mostrar',
    'consultar',
    'abrir',
    'open',
    'ir a',
    'go to',
    'navegar',
    'navigate',
  ],
  filtrar: ['filter', 'ordenar', 'sort', 'refinar'],
  precio: [
    'price',
    'coste',
    'cost',
    'cuesta',
    'cuanto',
    'vale',
    'importe',
    'amount',
    'total',
  ],
  producto: ['product', 'item', 'articulo', 'article'],
};

/** Objetivos que NO mencionan estas raíces no deberían recibir tools destructivas. */
const DESTRUCTIVE_TOKENS = [
  'eliminar',
  'delete',
  'borrar',
  'remove',
  'cancelar',
  'cancel',
  'quitar',
  'cerrar',
  'close',
  'dar de baja',
  'unsubscribe',
  'pagar',
  'pay',
  'comprar',
  'buy',
  'checkout',
  'transfer',
];

const STOP = new Set([
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'y',
  'o',
  'a',
  'en',
  'con',
  'por',
  'para',
  'que',
  'the',
  'to',
  'and',
  'or',
  'of',
  'in',
  'on',
  'for',
  'with',
  'me',
  'quiero',
  'necesito',
  'want',
  'need',
  'please',
  'favor',
  'al',
]);

/**
 * ¿Dos palabras comparten raíz? (`paga`/`pagar`, `compra`/`comprar`), con un
 * mínimo de 4 letras para evitar falsos positivos (`completar`≠`comprar`).
 * @param a Palabra plegada.
 * @param b Palabra plegada.
 */
export function related(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/** ¿El texto menciona la palabra/frase? (frases con límite de palabra). */
function mentions(folded: string, words: string[], phrase: string): boolean {
  if (phrase.includes(' '))
    return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(
      folded,
    );
  return words.some((w) => related(w, phrase));
}

/**
 * Tokeniza y expande con sinónimos.
 * @param text Texto.
 */
export function expandTokens(text: string): Set<string> {
  const folded = fold(text);
  const tokens = new Set(
    folded.split(/[^a-z0-9ñ@.]+/).filter((t) => t.length > 1 && !STOP.has(t)),
  );
  const base = [...tokens];
  for (const [canon, syns] of Object.entries(SYNONYMS)) {
    if (mentions(folded, base, canon) || syns.some((s) => mentions(folded, base, s))) {
      tokens.add(canon);
      for (const s of syns) for (const w of s.split(' ')) if (w.length > 2) tokens.add(w);
    }
  }
  // Raíces simples (plural/verbo).
  for (const t of [...tokens]) {
    if (t.length > 5) tokens.add(t.slice(0, 5));
  }
  return tokens;
}

/**
 * Extrae valores candidatos para parámetros del objetivo (email, números,
 * comillas, "buscar X", "llamado X").
 * @param goal Objetivo.
 * @param tool Tool.
 */
export function extractParams(goal: string, tool: ToolSpec): Record<string, string> {
  const out: Record<string, string> = {};
  const quoted = [...goal.matchAll(/["“”']([^"“”']{1,80})["“”']/g)].map((m) => m[1]);
  const email = /[\w.+-]+@[\w-]+\.[\w.]+/.exec(goal)?.[0];
  const number = /\b\d+(?:[.,]\d+)?\b/.exec(goal)?.[0];
  const folded = fold(goal);
  const after = (re: RegExp) => {
    const m = re.exec(folded);
    if (!m) return undefined;
    const idx = folded.indexOf(m[0]) + m[0].length;
    return (
      goal
        .slice(idx)
        .trim()
        .replace(/^(de|del|la|el|un|una|the|a|an|por|for)\s+/i, '')
        .split(/[,.;]| y | and | en | con /)[0]
        ?.trim() || undefined
    );
  };
  for (const [name, spec] of Object.entries(tool.params ?? {})) {
    if (spec.source !== 'value') continue;
    const n = fold(name);
    if (/mail/.test(n) && email) out[name] = email;
    else if (
      /(cantidad|qty|quantity|numero|number|precio|price|amount|importe)/.test(n) &&
      number
    )
      out[name] = number;
    else if (
      /(query|busq|search|q$|termino|term|keyword|texto|text|nombre|name|producto|product|mensaje|message|asunto|subject|comentario|comment|ciudad|city|destino|origen|fecha|date)/.test(
        n,
      )
    ) {
      const v =
        quoted.shift() ??
        after(
          /\b(buscar|busca|search|find|encontrar|llamad[oa]|named|called|sobre|about|con el texto|escribe|type|ciudad|city|destino|a)\b/,
        );
      if (v) out[name] = v;
    } else if (quoted.length) out[name] = quoted.shift() as string;
  }
  return out;
}

/**
 * Puntúa una tool frente a un objetivo.
 * @param name Nombre.
 * @param tool Tool.
 * @param goalTokens Tokens expandidos del objetivo.
 */
export function scoreTool(
  name: string,
  tool: ToolSpec,
  goalTokens: Set<string>,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const nameTokens = expandTokens(name.replace(/([a-z])([A-Z])/g, '$1 $2'));
  const descTokens = expandTokens(tool.description ?? '');
  const paramTokens = expandTokens(Object.keys(tool.params ?? {}).join(' '));
  const metaTokens = expandTokens(Object.values(tool.meta ?? {}).join(' '));
  const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((t) => b.has(t));
  const n = overlap(nameTokens, goalTokens);
  const d = overlap(descTokens, goalTokens);
  const p = overlap(paramTokens, goalTokens);
  const m = overlap(metaTokens, goalTokens);
  let score = 0;
  if (n.length) {
    score += Math.min(0.5, 0.25 * n.length);
    reasons.push(`el nombre coincide con: ${n.slice(0, 3).join(', ')}`);
  }
  if (d.length) {
    score += Math.min(0.35, 0.12 * d.length);
    reasons.push(`la descripción menciona: ${d.slice(0, 3).join(', ')}`);
  }
  if (p.length) {
    score += Math.min(0.15, 0.08 * p.length);
    reasons.push(`parámetros relacionados: ${p.slice(0, 3).join(', ')}`);
  }
  if (m.length) {
    score += Math.min(0.1, 0.05 * m.length);
  }
  return { score: Math.min(1, score), reasons };
}

/**
 * Agrega el historial por tool (opcionalmente filtrado por URL/host).
 * @param events Eventos.
 * @param url URL objetivo.
 */
export function historyByTool(
  events: HistoryEvent[],
  url?: string,
): Map<
  string,
  { runs: number; ok: number; failed: number; successRate: number; recommendedOk: number }
> {
  const host = url ? safeHost(url) : undefined;
  const out = new Map<
    string,
    {
      runs: number;
      ok: number;
      failed: number;
      successRate: number;
      recommendedOk: number;
    }
  >();
  for (const e of events) {
    if (!e.tool) continue;
    if (host && e.url && safeHost(e.url) !== host) continue;
    const cur = out.get(e.tool) ?? {
      runs: 0,
      ok: 0,
      failed: 0,
      successRate: 0,
      recommendedOk: 0,
    };
    if (e.type === 'execute' || e.type === 'prompt') {
      cur.runs++;
      e.ok ? cur.ok++ : cur.failed++;
    } else if (e.type === 'recommend' && e.ok) cur.recommendedOk++;
    cur.successRate = cur.runs ? cur.ok / cur.runs : 0;
    out.set(e.tool, cur);
  }
  return out;
}

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
}

/** Opciones de recomendación. */
export interface RecommendOptions {
  url?: string;
  /** Eventos de historial (por defecto se leen de `.webmcpcss/history.json`). */
  history?: HistoryEvent[];
  historyFile?: string;
  /** Cliente LLM opcional. */
  llm?: LlmClient | null;
  /** Máximo de pasos (def. 3). */
  maxSteps?: number;
  /** Registrar la recomendación en el historial (def. false). */
  record?: boolean;
}

/**
 * Recomienda tools para un objetivo.
 * @param goal Objetivo en lenguaje natural.
 * @param map Tool map.
 * @param opts Opciones.
 */
export async function recommend(
  goal: string,
  map: ToolMap,
  opts: RecommendOptions = {},
): Promise<RecommendationPlan> {
  const goalTokens = expandTokens(goal);
  const goalFolded = fold(goal);
  const goalWords = goalFolded.split(/[^a-z0-9ñ]+/).filter(Boolean);
  const events = opts.history ?? readHistory(opts.historyFile);
  const hist = historyByTool(events, opts.url);
  const scored: ToolRecommendation[] = Object.entries(map.tools).map(([name, tool]) => {
    const base = scoreTool(name, tool, goalTokens);
    const h = hist.get(name);
    let score = base.score;
    const reasons = [...base.reasons];
    if (h && h.runs >= 2) {
      const adj = (h.successRate - 0.5) * 0.3;
      score = Math.max(0, Math.min(1, score + adj));
      reasons.push(
        `historial: ${h.ok}/${h.runs} ejecuciones correctas${adj >= 0 ? ' (+)' : ' (−)'}`,
      );
    }
    if (h && h.recommendedOk > 0 && score > 0) {
      score = Math.min(1, score + Math.min(0.1, 0.03 * h.recommendedOk));
      reasons.push(`recomendada con éxito ${h.recommendedOk} vez/veces`);
    }
    // Penaliza acciones destructivas/de pago cuando el objetivo no las pide.
    const destructiveTool =
      tool.meta?.permissions === 'full' ||
      tool.meta?.payment === 'required' ||
      /eliminar|delete|borrar|remove|cancel|pagar|pay|checkout|transfer|cerrar/i.test(
        `${name} ${tool.description ?? ''}`,
      );
    if (
      destructiveTool &&
      !DESTRUCTIVE_TOKENS.some((t) => mentions(goalFolded, goalWords, t))
    ) {
      score = Number((score * 0.4).toFixed(3));
      reasons.push('acción sensible no solicitada explícitamente (penalizada)');
    }
    const params = extractParams(goal, tool);
    const required = Object.entries(tool.params ?? {})
      .filter(([, s]) => s.source === 'value')
      .map(([n]) => n);
    return {
      tool: name,
      score: Number(score.toFixed(3)),
      reasons,
      params,
      missingParams: required.filter((r) => !(r in params)),
      history: h
        ? {
            runs: h.runs,
            ok: h.ok,
            failed: h.failed,
            successRate: Number(h.successRate.toFixed(2)),
          }
        : undefined,
      requiresConfirmation:
        Boolean(tool.confirmation) ||
        tool.meta?.confirmation === 'needed' ||
        tool.meta?.permissions === 'full',
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const threshold = Math.max(0.2, (scored[0]?.score ?? 0) * 0.45);
  let steps = scored.filter((s) => s.score >= threshold).slice(0, opts.maxSteps ?? 3);
  // Si el objetivo implica sesión y hay tool de login con puntuación, va primero.
  const loginIdx = steps.findIndex((s) =>
    /login|iniciarsesion|signin|acceder|entrar/i.test(fold(s.tool).replace(/\s/g, '')),
  );
  if (loginIdx > 0) steps = [steps[loginIdx], ...steps.filter((_, i) => i !== loginIdx)];
  const alternatives = scored
    .filter((s) => !steps.includes(s) && s.score > 0)
    .slice(0, 5);
  const context = Object.entries(map.context)
    .map(([name, c]) => ({
      name,
      selector: c.selector,
      format: c.format,
      score: Number(
        scoreTool(
          name,
          { selector: c.selector, description: name, params: {} },
          goalTokens,
        ).score.toFixed(3),
      ),
    }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  let plan: RecommendationPlan = {
    goal,
    url: opts.url,
    steps,
    alternatives,
    context,
    source: 'heuristic',
    confidence: Number((steps[0]?.score ?? 0).toFixed(2)),
    generatedBy: `webmcpcss@${VERSION}`,
    explanation: '',
  };
  if (opts.llm && Object.keys(map.tools).length)
    plan = await refineWithLlm(plan, map, opts.llm);
  plan.explanation = explain(plan);
  if (opts.record && plan.steps[0])
    appendHistory(
      {
        type: 'recommend',
        url: opts.url,
        tool: plan.steps[0].tool,
        ok: true,
        details: { goal, steps: plan.steps.map((s) => s.tool), source: plan.source },
      },
      opts.historyFile,
    );
  return plan;
}

/**
 * Refina el plan con un LLM (reordena/filtra pasos y completa parámetros).
 * @param plan Plan heurístico.
 * @param map Tool map.
 * @param llm Cliente.
 */
export async function refineWithLlm(
  plan: RecommendationPlan,
  map: ToolMap,
  llm: LlmClient,
): Promise<RecommendationPlan> {
  const tools = Object.entries(map.tools).map(([name, t]) => ({
    name,
    description: t.description,
    params: Object.keys(t.params ?? {}),
    confirmation: Boolean(t.confirmation) || t.meta?.confirmation === 'needed',
    permissions: t.meta?.permissions,
  }));
  try {
    const raw = await llm.complete({
      system:
        'Eres un planificador de agentes web. Recibes un objetivo y la lista de tools WebMCP de una página. Devuelve SOLO JSON: {"steps":[{"tool":"nombre","params":{...},"why":"..."}],"confidence":0-1}. Usa únicamente tools de la lista, en orden de ejecución, máximo 4 pasos. Si ninguna sirve, steps vacío.',
      user: JSON.stringify({
        goal: plan.goal,
        tools,
        heuristic: plan.steps.map((s) => ({
          tool: s.tool,
          score: s.score,
          params: s.params,
        })),
      }),
      json: true,
      temperature: 0,
    });
    const parsed = extractJsonObject(typeof raw === 'string' ? raw : JSON.stringify(raw));
    const steps = Array.isArray(parsed?.steps)
      ? (parsed!.steps as Array<{
          tool?: string;
          params?: Record<string, string>;
          why?: string;
        }>)
      : [];
    const valid = steps.filter((s) => s.tool && map.tools[s.tool]);
    if (!valid.length) return plan;
    const byName = new Map([...plan.steps, ...plan.alternatives].map((s) => [s.tool, s]));
    const newSteps: ToolRecommendation[] = valid.map((s) => {
      const tool = map.tools[s.tool!];
      const base = byName.get(s.tool!) ?? {
        tool: s.tool!,
        score: 0.5,
        reasons: [],
        params: {},
        missingParams: [],
        requiresConfirmation: Boolean(tool.confirmation),
      };
      const params = { ...base.params, ...(s.params ?? {}) };
      const required = Object.entries(tool.params ?? {})
        .filter(([, p]) => p.source === 'value')
        .map(([n]) => n);
      return {
        ...base,
        params,
        missingParams: required.filter((r) => !(r in params)),
        reasons: [...base.reasons, ...(s.why ? [`LLM: ${s.why}`] : [])],
        score: Math.max(base.score, 0.6),
      };
    });
    const conf =
      typeof parsed?.confidence === 'number'
        ? parsed!.confidence
        : Math.max(plan.confidence, 0.6);
    return {
      ...plan,
      steps: newSteps,
      alternatives: plan.alternatives.filter(
        (a) => !newSteps.some((s) => s.tool === a.tool),
      ),
      source: 'llm',
      confidence: Number(Math.max(0, Math.min(1, conf)).toFixed(2)),
    };
  } catch {
    return plan;
  }
}

/**
 * Registra el resultado real de una recomendación (para aprender).
 * @param plan Plan.
 * @param ok Si el objetivo se cumplió.
 * @param historyFile Archivo.
 */
export function recordOutcome(
  plan: RecommendationPlan,
  ok: boolean,
  historyFile?: string,
): void {
  for (const s of plan.steps)
    appendHistory(
      {
        type: 'recommend',
        url: plan.url,
        tool: s.tool,
        ok,
        details: { goal: plan.goal },
      },
      historyFile,
    );
}

function explain(plan: RecommendationPlan): string {
  if (!plan.steps.length)
    return `No encontré tools adecuadas para "${plan.goal}". Revisa las alternativas o pide al sitio que declare la acción en su .webmcp.css.`;
  const lines = [
    `Para "${plan.goal}" recomiendo ${plan.steps.length === 1 ? 'esta tool' : `estos ${plan.steps.length} pasos`} (confianza ${(plan.confidence * 100).toFixed(0)} %):`,
  ];
  plan.steps.forEach((s, i) => {
    const params = Object.keys(s.params).length
      ? ` con ${Object.entries(s.params)
          .map(([k, v]) => `${k}="${v}"`)
          .join(', ')}`
      : '';
    const missing = s.missingParams.length
      ? ` — faltan: ${s.missingParams.join(', ')}`
      : '';
    lines.push(
      `${i + 1}. ${s.tool}${params}${missing}${s.requiresConfirmation ? ' ⚠️ requiere confirmación' : ''}${s.reasons.length ? ` (${s.reasons[0]})` : ''}`,
    );
  });
  if (plan.context.length)
    lines.push(
      `Verifica el resultado leyendo: ${plan.context.map((c) => c.name).join(', ')}.`,
    );
  return lines.join('\n');
}
