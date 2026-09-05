/**
 * Test-MCP (v1.0.0): generación automática de pruebas a partir de un
 * `.webmcp.css` y ejecución de un plan de pruebas contra una URL.
 *
 * - `buildTestPlan(map)` deriva casos de prueba deterministas de cada tool
 *   y contexto (existencia del selector, parámetros, confirmación, contexto
 *   con formato esperado).
 * - `generateTests(map, { framework })` emite código Playwright (TS) o
 *   Cypress (JS) listo para ejecutar en el repositorio del usuario.
 * - `runTestPlan(plan, { page })` ejecuta el plan con Puppeteer (sin
 *   dependencias nuevas) y devuelve un informe JUnit-compatible.
 * - `buildTestWorkflow()` genera el workflow de GitHub Actions.
 */
import type { Page } from 'puppeteer';
import type { ContextSpec, ParamSpec, ToolMap, ToolSpec } from '../types';
import { VERSION } from '../version';

/**
 * Selector asociado a un parámetro (o `null` si es un atributo/literal sin
 * selector propio, en cuyo caso no hay nada que comprobar en el DOM).
 * @param spec Especificación del parámetro.
 * @param toolSelector Selector de la tool (por defecto para `attr`).
 */
export function paramSelector(spec: ParamSpec, toolSelector: string): string | null {
  if (spec.selector) return spec.selector;
  if (spec.source === 'attr') return toolSelector;
  return null;
}

/**
 * Mapa `param → selector` de los parámetros comprobables de una tool.
 * @param tool Tool.
 */
export function paramSelectors(tool: ToolSpec): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, spec] of Object.entries(tool.params ?? {})) {
    const sel = paramSelector(spec, tool.selector);
    if (sel) out[name] = sel;
  }
  return out;
}

/** Framework de salida. */
export type TestFramework = 'playwright' | 'cypress';

/** Tipo de caso. */
export type TestKind =
  | 'tool-exists'
  | 'tool-params'
  | 'tool-confirmation'
  | 'context-exists'
  | 'context-format'
  | 'tool-execute';

/** Caso de prueba. */
export interface TestCase {
  id: string;
  kind: TestKind;
  name: string;
  target: string;
  selector: string;
  /** Selectores de parámetros (tool-params). */
  params?: Record<string, string>;
  /** Formato esperado del contexto. */
  format?: string;
  /** Selector de confirmación. */
  confirmation?: string;
  /** Datos de ejemplo para ejecución (tool-execute). */
  sample?: Record<string, string>;
  /** Si es seguro ejecutar (no pagos/eliminaciones/confirmación). */
  safe: boolean;
}

/** Plan de pruebas. */
export interface TestPlan {
  generatedBy: string;
  source?: string;
  cases: TestCase[];
}

/** Resultado de un caso. */
export interface TestResult {
  id: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  message?: string;
}

/** Informe de ejecución. */
export interface TestReport {
  url: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
  startedAt: string;
  durationMs: number;
}

const DANGEROUS =
  /pagar|pay|checkout|comprar|buy|eliminar|delete|borrar|remove|transfer|enviar|send|submit|publicar|publish|confirmar/i;

/**
 * Deriva un plan de pruebas de un tool map.
 * @param map Tool map parseado.
 * @param opts `source` (ruta del css) y `execute` para incluir casos de ejecución seguros.
 */
export function buildTestPlan(
  map: ToolMap,
  opts: { source?: string; execute?: boolean } = {},
): TestPlan {
  const cases: TestCase[] = [];
  let n = 0;
  const id = () => `tc${String(++n).padStart(3, '0')}`;
  for (const [name, tool] of Object.entries(map.tools) as [string, ToolSpec][]) {
    const dangerous =
      DANGEROUS.test(name) ||
      DANGEROUS.test(tool.description ?? '') ||
      Boolean(tool.confirmation) ||
      tool.meta?.payment === 'required';
    const params = paramSelectors(tool);
    const fillable: Record<string, string> = {};
    for (const [p, spec] of Object.entries(tool.params ?? {}))
      if (spec.source === 'value' && spec.selector) fillable[p] = spec.selector;
    cases.push({
      id: id(),
      kind: 'tool-exists',
      name: `tool "${name}" existe (${tool.selector})`,
      target: name,
      selector: tool.selector,
      safe: true,
    });
    if (Object.keys(params).length)
      cases.push({
        id: id(),
        kind: 'tool-params',
        name: `tool "${name}" tiene sus ${Object.keys(params).length} parámetro(s)`,
        target: name,
        selector: tool.selector,
        params,
        safe: true,
      });
    if (tool.confirmation && !/^(needed|none)$/.test(tool.confirmation))
      cases.push({
        id: id(),
        kind: 'tool-confirmation',
        name: `tool "${name}" declara confirmación ${tool.confirmation}`,
        target: name,
        selector: tool.selector,
        confirmation: tool.confirmation,
        safe: true,
      });
    if (opts.execute && !dangerous && Object.keys(fillable).length) {
      const sample: Record<string, string> = {};
      for (const p of Object.keys(fillable)) sample[p] = sampleFor(p);
      cases.push({
        id: id(),
        kind: 'tool-execute',
        name: `tool "${name}" se ejecuta con datos de ejemplo`,
        target: name,
        selector: tool.selector,
        params: fillable,
        sample,
        safe: true,
      });
    }
  }
  for (const [name, ctx] of Object.entries(map.context) as [string, ContextSpec][]) {
    cases.push({
      id: id(),
      kind: 'context-exists',
      name: `contexto "${name}" existe (${ctx.selector})`,
      target: name,
      selector: ctx.selector,
      safe: true,
    });
    if (ctx.format && ctx.format !== 'text')
      cases.push({
        id: id(),
        kind: 'context-format',
        name: `contexto "${name}" tiene formato ${ctx.format}`,
        target: name,
        selector: ctx.selector,
        format: ctx.format,
        safe: true,
      });
  }
  return { generatedBy: `webmcpcss@${VERSION}`, source: opts.source, cases };
}

/**
 * Valor de ejemplo para un parámetro por su nombre.
 * @param param Nombre del parámetro.
 */
export function sampleFor(param: string): string {
  const p = param.toLowerCase();
  if (/mail/.test(p)) return 'agente@example.com';
  if (/pass|contrase/.test(p)) return 'Secreta123!';
  if (/tel|phone|movil/.test(p)) return '+57 300 000 0000';
  if (/fecha|date/.test(p)) return '2026-01-15';
  if (/cantidad|qty|quantity|num|count/.test(p)) return '1';
  if (/precio|price|amount|importe/.test(p)) return '10';
  if (/url|web|sitio/.test(p)) return 'https://example.com';
  if (/nombre|name/.test(p)) return 'Agente WebMCP';
  if (/query|busq|search|q$/.test(p)) return 'webmcp';
  if (/mensaje|message|comentario|comment|texto|body/.test(p))
    return 'Mensaje de prueba generado por webmcpcss test.';
  return 'prueba';
}

/**
 * Comprueba un valor contra un formato de contexto.
 * @param value Texto extraído.
 * @param format Formato declarado.
 */
export function matchesFormat(value: string, format: string): boolean {
  const v = value.trim();
  switch (format) {
    case 'currency':
      return (
        /(\p{Sc}|[A-Z]{3})?\s?-?\d[\d.,]*\s?(\p{Sc}|[A-Z]{3})?/u.test(v) && /\d/.test(v)
      );
    case 'number':
      return /-?\d[\d.,]*/.test(v);
    case 'date':
      return /\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}\s+de\s+\w+|\b(19|20)\d{2}\b/i.test(
        v,
      );
    case 'list':
      return v.length > 0;
    case 'boolean':
      return /^(true|false|s[ií]|no|yes|1|0|on|off)$/i.test(v);
    case 'url':
      return /^https?:\/\//i.test(v);
    case 'email':
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
    default:
      return v.length > 0;
  }
}

const q = (s: string) => JSON.stringify(s);

/**
 * Genera el código de pruebas.
 * @param map Tool map.
 * @param opts Framework, URL base, ruta del css.
 */
export function generateTests(
  map: ToolMap,
  opts: {
    framework?: TestFramework;
    url?: string;
    source?: string;
    execute?: boolean;
  } = {},
): { code: string; plan: TestPlan; filename: string } {
  const plan = buildTestPlan(map, { source: opts.source, execute: opts.execute });
  const framework = opts.framework ?? 'playwright';
  const url = opts.url ?? 'http://localhost:3000';
  const code =
    framework === 'cypress' ? renderCypress(plan, url) : renderPlaywright(plan, url);
  return {
    code,
    plan,
    filename: framework === 'cypress' ? 'webmcp.cy.js' : 'webmcp.spec.ts',
  };
}

function renderPlaywright(plan: TestPlan, url: string): string {
  const lines: string[] = [
    `// Generado por webmcpcss test generate (${plan.generatedBy})${plan.source ? ` desde ${plan.source}` : ''}`,
    `// Ejecuta: npx playwright test webmcp.spec.ts   (BASE_URL=${url})`,
    `import { test, expect } from '@playwright/test';`,
    '',
    `const BASE_URL = process.env.BASE_URL ?? ${q(url)};`,
    '',
    `test.describe('WebMCPcss · contrato .webmcp.css', () => {`,
    `  test.beforeEach(async ({ page }) => {`,
    `    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });`,
    `  });`,
    '',
  ];
  for (const c of plan.cases) {
    lines.push(`  test(${q(`${c.id} ${c.name}`)}, async ({ page }) => {`);
    switch (c.kind) {
      case 'tool-exists':
      case 'context-exists':
        lines.push(
          `    await expect(page.locator(${q(c.selector)}).first()).toBeAttached();`,
        );
        break;
      case 'tool-params':
        for (const [p, sel] of Object.entries(c.params ?? {}))
          lines.push(
            `    await expect(page.locator(${q(sel)}).first(), ${q(`parámetro ${p}`)}).toBeAttached();`,
          );
        break;
      case 'tool-confirmation':
        lines.push(
          `    // La confirmación puede aparecer solo tras la acción; comprobamos que el selector es válido.`,
        );
        lines.push(
          `    expect(() => page.locator(${q(c.confirmation ?? '')})).not.toThrow();`,
        );
        break;
      case 'context-format': {
        lines.push(
          `    const value = (await page.locator(${q(c.selector)}).first().textContent()) ?? '';`,
        );
        lines.push(
          `    expect(value, ${q(`formato ${c.format}`)}).toMatch(${formatRegexSource(c.format ?? 'text')});`,
        );
        break;
      }
      case 'tool-execute':
        for (const [p, sel] of Object.entries(c.params ?? {}))
          lines.push(
            `    await page.locator(${q(sel)}).first().fill(${q(c.sample?.[p] ?? 'prueba')});`,
          );
        lines.push(`    await page.locator(${q(c.selector)}).first().click();`);
        lines.push(`    await page.waitForLoadState('domcontentloaded');`);
        lines.push(`    expect(page.url()).toBeTruthy();`);
        break;
    }
    lines.push(`  });`, '');
  }
  lines.push('});', '');
  return lines.join('\n');
}

function renderCypress(plan: TestPlan, url: string): string {
  const lines: string[] = [
    `// Generado por webmcpcss test generate (${plan.generatedBy})${plan.source ? ` desde ${plan.source}` : ''}`,
    `// Ejecuta: npx cypress run --spec webmcp.cy.js   (CYPRESS_BASE_URL=${url})`,
    `const BASE_URL = Cypress.env('BASE_URL') || ${q(url)};`,
    '',
    `describe('WebMCPcss · contrato .webmcp.css', () => {`,
    `  beforeEach(() => {`,
    `    cy.visit(BASE_URL);`,
    `  });`,
    '',
  ];
  for (const c of plan.cases) {
    lines.push(`  it(${q(`${c.id} ${c.name}`)}, () => {`);
    switch (c.kind) {
      case 'tool-exists':
      case 'context-exists':
        lines.push(`    cy.get(${q(c.selector)}).should('exist');`);
        break;
      case 'tool-params':
        for (const [, sel] of Object.entries(c.params ?? {}))
          lines.push(`    cy.get(${q(sel)}).should('exist');`);
        break;
      case 'tool-confirmation':
        lines.push(
          `    cy.document().then((doc) => expect(() => doc.querySelector(${q(c.confirmation ?? '')})).not.to.throw());`,
        );
        break;
      case 'context-format':
        lines.push(
          `    cy.get(${q(c.selector)}).first().invoke('text').should('match', ${formatRegexSource(c.format ?? 'text')});`,
        );
        break;
      case 'tool-execute':
        for (const [p, sel] of Object.entries(c.params ?? {}))
          lines.push(
            `    cy.get(${q(sel)}).first().clear().type(${q(c.sample?.[p] ?? 'prueba')});`,
          );
        lines.push(`    cy.get(${q(c.selector)}).first().click();`);
        lines.push(`    cy.location('href').should('be.a', 'string');`);
        break;
    }
    lines.push(`  });`, '');
  }
  lines.push('});', '');
  return lines.join('\n');
}

/**
 * Fuente de expresión regular (literal JS) para un formato.
 * @param format Formato.
 */
export function formatRegexSource(format: string): string {
  switch (format) {
    case 'currency':
      return '/\\d/';
    case 'number':
      return '/-?\\d[\\d.,]*/';
    case 'date':
      return '/\\d{1,4}[-/.]\\d{1,2}[-/.]\\d{1,4}|\\d{1,2}\\s+de\\s+\\w+|(19|20)\\d{2}/i';
    case 'boolean':
      return '/^(true|false|s[ií]|no|yes|1|0|on|off)$/i';
    case 'url':
      return '/^https?:\\/\\//i';
    case 'email':
      return '/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/';
    default:
      return '/\\S/';
  }
}

/** Sonda mínima de página para ejecutar un plan (Puppeteer o cualquier implementación). */
export interface TestProbe {
  url: () => string;
  count: (selector: string) => Promise<number>;
  text: (selector: string) => Promise<string | null>;
  fill?: (selector: string, value: string) => Promise<void>;
  click?: (selector: string) => Promise<void>;
}

/**
 * Sonda basada en Puppeteer.
 * @param page Página navegada.
 */
export function puppeteerProbe(page: Page): TestProbe {
  return {
    url: () => page.url(),
    count: (selector) =>
      page.evaluate((s) => document.querySelectorAll(s).length, selector),
    text: (selector) =>
      page.evaluate((s) => document.querySelector(s)?.textContent ?? null, selector),
    fill: async (selector, value) => {
      await page.evaluate(
        (s, v) => {
          const el = document.querySelector(s) as HTMLInputElement | null;
          if (!el) throw new Error(`No existe ${s}`);
          el.focus();
          el.value = v;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        selector,
        value,
      );
    },
    click: async (selector) => {
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 })
          .catch(() => undefined),
        page
          .click(selector)
          .catch(() =>
            page.evaluate(
              (s) => (document.querySelector(s) as HTMLElement | null)?.click(),
              selector,
            ),
          ),
      ]);
    },
  };
}

/**
 * Ejecuta un plan contra una sonda.
 * @param plan Plan.
 * @param probe Sonda (p. ej. {@link puppeteerProbe}).
 * @param opts `execute` para permitir casos tool-execute.
 */
export async function runTestPlan(
  plan: TestPlan,
  probe: TestProbe,
  opts: { execute?: boolean } = {},
): Promise<TestReport> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const results: TestResult[] = [];
  for (const c of plan.cases) {
    const s = Date.now();
    const done = (status: TestResult['status'], message?: string) =>
      results.push({
        id: c.id,
        name: c.name,
        status,
        durationMs: Date.now() - s,
        message,
      });
    try {
      switch (c.kind) {
        case 'tool-exists':
        case 'context-exists': {
          const n = await probe.count(c.selector);
          n > 0 ? done('passed') : done('failed', `selector ${c.selector} no encontrado`);
          break;
        }
        case 'tool-params': {
          const missing: string[] = [];
          for (const [p, sel] of Object.entries(c.params ?? {}))
            if ((await probe.count(sel)) === 0) missing.push(`${p} (${sel})`);
          missing.length
            ? done('failed', `parámetros sin selector: ${missing.join(', ')}`)
            : done('passed');
          break;
        }
        case 'tool-confirmation': {
          try {
            await probe.count(c.confirmation ?? '');
            done('passed');
          } catch (e) {
            done('failed', `selector de confirmación inválido: ${(e as Error).message}`);
          }
          break;
        }
        case 'context-format': {
          const value = await probe.text(c.selector);
          if (value === null) done('failed', `selector ${c.selector} no encontrado`);
          else
            matchesFormat(value, c.format ?? 'text')
              ? done('passed')
              : done('failed', `"${value.trim().slice(0, 60)}" no parece ${c.format}`);
          break;
        }
        case 'tool-execute': {
          if (!opts.execute || !probe.fill || !probe.click) {
            done('skipped', 'ejecución desactivada (usa --execute)');
            break;
          }
          for (const [p, sel] of Object.entries(c.params ?? {}))
            await probe.fill(sel, c.sample?.[p] ?? 'prueba');
          await probe.click(c.selector);
          done('passed');
          break;
        }
      }
    } catch (e) {
      done('failed', (e as Error).message);
    }
  }
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  return {
    url: probe.url(),
    total: results.length,
    passed,
    failed,
    skipped,
    results,
    startedAt,
    durationMs: Date.now() - t0,
  };
}

/**
 * Informe en formato JUnit XML (para CI).
 * @param report Informe.
 */
export function toJUnit(report: TestReport): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const cases = report.results
    .map((r) => {
      const body =
        r.status === 'failed'
          ? `<failure message="${esc(r.message ?? '')}"/>`
          : r.status === 'skipped'
            ? `<skipped message="${esc(r.message ?? '')}"/>`
            : '';
      return `    <testcase classname="webmcp" name="${esc(r.name)}" time="${(r.durationMs / 1000).toFixed(3)}">${body}</testcase>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n  <testsuite name="webmcpcss test run ${esc(report.url)}" tests="${report.total}" failures="${report.failed}" skipped="${report.skipped}" time="${(report.durationMs / 1000).toFixed(3)}" timestamp="${report.startedAt}">\n${cases}\n  </testsuite>\n</testsuites>\n`;
}

/**
 * Workflow de GitHub Actions que ejecuta el plan en cada PR.
 * @param opts URL, ruta del css.
 */
export function buildTestWorkflow(opts: { url: string; css: string }): string {
  return `name: Pruebas WebMCP (webmcpcss test)

on:
  pull_request:
  workflow_dispatch:

jobs:
  webmcp-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm i -g webmcpcss@${VERSION.split('.')[0]}
      - name: Ejecutar plan
        run: webmcpcss test run --url "${opts.url}" --file "${opts.css}" --junit webmcp-junit.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: webmcp-junit
          path: webmcp-junit.xml
`;
}
