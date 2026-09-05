/**
 * Cliente del Component Hub: descarga el índice público, importa componentes
 * al proyecto, los actualiza y publica nuevos componentes como Pull Request.
 *
 * Funciona con `fetch` nativo (Node 18+). Si el hub remoto no responde, cae al
 * catálogo empaquetado en el propio paquete npm (`components/`), así que
 * `list`/`import` funcionan también sin conexión.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseAnimations } from '../animation/parser';
import { parseWebMCP } from '../parser';
import {
  DEFAULT_HUB_URL,
  META_FILE,
  buildHubIndex,
  bundledHubDir,
  filterEntries,
  importCommandFor,
  loadHub,
  shortHash,
  slugOf,
  validateMeta,
  type HubFilter,
} from './loader';
import type {
  ComponentMeta,
  HubCategory,
  HubIndex,
  HubIndexEntry,
  HubLibrary,
  InstalledComponent,
  InstalledLock,
} from './types';
import { HUB_CATEGORIES, HUB_LIBRARIES } from './types';

/** Ruta por defecto del lock de componentes instalados (relativa al cwd). */
export const LOCK_FILE = path.join('.webmcpcss', 'components.lock.json');

/** Implementación de fetch inyectable (tests). */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

/** Opciones comunes de acceso al hub. */
export interface HubClientOptions {
  /** URL base del hub (`WEBMCPCSS_HUB_URL` o la pública por defecto). */
  hubUrl?: string;
  /** No intentar la red: usar solo el catálogo empaquetado. */
  offline?: boolean;
  /** Carpeta `components/` local alternativa (tests / desarrollo). */
  localRoot?: string;
  fetchImpl?: FetchLike;
  /** Tiempo máximo de cada petición (ms). */
  timeoutMs?: number;
}

/** Índice resuelto con su procedencia. */
export interface ResolvedIndex {
  index: HubIndex;
  source: 'remote' | 'bundled';
  /** URL base usada (remota) o carpeta local (bundled). */
  location: string;
}

/** Resuelve la URL del hub (argumento → variable de entorno → por defecto). */
export function resolveHubUrl(explicit?: string): string {
  const raw = explicit || process.env.WEBMCPCSS_HUB_URL || DEFAULT_HUB_URL;
  return raw.replace(/\/+$/, '');
}

/** Descarga texto con timeout usando fetch nativo. */
async function fetchText(url: string, options: HubClientOptions): Promise<string> {
  const impl: FetchLike =
    options.fetchImpl ??
    (async (u: string) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), options.timeoutMs ?? 15000);
      try {
        const res = await fetch(u, {
          signal: ctrl.signal,
          headers: {
            'User-Agent': 'webmcpcss-hub',
            Accept: 'application/json, text/plain, */*',
          },
        });
        return { ok: res.ok, status: res.status, text: () => res.text() };
      } finally {
        clearTimeout(timer);
      }
    });
  const res = await impl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
  return res.text();
}

/** Carga el índice desde la carpeta local `components/` (empaquetada o indicada). */
export function loadBundledIndex(localRoot?: string): ResolvedIndex {
  const root = localRoot ?? bundledHubDir();
  if (!root) {
    throw new Error(
      'No se encuentra el catálogo local de componentes (carpeta components/). Reinstala webmcpcss o indica --hub <url>.',
    );
  }
  const loaded = loadHub(root);
  if (loaded.errors.length) {
    throw new Error(`Catálogo local inválido:\n- ${loaded.errors.join('\n- ')}`);
  }
  return {
    index: buildHubIndex(loaded.components, { baseUrl: resolveHubUrl() }),
    source: 'bundled',
    location: root,
  };
}

/**
 * Obtiene el índice del hub: remoto si es posible, empaquetado si no.
 * @param options URL, modo offline o `localRoot`.
 */
export async function fetchHubIndex(
  options: HubClientOptions = {},
): Promise<ResolvedIndex> {
  if (options.offline || options.localRoot) return loadBundledIndex(options.localRoot);
  const hubUrl = resolveHubUrl(options.hubUrl);
  try {
    const text = await fetchText(`${hubUrl}/api/components.json`, options);
    const index = JSON.parse(text) as HubIndex;
    if (!Array.isArray(index.components)) throw new Error('índice sin "components"');
    return { index, source: 'remote', location: hubUrl };
  } catch (err) {
    const fallback = bundledHubDir();
    if (!fallback) throw err;
    return loadBundledIndex(fallback);
  }
}

/** Lista componentes aplicando filtros. */
export async function listComponents(
  filter: HubFilter = {},
  options: HubClientOptions = {},
): Promise<{ components: HubIndexEntry[]; resolved: ResolvedIndex }> {
  const resolved = await fetchHubIndex(options);
  return { components: filterEntries(resolved.index.components, filter), resolved };
}

/** Archivos de un componente (contenido en memoria). */
export interface ComponentFiles {
  entry: HubIndexEntry;
  css: string;
  html: string;
  meta: ComponentMeta;
  /** CSS auxiliar solo para la previsualización (si existe). */
  preview?: string;
}

/**
 * Descarga (o lee en local) los archivos de un componente.
 * @param id Identificador (`tailwind-button-primary`).
 */
export async function fetchComponent(
  id: string,
  options: HubClientOptions = {},
  resolved?: ResolvedIndex,
): Promise<ComponentFiles> {
  const res = resolved ?? (await fetchHubIndex(options));
  const entry = res.index.components.find((c) => c.id === id);
  if (!entry) {
    const near = res.index.components
      .filter((c) => c.id.includes(slugOf(id)) || slugOf(c.id) === slugOf(id))
      .map((c) => c.id)
      .slice(0, 5);
    throw new Error(
      `Componente "${id}" no encontrado en el hub${near.length ? `. ¿Quizás: ${near.join(', ')}?` : '.'}`,
    );
  }
  if (res.source === 'bundled') {
    const loaded = loadHub(res.location);
    const c = loaded.components.find((x) => x.id === id);
    if (!c) throw new Error(`Componente "${id}" no encontrado en ${res.location}`);
    const dir = path.join(res.location, c.dir);
    const meta = JSON.parse(
      fs.readFileSync(path.join(dir, META_FILE), 'utf8'),
    ) as ComponentMeta;
    const previewFile = (meta as ComponentMeta & { preview?: string }).preview;
    const preview =
      previewFile && fs.existsSync(path.join(dir, previewFile))
        ? fs.readFileSync(path.join(dir, previewFile), 'utf8')
        : undefined;
    return { entry, css: c.cssSource, html: c.htmlSource, meta, preview };
  }
  const base = `${res.location}/`;
  const [css, html, metaText] = await Promise.all([
    fetchText(base + entry.files.css, options),
    fetchText(base + entry.files.html, options),
    fetchText(base + entry.files.meta, options),
  ]);
  const meta = JSON.parse(metaText) as ComponentMeta & { preview?: string };
  let preview: string | undefined;
  if (meta.preview) {
    try {
      preview = await fetchText(base + entry.files.page + meta.preview, options);
    } catch {
      preview = undefined;
    }
  }
  return { entry, css, html, meta, preview };
}

/** Lee el lock de componentes instalados (o uno vacío). */
export function readLock(lockPath = LOCK_FILE): InstalledLock {
  if (!fs.existsSync(lockPath)) {
    return { version: 1, hub: resolveHubUrl(), components: {} };
  }
  return JSON.parse(fs.readFileSync(lockPath, 'utf8')) as InstalledLock;
}

/** Guarda el lock. */
export function writeLock(lock: InstalledLock, lockPath = LOCK_FILE): void {
  fs.mkdirSync(path.dirname(path.resolve(lockPath)), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

/** Marcador que delimita un componente dentro de un CSS fusionado. */
export function mergeMarker(id: string, version: string): string {
  return `/* @webmcpcss-component ${id} v${version} */`;
}

/** Opciones de importación. */
export interface ImportOptions extends HubClientOptions {
  /** Carpeta destino (por defecto `./webmcp-components`). */
  output?: string;
  /** Sobrescribir si ya existe. */
  force?: boolean;
  /** Ruta del lock. */
  lockPath?: string;
  /** Añadir el contrato CSS a este archivo (se crea si no existe). */
  merge?: string;
  /** Índice ya resuelto (para importar varios sin repetir descargas). */
  resolved?: ResolvedIndex;
}

/** Resultado de una importación. */
export interface ImportResult {
  id: string;
  version: string;
  hash: string;
  dir: string;
  files: string[];
  merged?: string;
  source: 'remote' | 'bundled';
  skipped?: boolean;
}

/**
 * Importa un componente al proyecto: escribe `<output>/<id>/` con el
 * `.webmcp.css`, el HTML y `component.json`, y lo registra en el lock.
 */
export async function importComponent(
  id: string,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const resolved = options.resolved ?? (await fetchHubIndex(options));
  const files = await fetchComponent(id, options, resolved);
  const outRoot = options.output ?? 'webmcp-components';
  const dir = path.join(outRoot, id);
  const cssName = files.meta.css ?? `${slugOf(id)}.webmcp.css`;
  const htmlName = files.meta.html ?? `${slugOf(id)}.html`;
  const lockPath = options.lockPath ?? LOCK_FILE;
  const lock = readLock(lockPath);
  const hash = shortHash(files.css + '\n' + files.html);

  const existing = lock.components[id];
  if (fs.existsSync(dir) && !options.force && existing && existing.hash === hash) {
    return {
      id,
      version: files.entry.version,
      hash,
      dir,
      files: existing.files,
      source: resolved.source,
      skipped: true,
    };
  }
  if (fs.existsSync(dir) && !options.force && !existing) {
    throw new Error(
      `Ya existe ${dir} y no está registrado en el lock. Usa --force para sobrescribir.`,
    );
  }
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  const write = (name: string, content: string): void => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content.endsWith('\n') ? content : content + '\n', 'utf8');
    written.push(p.split(path.sep).join('/'));
  };
  write(cssName, files.css);
  write(htmlName, files.html);
  const meta: ComponentMeta & { preview?: string } = { ...files.meta };
  if (files.preview && meta.preview) write(meta.preview, files.preview);
  else delete meta.preview;
  write(META_FILE, JSON.stringify(meta, null, 2));

  let merged: string | undefined;
  if (options.merge) {
    merged = mergeIntoCss(options.merge, id, files.entry.version, files.css);
  }

  const record: InstalledComponent = {
    id,
    version: files.entry.version,
    hash,
    files: written,
    installedAt: new Date().toISOString(),
    source: resolved.source === 'remote' ? resolved.location : 'bundled',
  };
  lock.hub = resolved.source === 'remote' ? resolved.location : lock.hub;
  lock.components[id] = record;
  writeLock(lock, lockPath);
  return {
    id,
    version: record.version,
    hash,
    dir,
    files: written,
    merged,
    source: resolved.source,
  };
}

/**
 * Añade (o reemplaza) el bloque de un componente en un CSS del proyecto,
 * delimitado por marcadores para poder actualizarlo después.
 */
export function mergeIntoCss(
  target: string,
  id: string,
  version: string,
  css: string,
): string {
  const start = `/* @webmcpcss-component ${id} `;
  const end = `/* @end webmcpcss-component ${id} */`;
  const block = `${mergeMarker(id, version)}\n${css.trim()}\n${end}\n`;
  let current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
  const from = current.indexOf(start);
  const to = current.indexOf(end);
  if (from !== -1 && to !== -1) {
    current =
      current.slice(0, from) + block + current.slice(to + end.length).replace(/^\n/, '');
  } else {
    current = current.trimEnd() + (current.trim() ? '\n\n' : '') + block;
  }
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(target, current, 'utf8');
  return target;
}

/** Estado de un componente instalado respecto al hub. */
export interface UpdateStatus {
  id: string;
  installed: string;
  available?: string;
  status: 'up-to-date' | 'outdated' | 'missing-remote' | 'updated';
  changed?: boolean;
}

/**
 * Comprueba (y opcionalmente aplica) actualizaciones de los componentes del lock.
 * @param options `dryRun` solo informa; `merge` reescribe los bloques fusionados.
 */
export async function updateComponents(
  options: HubClientOptions & {
    lockPath?: string;
    dryRun?: boolean;
    merge?: string;
    ids?: string[];
  } = {},
): Promise<{ statuses: UpdateStatus[]; resolved: ResolvedIndex }> {
  const lockPath = options.lockPath ?? LOCK_FILE;
  const lock = readLock(lockPath);
  const resolved = await fetchHubIndex(options);
  const statuses: UpdateStatus[] = [];
  const wanted = options.ids?.length ? options.ids : Object.keys(lock.components);
  for (const id of wanted) {
    const installed = lock.components[id];
    if (!installed)
      throw new Error(
        `El componente ${id} no está instalado (no aparece en ${lockPath}).`,
      );
    const remote = resolved.index.components.find((c) => c.id === id);
    if (!remote) {
      statuses.push({ id, installed: installed.version, status: 'missing-remote' });
      continue;
    }
    const outdated =
      remote.hash !== installed.hash || remote.version !== installed.version;
    if (!outdated) {
      statuses.push({
        id,
        installed: installed.version,
        available: remote.version,
        status: 'up-to-date',
      });
      continue;
    }
    if (options.dryRun) {
      statuses.push({
        id,
        installed: installed.version,
        available: remote.version,
        status: 'outdated',
      });
      continue;
    }
    const dir = path.dirname(installed.files[0] ?? path.join('webmcp-components', id));
    await importComponent(id, {
      ...options,
      output: path.dirname(dir),
      force: true,
      lockPath,
      merge: options.merge,
      resolved,
    });
    statuses.push({
      id,
      installed: installed.version,
      available: remote.version,
      status: 'updated',
      changed: true,
    });
  }
  return { statuses, resolved };
}

/** Opciones para preparar un componente comunitario. */
export interface PrepareComponentOptions {
  cssPath: string;
  name: string;
  category: string;
  library?: string;
  htmlPath?: string;
  description?: string;
  tags?: string[];
  author?: string;
  version?: string;
}

/** Componente preparado para publicar. */
export interface PreparedComponent {
  id: string;
  dir: string;
  meta: ComponentMeta;
  css: string;
  html: string;
  summary: { tools: number; context: number; animations: number };
}

/** Slug a partir del nombre legible. */
export function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Valida y prepara un componente local para el hub (usado por `components publish`).
 * Genera el HTML de ejemplo a partir del CSS si no se indica uno.
 */
export function prepareComponent(options: PrepareComponentOptions): PreparedComponent {
  if (!fs.existsSync(options.cssPath)) throw new Error(`No existe ${options.cssPath}`);
  const css = fs.readFileSync(options.cssPath, 'utf8');
  const library = (options.library ?? 'core') as HubLibrary;
  const category = options.category as HubCategory;
  if (!(HUB_LIBRARIES as readonly string[]).includes(library))
    throw new Error(`Librería inválida "${library}". Usa: ${HUB_LIBRARIES.join(', ')}`);
  if (!(HUB_CATEGORIES as readonly string[]).includes(category))
    throw new Error(
      `Categoría inválida "${category}". Usa: ${HUB_CATEGORIES.join(', ')}`,
    );
  const slug = slugFromName(options.name);
  if (!slug) throw new Error('El nombre debe contener letras o números');
  const id = `${library}-${slug}`;

  const map = parseWebMCP(css);
  const anims = parseAnimations(css);
  const summary = {
    tools: Object.keys(map.tools).length,
    context: Object.keys(map.context).length,
    animations: Object.keys(anims.animations).length,
  };
  if (summary.tools + summary.context + summary.animations === 0) {
    throw new Error(
      'El CSS no declara ninguna herramienta (webmcp-tool), contexto ni animación webmcp-*.',
    );
  }
  const html = options.htmlPath
    ? fs.readFileSync(options.htmlPath, 'utf8')
    : defaultHtmlFor(map, slug);
  const description =
    options.description ??
    `${options.name}: componente IA-First con ${summary.tools} herramienta(s), ${summary.context} contexto(s) y ${summary.animations} animación(es).`;
  const meta: ComponentMeta = {
    id,
    name: options.name,
    category,
    library,
    version: options.version ?? '1.0.0',
    description,
    author: options.author ?? 'Comunidad WebMCPcss',
    tags: options.tags ?? [category, library, 'community'],
    css: `${slug}.webmcp.css`,
    html: `${slug}.html`,
  };
  const errors = validateMeta(meta, id);
  if (errors.length) throw new Error(errors.join('\n'));
  return { id, dir: `components/community/${id}`, meta, css, html, summary };
}

/** HTML de ejemplo mínimo a partir de los selectores del contrato. */
function defaultHtmlFor(map: ReturnType<typeof parseWebMCP>, slug: string): string {
  const parts: string[] = [`<div class="${slug}" data-component="${slug}">`];
  for (const [name, tool] of Object.entries(map.tools)) {
    const sel = tool.selector;
    const attrs = selectorToAttrs(sel);
    parts.push(`  <button type="button"${attrs}>${tool.description ?? name}</button>`);
  }
  for (const [name, ctx] of Object.entries(map.context)) {
    parts.push(`  <span${selectorToAttrs(ctx.selector)}>${name}</span>`);
  }
  parts.push('</div>');
  return parts.join('\n');
}

/** Convierte un selector simple (`.a[data-x="y"]#id`) en atributos HTML. */
function selectorToAttrs(selector: string): string {
  const last = selector.split(/\s+|>/).filter(Boolean).pop() ?? '';
  const classes = [...last.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
  const id = /#([\w-]+)/.exec(last)?.[1];
  const attrs = [...last.matchAll(/\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]/g)].map(
    (m) => ` ${m[1]}="${m[2] ?? ''}"`,
  );
  return (
    (id ? ` id="${id}"` : '') +
    (classes.length ? ` class="${classes.join(' ')}"` : '') +
    attrs.join('')
  );
}

/** Reexportación cómoda para la CLI. */
export { importCommandFor, DEFAULT_HUB_URL };
