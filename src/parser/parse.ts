/**
 * Parser de `.webmcp.css`: CSS estándar con propiedades personalizadas
 * `webmcp-*` → {@link ToolMap} JSON.
 *
 * Soporta (v0.2.0): reglas anidadas con `&`, variables CSS (`var(--x)` con
 * fallback y referencias encadenadas), `@import` con guardia anti-ciclos
 * (`parseWebMCPFile`) y los alias `data(x)`/`aria(x)`.
 */
import * as fs from 'fs';
import * as path from 'path';
import postcss, { type ChildNode, type Root, type Rule } from 'postcss';
import type { ContextDef, ParamSource, ToolDef, ToolMap, TriggerSpec } from '../types';
import { normalizeText } from '../utils/dom';

/** Opciones de parseo. */
export interface ParseOptions {
  /** Ruta base para resolver `@import` relativos. */
  from?: string;
  /** Profundidad máxima de `@import` (por defecto 10). */
  maxImportDepth?: number;
}

interface Collector {
  tools: Record<string, ToolDef>;
  context: Record<string, ContextDef>;
  vars: Map<string, string>;
  imported: Set<string>;
}

/**
 * Parsea una cadena CSS en un {@link ToolMap}.
 *
 * Los `@import` solo se resuelven si se pasa `from` (o se usa
 * {@link parseWebMCPFile}); en caso contrario se ignoran.
 *
 * @param css Contenido del `.webmcp.css`.
 * @param opts Opciones de parseo.
 * @returns Tool map con herramientas y contextos declarados.
 */
export function parseWebMCP(css: string, opts: ParseOptions = {}): ToolMap {
  const collector: Collector = {
    tools: {},
    context: {},
    vars: new Map(),
    imported: new Set(),
  };
  const maxDepth = opts.maxImportDepth ?? 10;
  const root = postcss.parse(css, { from: opts.from });
  collect(
    root,
    undefined,
    collector,
    opts.from ? path.resolve(opts.from) : undefined,
    0,
    maxDepth,
  );
  return { tools: collector.tools, context: collector.context };
}

/**
 * Parsea un archivo `.webmcp.css` desde disco, resolviendo `@import`
 * relativos al archivo (con guardia anti-ciclos).
 *
 * @param file Ruta al archivo CSS.
 * @param maxImportDepth Profundidad máxima de importación.
 * @returns Tool map con herramientas y contextos declarados.
 */
export function parseWebMCPFile(file: string, maxImportDepth = 10): ToolMap {
  const abs = path.resolve(file);
  const css = fs.readFileSync(abs, 'utf8');
  return parseWebMCP(css, { from: abs, maxImportDepth });
}

/**
 * Recorre un (sub)árbol PostCSS recolectando declaraciones `webmcp-*`,
 * variables `:root` y resolviendo reglas anidadas.
 */
function collect(
  root: Root,
  parentSelector: string | undefined,
  c: Collector,
  fromFile: string | undefined,
  depth: number,
  maxDepth: number,
): void {
  for (const node of root.nodes as ChildNode[]) {
    if (node.type === 'atrule' && node.name === 'import') {
      const target = unquote(node.params);
      const base = fromFile ? path.dirname(fromFile) : undefined;
      if (!base || depth >= maxDepth) continue;
      const abs = path.resolve(base, target);
      if (c.imported.has(abs)) continue;
      c.imported.add(abs);
      try {
        const css = fs.readFileSync(abs, 'utf8');
        collect(
          postcss.parse(css, { from: abs }),
          parentSelector,
          c,
          abs,
          depth + 1,
          maxDepth,
        );
      } catch {
        // Un @import ilegible no debe romper el resto del archivo.
      }
      continue;
    }
    if (node.type !== 'rule') continue;
    const rule = node as Rule;
    const selector = resolveSelector(parentSelector, rule.selector);
    if (/^(:root|html)$/i.test(selector)) {
      for (const decl of rule.nodes ?? []) {
        if (decl.type === 'decl' && decl.prop.startsWith('--')) {
          c.vars.set(decl.prop, decl.value.trim());
        }
      }
    }
    applyDeclarations(rule, selector, c);
    if (rule.nodes?.length) {
      collect(rule as unknown as Root, selector, c, fromFile, depth, maxDepth);
    }
  }
}

/**
 * Resuelve el selector de una regla frente al de su padre (anidamiento).
 * Sustituye `&` por el selector padre o concatena como descendiente.
 */
function resolveSelector(parent: string | undefined, child: string): string {
  const trimmed = child.trim();
  if (!parent) return trimmed;
  if (trimmed.includes('&')) {
    return trimmed.replace(/&/g, parent);
  }
  return `${parent} ${trimmed}`;
}

/**
 * Aplica las declaraciones `webmcp-*` de una regla al collector.
 * Las declaraciones pueden aparecer en cualquier orden dentro de la regla.
 */
function applyDeclarations(rule: Rule, selector: string, c: Collector): void {
  const decls = (rule.nodes ?? [])
    .filter((d): d is import('postcss').Declaration => d.type === 'decl')
    .filter((d) => d.prop.startsWith('webmcp-'))
    .map((d) => ({
      prop: d.prop.slice('webmcp-'.length),
      value: substituteVars(normalizeText(d.value), c.vars),
    }));

  const toolDecl = decls.find((d) => d.prop === 'tool');
  const contextDecl = decls.find((d) => d.prop === 'context');

  if (toolDecl) {
    const name = unquote(toolDecl.value);
    const existing = c.tools[name];
    const params: Record<string, ParamSource> = { ...(existing?.params ?? {}) };
    let description: string | undefined;
    let trigger: TriggerSpec | undefined;
    let confirmation: string | undefined;
    for (const d of decls) {
      if (d.prop.startsWith('param-')) {
        params[kebabToCamel(d.prop.slice('param-'.length))] = parseParamSource(d.value);
      } else if (d.prop === 'description') {
        description = unquote(d.value);
      } else if (d.prop === 'trigger') {
        trigger = parseTrigger(d.value);
      } else if (d.prop === 'confirmation') {
        confirmation = unquote(d.value);
      }
    }
    c.tools[name] = {
      selector,
      params,
      description: description ?? existing?.description,
      trigger: trigger ?? existing?.trigger ?? { event: 'click' },
      confirmation: confirmation ?? existing?.confirmation,
    };
  }

  if (contextDecl) {
    const formatDecl = decls.find((d) => d.prop === 'format');
    c.context[unquote(contextDecl.value)] = {
      selector,
      format: formatDecl ? unquote(formatDecl.value) : 'text',
    };
  }
}

/**
 * Interpreta el valor de `webmcp-param-<nombre>` como {@link ParamSource}.
 * Acepta `attr(x)`, `data(x)`, `aria(x)`, `value(sel?)`, `text(sel?)` y
 * literales entre comillas (o desnudos, de forma tolerante).
 */
export function parseParamSource(raw: string): ParamSource {
  const value = raw.trim();
  const fn = value.match(/^([a-z]+)\(\s*(.*?)\s*\)$/i);
  if (fn) {
    const name = fn[1].toLowerCase();
    const arg = fn[2].trim();
    if (name === 'attr') return { source: 'attr', value: arg };
    if (name === 'data') return { source: 'attr', value: `data-${arg}` };
    if (name === 'aria') return { source: 'attr', value: `aria-${arg}` };
    if (name === 'value')
      return arg ? { source: 'value', selector: arg } : { source: 'value' };
    if (name === 'text')
      return arg ? { source: 'text', selector: arg } : { source: 'text' };
  }
  return { source: 'literal', value: unquote(value) };
}

/**
 * Interpreta `webmcp-trigger`: `"submit" on .form` o `"click"`.
 */
export function parseTrigger(raw: string): TriggerSpec {
  const m = raw.match(/^['"]?([A-Za-z-]+)['"]?(?:\s+on\s+(.+))?$/);
  if (!m) return { event: 'click' };
  return { event: m[1], on: m[2] ? m[2].trim() : undefined };
}

/**
 * Sustituye `var(--x)` y `var(--x, fallback)` (con referencias encadenadas).
 */
function substituteVars(value: string, vars: Map<string, string>): string {
  let out = value;
  for (let i = 0; i < 10; i++) {
    const next = out.replace(
      /var\(\s*(--[A-Za-z0-9-]+)\s*(?:,\s*([^()]*?)\s*)?\)/g,
      (_all, name: string, fallback: string | undefined) => {
        const resolved = vars.get(name);
        if (resolved !== undefined) return resolved;
        return (fallback ?? '').trim();
      },
    );
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Convierte `kebab-case` en `camelCase` (`param-qty` → `qty`,
 * `mi-param-largo` → `miParamLargo`).
 */
function kebabToCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_all, ch: string) => ch.toUpperCase());
}

/**
 * Quita comillas envolventes de un valor CSS.
 */
function unquote(value: string): string {
  const m = value.match(/^(['"])(.*)\1$/s);
  return m ? m[2] : value;
}
