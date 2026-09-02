/**
 * Análisis de fragilidad de selectores CSS.
 *
 * Detecta, mediante expresiones regulares y heurísticas, patrones típicos de
 * frameworks y librerías (clases generadas, hashes de scoping, utilidades)
 * y asigna un nivel de fragilidad con razones y sugerencias de migración.
 *
 * Escala de puntos: cada patrón aporta 1–3 puntos según gravedad.
 * 0–1 → `low`, 2–3 → `medium`, ≥4 → `high`. Un único patrón de gravedad 3
 * (p. ej. un hash de CSS-in-JS, que cambia en cada build) fuerza `high`.
 */
import { isTailwindClass } from '../tailwind/inspector';
import { suggestionsFor } from './suggestions';
import type { FragilityLevel, FragilityScore } from './types';

/** Patrón de detección: framework, regex, gravedad (1–3) y razón. */
interface Pattern {
  framework: string;
  regex: RegExp;
  severity: 1 | 2 | 3;
  reason: string;
  /** `true` si la gravedad 3 debe forzar nivel `high` por sí sola. */
  critical?: boolean;
}

/** Patrones de frameworks y librerías (orden: más específicos primero). */
const PATTERNS: Pattern[] = [
  // --- Scoping por framework (hashes que cambian en cada build) ---
  {
    framework: 'Vue (scoped)',
    regex: /\[data-v-[0-9a-f]{6,}\]|data-v-[0-9a-f]{6,}/,
    severity: 3,
    critical: true,
    reason: 'Atributo de scoping de Vue (data-v-*): cambia al recompilar el componente',
  },
  {
    framework: 'Svelte',
    regex: /\.svelte-[a-z0-9]{4,}/,
    severity: 3,
    critical: true,
    reason: 'Clase de scoping de Svelte (svelte-*): hash regenerado en cada build',
  },
  {
    framework: 'Angular',
    regex: /\[?_ng(content|host)-[a-z0-9-]+\]?/,
    severity: 3,
    critical: true,
    reason:
      'Atributo de encapsulación de Angular (_ngcontent/_nghost): generado por build',
  },
  {
    framework: 'styled-components',
    regex: /\.sc-[a-zA-Z0-9]{4,}/,
    severity: 3,
    critical: true,
    reason: 'Clase de styled-components (sc-*): hash inestable entre builds',
  },
  {
    framework: 'Emotion',
    regex: /\.css-[a-z0-9]{4,}/,
    severity: 3,
    critical: true,
    reason: 'Clase de Emotion (css-*): hash inestable entre builds',
  },
  {
    framework: 'CSS Modules',
    regex:
      /\.[A-Za-z][\w-]*(__|--)[A-Za-z0-9]*_{1,2}[A-Za-z0-9]{5,}|\.[A-Za-z][\w-]*_[A-Za-z0-9]{5,}_[A-Za-z0-9]{2,}/,
    severity: 3,
    critical: true,
    reason: 'Clase con hash de CSS Modules: cambia al recompilar',
  },
  {
    framework: 'JSS / MUI v4',
    regex: /\.jss\d+|\.makeStyles-[\w-]+-\d+/,
    severity: 3,
    critical: true,
    reason: 'Clase JSS/makeStyles con índice numérico: depende del orden de montaje',
  },
  {
    framework: 'React (useId)',
    regex: /#[«:]r[0-9a-z]+[»:]?|#:r[0-9a-z]+:/,
    severity: 3,
    critical: true,
    reason: 'ID generado por React useId (:r0:): distinto en cada render/sesión',
  },
  // --- Design systems (clases semiestables) ---
  {
    framework: 'MUI v5',
    regex: /\.Mui[A-Z][A-Za-z]*-[a-z][A-Za-z]*/,
    severity: 1,
    reason:
      'Clase de MUI (Mui*-slot): estable entre builds, pero acoplada a la versión de la librería',
  },
  {
    framework: 'Ant Design',
    regex: /\.ant-[a-z-]+/,
    severity: 1,
    reason:
      'Clase de Ant Design (ant-*): estable, pero puede cambiar entre versiones mayores',
  },
  {
    framework: 'Bootstrap',
    regex:
      /\.(btn|nav|navbar|col|row|card|form-control|modal|alert|badge|dropdown)(-[a-z0-9-]+)?(?![\w-])/,
    severity: 1,
    reason:
      'Clase de Bootstrap: estable, pero compartida por muchos elementos (poca especificidad semántica)',
  },
];

/** ¿El id parece autogenerado (uuid, hash hex, sufijo numérico largo)? */
const GENERATED_ID =
  /^#(?:[0-9a-f]{8}-[0-9a-f]{4}|[0-9a-f]{12,}|.*\d{4,})$|^#(ember|yui_|ext-|react-select-\d)/i;

/**
 * Analiza la fragilidad de un selector CSS.
 *
 * @param selector Selector CSS tal cual aparece en el `.webmcp.css`.
 * @param framework Framework principal declarado (opcional): añade una
 *   sugerencia específica aunque no se detecte por patrón.
 * @returns Nivel (`low`/`medium`/`high`), razones, sugerencias y frameworks.
 */
export function analyzeFragility(selector: string, framework?: string): FragilityScore {
  const reasons: string[] = [];
  const frameworks: string[] = [];
  let points = 0;
  let forcedHigh = false;

  for (const p of PATTERNS) {
    if (p.regex.test(selector)) {
      reasons.push(p.reason);
      frameworks.push(p.framework);
      points += p.severity;
      if (p.critical) forcedHigh = true;
    }
  }

  // --- Heurísticas estructurales (independientes de framework) ---
  const classTokens = selector.match(/\.([A-Za-z0-9_-]+)/g)?.map((c) => c.slice(1)) ?? [];
  const tailwindTokens = classTokens.filter((c) => isTailwindClass(c));
  if (tailwindTokens.length > 0) {
    frameworks.push('Tailwind CSS');
    reasons.push(
      `Utilidades de Tailwind como selector (${tailwindTokens.slice(0, 3).join(', ')}${tailwindTokens.length > 3 ? '…' : ''}): cambian con cada retoque visual`,
    );
    points += 2;
  }

  if (/:nth-(child|of-type)\(/.test(selector)) {
    reasons.push(
      'Usa :nth-child/:nth-of-type: depende del orden de los hermanos en el DOM',
    );
    points += 2;
  }

  const normalized = selector.replace(/\s*([>~+])\s*/g, '$1');
  const combinators = (normalized.match(/[>~+]|\s+/g) ?? []).length;
  if (combinators >= 3) {
    reasons.push(
      `Cadena de ${combinators + 1} niveles: cualquier cambio intermedio la rompe`,
    );
    points += 2;
  }

  const hasId = /#[A-Za-z_«:][\w«»:-]*/.test(selector);
  const hasClass = classTokens.length > 0;
  const hasAttr = /\[[^\]]+\]/.test(selector);
  if (!hasId && !hasClass && !hasAttr) {
    reasons.push('Selector solo de etiquetas (sin id, clase ni atributo): muy ambiguo');
    points += 2;
  }

  if (hasId && GENERATED_ID.test(selector.match(/#[\w«»:-]+/)?.[0] ?? '')) {
    reasons.push('El id parece autogenerado (hash/uuid/sufijo numérico): puede variar');
    points += 3;
    forcedHigh = true;
  }

  // --- Señales de estabilidad (informativas, no restan) ---
  if (/\[data-(?!v-)[\w-]+([~|^$*]?=)?/.test(selector)) {
    reasons.push(
      'Usa atributos data-*: el patrón más estable (contrato explícito con agentes)',
    );
  }

  const level: FragilityLevel =
    forcedHigh || points >= 4 ? 'high' : points >= 2 ? 'medium' : 'low';
  return {
    level,
    reasons,
    suggestions: suggestionsFor(selector, frameworks, level, framework),
    frameworks: [...new Set(frameworks)],
  };
}
