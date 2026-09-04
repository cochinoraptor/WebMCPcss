/**
 * Exportación del grafo a un vault de Obsidian.
 *
 * Estructura generada:
 * ```
 * vault/
 * ├── index.md                 # estadísticas + enlaces a todo
 * ├── herramientas/<tool>.md   # frontmatter YAML + descripción + backlinks
 * ├── selectores/<selector>.md # estado, fragilidad, herramientas que lo usan
 * ├── paginas/<page>.md        # herramientas de la página
 * └── estados/<OK|Rotos>.md    # herramientas por estado
 * ```
 *
 * DECISIÓN DE DISEÑO: las notas se generan con template literals en lugar de
 * Handlebars, y la escritura usa `fs` nativo en lugar de fs-extra — cero
 * dependencias nuevas, coherente con el resto del proyecto.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { FragilityScore, Graph, GraphNode, ObsidianOptions } from './types';
import { sanitizeFileName, uniqueFileNames, wikiLink, yamlEscape } from './utils';

/** Índice de acceso rápido al grafo. */
interface GraphIndex {
  byId: Map<string, GraphNode>;
  /** Aristas salientes por nodo y tipo. */
  out: Map<string, Map<string, string[]>>;
  /** Aristas entrantes por nodo y tipo. */
  inc: Map<string, Map<string, string[]>>;
  /** label del nodo → nombre de archivo (por tipo). */
  fileFor: (node: GraphNode) => string;
}

/** Construye índices de nodos/aristas y nombres de archivo únicos. */
function indexGraph(graph: Graph): GraphIndex {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, Map<string, string[]>>();
  const inc = new Map<string, Map<string, string[]>>();
  const push = (
    map: Map<string, Map<string, string[]>>,
    key: string,
    type: string,
    v: string,
  ) => {
    const byType = map.get(key) ?? new Map<string, string[]>();
    byType.set(type, [...(byType.get(type) ?? []), v]);
    map.set(key, byType);
  };
  for (const e of graph.edges) {
    push(out, e.source, e.type, e.target);
    push(inc, e.target, e.type, e.source);
  }
  const names = new Map<string, Map<string, string>>();
  for (const type of ['tool', 'selector', 'param', 'page', 'status']) {
    const labels = graph.nodes.filter((n) => n.type === type).map((n) => n.label);
    names.set(type, uniqueFileNames(labels));
  }
  const fileFor = (node: GraphNode): string =>
    names.get(node.type)?.get(node.label) ?? sanitizeFileName(node.label);
  return { byId, out, inc, fileFor };
}

/** Targets de una arista saliente, resueltos a nodos. */
function targets(idx: GraphIndex, id: string, type: string): GraphNode[] {
  return (idx.out.get(id)?.get(type) ?? [])
    .map((t) => idx.byId.get(t))
    .filter((n): n is GraphNode => Boolean(n));
}

/** Sources de una arista entrante, resueltos a nodos. */
function sources(idx: GraphIndex, id: string, type: string): GraphNode[] {
  return (idx.inc.get(id)?.get(type) ?? [])
    .map((t) => idx.byId.get(t))
    .filter((n): n is GraphNode => Boolean(n));
}

/** Convierte un nombre de framework en una etiqueta Obsidian válida. */
function tagFor(framework: string): string {
  return framework
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Líneas de frontmatter YAML derivadas del análisis de fragilidad:
 * `fragility`, `framework` y `suggestions` (lista).
 */
function fragilityFrontmatter(frag: FragilityScore | undefined): string[] {
  if (!frag) return [];
  const lines = [`fragility: ${frag.level}`];
  if (frag.framework) lines.push(`framework: ${yamlEscape(frag.framework)}`);
  if (frag.suggestions.length > 0) {
    lines.push('suggestions:');
    for (const sug of frag.suggestions) lines.push(`  - ${yamlEscape(sug)}`);
  }
  return lines;
}

/** Sección Markdown con el análisis de fragilidad de un selector. */
function fragilitySection(frag: FragilityScore | undefined): string {
  if (!frag) return '';
  const icon = frag.level === 'high' ? '🔴' : frag.level === 'medium' ? '🟡' : '🟢';
  let md = `\n## Fragilidad: ${icon} ${frag.level}\n\n`;
  if (frag.frameworks.length > 0)
    md += `Frameworks detectados: ${frag.frameworks.join(', ')}\n\n`;
  if (frag.reasons.length > 0) {
    md += `**Razones**\n\n${frag.reasons.map((r) => `- ${r}`).join('\n')}\n`;
  }
  if (frag.suggestions.length > 0) {
    md += `\n**Recomendaciones**\n\n${frag.suggestions.map((s) => `- ${s}`).join('\n')}\n`;
  }
  return md;
}

/** Nota de una herramienta. */
function toolNote(idx: GraphIndex, node: GraphNode): string {
  const meta = node.metadata ?? {};
  const selectors = targets(idx, node.id, 'uses');
  const params = targets(idx, node.id, 'requires');
  const pages = targets(idx, node.id, 'belongs-to').filter((n) => n.type === 'page');
  const status = targets(idx, node.id, 'has-status')[0];
  const shared = [
    ...targets(idx, node.id, 'shares-selector'),
    ...sources(idx, node.id, 'shares-selector'),
  ];
  const frag = selectors[0]?.metadata?.fragility as FragilityScore | undefined;

  const fm = [
    '---',
    `type: tool`,
    `name: ${yamlEscape(node.label)}`,
    ...(pages[0] ? [`page: ${yamlEscape(pages[0].label)}`] : []),
    ...(status ? [`status: ${status.label === 'OK' ? 'ok' : 'broken'}`] : []),
    `selectors:`,
    ...selectors.map((s) => `  - ${yamlEscape(s.label)}`),
    `params: [${params.map((p) => p.label).join(', ')}]`,
    ...fragilityFrontmatter(frag),
    `tags: [webmcp, tool${status ? (status.label === 'OK' ? ', ok' : ', broken') : ''}${frag?.framework ? `, ${tagFor(frag.framework)}` : ''}]`,
    '---',
  ].join('\n');

  let body = `\n# 🔧 ${node.label}\n\n`;
  if (meta.description) body += `> ${String(meta.description)}\n\n`;
  body += `| Campo | Valor |\n| --- | --- |\n`;
  body += `| Selector | ${selectors.map((s) => wikiLink(`selectores/${idx.fileFor(s)}`, s.label)).join(', ')} |\n`;
  if (pages[0])
    body += `| Página | ${wikiLink(`paginas/${idx.fileFor(pages[0])}`, pages[0].label)} |\n`;
  if (status)
    body += `| Estado | ${wikiLink(`estados/${idx.fileFor(status)}`, status.label)} ${status.label === 'OK' ? '✅' : '❌'} |\n`;

  if (params.length > 0) {
    body += `\n## Parámetros\n\n`;
    for (const p of params) {
      const pm = p.metadata ?? {};
      body += `- **${p.label}** — fuente: \`${String(pm.source ?? '?')}\`${pm.selector ? `, selector: \`${String(pm.selector)}\`` : ''}\n`;
    }
  }
  body += fragilitySection(frag);
  if (shared.length > 0) {
    body += `\n## Comparte selector con\n\n${[...new Set(shared.map((t) => `- ${wikiLink(`herramientas/${idx.fileFor(t)}`, t.label)}`))].join('\n')}\n`;
  }
  return fm + body;
}

/** Nota de un selector. */
function selectorNote(idx: GraphIndex, node: GraphNode): string {
  const frag = node.metadata?.fragility as FragilityScore | undefined;
  const tools = sources(idx, node.id, 'uses');
  const pages = targets(idx, node.id, 'belongs-to').filter((n) => n.type === 'page');
  const fm = [
    '---',
    `type: selector`,
    `selector: ${yamlEscape(node.label)}`,
    ...fragilityFrontmatter(frag),
    `tags: [webmcp, selector${frag ? `, fragilidad-${frag.level}` : ''}${frag?.framework ? `, ${tagFor(frag.framework)}` : ''}]`,
    '---',
  ].join('\n');
  let body = `\n# 🎯 \`${node.label}\`\n\n`;
  if (pages.length > 0)
    body += `Página: ${pages.map((p) => wikiLink(`paginas/${idx.fileFor(p)}`, p.label)).join(', ')}\n\n`;
  body += `## Herramientas que lo usan\n\n`;
  body +=
    tools.length > 0
      ? tools
          .map((t) => `- ${wikiLink(`herramientas/${idx.fileFor(t)}`, t.label)}`)
          .join('\n') + '\n'
      : '_Ninguna._\n';
  body += fragilitySection(frag);
  return fm + body;
}

/** Nota de una página. */
function pageNote(idx: GraphIndex, node: GraphNode): string {
  const tools = sources(idx, node.id, 'belongs-to').filter((n) => n.type === 'tool');
  const fm = [
    '---',
    `type: page`,
    `name: ${yamlEscape(node.label)}`,
    `tags: [webmcp, page]`,
    '---',
  ].join('\n');
  let body = `\n# 📄 ${node.label}\n\n`;
  if (node.metadata?.path) body += `Archivo: \`${String(node.metadata.path)}\`\n\n`;
  body += `## Herramientas (${tools.length})\n\n`;
  body +=
    tools.length > 0
      ? tools
          .map((t) => `- ${wikiLink(`herramientas/${idx.fileFor(t)}`, t.label)}`)
          .join('\n') + '\n'
      : '_Ninguna._\n';
  return fm + body;
}

/** Nota de un estado (OK / Rotos). */
function statusNote(idx: GraphIndex, node: GraphNode): string {
  const tools = sources(idx, node.id, 'has-status');
  const fm = [
    '---',
    `type: status`,
    `name: ${yamlEscape(node.label)}`,
    `tags: [webmcp, status]`,
    '---',
  ].join('\n');
  let body = `\n# ${node.label === 'OK' ? '✅' : '❌'} Herramientas ${node.label === 'OK' ? 'OK' : 'rotas'} (${tools.length})\n\n`;
  body +=
    tools.length > 0
      ? tools
          .map((t) => `- ${wikiLink(`herramientas/${idx.fileFor(t)}`, t.label)}`)
          .join('\n') + '\n'
      : '_Ninguna._\n';
  return fm + body;
}

/** index.md con estadísticas globales y enlaces. */
function indexNote(idx: GraphIndex, graph: Graph, options: ObsidianOptions): string {
  const m = graph.metadata;
  const tools = graph.nodes.filter((n) => n.type === 'tool');
  const pages = graph.nodes.filter((n) => n.type === 'page');
  const frag = m?.fragilitySummary ?? {};
  let md = `---\ntype: index\ntags: [webmcp, index]\n---\n\n# 🗺️ ${options.vaultName ?? 'WebMCPcss'} — Mapa de contenido\n\n`;
  md += `| Métrica | Valor |\n| --- | --- |\n`;
  md += `| Herramientas | ${m?.totalTools ?? tools.length} |\n`;
  md += `| Selectores | ${m?.totalSelectors ?? 0} |\n`;
  md += `| Páginas | ${m?.totalPages ?? pages.length} |\n`;
  if (m?.statusCounts)
    md += `| Estado | ✅ ${m.statusCounts.ok} · ❌ ${m.statusCounts.broken} |\n`;
  if (Object.keys(frag).length > 0)
    md += `| Fragilidad | 🟢 ${frag.low ?? 0} · 🟡 ${frag.medium ?? 0} · 🔴 ${frag.high ?? 0} |\n`;
  md += `\n## Páginas\n\n${pages.map((p) => `- ${wikiLink(`paginas/${idx.fileFor(p)}`, p.label)}`).join('\n') || '_Ninguna._'}\n`;
  md += `\n## Herramientas\n\n${tools.map((t) => `- ${wikiLink(`herramientas/${idx.fileFor(t)}`, t.label)}`).join('\n') || '_Ninguna._'}\n`;
  const selectors = graph.nodes.filter((n) => n.type === 'selector');
  md += `\n## Selectores\n\n${selectors.map((s) => `- ${wikiLink(`selectores/${idx.fileFor(s)}`, s.label)}`).join('\n') || '_Ninguno._'}\n`;
  const fws = Object.entries(m?.frameworkSummary ?? {}).sort((a, b) => b[1] - a[1]);
  if (fws.length > 0) {
    md += `\n## Frameworks detectados\n\n| Framework | Selectores |\n| --- | --- |\n`;
    md += fws.map(([fw, n]) => `| ${fw} | ${n} |`).join('\n') + '\n';
  }
  return md;
}

/**
 * Genera un vault de Obsidian a partir del grafo.
 *
 * @param graph Grafo construido con `buildGraph()`.
 * @param outputDir Carpeta destino (se crea si no existe).
 * @param options Nombre del vault y flags.
 * @returns Lista de rutas de archivos escritos.
 */
export function generateObsidianVault(
  graph: Graph,
  outputDir: string,
  options: ObsidianOptions = {},
): string[] {
  const idx = indexGraph(graph);
  const written: string[] = [];
  const write = (rel: string, content: string): void => {
    const abs = path.join(outputDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    written.push(abs);
  };

  for (const node of graph.nodes) {
    const file = idx.fileFor(node);
    switch (node.type) {
      case 'tool':
        write(path.join('herramientas', `${file}.md`), toolNote(idx, node));
        break;
      case 'selector':
        write(path.join('selectores', `${file}.md`), selectorNote(idx, node));
        break;
      case 'page':
        write(path.join('paginas', `${file}.md`), pageNote(idx, node));
        break;
      case 'status':
        write(path.join('estados', `${file}.md`), statusNote(idx, node));
        break;
      default:
        break; // los params se documentan dentro de su herramienta
    }
  }
  write('index.md', indexNote(idx, graph, options));
  return written;
}
