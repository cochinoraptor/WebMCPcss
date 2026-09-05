/**
 * Cargador y validador del catálogo de componentes del Hub.
 *
 * Estructura en disco (una carpeta por componente):
 *
 * ```
 * components/
 * ├── core/button-primary/{component.json, button-primary.webmcp.css, button-primary.html}
 * ├── adapters/tailwind/button-primary/…
 * ├── adapters/bootstrap/…  adapters/mui/…  adapters/shadcn/…
 * ├── intelligent/checkout-form/…
 * └── animations/fade-in/…
 * ```
 *
 * El `.webmcp.css` es a la vez el contrato para agentes y una hoja de estilos
 * válida (los navegadores ignoran las propiedades `webmcp-*`), así que la
 * vista previa del sitio lo carga tal cual.
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { parseAnimations } from '../animation/parser';
import { parseWebMCP } from '../parser';
import { VERSION } from '../version';
import {
  CATEGORY_LABELS,
  HUB_CATEGORIES,
  HUB_LIBRARIES,
  LIBRARY_LABELS,
  type ComponentMeta,
  type HubCategory,
  type HubComponent,
  type HubIndex,
  type HubIndexEntry,
  type HubLibrary,
} from './types';

/** URL pública por defecto del hub (configurable con `WEBMCPCSS_HUB_URL`). */
export const DEFAULT_HUB_URL = 'https://cochinoraptor.github.io/WebMCPcss';

/** Nombre del archivo de metadatos. */
export const META_FILE = 'component.json';

/** Resultado de {@link loadHub}. */
export interface HubLoadResult {
  components: HubComponent[];
  /** Problemas que impiden usar un componente (se omite del catálogo). */
  errors: string[];
  /** Avisos no bloqueantes. */
  warnings: string[];
}

/** Localiza la carpeta `components/` del paquete instalado (o del repo). */
export function bundledHubDir(): string | undefined {
  const candidates = [
    path.resolve(__dirname, '..', '..', '..', 'components'), // dist/src/hub → raíz del paquete
    path.resolve(__dirname, '..', '..', 'components'), // src/hub (vitest / ts-node)
    path.resolve(process.cwd(), 'components'),
  ];
  return candidates.find((c) => fs.existsSync(path.join(c, 'core')));
}

/** Hash sha256 corto y estable de un texto. */
export function shortHash(text: string): string {
  return createHash('sha256')
    .update(text.replace(/\r\n/g, '\n'))
    .digest('hex')
    .slice(0, 16);
}

/** Recorre recursivamente buscando `component.json`. */
function findMetaFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.name === META_FILE) {
        out.push(full);
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

/** Slug del componente (parte del id tras la librería). */
export function slugOf(id: string): string {
  const [lib, ...rest] = id.split('-');
  return (HUB_LIBRARIES as readonly string[]).includes(lib) ? rest.join('-') : id;
}

/** Comando de importación canónico. */
export function importCommandFor(id: string): string {
  return `npx webmcpcss components import ${id}`;
}

/**
 * Valida los metadatos de un componente. Devuelve la lista de errores
 * (vacía si es válido).
 */
export function validateMeta(meta: Partial<ComponentMeta>, dir: string): string[] {
  const errors: string[] = [];
  const at = (m: string) => `${dir}: ${m}`;
  if (!meta.id || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(meta.id))
    errors.push(at('`id` obligatorio en kebab-case (<library>-<slug>)'));
  if (!meta.name) errors.push(at('`name` obligatorio'));
  if (!meta.description || meta.description.length < 15)
    errors.push(at('`description` obligatoria (≥ 15 caracteres)'));
  if (!meta.category || !(HUB_CATEGORIES as readonly string[]).includes(meta.category))
    errors.push(at(`\`category\` debe ser una de: ${HUB_CATEGORIES.join(', ')}`));
  if (!meta.library || !(HUB_LIBRARIES as readonly string[]).includes(meta.library))
    errors.push(at(`\`library\` debe ser una de: ${HUB_LIBRARIES.join(', ')}`));
  if (meta.id && meta.library && !meta.id.startsWith(`${meta.library}-`))
    errors.push(at(`el id debe empezar por la librería: ${meta.library}-…`));
  if (!meta.version || !/^\d+\.\d+\.\d+$/.test(meta.version))
    errors.push(at('`version` debe ser SemVer (1.0.0)'));
  for (const c of meta.controls ?? []) {
    if (!c.variable?.startsWith('--'))
      errors.push(at(`control con variable inválida: ${c.variable}`));
    if (!['color', 'range', 'select', 'text'].includes(c.type))
      errors.push(at(`control ${c.variable}: tipo inválido ${c.type}`));
    if (c.type === 'select' && !(c.options && c.options.length))
      errors.push(at(`control ${c.variable}: select sin options`));
  }
  return errors;
}

/**
 * Carga un componente desde su carpeta.
 * @param dir Carpeta que contiene `component.json`.
 * @param root Raíz del hub (para rutas relativas).
 */
export function loadComponent(
  dir: string,
  root: string,
): { component?: HubComponent; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rel = path.relative(root, dir).split(path.sep).join('/');
  let meta: ComponentMeta;
  try {
    meta = JSON.parse(
      fs.readFileSync(path.join(dir, META_FILE), 'utf8'),
    ) as ComponentMeta;
  } catch (err) {
    return {
      errors: [`${rel}: component.json inválido (${(err as Error).message})`],
      warnings,
    };
  }
  errors.push(...validateMeta(meta, rel));
  if (errors.length) return { errors, warnings };

  const slug = slugOf(meta.id);
  const cssFile = meta.css ?? `${slug}.webmcp.css`;
  const htmlFile = meta.html ?? `${slug}.html`;
  const cssAbs = path.join(dir, cssFile);
  const htmlAbs = path.join(dir, htmlFile);
  if (!fs.existsSync(cssAbs)) errors.push(`${rel}: falta ${cssFile}`);
  if (!fs.existsSync(htmlAbs)) errors.push(`${rel}: falta ${htmlFile}`);
  if (errors.length) return { errors, warnings };

  const cssSource = fs.readFileSync(cssAbs, 'utf8');
  const htmlSource = fs.readFileSync(htmlAbs, 'utf8');

  let tools: HubComponent['tools'] = [];
  let context: HubComponent['context'] = [];
  try {
    const map = parseWebMCP(cssSource);
    tools = Object.entries(map.tools).map(([name, t]) => ({
      name,
      selector: t.selector,
      description: t.description,
      params: Object.keys(t.params),
      intent: t.meta?.intent,
      confirmation: t.meta?.confirmation ?? (t.confirmation ? 'selector' : undefined),
    }));
    context = Object.entries(map.context).map(([name, c]) => ({
      name,
      selector: c.selector,
      format: c.format,
    }));
  } catch (err) {
    errors.push(`${rel}/${cssFile}: ${(err as Error).message}`);
  }

  let animations: HubComponent['animations'] = [];
  try {
    const anims = parseAnimations(cssSource);
    animations = Object.values(anims.animations).map((a) => ({
      name: a.name,
      type: a.type,
      selector: a.selector,
    }));
    for (const w of anims.warnings) warnings.push(`${rel}/${cssFile}: ${w}`);
  } catch (err) {
    errors.push(`${rel}/${cssFile}: animación inválida — ${(err as Error).message}`);
  }

  if (tools.length === 0 && context.length === 0 && animations.length === 0)
    errors.push(
      `${rel}/${cssFile}: no declara ninguna herramienta, contexto ni animación webmcp-*`,
    );
  if (meta.category === 'animations' && animations.length === 0)
    errors.push(
      `${rel}: un componente de la categoría animations debe declarar webmcp-animation`,
    );
  for (const t of tools) {
    if (!t.description)
      warnings.push(`${rel}: la herramienta ${t.name} no tiene webmcp-description`);
  }
  if (errors.length) return { errors, warnings };

  const component: HubComponent = {
    ...meta,
    tags: meta.tags ?? [],
    author: meta.author ?? 'WebMCPcss Team',
    css: cssFile,
    html: htmlFile,
    dir: rel,
    cssPath: `${rel}/${cssFile}`,
    cssSource,
    htmlSource,
    tools,
    context,
    animations,
    hash: shortHash(cssSource + '\n' + htmlSource),
    importCommand: importCommandFor(meta.id),
  };
  return { component, errors, warnings };
}

/**
 * Carga todo el catálogo de una carpeta raíz (`components/`).
 * @param root Carpeta raíz del hub.
 */
export function loadHub(root: string): HubLoadResult {
  const components: HubComponent[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();
  for (const metaFile of findMetaFiles(root)) {
    const dir = path.dirname(metaFile);
    const res = loadComponent(dir, root);
    errors.push(...res.errors);
    warnings.push(...res.warnings);
    if (!res.component) continue;
    const prev = seen.get(res.component.id);
    if (prev) {
      errors.push(
        `${res.component.dir}: id duplicado "${res.component.id}" (ya en ${prev})`,
      );
      continue;
    }
    seen.set(res.component.id, res.component.dir);
    components.push(res.component);
  }
  components.sort((a, b) => a.id.localeCompare(b.id));
  return { components, errors, warnings };
}

/** Orden de presentación de categorías y librerías. */
export function sortForCatalog(components: HubComponent[]): HubComponent[] {
  const cat = (c: HubComponent) => HUB_CATEGORIES.indexOf(c.category);
  const lib = (c: HubComponent) => HUB_LIBRARIES.indexOf(c.library);
  return [...components].sort(
    (a, b) => cat(a) - cat(b) || lib(a) - lib(b) || a.name.localeCompare(b.name),
  );
}

/** Convierte un componente en su entrada del índice público. */
export function toIndexEntry(c: HubComponent): HubIndexEntry {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    library: c.library,
    version: c.version,
    description: c.description,
    tags: c.tags ?? [],
    tools: c.tools,
    context: c.context,
    animations: c.animations,
    hash: c.hash,
    files: {
      css: `components/${c.id}/${c.css}`,
      html: `components/${c.id}/${c.html}`,
      meta: `components/${c.id}/${META_FILE}`,
      page: `components/${c.id}/`,
    },
    importCommand: c.importCommand,
    promptExamples: c.promptExamples ?? [],
    animateExamples: c.animateExamples ?? [],
  };
}

/**
 * Construye el índice público `api/components.json`.
 * @param components Componentes cargados.
 * @param options `baseUrl` del hub y `generatedAt` fijo (tests/CI determinista).
 */
export function buildHubIndex(
  components: HubComponent[],
  options: { baseUrl?: string; generatedAt?: string } = {},
): HubIndex {
  const sorted = sortForCatalog(components);
  const count = <T extends string>(key: 'category' | 'library', id: T) =>
    sorted.filter((c) => c[key] === id).length;
  return {
    $schema: 'https://cochinoraptor.github.io/WebMCPcss/api/schema/components.json',
    name: 'WebMCPcss Component Hub',
    version: VERSION,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    baseUrl: (options.baseUrl ?? DEFAULT_HUB_URL).replace(/\/+$/, ''),
    categories: HUB_CATEGORIES.map((id) => ({
      id,
      label: CATEGORY_LABELS[id],
      count: count('category', id),
    })).filter((c) => c.count > 0),
    libraries: HUB_LIBRARIES.map((id) => ({
      id,
      label: LIBRARY_LABELS[id],
      count: count('library', id),
    })).filter((l) => l.count > 0),
    components: sorted.map(toIndexEntry),
  };
}

/** Filtro de búsqueda compartido por la CLI, el servidor MCP y el sitio. */
export interface HubFilter {
  category?: HubCategory | string;
  library?: HubLibrary | string;
  search?: string;
  tag?: string;
}

/** Aplica un filtro a entradas del índice (o componentes). */
export function filterEntries<
  T extends Pick<
    HubIndexEntry,
    'id' | 'name' | 'description' | 'category' | 'library' | 'tags' | 'tools'
  >,
>(entries: T[], filter: HubFilter): T[] {
  const q = filter.search?.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.category && e.category !== filter.category) return false;
    if (filter.library && e.library !== filter.library) return false;
    if (filter.tag && !e.tags.includes(filter.tag)) return false;
    if (q) {
      const hay = [
        e.id,
        e.name,
        e.description,
        e.category,
        e.library,
        ...e.tags,
        ...e.tools.map((t) => `${t.name} ${t.description ?? ''}`),
      ]
        .join(' ')
        .toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

/** JSON Schema (draft 2020-12) del índice, publicado en `api/schema/components.json`. */
export function hubIndexSchema(): Record<string, unknown> {
  const str = { type: 'string' };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://cochinoraptor.github.io/WebMCPcss/api/schema/components.json',
    title: 'WebMCPcss Component Hub index',
    type: 'object',
    required: ['name', 'version', 'baseUrl', 'components'],
    properties: {
      name: str,
      version: str,
      generatedAt: { type: 'string', format: 'date-time' },
      baseUrl: { type: 'string', format: 'uri' },
      categories: { type: 'array', items: { type: 'object' } },
      libraries: { type: 'array', items: { type: 'object' } },
      components: {
        type: 'array',
        items: {
          type: 'object',
          required: [
            'id',
            'name',
            'category',
            'library',
            'version',
            'description',
            'files',
            'importCommand',
          ],
          properties: {
            id: { type: 'string', pattern: '^[a-z0-9]+(?:-[a-z0-9]+)+$' },
            name: str,
            category: { type: 'string', enum: [...HUB_CATEGORIES] },
            library: { type: 'string', enum: [...HUB_LIBRARIES] },
            version: str,
            description: str,
            tags: { type: 'array', items: str },
            tools: { type: 'array', items: { type: 'object' } },
            context: { type: 'array', items: { type: 'object' } },
            animations: { type: 'array', items: { type: 'object' } },
            hash: str,
            files: {
              type: 'object',
              properties: { css: str, html: str, meta: str, page: str },
            },
            importCommand: str,
            promptExamples: { type: 'array', items: str },
            animateExamples: { type: 'array', items: str },
          },
        },
      },
    },
  };
}
