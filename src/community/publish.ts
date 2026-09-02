/**
 * Publicación comunitaria (v0.6.0): sube un `.webmcp.css` validado a
 * `community-styles/` del repositorio upstream mediante fork + rama + PR,
 * usando solo la API REST de GitHub (fetch nativo de Node 18+).
 *
 * Sin token, prepara el archivo localmente e imprime los pasos manuales.
 */
import { parseWebMCP } from '../parser';
import { normalizeDomain } from '../proxy';

/** Repositorio upstream por defecto. */
export const UPSTREAM = { owner: 'cochinoraptor', repo: 'WebMCPcss', branch: 'main' };

/** Opciones de publicación. */
export interface PublishOptions {
  /** Dominio destino (ej. `tienda.com`); se normaliza. */
  domain: string;
  /** Contenido del .webmcp.css (ya validado por el llamador con parseWebMCP). */
  css: string;
  /** Token de GitHub (PAT) con scope repo/contents. */
  token: string;
  /** Upstream alternativo (tests). */
  upstream?: typeof UPSTREAM;
  /** Base de la API (tests). */
  apiBase?: string;
}

/** Resultado de la publicación. */
export interface PublishResult {
  prUrl: string;
  branch: string;
  path: string;
  fork: string;
}

/**
 * Valida el CSS y devuelve el número de herramientas (lanza si es inválido
 * o si no declara ninguna herramienta/contexto).
 * @param css Contenido del archivo.
 */
export function validateForPublish(css: string): { tools: number; context: number } {
  const map = parseWebMCP(css);
  const tools = Object.keys(map.tools).length;
  const context = Object.keys(map.context).length;
  if (tools === 0 && context === 0) {
    throw new Error('El archivo no declara ninguna herramienta ni contexto webmcp-*.');
  }
  return { tools, context };
}

/** Ruta del archivo dentro del repo para un dominio. */
export function communityPathFor(domain: string): string {
  const normalized = normalizeDomain(domain);
  if (!normalized || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(normalized)) {
    throw new Error(`Dominio inválido: "${domain}". Usa algo como tienda.com.`);
  }
  return `community-styles/${normalized}.webmcp.css`;
}

/** Llamada a la API de GitHub con manejo de errores. */
async function gh(
  apiBase: string,
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'webmcpcss-publish',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok && res.status !== 202) {
    const msg = typeof data.message === 'string' ? data.message : `HTTP ${res.status}`;
    throw new Error(`GitHub API ${method} ${path}: ${msg}`);
  }
  return data;
}

/** Espera activa a que el fork exista (GitHub lo crea en segundo plano). */
async function waitForFork(
  apiBase: string,
  token: string,
  owner: string,
  repo: string,
  attempts = 10,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      await gh(apiBase, token, 'GET', `/repos/${owner}/${repo}`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error(
    `El fork ${owner}/${repo} no apareció a tiempo; reintenta en unos segundos.`,
  );
}

/**
 * Publica el CSS como Pull Request a `community-styles/` del upstream:
 * fork (idempotente) → rama desde main → commit del archivo → PR.
 *
 * @param options Dominio, CSS y token.
 * @returns URL del PR creado y metadatos.
 */
export async function publishToCommunity(
  options: PublishOptions,
): Promise<PublishResult> {
  const upstream = options.upstream ?? UPSTREAM;
  const apiBase = options.apiBase ?? 'https://api.github.com';
  const { token, css } = options;
  validateForPublish(css);
  const filePath = communityPathFor(options.domain);
  const domain = normalizeDomain(options.domain);

  // Usuario autenticado.
  const me = await gh(apiBase, token, 'GET', '/user');
  const login = String(me.login);

  // Fork (idempotente: si ya existe, GitHub devuelve el existente).
  await gh(apiBase, token, 'POST', `/repos/${upstream.owner}/${upstream.repo}/forks`, {});
  await waitForFork(apiBase, token, login, upstream.repo);

  // SHA de main del upstream y rama nueva en el fork.
  const ref = (await gh(
    apiBase,
    token,
    'GET',
    `/repos/${upstream.owner}/${upstream.repo}/git/ref/heads/${upstream.branch}`,
  )) as { object?: { sha?: string } };
  const baseSha = ref.object?.sha;
  if (!baseSha) throw new Error('No se pudo leer el SHA de main del upstream.');

  const branch = `community/${domain.replace(/[^a-z0-9.-]/g, '-')}-${Date.now().toString(36)}`;
  await gh(apiBase, token, 'POST', `/repos/${login}/${upstream.repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  // ¿El archivo ya existe en upstream? (para commit de update con sha).
  let existingSha: string | undefined;
  try {
    const existing = (await gh(
      apiBase,
      token,
      'GET',
      `/repos/${upstream.owner}/${upstream.repo}/contents/${filePath}?ref=${upstream.branch}`,
    )) as { sha?: string };
    existingSha = existing.sha;
  } catch {
    /* no existe: archivo nuevo */
  }

  // Commit del archivo en la rama del fork.
  await gh(
    apiBase,
    token,
    'PUT',
    `/repos/${login}/${upstream.repo}/contents/${filePath}`,
    {
      message: `feat(community): ${existingSha ? 'actualiza' : 'añade'} ${domain}.webmcp.css`,
      content: Buffer.from(css, 'utf8').toString('base64'),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    },
  );

  // PR al upstream.
  const { tools, context } = validateForPublish(css);
  const pr = (await gh(
    apiBase,
    token,
    'POST',
    `/repos/${upstream.owner}/${upstream.repo}/pulls`,
    {
      title: `feat(community): ${domain} (${tools} herramienta${tools === 1 ? '' : 's'})`,
      head: `${login}:${branch}`,
      base: upstream.branch,
      body: [
        `Definición comunitaria para **${domain}**.`,
        '',
        `- Herramientas: ${tools}`,
        `- Contextos: ${context}`,
        '',
        '_Generado con `webmcpcss publish`. Validado con `parseWebMCP` antes de subir._',
      ].join('\n'),
    },
  )) as { html_url?: string };

  if (!pr.html_url) throw new Error('El PR no devolvió URL; revisa permisos del token.');
  return {
    prUrl: pr.html_url,
    branch,
    path: filePath,
    fork: `${login}/${upstream.repo}`,
  };
}
