/**
 * Exportador de integración con **Cursor**.
 *
 * Genera:
 * - `mcp.json` — servidor MCP `webmcpcss` (fusionable en `~/.cursor/mcp.json`
 *   o `.cursor/mcp.json` del proyecto).
 * - `.vscode/webmcp.code-snippets` — autocompletado con prefijo `webmcp:`
 *   (Cursor lee los snippets de VS Code): `webmcp:tool`, `webmcp:context`,
 *   `webmcp:param`, `webmcp:fingerprint`, `webmcp:animation` y un snippet
 *   por herramienta del `.webmcp.css` (`webmcp:addToCart`…) cuyo selector
 *   se elige entre **candidatos estables** (`[data-tool]`, `#id`…).
 * - `.cursor/rules/webmcpcss.mdc` — regla de proyecto para el agente de
 *   Cursor: convenciones de selectores estables, herramientas disponibles y
 *   su fragilidad.
 * - `README.md` — pasos de instalación.
 *
 * Además, {@link registerCursorMcpServer} registra el servidor directamente
 * en `~/.cursor/mcp.json` (CLI: `webmcpcss export --format cursor --register`).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyzeFragility } from '../graph/fragility';
import { serializeParam } from '../parser';
import type { ToolMap } from '../types';
import { VERSION } from '../version';
import { exportMcpConfig } from './editors';
import type { ExportContext } from './python-agents';

/** Convierte `addToCart` → `add-to-cart`. */
export function kebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Candidatos de selector estable para una herramienta, ordenados por
 * preferencia: el selector actual (si ya es robusto), un id presente en el
 * selector, `[data-tool]`, `[data-testid]` y `#id` derivados del nombre.
 *
 * @param toolName Nombre de la herramienta (`addToCart`).
 * @param selector Selector declarado actualmente.
 * @returns Lista sin duplicados (el primero es el recomendado).
 */
export function stableSelectorCandidates(toolName: string, selector: string): string[] {
  const slug = kebabCase(toolName) || 'tool';
  const score = analyzeFragility(selector);
  const out: string[] = [];
  if (score.level === 'low') out.push(selector);
  const id = selector.match(/#([A-Za-z_][\w-]*)/)?.[1];
  if (id && !/[«:]/.test(id) && !/\d{4,}/.test(id)) out.push(`#${id}`);
  out.push(`[data-tool="${slug}"]`, `[data-testid="${slug}"]`, `#${slug}`);
  if (score.level !== 'low') out.push(selector);
  return [...new Set(out)];
}

/** Escapa un valor para usarlo dentro de una elección de snippet `${1|a,b|}`. */
function snippetChoice(values: string[]): string {
  const esc = (v: string) => v.replace(/[\\,|$}]/g, (c) => `\\${c}`);
  return `\${1|${values.map(esc).join(',')}|}`;
}

/** Escapa `$` en texto literal de snippet. */
function snippetLiteral(text: string): string {
  return text.replace(/\$/g, '\\$');
}

/**
 * Genera el archivo de snippets (`*.code-snippets`) con prefijo `webmcp:`.
 *
 * @param toolMap Tool map parseado (añade un snippet por herramienta).
 * @returns JSON del archivo de snippets.
 */
export function buildCursorSnippets(toolMap: ToolMap): string {
  const snippets: Record<
    string,
    { scope: string; prefix: string; body: string[]; description: string }
  > = {
    'WebMCP: herramienta': {
      scope: 'css,scss,less',
      prefix: 'webmcp:tool',
      body: [
        '${1|[data-tool="${2:accion}"],#${2:accion},[aria-label="${3:Etiqueta}"]|} {',
        '  webmcp-tool: "${4:nombreHerramienta}";',
        '  webmcp-description: "${5:Qué hace esta acción}";',
        '  webmcp-param-${6:campo}: value(${7:#input});',
        '  webmcp-confirmation: "${8:.mensaje-exito}";',
        '}',
      ],
      description: 'Declara una herramienta WebMCP con un selector estable',
    },
    'WebMCP: contexto': {
      scope: 'css,scss,less',
      prefix: 'webmcp:context',
      body: [
        '${1|[data-context="${2:dato}"],#${2:dato}|} {',
        '  webmcp-context: "${3:nombreDato}";',
        '  webmcp-format: "${4|text,number,currency,json|}";',
        '}',
      ],
      description: 'Expone un dato de la página como contexto para agentes',
    },
    'WebMCP: parámetro': {
      scope: 'css,scss,less',
      prefix: 'webmcp:param',
      body: [
        'webmcp-param-${1:nombre}: ${2|value(#campo),value(),attr(data-id),data(id),aria(label),text(.etiqueta),"literal"|};',
      ],
      description: 'Parámetro de una herramienta (value/attr/data/aria/text/literal)',
    },
    'WebMCP: huella para auto-reparación': {
      scope: 'css,scss,less',
      prefix: 'webmcp:fingerprint',
      body: [
        'webmcp-fingerprint: \'{"tag":"${1:button}","text":"${2:Añadir al carrito}","attrs":{"${3:data-product-id}":"${4:123}"}}\';',
      ],
      description: 'Huella del elemento para que `webmcpcss repair` lo re-localice',
    },
    'WebMCP: animación declarativa': {
      scope: 'css,scss,less',
      prefix: 'webmcp:animation',
      body: [
        '${1:.hero} {',
        '  webmcp-animation: "${2:nombre}";',
        '  webmcp-animation-type: ${3|parallax,isometric,3d-transform,keyframes,three-scene|};',
        '  webmcp-animation-priority: ${4|normal,low,high,critical|};',
        '  webmcp-animation-trigger: ${5|load,scroll,hover,click,visible,manual|};',
        '  webmcp-animation-conflict: ${6|queue,replace,ignore,merge|};',
        '  webmcp-animation-duration: ${7:600ms};',
        '}',
      ],
      description: 'Animación webmcp-animation-* con prioridad y estrategia de conflicto',
    },
  };

  for (const [name, tool] of Object.entries(toolMap.tools)) {
    const candidates = stableSelectorCandidates(name, tool.selector);
    const score = analyzeFragility(tool.selector);
    const params = Object.entries(tool.params).map(
      ([p, spec]) => `  webmcp-param-${p}: ${snippetLiteral(serializeParam(spec))};`,
    );
    snippets[`WebMCP: ${name}`] = {
      scope: 'css,scss,less',
      prefix: `webmcp:${name}`,
      body: [
        `${snippetChoice(candidates)} {`,
        `  webmcp-tool: "${name}";`,
        ...(tool.description
          ? [`  webmcp-description: "${snippetLiteral(tool.description)}";`]
          : []),
        ...params,
        ...(tool.confirmation
          ? [`  webmcp-confirmation: "${snippetLiteral(tool.confirmation)}";`]
          : []),
        '}',
      ],
      description: `Herramienta ${name} · selector actual ${tool.selector} (fragilidad ${score.level}); elige un selector estable`,
    };
  }
  return JSON.stringify(snippets, null, 2) + '\n';
}

/**
 * Genera la regla de proyecto de Cursor (`.cursor/rules/webmcpcss.mdc`).
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 */
export function buildCursorRule(toolMap: ToolMap, ctx: ExportContext): string {
  const rows = Object.entries(toolMap.tools).map(([name, tool]) => {
    const score = analyzeFragility(tool.selector);
    const best = stableSelectorCandidates(name, tool.selector)[0];
    return `| \`${name}\` | \`${tool.selector}\` | ${score.level}${score.framework ? ` (${score.framework})` : ''} | \`${best}\` |`;
  });
  return `---
description: Convenciones WebMCPcss para ${ctx.cssPath} — selectores estables, herramientas MCP disponibles y cómo probarlas
globs: ["**/*.webmcp.css", "**/webmcp.css"]
alwaysApply: false
---

# WebMCPcss en este proyecto

- Archivo de herramientas: \`${ctx.cssPath}\`${ctx.url ? ` · sitio: ${ctx.url}` : ''}
- Servidor MCP: \`webmcpcss mcp --serve --css ${ctx.cssPath}${ctx.url ? ` --url ${ctx.url}` : ''}\`
  (herramientas del sitio + \`webmcpcss_prompt\` + \`webmcpcss_animate\`).

## Reglas para selectores

1. Prefiere, por este orden: \`[data-tool="…"]\` / \`[data-testid="…"]\` →
   \`#id\` semántico → \`[name]\` / \`[aria-label]\` → clase semántica propia.
2. Nunca uses clases con hash (CSS Modules \`_abc12\`, Vue \`data-v-*\`,
   Svelte \`svelte-*\`, styled-components \`sc-*\`, Emotion \`css-*\`), utilidades
   de Tailwind ni \`:nth-child\` como selector de herramienta.
3. Añade \`webmcp-fingerprint\` a las herramientas críticas para que
   \`webmcpcss repair\` pueda re-localizarlas.
4. Tras editar \`${ctx.cssPath}\` ejecuta \`webmcpcss validate ${ctx.url ?? '<url>'} ${ctx.cssPath}\`.
5. Escribe \`webmcp:\` en un archivo CSS para ver los snippets disponibles.

## Herramientas declaradas

| Herramienta | Selector actual | Fragilidad | Selector recomendado |
| --- | --- | --- | --- |
${rows.join('\n') || '| — | — | — | — |'}
`;
}

/**
 * Genera la integración con Cursor: `mcp.json`, snippets `webmcp:`, regla de
 * proyecto y guía.
 *
 * @param ctx Ruta CSS y URL.
 * @param toolMap Tool map parseado (opcional: sin él solo se generan
 *   `mcp.json`, los snippets genéricos y el README).
 */
export function exportCursorIntegration(
  ctx: ExportContext,
  toolMap: ToolMap = { tools: {}, context: {} },
): Record<string, string> {
  return {
    'mcp.json': exportMcpConfig(ctx) + '\n',
    '.vscode/webmcp.code-snippets': buildCursorSnippets(toolMap),
    '.cursor/rules/webmcpcss.mdc': buildCursorRule(toolMap, ctx),
    'README.md': `# Integración con Cursor (webmcpcss v${VERSION})

## 1. Servidor MCP

- Automático: \`webmcpcss export ${ctx.cssPath} --format cursor --register\`
  (fusiona el servidor en \`~/.cursor/mcp.json\`).
- Manual: copia el contenido de \`mcp.json\` en \`~/.cursor/mcp.json\` (global)
  o en \`.cursor/mcp.json\` del proyecto.

Reinicia Cursor. En Settings → MCP verás el servidor \`webmcpcss\` con las
herramientas de \`${ctx.cssPath}\` más \`webmcpcss_prompt\` y \`webmcpcss_animate\`.

## 2. Autocompletado \`webmcp:\`

Copia \`.vscode/webmcp.code-snippets\` a la carpeta \`.vscode/\` de tu proyecto
(o a tus snippets de usuario). En cualquier archivo CSS escribe \`webmcp:\` y
elige: \`webmcp:tool\`, \`webmcp:context\`, \`webmcp:param\`,
\`webmcp:fingerprint\`, \`webmcp:animation\` o una herramienta concreta
(\`webmcp:${Object.keys(toolMap.tools)[0] ?? 'addToCart'}\`). Cada snippet ofrece
**selectores estables** como primera elección.

## 3. Regla para el agente

Copia \`.cursor/rules/webmcpcss.mdc\` a \`.cursor/rules/\` del proyecto: el
agente de Cursor conocerá las herramientas, su fragilidad y las convenciones
de selectores al editar archivos \`.webmcp.css\`.

Requiere \`webmcpcss\` instalado globalmente: \`npm i -g webmcpcss\`.
`,
  };
}

/** Opciones de {@link registerCursorMcpServer}. */
export interface RegisterCursorOptions {
  /** Carpeta home (def. `os.homedir()`); útil en tests. */
  home?: string;
  /** Ruta explícita del archivo de configuración (prevalece sobre `home`). */
  configPath?: string;
  /** Nombre del servidor en `mcpServers` (def. `webmcpcss`). */
  serverName?: string;
}

/**
 * Registra (o actualiza) el servidor `webmcpcss` en `~/.cursor/mcp.json`,
 * conservando el resto de servidores ya configurados.
 *
 * @param ctx Ruta CSS y URL que se pasarán a `webmcpcss mcp --serve`.
 * @param options Home/ruta alternativa y nombre del servidor.
 * @returns Ruta del archivo escrito y si el servidor ya existía.
 * @throws Error si el archivo existente no es JSON válido.
 */
export function registerCursorMcpServer(
  ctx: ExportContext,
  options: RegisterCursorOptions = {},
): { path: string; updated: boolean } {
  const configPath =
    options.configPath ?? path.join(options.home ?? os.homedir(), '.cursor', 'mcp.json');
  const serverName = options.serverName ?? 'webmcpcss';
  let existing: { mcpServers?: Record<string, unknown> } = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8').trim();
    if (raw) {
      try {
        existing = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      } catch {
        throw new Error(
          `${configPath} no es JSON válido; corrígelo o bórralo antes de registrar.`,
        );
      }
    }
  }
  const generated = JSON.parse(exportMcpConfig(ctx)) as {
    mcpServers: Record<string, unknown>;
  };
  const servers = { ...(existing.mcpServers ?? {}) };
  const updated = serverName in servers;
  servers[serverName] = generated.mcpServers.webmcpcss;
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    JSON.stringify({ ...existing, mcpServers: servers }, null, 2) + '\n',
    'utf8',
  );
  return { path: configPath, updated };
}
