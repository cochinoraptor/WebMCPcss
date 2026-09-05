/**
 * `webmcpcss components publish`: sube un componente a `components/community/`
 * del repositorio upstream como Pull Request (fork → rama → commits → PR),
 * con el mismo flujo probado de `webmcpcss publish` (community-styles).
 */
import { UPSTREAM } from '../community/publish';
import { META_FILE } from './loader';
import type { PreparedComponent } from './client';

/** Opciones de publicación. */
export interface PublishComponentOptions {
  component: PreparedComponent;
  /** Token de GitHub (`GITHUB_TOKEN`). */
  token: string;
  /** Base de la API (tests). */
  apiBase?: string;
  /** Repositorio destino (tests). */
  upstream?: { owner: string; repo: string; branch: string };
}

/** Resultado de la publicación. */
export interface PublishComponentResult {
  prUrl: string;
  branch: string;
  fork: string;
  files: string[];
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
      'User-Agent': 'webmcpcss-hub-publish',
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

/** Espera activa a que el fork exista. */
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
 * Publica el componente como PR al upstream.
 * @returns URL del PR y metadatos.
 */
export async function publishComponent(
  options: PublishComponentOptions,
): Promise<PublishComponentResult> {
  const upstream = options.upstream ?? UPSTREAM;
  const apiBase = options.apiBase ?? 'https://api.github.com';
  const { token, component } = options;

  const me = await gh(apiBase, token, 'GET', '/user');
  const login = String(me.login);

  await gh(apiBase, token, 'POST', `/repos/${upstream.owner}/${upstream.repo}/forks`, {});
  await waitForFork(apiBase, token, login, upstream.repo);

  const ref = (await gh(
    apiBase,
    token,
    'GET',
    `/repos/${upstream.owner}/${upstream.repo}/git/ref/heads/${upstream.branch}`,
  )) as { object?: { sha?: string } };
  const baseSha = ref.object?.sha;
  if (!baseSha) throw new Error('No se pudo leer el SHA de main del upstream.');

  const branch = `hub/${component.id}-${Date.now().toString(36)}`;
  await gh(apiBase, token, 'POST', `/repos/${login}/${upstream.repo}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: baseSha,
  });

  const files: Array<[string, string]> = [
    [`${component.dir}/${META_FILE}`, JSON.stringify(component.meta, null, 2) + '\n'],
    [
      `${component.dir}/${component.meta.css}`,
      component.css.endsWith('\n') ? component.css : component.css + '\n',
    ],
    [
      `${component.dir}/${component.meta.html}`,
      component.html.endsWith('\n') ? component.html : component.html + '\n',
    ],
  ];
  const written: string[] = [];
  for (const [filePath, content] of files) {
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
      /* archivo nuevo */
    }
    await gh(
      apiBase,
      token,
      'PUT',
      `/repos/${login}/${upstream.repo}/contents/${filePath}`,
      {
        message: `feat(hub): ${existingSha ? 'actualiza' : 'añade'} ${filePath}`,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      },
    );
    written.push(filePath);
  }

  const { tools, context, animations } = component.summary;
  const pr = (await gh(
    apiBase,
    token,
    'POST',
    `/repos/${upstream.owner}/${upstream.repo}/pulls`,
    {
      title: `feat(hub): componente ${component.id}`,
      head: `${login}:${branch}`,
      base: upstream.branch,
      body: [
        `Nuevo componente comunitario **${component.meta.name}** (\`${component.id}\`).`,
        '',
        `- Categoría: ${component.meta.category}`,
        `- Librería: ${component.meta.library}`,
        `- Herramientas: ${tools} · Contextos: ${context} · Animaciones: ${animations}`,
        '',
        `> ${component.meta.description}`,
        '',
        '_Generado con `webmcpcss components publish`. Validado con `parseWebMCP`/`parseAnimations` antes de subir._',
      ].join('\n'),
    },
  )) as { html_url?: string };
  if (!pr.html_url) throw new Error('El PR no devolvió URL; revisa permisos del token.');
  return {
    prUrl: pr.html_url,
    branch,
    fork: `${login}/${upstream.repo}`,
    files: written,
  };
}
