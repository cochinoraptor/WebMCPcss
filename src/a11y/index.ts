/**
 * A11y-MCP (v1.0.0): auditoría, corrección declarativa y validación
 * continua de accesibilidad.
 *
 * - `auditPage(page)` ejecuta {@link auditDocumentInPage} en Puppeteer.
 * - `summarizeAudit()` agrupa por regla/impacto y calcula una puntuación.
 * - `buildA11yToolMap()` convierte las correcciones en un `.webmcp.css`
 *   con propiedades `webmcp-accessibility` (aria-label, alt, title…) que
 *   un agente o el runtime pueden aplicar sin tocar el código fuente.
 * - `buildA11yFixScript()` genera JS que aplica esas correcciones en vivo.
 * - `buildA11yWorkflow()` produce un workflow de GitHub Actions para CI.
 */
import type { Page } from 'puppeteer';
import { serializeToolMap } from '../parser';
import type { ToolMap } from '../types';
import { VERSION } from '../version';
import {
  auditDocumentInPage,
  type A11yImpact,
  type A11yIssue,
  type A11yPageAudit,
} from './rules';

export {
  auditDocumentInPage,
  type A11yImpact,
  type A11yIssue,
  type A11yPageAudit,
} from './rules';

/** Resumen de auditoría. */
export interface A11ySummary {
  url: string;
  title: string;
  /** Puntuación 0-100 (100 = sin problemas). */
  score: number;
  total: number;
  byImpact: Record<A11yImpact, number>;
  byRule: Record<string, number>;
  issues: A11yIssue[];
  checked: Record<string, number>;
  generatedBy: string;
}

/** Pesos por impacto para la puntuación. */
const WEIGHTS: Record<A11yImpact, number> = {
  critical: 10,
  serious: 6,
  moderate: 3,
  minor: 1,
};

/**
 * Agrupa y puntúa el resultado de {@link auditDocumentInPage}.
 * @param audit Resultado crudo.
 */
export function summarizeAudit(audit: A11yPageAudit): A11ySummary {
  const byImpact: Record<A11yImpact, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };
  const byRule: Record<string, number> = {};
  let penalty = 0;
  for (const i of audit.issues) {
    byImpact[i.impact]++;
    byRule[i.rule] = (byRule[i.rule] ?? 0) + 1;
    penalty += WEIGHTS[i.impact];
  }
  const checkedTotal = Object.values(audit.checked).reduce((a, b) => a + b, 0) || 1;
  // Penalización relativa al número de comprobaciones (una página grande con
  // pocos fallos puntúa alto; una pequeña llena de fallos, bajo), acotada.
  const score = Math.max(
    0,
    Math.round(100 - Math.min(100, (penalty / Math.max(20, checkedTotal * 1.5)) * 100)),
  );
  return {
    url: audit.url,
    title: audit.title,
    score,
    total: audit.issues.length,
    byImpact,
    byRule,
    issues: audit.issues,
    checked: audit.checked,
    generatedBy: `webmcpcss@${VERSION}`,
  };
}

/**
 * Ejecuta la auditoría en una página de Puppeteer.
 * @param page Página ya navegada.
 */
export async function auditPage(page: Page): Promise<A11ySummary> {
  const audit = (await page.evaluate(
    auditDocumentInPage as unknown as (doc: Document) => A11yPageAudit,
    await page.evaluateHandle(() => document),
  )) as A11yPageAudit;
  return summarizeAudit(audit);
}

/**
 * Construye un `.webmcp.css` de correcciones: una regla por elemento con
 * `webmcp-accessibility: "attr: valor; attr2: valor2"` y `webmcp-a11y-rule`.
 * Los elementos se declaran como contexto (no son acciones).
 * @param summary Resumen de auditoría.
 */
export function buildA11yToolMap(summary: A11ySummary): ToolMap {
  const map: ToolMap = { tools: {}, context: {} };
  const bySelector = new Map<string, A11yIssue[]>();
  for (const i of summary.issues) {
    if (!i.fix?.attrs) continue;
    const list = bySelector.get(i.selector) ?? [];
    list.push(i);
    bySelector.set(i.selector, list);
  }
  let n = 1;
  for (const [selector, issues] of bySelector) {
    const attrs: Record<string, string> = {};
    for (const i of issues) Object.assign(attrs, i.fix?.attrs);
    const name = `a11y${String(n++).padStart(2, '0')}${issues[0].rule.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase())}`;
    map.context[name] = {
      selector,
      format: 'text',
      meta: {
        accessibility: Object.entries(attrs)
          .map(([k, v]) => `${k}: ${v.replace(/[;"]/g, ' ').trim()}`)
          .join('; '),
        'a11y-rule': [...new Set(issues.map((i) => i.rule))].join(','),
        'a11y-wcag': [...new Set(issues.map((i) => i.wcag))].join(','),
        'a11y-impact': issues
          .map((i) => i.impact)
          .sort((a, b) => WEIGHTS[b] - WEIGHTS[a])[0],
      },
    };
  }
  return map;
}

/**
 * Serializa el tool map de correcciones con cabecera explicativa.
 * @param summary Resumen.
 */
export function buildA11yCss(summary: A11ySummary): string {
  const map = buildA11yToolMap(summary);
  const header = [
    `/* Correcciones de accesibilidad generadas por webmcpcss a11y fix (v${VERSION}) */`,
    `/* ${summary.url || 'página'} · puntuación ${summary.score}/100 · ${summary.total} problemas */`,
    '/* Cada regla declara los atributos ARIA/alt/title que deben aplicarse al selector. */',
    '/* Aplícalas en vivo con el script de `a11y fix --script` o corrígelas en el código fuente. */',
    '',
  ].join('\n');
  return (
    header + serializeToolMap(map).replace(/^\/\* Generado por WebMCPcss[^\n]*\n\n?/, '')
  );
}

/**
 * Genera un script que aplica las correcciones (`webmcp-accessibility`) en
 * la página: útil como inyección temporal mientras se corrige el código.
 * @param map Tool map con `meta.accessibility`.
 */
export function buildA11yFixScript(map: ToolMap): string {
  const fixes = [...Object.values(map.tools), ...Object.values(map.context)]
    .filter((e) => e.meta?.accessibility)
    .map((e) => ({ selector: e.selector, attrs: e.meta!.accessibility }));
  return `(function(){
var FIXES = ${JSON.stringify(fixes).replace(/</g, '\\u003c')};
var applied = 0;
FIXES.forEach(function (f) {
  var els; try { els = document.querySelectorAll(f.selector); } catch (e) { return; }
  f.attrs.split(';').forEach(function (pair) {
    var i = pair.indexOf(':'); if (i < 0) return;
    var k = pair.slice(0, i).trim(), v = pair.slice(i + 1).trim();
    if (!k) return;
    // Atributos «de reemplazo» (tabindex, content, lang) se sobrescriben; los
    // de nombre accesible (alt, aria-label, title) solo se añaden si faltan.
    var replace = k === 'tabindex' || k === 'content' || k === 'lang';
    els.forEach(function (el) { if (replace ? el.getAttribute(k) !== v : (!el.hasAttribute(k) || !el.getAttribute(k))) { el.setAttribute(k, v); applied++; } });
  });
});
window.__WEBMCP_A11Y__ = { applied: applied, fixes: FIXES.length };
return applied;
})();`;
}

/** Opciones del workflow de CI. */
export interface A11yWorkflowOptions {
  /** URL(s) a auditar. */
  urls: string[];
  /** Puntuación mínima (def. 80). */
  minScore?: number;
  /** Fallar si hay problemas critical (def. true). */
  failOnCritical?: boolean;
}

/**
 * Genera un workflow de GitHub Actions que audita accesibilidad en cada PR.
 * @param opts URLs y umbrales.
 */
export function buildA11yWorkflow(opts: A11yWorkflowOptions): string {
  const min = opts.minScore ?? 80;
  const failCritical = opts.failOnCritical !== false;
  return `name: Accesibilidad (WebMCPcss a11y)

on:
  pull_request:
  workflow_dispatch:

jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm i -g webmcpcss@${VERSION.split('.')[0]}
      - name: Auditar
        run: |
${opts.urls.map((u) => `          webmcpcss a11y audit --url "${u}" --min-score ${min}${failCritical ? ' --fail-on critical' : ''} --json > a11y-$(echo "${u}" | tr -c 'a-zA-Z0-9' '_').json`).join('\n')}
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: a11y-reports
          path: a11y-*.json
`;
}

/**
 * Determina si una auditoría supera los umbrales (para CI).
 * @param summary Resumen.
 * @param minScore Puntuación mínima.
 * @param failOn Impacto máximo tolerado (`critical` = falla solo con critical).
 */
export function passesThresholds(
  summary: A11ySummary,
  minScore = 80,
  failOn: A11yImpact | 'none' = 'critical',
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (summary.score < minScore) reasons.push(`puntuación ${summary.score} < ${minScore}`);
  if (failOn !== 'none') {
    const order: A11yImpact[] = ['critical', 'serious', 'moderate', 'minor'];
    const idx = order.indexOf(failOn);
    for (const imp of order.slice(0, idx + 1))
      if (summary.byImpact[imp] > 0)
        reasons.push(`${summary.byImpact[imp]} problema(s) ${imp}`);
  }
  return { ok: reasons.length === 0, reasons };
}
