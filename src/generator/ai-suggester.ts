/**
 * Sugeridor de metadatos con IA (opcional).
 *
 * Mejora los tool maps generados por `webmcpcss generate` usando un modelo
 * de lenguaje: propone nombres semánticos, descripciones y nombres de
 * parámetros a partir de la estructura de la página.
 *
 * Es 100% opcional: solo se activa con `--ai` y si hay una API key
 * configurada. Funciona con cualquier endpoint compatible con la API de
 * chat de OpenAI (OpenAI, Gemini vía proxy OpenAI-compat, Ollama local...):
 *
 * - `WEBMCPCSS_AI_API_KEY`  → API key (obligatoria para activar).
 * - `WEBMCPCSS_AI_BASE_URL` → base URL (def.: https://api.openai.com/v1).
 * - `WEBMCPCSS_AI_MODEL`    → modelo (def.: gpt-4o-mini).
 */
import type { ToolMap } from '../types';
import { logger } from '../utils/logger';

/** Sugerencia de la IA para una herramienta. */
export interface AiToolSuggestion {
  /** Nombre original (clave en el tool map). */
  originalName: string;
  /** Nombre sugerido (camelCase, semántico). */
  name?: string;
  /** Descripción sugerida. */
  description?: string;
}

/** Configuración resuelta del proveedor de IA. */
export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * Lee la configuración de IA desde variables de entorno.
 * @returns La configuración, o `null` si no hay API key (IA desactivada).
 */
export function getAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const apiKey = env.WEBMCPCSS_AI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (env.WEBMCPCSS_AI_BASE_URL ?? 'https://api.openai.com/v1').replace(
      /\/$/,
      '',
    ),
    model: env.WEBMCPCSS_AI_MODEL ?? 'gpt-4o-mini',
  };
}

/**
 * Construye el prompt que se envía al modelo.
 * @param map Tool map a mejorar.
 * @param pageTitle Título de la página (contexto).
 */
export function buildSuggestionPrompt(map: ToolMap, pageTitle: string): string {
  const tools = Object.entries(map.tools).map(([name, t]) => ({
    name,
    selector: t.selector,
    text: t.fingerprint?.text ?? '',
    params: Object.keys(t.params),
  }));
  return [
    `Página: "${pageTitle}".`,
    'Estas herramientas WebMCP fueron grabadas automáticamente. Sugiere para cada una',
    'un nombre camelCase semántico y una descripción breve en español (máx. 12 palabras).',
    'Responde SOLO con JSON: [{"originalName":"...","name":"...","description":"..."}]',
    '',
    JSON.stringify(tools, null, 2),
  ].join('\n');
}

/**
 * Parsea la respuesta del modelo de forma tolerante: acepta JSON puro o
 * JSON envuelto en fences de Markdown, y descarta entradas malformadas.
 *
 * @param raw Texto devuelto por el modelo.
 * @returns Sugerencias válidas (posiblemente vacío).
 */
export function parseAiSuggestions(raw: string): AiToolSuggestion[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/```\s*$/m, '')
    .trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is AiToolSuggestion =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as AiToolSuggestion).originalName === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Aplica sugerencias al tool map EN MEMORIA: renombra herramientas y añade
 * descripciones. Ignora sugerencias que colisionen con nombres existentes.
 *
 * @param map Tool map a modificar.
 * @param suggestions Sugerencias de la IA.
 * @returns Número de herramientas modificadas.
 */
export function applyAiSuggestions(
  map: ToolMap,
  suggestions: AiToolSuggestion[],
): number {
  let applied = 0;
  for (const s of suggestions) {
    const tool = map.tools[s.originalName];
    if (!tool) continue;
    let changed = false;
    if (s.description && !tool.description) {
      tool.description = s.description;
      changed = true;
    }
    if (s.name && s.name !== s.originalName && !map.tools[s.name]) {
      map.tools[s.name] = tool;
      delete map.tools[s.originalName];
      changed = true;
    }
    if (changed) applied++;
  }
  return applied;
}

/**
 * Pide al modelo sugerencias para el tool map y las aplica.
 * Si la IA no está configurada o falla, deja el tool map intacto.
 *
 * @param map Tool map a mejorar (se muta si hay sugerencias).
 * @param pageTitle Título de la página como contexto.
 * @param config Configuración (por defecto, desde variables de entorno).
 * @returns Número de herramientas mejoradas.
 */
export async function enhanceToolMapWithAi(
  map: ToolMap,
  pageTitle: string,
  config: AiConfig | null = getAiConfig(),
): Promise<number> {
  if (!config) {
    logger.warn(
      'IA no configurada (define WEBMCPCSS_AI_API_KEY). Se omiten las sugerencias.',
    );
    return 0;
  }
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: buildSuggestionPrompt(map, pageTitle) }],
        temperature: 0.2,
      }),
    });
    if (!res.ok) {
      logger.warn(`IA: el proveedor respondió ${res.status}. Se omiten sugerencias.`);
      return 0;
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content ?? '';
    const suggestions = parseAiSuggestions(content);
    const applied = applyAiSuggestions(map, suggestions);
    if (applied > 0) logger.success(`IA: ${applied} herramienta(s) mejoradas.`);
    return applied;
  } catch (err) {
    logger.warn(
      `IA: fallo al contactar el proveedor (${err instanceof Error ? err.message : err}).`,
    );
    return 0;
  }
}
