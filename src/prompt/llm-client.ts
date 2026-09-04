/**
 * Cliente LLM mínimo para el módulo `prompt`.
 *
 * Soporta tres proveedores con `fetch` nativo (sin dependencias nuevas):
 * - **ollama** (local, por defecto): `POST /api/chat`.
 * - **openai** (o cualquier endpoint compatible: Groq, Together, LM Studio,
 *   Gemini vía proxy...): `POST /chat/completions`.
 * - **anthropic**: `POST /v1/messages`.
 *
 * Configuración por variables de entorno (todas opcionales):
 *
 * ```bash
 * WEBMCP_LLM_PROVIDER=ollama|openai|anthropic   # def.: ollama si hay servidor; si no, heurísticas
 * WEBMCP_OLLAMA_MODEL=llama3                    # def.: llama3
 * WEBMCP_OLLAMA_BASE_URL=http://localhost:11434
 * WEBMCP_OPENAI_API_KEY=sk-...
 * WEBMCP_OPENAI_MODEL=gpt-4o-mini
 * WEBMCP_OPENAI_BASE_URL=https://api.openai.com/v1
 * WEBMCP_ANTHROPIC_API_KEY=sk-ant-...
 * WEBMCP_ANTHROPIC_MODEL=claude-3-5-haiku-latest
 * WEBMCP_ANTHROPIC_BASE_URL=https://api.anthropic.com
 * WEBMCP_LLM_TIMEOUT_MS=60000
 * ```
 *
 * Si no hay ningún proveedor configurado, {@link createLlmClient} devuelve
 * `null` y el intérprete usa heurísticas locales (sin red).
 */
import { logger } from '../utils/logger';
import type { LlmClient, LlmConfig, LlmProvider, LlmRequest } from './types';

/** Modelos por defecto por proveedor. */
export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  ollama: 'llama3',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-latest',
};

/** URLs base por defecto por proveedor. */
export const DEFAULT_BASE_URLS: Record<LlmProvider, string> = {
  ollama: 'http://localhost:11434',
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
};

/** Overrides explícitos (flags del CLI) sobre las variables de entorno. */
export interface LlmOverrides {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

/** Comprueba si un string es un proveedor válido. */
export function isLlmProvider(value: unknown): value is LlmProvider {
  return value === 'ollama' || value === 'openai' || value === 'anthropic';
}

/**
 * Resuelve la configuración del LLM combinando overrides y variables de
 * entorno. Reglas:
 * - El proveedor explícito (`--llm`) manda; si no, `WEBMCP_LLM_PROVIDER`.
 * - Sin proveedor explícito, se infiere: hay API key de OpenAI → openai;
 *   de Anthropic → anthropic; en otro caso → `null` (heurísticas). Ollama
 *   solo se elige de forma implícita si `WEBMCP_OLLAMA_MODEL` o
 *   `WEBMCP_OLLAMA_BASE_URL` están definidas (evita esperar a un servidor
 *   local inexistente).
 * - openai/anthropic sin API key → `null` con aviso.
 *
 * @param overrides Valores explícitos (CLI/API).
 * @param env Entorno (inyectable en tests).
 * @returns Configuración lista, o `null` si el LLM está desactivado.
 */
export function resolveLlmConfig(
  overrides: LlmOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): LlmConfig | null {
  let provider: LlmProvider | null = null;
  const requested = overrides.provider ?? env.WEBMCP_LLM_PROVIDER;
  if (requested) {
    if (requested === 'none' || requested === 'off' || requested === 'heuristic') {
      return null;
    }
    if (!isLlmProvider(requested)) {
      throw new Error(
        `Proveedor LLM desconocido: "${requested}". Usa ollama, openai o anthropic.`,
      );
    }
    provider = requested;
  } else if (overrides.apiKey) {
    provider = 'openai';
  } else if (env.WEBMCP_OPENAI_API_KEY) {
    provider = 'openai';
  } else if (env.WEBMCP_ANTHROPIC_API_KEY) {
    provider = 'anthropic';
  } else if (env.WEBMCP_OLLAMA_MODEL || env.WEBMCP_OLLAMA_BASE_URL) {
    provider = 'ollama';
  }
  if (!provider) return null;

  const upper = provider.toUpperCase();
  const apiKey =
    overrides.apiKey ??
    (provider === 'ollama' ? undefined : env[`WEBMCP_${upper}_API_KEY`]);
  if (provider !== 'ollama' && !apiKey) {
    logger.warn(
      `LLM ${provider}: falta WEBMCP_${upper}_API_KEY. Se usarán heurísticas locales.`,
    );
    return null;
  }
  const timeoutRaw = overrides.timeoutMs ?? Number(env.WEBMCP_LLM_TIMEOUT_MS);
  return {
    provider,
    model: overrides.model ?? env[`WEBMCP_${upper}_MODEL`] ?? DEFAULT_MODELS[provider],
    baseUrl: (
      overrides.baseUrl ??
      env[`WEBMCP_${upper}_BASE_URL`] ??
      DEFAULT_BASE_URLS[provider]
    ).replace(/\/$/, ''),
    apiKey,
    timeoutMs: Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 60_000,
  };
}

/** `fetch` con tiempo máximo. */
async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Lanza un error legible si la respuesta HTTP no es 2xx. */
async function ensureOk(res: Response, provider: string): Promise<void> {
  if (res.ok) return;
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    /* sin cuerpo */
  }
  throw new Error(
    `LLM ${provider} respondió ${res.status}${detail ? `: ${detail}` : ''}`,
  );
}

/**
 * Implementación de {@link LlmClient} sobre `fetch`.
 * Se puede inyectar un `fetch` alternativo para tests.
 */
export class FetchLlmClient implements LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;

  constructor(
    private readonly config: LlmConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.provider = config.provider;
    this.model = config.model;
  }

  /** @inheritdoc */
  async complete(req: LlmRequest): Promise<string> {
    switch (this.config.provider) {
      case 'ollama':
        return this.completeOllama(req);
      case 'openai':
        return this.completeOpenAi(req);
      case 'anthropic':
        return this.completeAnthropic(req);
      default:
        throw new Error(`Proveedor no soportado: ${String(this.config.provider)}`);
    }
  }

  private timeout(): number {
    return this.config.timeoutMs ?? 60_000;
  }

  private async completeOllama(req: LlmRequest): Promise<string> {
    const res = await fetchWithTimeout(
      this.fetchImpl,
      `${this.config.baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          ...(req.json ? { format: 'json' } : {}),
          options: { temperature: req.temperature ?? 0 },
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      },
      this.timeout(),
    );
    await ensureOk(res, 'ollama');
    const body = (await res.json()) as { message?: { content?: string } };
    return body.message?.content ?? '';
  }

  private async completeOpenAi(req: LlmRequest): Promise<string> {
    const res = await fetchWithTimeout(
      this.fetchImpl,
      `${this.config.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey ?? ''}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          temperature: req.temperature ?? 0,
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        }),
      },
      this.timeout(),
    );
    await ensureOk(res, 'openai');
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return body.choices?.[0]?.message?.content ?? '';
  }

  private async completeAnthropic(req: LlmRequest): Promise<string> {
    const res = await fetchWithTimeout(
      this.fetchImpl,
      `${this.config.baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.config.apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 1024,
          temperature: req.temperature ?? 0,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
      },
      this.timeout(),
    );
    await ensureOk(res, 'anthropic');
    const body = (await res.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    return (body.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('');
  }
}

/**
 * Crea un cliente LLM a partir de overrides + entorno.
 * @returns El cliente, o `null` si no hay proveedor configurado.
 */
export function createLlmClient(
  overrides: LlmOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): LlmClient | null {
  const config = resolveLlmConfig(overrides, env);
  return config ? new FetchLlmClient(config, fetchImpl) : null;
}

/**
 * Extrae el primer objeto JSON de una respuesta de modelo, tolerando fences
 * de Markdown y texto alrededor.
 *
 * @param raw Texto devuelto por el modelo.
 * @returns El objeto parseado, o `null` si no hay JSON válido.
 */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/im, '')
    .replace(/```\s*$/m, '')
    .trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(cleaned.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
