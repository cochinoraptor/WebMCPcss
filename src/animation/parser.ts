/**
 * Parser de reglas `webmcp-animation-*` en archivos `.webmcp.css`.
 *
 * Reutiliza el pipeline PostCSS del parser principal (selectores anidados,
 * `&`, variables `var(--x)`, `@import`) y añade las propiedades del
 * estándar de animaciones:
 *
 * ```css
 * .hero {
 *   webmcp-animation: "heroParallax";          /* nombre (obligatorio) *\/
 *   webmcp-animation-type: parallax;           /* parallax | isometric | 3d-transform | keyframes | three-scene *\/
 *   webmcp-animation-priority: high;           /* low | normal | high | critical *\/
 *   webmcp-animation-selector: ".hero";        /* opcional: por defecto el selector de la regla *\/
 *   webmcp-animation-engine: auto;             /* auto | css | waapi | three *\/
 *   webmcp-animation-trigger: scroll;          /* load | scroll | hover | click | visible | manual *\/
 *   webmcp-animation-conflict: queue;          /* replace | queue | ignore | merge *\/
 *   webmcp-animation-sandbox: shadow;          /* none | shadow *\/
 *   webmcp-animation-duration: 1.2s;           /* atajos de parámetros… *\/
 *   webmcp-animation-easing: ease-out;
 *   webmcp-animation-params: '{"layers":[{"selector":".bg","speed":0.2}]}';  /* JSON *\/
 *   webmcp-animation-fallback: "heroFade";     /* nombre de otra animación *\/
 *   webmcp-animation-description: "Parallax del hero";
 * }
 * ```
 *
 * Los parámetros pueden darse como atajos (`webmcp-animation-duration`) o
 * como JSON en `webmcp-animation-params`; los atajos tienen prioridad.
 */
import * as fs from 'fs';
import * as path from 'path';
import postcss, { Declaration, Rule, Root } from 'postcss';
import {
  resolveSelector,
  substituteVars,
  unquote,
  WebMCPParseError,
} from '../parser/css-parser';
import { AnimationConfigError, parseDuration, validateConfig } from './config-validation';
import {
  ANIMATION_PRIORITIES,
  ANIMATION_TRIGGERS,
  ANIMATION_TYPES,
  CONFLICT_STRATEGIES,
  type AnimationConfig,
  type AnimationKeyframe,
  type AnimationMap,
  type AnimationParameters,
  type AnimationPriority,
  type AnimationTrigger,
  type AnimationType,
  type ConflictStrategy,
  type EnginePreference,
  type LayerConfig,
  type SandboxMode,
  type ThreeSceneConfig,
} from './types';

/** Prefijo de las propiedades del estándar. */
export const ANIMATION_PREFIX = 'webmcp-animation';

/** Atajos `webmcp-animation-<x>` que se vuelcan directamente a `parameters`. */
const PARAM_SHORTCUTS = new Set([
  'duration',
  'delay',
  'easing',
  'iterations',
  'direction',
  'fill',
  'perspective',
  'rotation-x',
  'rotation-y',
  'rotation-z',
  'translation-z',
  'scale',
  'scroll-container',
]);

/** Opciones de {@link parseAnimations}. */
export interface AnimationParseOptions {
  /** Resuelve el contenido de un `@import "spec";`. */
  resolveImport?: (spec: string) => string;
  /** Variables CSS heredadas (uso interno). */
  inheritedVars?: Record<string, string>;
  /** Guardia anti-ciclos (uso interno). */
  seen?: Set<string>;
}

/**
 * Parsea un CSS y devuelve las animaciones declaradas.
 *
 * @param css Contenido del archivo `.webmcp.css`.
 * @param options Opciones (resolución de `@import`).
 * @returns Mapa de animaciones con avisos no fatales.
 * @throws {WebMCPParseError} Si el CSS es inválido o una declaración es incoherente.
 */
export function parseAnimations(
  css: string,
  options: AnimationParseOptions = {},
): AnimationMap {
  let root: Root;
  try {
    root = postcss.parse(css);
  } catch (err) {
    throw new WebMCPParseError(
      `CSS inválido: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const map: AnimationMap = { animations: {}, warnings: [] };
  const vars: Record<string, string> = { ...(options.inheritedVars ?? {}) };
  const seen = options.seen ?? new Set<string>();

  root.walkAtRules('import', (at) => {
    if (!options.resolveImport) return;
    const spec = unquote(at.params.replace(/^url\((.*)\)$/i, '$1').trim());
    if (seen.has(spec))
      throw new WebMCPParseError(`@import circular detectado: "${spec}"`);
    seen.add(spec);
    const imported = options.resolveImport(spec);
    const sub = parseAnimations(imported, { ...options, inheritedVars: vars, seen });
    Object.assign(map.animations, sub.animations);
    map.warnings.push(...sub.warnings);
    collectVars(postcss.parse(imported), vars);
  });
  collectVars(root, vars);

  const pendingFallbacks: Array<{ owner: string; ref: string; line?: number }> = [];

  root.walkRules((rule: Rule) => {
    const decls = (rule.nodes ?? []).filter(
      (n): n is Declaration =>
        n.type === 'decl' && n.prop.toLowerCase().startsWith(ANIMATION_PREFIX),
    );
    if (decls.length === 0) return;
    const line = rule.source?.start?.line;
    const val = (d: Declaration): string => substituteVars(d.value, vars).trim();
    const byProp = new Map<string, Declaration>();
    for (const d of decls) byProp.set(d.prop.toLowerCase(), d);

    const nameDecl =
      byProp.get(ANIMATION_PREFIX) ?? byProp.get(`${ANIMATION_PREFIX}-name`);
    if (!nameDecl) {
      throw new WebMCPParseError(
        `La regla "${rule.selector}" usa propiedades webmcp-animation-* pero no declara webmcp-animation: "nombre"`,
        line,
      );
    }
    const name = unquote(val(nameDecl));
    if (!/^[A-Za-z_][\w-]*$/.test(name)) {
      throw new WebMCPParseError(
        `Nombre de animación inválido: "${name}" (usa letras, dígitos, _ o -)`,
        line,
      );
    }
    if (map.animations[name]) {
      map.warnings.push(
        `Animación "${name}" redeclarada (línea ${line ?? '?'}); se sobrescribe.`,
      );
    }

    const ruleSelector = substituteVars(resolveSelector(rule), vars).trim();
    const selectorDecl = byProp.get(`${ANIMATION_PREFIX}-selector`);
    const selector = selectorDecl ? unquote(val(selectorDecl)) : ruleSelector;

    const typeDecl = byProp.get(`${ANIMATION_PREFIX}-type`);
    const type = parseEnum<AnimationType>(
      typeDecl ? unquote(val(typeDecl)) : 'keyframes',
      ANIMATION_TYPES,
      'webmcp-animation-type',
      line,
    );
    const priorityDecl = byProp.get(`${ANIMATION_PREFIX}-priority`);
    const priority = parseEnum<AnimationPriority>(
      priorityDecl ? unquote(val(priorityDecl)) : 'normal',
      ANIMATION_PRIORITIES,
      'webmcp-animation-priority',
      line,
    );

    // Parámetros: JSON primero, atajos después (los atajos ganan).
    let parameters: AnimationParameters = {};
    const paramsDecl = byProp.get(`${ANIMATION_PREFIX}-params`);
    if (paramsDecl) parameters = { ...parseJsonParams(unquote(val(paramsDecl)), line) };
    const keyframesDecl = byProp.get(`${ANIMATION_PREFIX}-keyframes`);
    if (keyframesDecl)
      parameters.keyframes = parseKeyframesValue(unquote(val(keyframesDecl)), line);
    const layersDecl = byProp.get(`${ANIMATION_PREFIX}-layers`);
    if (layersDecl) parameters.layers = parseLayersValue(unquote(val(layersDecl)), line);
    const sceneDecl = byProp.get(`${ANIMATION_PREFIX}-scene`);
    if (sceneDecl)
      parameters.sceneConfig = parseSceneValue(unquote(val(sceneDecl)), line);

    for (const [prop, d] of byProp) {
      const key = prop.slice(ANIMATION_PREFIX.length + 1);
      if (!PARAM_SHORTCUTS.has(key)) continue;
      const raw = unquote(val(d));
      const camel = key.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      if (key === 'iterations') {
        parameters.iterations =
          raw === 'infinite' ? 'infinite' : toNumber(raw, prop, line);
      } else if (key === 'scale') {
        parameters.scale = toNumber(raw, prop, line);
      } else {
        (parameters as Record<string, unknown>)[camel] = raw;
      }
    }

    const config: AnimationConfig = { name, type, priority, selector, parameters, line };

    const engineDecl = byProp.get(`${ANIMATION_PREFIX}-engine`);
    if (engineDecl) {
      config.engine = parseEnum<EnginePreference>(
        unquote(val(engineDecl)),
        ['auto', 'css', 'waapi', 'three'],
        'webmcp-animation-engine',
        line,
      );
    }
    const triggerDecl = byProp.get(`${ANIMATION_PREFIX}-trigger`);
    if (triggerDecl) {
      config.trigger = parseEnum<AnimationTrigger>(
        unquote(val(triggerDecl)),
        ANIMATION_TRIGGERS,
        'webmcp-animation-trigger',
        line,
      );
    }
    const conflictDecl = byProp.get(`${ANIMATION_PREFIX}-conflict`);
    if (conflictDecl) {
      config.conflict = parseEnum<ConflictStrategy>(
        unquote(val(conflictDecl)),
        CONFLICT_STRATEGIES,
        'webmcp-animation-conflict',
        line,
      );
    }
    const sandboxDecl = byProp.get(`${ANIMATION_PREFIX}-sandbox`);
    if (sandboxDecl) {
      config.sandbox = parseEnum<SandboxMode>(
        unquote(val(sandboxDecl)),
        ['none', 'shadow'],
        'webmcp-animation-sandbox',
        line,
      );
    }
    const descDecl = byProp.get(`${ANIMATION_PREFIX}-description`);
    if (descDecl) config.description = unquote(val(descDecl));
    const fallbackDecl = byProp.get(`${ANIMATION_PREFIX}-fallback`);
    if (fallbackDecl) {
      const raw = unquote(val(fallbackDecl));
      if (raw.startsWith('{')) {
        config.fallback = inlineFallback(config, parseJsonParams(raw, line), line);
      } else {
        pendingFallbacks.push({ owner: name, ref: raw, line });
      }
    }

    try {
      validateConfig(config, map.warnings);
    } catch (err) {
      if (err instanceof AnimationConfigError)
        throw new WebMCPParseError(err.message, err.line);
      throw err;
    }
    map.animations[name] = config;
  });

  // Fallbacks por referencia a otra animación (se resuelven al final para
  // permitir declararla después). Se copia sin su propio fallback para
  // evitar ciclos.
  for (const { owner, ref, line } of pendingFallbacks) {
    const target = map.animations[ref];
    if (!target) {
      throw new WebMCPParseError(
        `webmcp-animation-fallback de "${owner}" referencia una animación inexistente: "${ref}"`,
        line,
      );
    }
    if (ref === owner) {
      throw new WebMCPParseError(`"${owner}" no puede ser su propio fallback`, line);
    }
    const { fallback: _omit, ...copy } = target;
    map.animations[owner].fallback = {
      ...copy,
      selector: map.animations[owner].selector,
    };
  }

  return map;
}

/**
 * Parsea un archivo `.webmcp.css` desde disco resolviendo `@import` relativos.
 * @param filePath Ruta del archivo.
 */
export function parseAnimationsFile(filePath: string): AnimationMap {
  const abs = path.resolve(filePath);
  const css = fs.readFileSync(abs, 'utf8');
  const base = path.dirname(abs);
  return parseAnimations(css, {
    resolveImport: (spec) => fs.readFileSync(path.resolve(base, spec), 'utf8'),
    seen: new Set([abs]),
  });
}

/**
 * Serializa un {@link AnimationMap} a CSS con propiedades `webmcp-animation-*`
 * (útil para generar archivos desde código o desde agentes).
 * @param map Mapa de animaciones.
 */
export function serializeAnimations(map: AnimationMap): string {
  const blocks: string[] = [];
  for (const a of Object.values(map.animations)) {
    const lines = [
      `  webmcp-animation: "${a.name}";`,
      `  webmcp-animation-type: ${a.type};`,
      `  webmcp-animation-priority: ${a.priority};`,
    ];
    if (a.engine) lines.push(`  webmcp-animation-engine: ${a.engine};`);
    if (a.trigger) lines.push(`  webmcp-animation-trigger: ${a.trigger};`);
    if (a.conflict) lines.push(`  webmcp-animation-conflict: ${a.conflict};`);
    if (a.sandbox) lines.push(`  webmcp-animation-sandbox: ${a.sandbox};`);
    if (a.description) lines.push(`  webmcp-animation-description: "${a.description}";`);
    if (a.fallback) {
      const fb = a.fallback;
      const inline = fb.name === `${a.name}__fallback` || !map.animations[fb.name];
      lines.push(
        inline
          ? `  webmcp-animation-fallback: '${JSON.stringify({
              type: fb.type,
              ...(fb.engine ? { engine: fb.engine } : {}),
              ...(fb.priority !== a.priority ? { priority: fb.priority } : {}),
              ...fb.parameters,
            })}';`
          : `  webmcp-animation-fallback: "${fb.name}";`,
      );
    }
    if (Object.keys(a.parameters).length > 0) {
      lines.push(`  webmcp-animation-params: '${JSON.stringify(a.parameters)}';`);
    }
    blocks.push(`${a.selector} {\n${lines.join('\n')}\n}`);
  }
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

/** Recolecta variables CSS (`--x: valor`) de todas las reglas. */
function collectVars(root: Root, vars: Record<string, string>): void {
  root.walkDecls((d) => {
    if (d.prop.startsWith('--')) vars[d.prop] = d.value.trim();
  });
}

/** Valida un valor contra un conjunto cerrado. */
function parseEnum<T extends string>(
  raw: string,
  allowed: readonly string[],
  prop: string,
  line?: number,
): T {
  const v = raw.trim().toLowerCase();
  if (!allowed.includes(v)) {
    throw new WebMCPParseError(
      `${prop}: valor "${raw}" no válido. Permitidos: ${allowed.join(', ')}`,
      line,
    );
  }
  return v as T;
}

/** Convierte a número o lanza un error de parseo. */
function toNumber(raw: string, prop: string, line?: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n))
    throw new WebMCPParseError(`${prop}: "${raw}" no es un número`, line);
  return n;
}

/** Parsea el JSON de `webmcp-animation-params`. */
function parseJsonParams(raw: string, line?: number): AnimationParameters {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('debe ser un objeto JSON');
    }
    return parsed as AnimationParameters;
  } catch (err) {
    throw new WebMCPParseError(
      `webmcp-animation-params: JSON inválido (${(err as Error).message})`,
      line,
    );
  }
}

/** Parsea `webmcp-animation-keyframes` (JSON array). */
function parseKeyframesValue(raw: string, line?: number): AnimationKeyframe[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('debe ser un array');
    return parsed as AnimationKeyframe[];
  } catch (err) {
    throw new WebMCPParseError(
      `webmcp-animation-keyframes: JSON inválido (${(err as Error).message})`,
      line,
    );
  }
}

/**
 * Parsea `webmcp-animation-layers`: JSON array o forma corta
 * `".bg" 0.2, ".mid" 0.5, ".fg" 1`.
 */
function parseLayersValue(raw: string, line?: number): LayerConfig[] {
  const v = raw.trim();
  if (v.startsWith('[')) {
    try {
      return JSON.parse(v) as LayerConfig[];
    } catch (err) {
      throw new WebMCPParseError(
        `webmcp-animation-layers: JSON inválido (${(err as Error).message})`,
        line,
      );
    }
  }
  return v
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(.+?)\s+([\d.]+)(?:\s+(\S+))?$/.exec(part);
      if (!m) {
        throw new WebMCPParseError(
          `webmcp-animation-layers: capa "${part}" inválida (usa "<selector> <velocidad> [profundidad]")`,
          line,
        );
      }
      const layer: LayerConfig = { selector: unquote(m[1]), speed: Number(m[2]) };
      if (m[3]) layer.depth = m[3];
      return layer;
    });
}

/** Parsea `webmcp-animation-scene` (JSON). */
function parseSceneValue(raw: string, line?: number): ThreeSceneConfig {
  try {
    const parsed = JSON.parse(raw) as ThreeSceneConfig;
    if (!parsed || typeof parsed !== 'object') throw new Error('debe ser un objeto');
    return parsed;
  } catch (err) {
    throw new WebMCPParseError(
      `webmcp-animation-scene: JSON inválido (${(err as Error).message})`,
      line,
    );
  }
}

/** Construye un fallback inline (`{"type":"keyframes",...}`) heredando del padre. */
function inlineFallback(
  owner: AnimationConfig,
  raw: AnimationParameters & { type?: string; engine?: string; priority?: string },
  line?: number,
): AnimationConfig {
  const { type, engine, priority, ...params } = raw;
  const fb: AnimationConfig = {
    name: `${owner.name}__fallback`,
    type: type
      ? parseEnum<AnimationType>(type, ANIMATION_TYPES, 'fallback.type', line)
      : 'keyframes',
    priority: priority
      ? parseEnum<AnimationPriority>(
          priority,
          ANIMATION_PRIORITIES,
          'fallback.priority',
          line,
        )
      : owner.priority,
    selector: owner.selector,
    parameters: params,
    line,
  };
  if (engine) {
    fb.engine = parseEnum<EnginePreference>(
      engine,
      ['auto', 'css', 'waapi', 'three'],
      'fallback.engine',
      line,
    );
  }
  return fb;
}

export { parseDuration, validateConfig };
