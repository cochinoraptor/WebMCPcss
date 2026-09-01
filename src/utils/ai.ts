/**
 * Sugerencias con IA (opcional) para `webmcpcss generate --ai`: mejora
 * nombres y descripciones del tool map grabado usando cualquier endpoint
 * compatible con la API de chat de OpenAI.
 *
 * Sin `WEBMCPCSS_AI_API_KEY` configurada, todo se omite con un aviso.
 */

/** Configuración de IA cargada del entorno. */
export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Una sugerencia de la IA para una herramienta. */
export interface AiSuggestion {
  /** Nombre actual (de la grabación). */
  name: string;
  /** Nombre propuesto (`addToCart`, ...). */
  suggestedName: string;
  /** Descripción propuesta. */
  description: string;
}

/**
 * Carga la configuración de IA del entorno.
 *
 * @param env Entorno (defecto: `process.env`).
 * @returns Configuración o `null` si falta la API key.
 */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const apiKey = env.WEBMCPCSS_AI_API_KEY;
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: env.WEBMCPCSS_AI_BASE_URL ?? 'https://api.openai.com/v1',
    model: env.WEBMCPCSS_AI_MODEL ?? 'gpt-4o-mini',
  };
}

/**
 * Pide a la IA nombres y descripciones para una lista de herramientas
 * grabadas. Devuelve `null` si la IA no está configurada o falla.
 *
 * @param tools Herramientas grabadas (nombre provisional + señal de contexto).
 * @param config Configuración de IA.
 * @returns Sugerencias por herramienta, o `null`.
 */
export async function suggestToolMetadata(
  tools: { name: string; hint: string }[],
  config: AiConfig,
): Promise<AiSuggestion[] | null> {
  const prompt =
    'Eres un generador de tool maps para agentes de IA (WebMCP). Para cada ' +
    'herramienta devuelve un nombre camelCase conciso y una descripción en ' +
    'español de una línea. Responde SOLO con JSON: ' +
    '{"suggestions":[{"name":"<original>","suggestedName":"...","description":"..."}]}\n\n' +
    JSON.stringify(tools, null, 2);
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { suggestions?: AiSuggestion[] };
    return Array.isArray(parsed.suggestions) ? parsed.suggestions : null;
  } catch {
    return null;
  }
}
