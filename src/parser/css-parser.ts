/**
 * Parser de archivos `.webmcp.css`.
 *
 * Convierte un archivo CSS con propiedades personalizadas `webmcp-*` en un
 * {@link ToolMap} JSON, y viceversa (serialización, usada por `webmcpcss repair`
 * para reescribir el archivo con selectores reparados).
 *
 * Propiedades soportadas:
 * - `webmcp-tool: "name"`            → declara una herramienta.
 * - `webmcp-param-<param>: <fuente>` → parámetro. Fuentes: `attr(x)`, `data(x)`,
 *   `aria(x)`, `value(sel?)`, `text(sel?)`, `"literal"`.
 * - `webmcp-confirmation: ".sel"`    → selector de confirmación post-acción.
 * - `webmcp-trigger: "evt" on .sel`  → evento y objetivo del disparo.
 * - `webmcp-description: "..."`      → descripción legible.
 * - `webmcp-context: "name"`         → declara un dato de contexto (lectura).
 * - `webmcp-format: "currency"`      → formato del dato de contexto.
 *
 * Características de CSS moderno soportadas:
 * - **Reglas anidadas** (incluido `&`): `.card { .btn { webmcp-tool: "x"; } }`
 * - **Variables CSS**: `:root { --qty: #qty-input; }` + `var(--qty, fallback)`
 * - **`@import "otro.css";`** vía {@link parseWebMCPFile} o la opción `resolveImport`.
 */
import * as fs from 'fs';
import * as path from 'path';
import postcss, { Declaration, Rule, Root } from 'postcss';
import type {
  ContextSpec,
  ParamSpec,
  ToolMap,
  ToolSpec,
  TriggerSpec,
  WebMCPMeta,
} from '../types';

/** Prefijo de todas las propiedades WebMCP. */
const WEBMCP_PREFIX = 'webmcp-';
const PARAM_PREFIX = 'webmcp-param-';
/** Valores de `webmcp-confirmation` que son política (IA-First) y no selector. */
const CONFIRMATION_POLICIES = new Set(['needed', 'none', 'required', 'always', 'never']);
/** Profundidad máxima de resolución de `var()` anidadas. */
const MAX_VAR_DEPTH = 8;

/** Opciones de {@link parseWebMCP}. */
export interface ParseOptions {
  /**
   * Resuelve el contenido de un `@import "spec";`. Recibe el especificador
   * tal cual aparece en el CSS y debe devolver el CSS importado.
   * Si no se define, los `@import` se ignoran con seguridad.
   */
  resolveImport?: (spec: string) => string;
  /** Variables CSS heredadas (uso interno en imports recursivos). */
  inheritedVars?: Record<string, string>;
  /** Especificadores ya importados (guardia anti-ciclos, uso interno). */
  seen?: Set<string>;
}

/** Error de parseo con información de línea. */
export class WebMCPParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
  ) {
    super(line ? `${message} (línea ${line})` : message);
    this.name = 'WebMCPParseError';
  }
}

/**
 * Elimina comillas simples o dobles envolventes de un valor CSS.
 * @param raw Valor crudo, p. ej. `"addToCart"`.
 * @returns El valor sin comillas, p. ej. `addToCart`.
 */
export function unquote(raw: string): string {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Sustituye referencias `var(--nombre, fallback?)` por su valor.
 * Soporta fallbacks y variables que referencian otras variables
 * (hasta {@link MAX_VAR_DEPTH} niveles).
 *
 * @param value Valor CSS que puede contener `var()`.
 * @param vars Tabla de variables (`--nombre` → valor).
 * @param depth Nivel de recursión actual (uso interno).
 */
export function substituteVars(
  value: string,
  vars: Record<string, string>,
  depth = 0,
): string {
  if (depth > MAX_VAR_DEPTH || !value.includes('var(')) return value;
  const replaced = value.replace(
    /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g,
    (_m, name: string, fallback?: string) => {
      const resolved = vars[name];
      if (resolved !== undefined) return resolved;
      return fallback !== undefined ? fallback.trim() : '';
    },
  );
  return replaced === value ? replaced : substituteVars(replaced, vars, depth + 1);
}

/**
 * Resuelve el selector completo de una regla, teniendo en cuenta el
 * anidamiento CSS. Soporta `&` (referencia al padre) y listas separadas
 * por comas en cualquier nivel.
 *
 * @param rule Regla postcss (posiblemente anidada).
 * @returns El selector plano equivalente.
 */
export function resolveSelector(rule: Rule): string {
  const ownParts = rule.selectors.map((s) => s.trim());
  const parent = rule.parent;
  if (!parent || parent.type !== 'rule') return ownParts.join(', ');
  const parentParts = resolveSelector(parent as Rule)
    .split(',')
    .map((s) => s.trim());
  const combined: string[] = [];
  for (const p of parentParts) {
    for (const s of ownParts) {
      combined.push(s.includes('&') ? s.replace(/&/g, p) : `${p} ${s}`);
    }
  }
  return combined.join(', ');
}

/**
 * Parsea el valor de una propiedad `webmcp-param-*` a un {@link ParamSpec}.
 *
 * Formatos soportados:
 * - `attr(data-product-id)` → lee el atributo del elemento de la herramienta.
 * - `data(product-id)`      → alias de `attr(data-product-id)`.
 * - `aria(label)`           → alias de `attr(aria-label)`.
 * - `value(#qty-input)`     → lee/escribe el `value` del selector dado.
 * - `value()`               → lee/escribe el `value` del propio elemento.
 * - `text(.price)`          → lee el texto del selector dado.
 * - `"literal"`             → valor fijo.
 *
 * Los alias `data()` y `aria()` se normalizan a `attr()` al parsear, por lo
 * que el resto del motor no necesita conocerlos.
 *
 * @param raw Valor crudo de la declaración CSS.
 * @param line Línea (para mensajes de error).
 */
export function parseParamValue(raw: string, line?: number): ParamSpec {
  const v = raw.trim();
  const fnMatch = /^(attr|value|text|data|aria)\(\s*([^)]*?)\s*\)$/i.exec(v);
  if (fnMatch) {
    const fn = fnMatch[1].toLowerCase();
    const arg = fnMatch[2].trim();
    if (fn === 'attr' || fn === 'data' || fn === 'aria') {
      if (!arg) {
        throw new WebMCPParseError(`${fn}() requiere un nombre de atributo`, line);
      }
      const attrName = fn === 'attr' ? arg : `${fn}-${arg}`;
      return { source: 'attr', value: attrName };
    }
    if (fn === 'value') {
      return arg ? { source: 'value', selector: arg } : { source: 'value' };
    }
    // text()
    return arg ? { source: 'text', selector: arg } : { source: 'text' };
  }
  return { source: 'literal', value: unquote(v) };
}

/**
 * Parsea el valor de `webmcp-trigger`, p. ej. `"submit" on .coupon-form`.
 * @param raw Valor crudo.
 * @returns Un {@link TriggerSpec} con evento y selector opcional.
 */
export function parseTriggerValue(raw: string): TriggerSpec {
  const onMatch = /^(.*?)\s+on\s+(.+)$/i.exec(raw.trim());
  if (onMatch) {
    return { event: unquote(onMatch[1]), selector: unquote(onMatch[2].trim()) };
  }
  return { event: unquote(raw) };
}

/**
 * Parsea el contenido de un archivo `.webmcp.css` a un {@link ToolMap}.
 *
 * Reglas sin ninguna propiedad `webmcp-*` se ignoran (pueden convivir con
 * CSS visual normal). Una regla puede declarar una herramienta
 * (`webmcp-tool`) o un dato de contexto (`webmcp-context`), no ambos.
 *
 * Soporta reglas anidadas, variables CSS (`var(--x)`) y `@import` (si se
 * provee `options.resolveImport`; ver también {@link parseWebMCPFile}).
 *
 * @param css Contenido CSS.
 * @param options Opciones de parseo (imports, variables heredadas).
 * @returns El tool map extraído.
 * @throws {WebMCPParseError} Si el CSS es inválido o hay declaraciones malformadas.
 */
export function parseWebMCP(css: string, options: ParseOptions = {}): ToolMap {
  let root: Root;
  try {
    root = postcss.parse(css);
  } catch (err) {
    throw new WebMCPParseError(
      `CSS inválido: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const map: ToolMap = { tools: {}, context: {} };
  const vars: Record<string, string> = { ...(options.inheritedVars ?? {}) };
  const seen = options.seen ?? new Set<string>();

  // 1) Resolver @import (primero, para que el archivo actual pueda sobreescribir).
  root.walkAtRules('import', (at) => {
    if (!options.resolveImport) return;
    const spec = unquote(at.params.replace(/^url\((.*)\)$/i, '$1').trim());
    if (seen.has(spec)) {
      throw new WebMCPParseError(`@import circular detectado: "${spec}"`);
    }
    seen.add(spec);
    const imported = options.resolveImport(spec);
    const importedMap = parseWebMCP(imported, {
      ...options,
      inheritedVars: vars,
      seen,
    });
    Object.assign(map.tools, importedMap.tools);
    Object.assign(map.context, importedMap.context);
    // Las variables del import quedan disponibles vía collectVars más abajo.
    collectVars(postcss.parse(imported), vars);
  });

  // 2) Recolectar variables CSS de este archivo (sobrescriben las heredadas).
  collectVars(root, vars);

  // 3) Procesar reglas (incluidas las anidadas).
  root.walkRules((rule: Rule) => {
    const decls: Declaration[] = [];
    for (const node of rule.nodes ?? []) {
      if (node.type === 'decl' && node.prop.toLowerCase().startsWith(WEBMCP_PREFIX)) {
        decls.push(node);
      }
    }
    if (decls.length === 0) return;

    const selector = substituteVars(resolveSelector(rule), vars).trim();
    const line = rule.source?.start?.line;

    const toolDecl = decls.find((d) => d.prop.toLowerCase() === 'webmcp-tool');
    const contextDecl = decls.find((d) => d.prop.toLowerCase() === 'webmcp-context');

    if (toolDecl && contextDecl) {
      throw new WebMCPParseError(
        `La regla "${selector}" no puede declarar webmcp-tool y webmcp-context a la vez`,
        line,
      );
    }

    const val = (d: Declaration): string => substituteVars(d.value, vars);

    if (toolDecl) {
      const name = unquote(val(toolDecl));
      if (!name) throw new WebMCPParseError('webmcp-tool requiere un nombre', line);
      const tool: ToolSpec = { selector, params: {} };
      for (const d of decls) {
        const prop = d.prop.toLowerCase();
        if (prop === 'webmcp-tool') continue;
        if (prop.startsWith(PARAM_PREFIX)) {
          // Conservamos el caso original del nombre del parámetro.
          const paramName = d.prop.slice(PARAM_PREFIX.length);
          tool.params[paramName] = parseParamValue(val(d), d.source?.start?.line);
        } else if (prop === 'webmcp-confirmation') {
          const conf = unquote(val(d));
          // IA-First (v1.0.0): `webmcp-confirmation: needed | none` es una
          // política, no un selector; se conserva en meta.confirmation.
          if (CONFIRMATION_POLICIES.has(conf.toLowerCase())) {
            (tool.meta ??= {}).confirmation = conf.toLowerCase();
          } else {
            tool.confirmation = conf;
          }
        } else if (prop === 'webmcp-confirmation-selector') {
          // Forma explícita del selector de confirmación (IA-First lo usa
          // cuando `webmcp-confirmation` lleva la política needed|none).
          tool.confirmation = unquote(val(d));
        } else if (prop === 'webmcp-trigger') {
          tool.trigger = parseTriggerValue(val(d));
        } else if (prop === 'webmcp-description') {
          tool.description = unquote(val(d));
        } else if (prop === 'webmcp-fingerprint') {
          tool.fingerprint = safeParseFingerprint(d.value);
        } else if (prop.startsWith(WEBMCP_PREFIX)) {
          (tool.meta ??= {})[prop.slice(WEBMCP_PREFIX.length)] = unquote(val(d));
        }
      }
      map.tools[name] = tool;
      return;
    }

    if (contextDecl) {
      const name = unquote(val(contextDecl));
      if (!name) {
        throw new WebMCPParseError('webmcp-context requiere un nombre', line);
      }
      const ctx: ContextSpec = { selector };
      for (const d of decls) {
        const prop = d.prop.toLowerCase();
        if (prop === 'webmcp-context') continue;
        if (prop === 'webmcp-format') ctx.format = unquote(val(d));
        else if (prop === 'webmcp-fingerprint') ctx.fingerprint = safeParseFingerprint(d.value);
        else (ctx.meta ??= {})[prop.slice(WEBMCP_PREFIX.length)] = unquote(val(d));
      }
      map.context[name] = ctx;
    }
  });

  return map;
}

/**
 * Parsea un archivo `.webmcp.css` desde disco, resolviendo `@import` con
 * rutas relativas al archivo (con guardia anti-ciclos).
 *
 * @param filePath Ruta al archivo CSS.
 * @returns El tool map combinado (imports incluidos).
 */
export function parseWebMCPFile(filePath: string): ToolMap {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  const css = fs.readFileSync(abs, 'utf8');
  return parseWebMCP(css, {
    seen: new Set([abs]),
    resolveImport: (spec) => {
      const target = path.resolve(dir, spec);
      return fs.readFileSync(target, 'utf8');
    },
  });
}

/** Recolecta declaraciones `--variable: valor;` de todo el árbol. */
function collectVars(root: Root, vars: Record<string, string>): void {
  root.walkDecls((d) => {
    if (d.prop.startsWith('--')) vars[d.prop] = d.value.trim();
  });
}

/**
 * Parsea una huella serializada como JSON entre comillas (propiedad opcional
 * `webmcp-fingerprint`, escrita automáticamente por `webmcpcss generate`).
 * Devuelve `undefined` si el JSON es inválido en lugar de fallar.
 */
function safeParseFingerprint(raw: string): ToolSpec['fingerprint'] {
  try {
    return JSON.parse(unquote(raw).replace(/\\"/g, '"'));
  } catch {
    return undefined;
  }
}

/**
 * Serializa un {@link ParamSpec} a su representación CSS.
 * Los alias `data()`/`aria()` se emiten normalizados como `attr()`.
 * @param spec Especificación del parámetro.
 */
export function serializeParam(spec: ParamSpec): string {
  switch (spec.source) {
    case 'attr':
      return `attr(${spec.value ?? ''})`;
    case 'value':
      return `value(${spec.selector ?? ''})`;
    case 'text':
      return `text(${spec.selector ?? ''})`;
    case 'literal':
      return `"${spec.value ?? ''}"`;
  }
}

/**
 * Serializa un {@link ToolMap} de vuelta a formato `.webmcp.css`.
 * Usado por `webmcpcss repair` y `webmcpcss generate` para escribir en disco.
 *
 * @param map Tool map a serializar.
 * @returns Contenido CSS.
 */
export function serializeToolMap(map: ToolMap): string {
  const blocks: string[] = [
    '/* Generado por WebMCPcss - https://github.com/cochinoraptor/WebMCPcss */',
  ];

  for (const [name, tool] of Object.entries(map.tools)) {
    const lines: string[] = [`${tool.selector} {`];
    lines.push(`  webmcp-tool: "${name}";`);
    if (tool.description) lines.push(`  webmcp-description: "${tool.description}";`);
    for (const [pName, pSpec] of Object.entries(tool.params)) {
      lines.push(`  webmcp-param-${pName}: ${serializeParam(pSpec)};`);
    }
    if (tool.trigger) {
      const t = tool.trigger;
      // Los selectores con ':' (pseudo-clases) se citan para no romper postcss.
      const tSel = t.selector
        ? t.selector.includes(':')
          ? ` on "${t.selector}"`
          : ` on ${t.selector}`
        : '';
      lines.push(`  webmcp-trigger: "${t.event}"${tSel};`);
    }
    if (tool.confirmation) {
      const prop = tool.meta?.confirmation ? 'webmcp-confirmation-selector' : 'webmcp-confirmation';
      lines.push(`  ${prop}: ${quoteCss(tool.confirmation)};`);
    }
    if (tool.fingerprint) {
      lines.push(
        `  webmcp-fingerprint: '${JSON.stringify(tool.fingerprint).replace(/'/g, "\\'")}';`,
      );
    }
    lines.push(...serializeMeta(tool.meta));
    lines.push('}');
    blocks.push(lines.join('\n'));
  }

  for (const [name, ctx] of Object.entries(map.context)) {
    const lines: string[] = [`${ctx.selector} {`];
    lines.push(`  webmcp-context: "${name}";`);
    if (ctx.format) lines.push(`  webmcp-format: "${ctx.format}";`);
    if (ctx.fingerprint) {
      lines.push(
        `  webmcp-fingerprint: '${JSON.stringify(ctx.fingerprint).replace(/'/g, "\\'")}';`,
      );
    }
    lines.push(...serializeMeta(ctx.meta));
    lines.push('}');
    blocks.push(lines.join('\n'));
  }

  return blocks.join('\n\n') + '\n';
}

/** Cita un valor CSS eligiendo el tipo de comillas que no requiera escapes. */
function quoteCss(value: string): string {
  if (!value.includes('"')) return `"${value}"`;
  if (!value.includes("'")) return `'${value}'`;
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Serializa la bolsa de metadatos extendidos como declaraciones `webmcp-*`.
 * @param meta Metadatos (clave sin prefijo).
 */
function serializeMeta(meta: WebMCPMeta | undefined): string[] {
  if (!meta) return [];
  return Object.entries(meta).map(([key, value]) => `  webmcp-${key}: ${quoteCss(value)};`);
}
