/**
 * Tests de Test-MCP (v1.0.0): plan de pruebas derivado del contrato,
 * generación Playwright/Cypress, ejecución con sonda (jsdom) y JUnit.
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { parseWebMCP } from '../src/parser';
import {
  buildTestPlan,
  buildTestWorkflow,
  formatRegexSource,
  generateTests,
  matchesFormat,
  paramSelectors,
  runTestPlan,
  sampleFor,
  toJUnit,
  type TestProbe,
} from '../src/testing';

const css = `
#search-btn { webmcp-tool: "buscar"; webmcp-description: "Busca productos"; webmcp-param-query: value(#q); webmcp-param-cat: attr(data-cat); }
#pay { webmcp-tool: "pagar"; webmcp-description: "Paga el pedido"; webmcp-param-cvv: value(#cvv); webmcp-confirmation: "#confirm"; }
#del { webmcp-tool: "eliminarCuenta"; webmcp-description: "Elimina la cuenta"; webmcp-param-motivo: value(#motivo); }
#sub { webmcp-tool: "suscribirse"; webmcp-description: "Alta en el boletín"; webmcp-param-email: value(#email); webmcp-payment: "required"; }
.price { webmcp-context: "precio"; webmcp-format: "currency"; }
.list { webmcp-context: "lista"; webmcp-format: "list"; }
.title { webmcp-context: "titulo"; }
`;
const map = parseWebMCP(css);

describe('testing · plan', () => {
  it('deriva casos de existencia, parámetros, confirmación y formato', () => {
    const plan = buildTestPlan(map, { source: 'x.webmcp.css' });
    const kinds = plan.cases.map((c) => `${c.kind}:${c.target}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'tool-exists:buscar',
        'tool-params:buscar',
        'tool-exists:pagar',
        'tool-confirmation:pagar',
        'context-exists:precio',
        'context-format:precio',
        'context-format:lista',
        'context-exists:titulo',
      ]),
    );
    expect(kinds).not.toContain('context-format:titulo'); // text no se comprueba
    expect(kinds.filter((k) => k.startsWith('tool-execute'))).toEqual([]);
    expect(plan.cases.every((c) => /^tc\d{3}$/.test(c.id))).toBe(true);
    expect(plan.source).toBe('x.webmcp.css');
    // attr() apunta al propio selector de la tool.
    expect(paramSelectors(map.tools.buscar)).toEqual({ query: '#q', cat: '#search-btn' });
  });

  it('con execute solo añade ejecución para tools seguras con campos rellenables', () => {
    const plan = buildTestPlan(map, { execute: true });
    const exec = plan.cases.filter((c) => c.kind === 'tool-execute');
    expect(exec.map((c) => c.target)).toEqual(['buscar']); // pagar (confirmación), eliminar (peligrosa), suscribirse (pago) quedan fuera
    expect(exec[0].sample).toEqual({ query: 'webmcp' });
    expect(exec[0].params).toEqual({ query: '#q' });
  });

  it('sampleFor y matchesFormat cubren los formatos habituales', () => {
    expect(sampleFor('email')).toContain('@');
    expect(sampleFor('password')).toMatch(/\w+/);
    expect(sampleFor('fecha')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sampleFor('cantidad')).toBe('1');
    expect(sampleFor('otro')).toBe('prueba');
    expect(matchesFormat('$ 12,50', 'currency')).toBe(true);
    expect(matchesFormat('gratis', 'currency')).toBe(false);
    expect(matchesFormat('42', 'number')).toBe(true);
    expect(matchesFormat('12 de marzo de 2026', 'date')).toBe(true);
    expect(matchesFormat('2026-03-12', 'date')).toBe(true);
    expect(matchesFormat('sí', 'boolean')).toBe(true);
    expect(matchesFormat('https://x.test', 'url')).toBe(true);
    expect(matchesFormat('a@b.co', 'email')).toBe(true);
    expect(matchesFormat('', 'list')).toBe(false);
    expect(matchesFormat('x', 'desconocido')).toBe(true);
    for (const f of ['currency', 'number', 'date', 'boolean', 'url', 'email', 'text'])
      expect(() => new Function(`return ${formatRegexSource(f)}`)()).not.toThrow();
  });
});

describe('testing · generación de código', () => {
  it('Playwright: archivo TS con un test por caso y BASE_URL configurable', () => {
    const { code, filename, plan } = generateTests(map, {
      framework: 'playwright',
      url: 'https://shop.test',
      execute: true,
    });
    expect(filename).toBe('webmcp.spec.ts');
    expect(code).toContain("import { test, expect } from '@playwright/test'");
    expect(code).toContain('process.env.BASE_URL ?? "https://shop.test"');
    expect(code.match(/\n {2}test\(/g)?.length).toBe(plan.cases.length);
    expect(code).toContain('page.locator("#search-btn").first()).toBeAttached()');
    expect(code).toContain('page.locator("#q").first().fill("webmcp")');
    expect(code).toContain('toMatch(/\\d/)');
  });

  it('Cypress: archivo JS con cy.get y Cypress.env', () => {
    const { code, filename } = generateTests(map, { framework: 'cypress' });
    expect(filename).toBe('webmcp.cy.js');
    expect(code).toContain("Cypress.env('BASE_URL')");
    expect(code).toContain('cy.get("#pay").should(\'exist\')');
    expect(code).toContain("invoke('text').should('match'");
    expect(code).not.toContain('@playwright');
  });

  it('buildTestWorkflow genera el workflow de CI', () => {
    const yml = buildTestWorkflow({ url: 'https://shop.test', css: 'shop.webmcp.css' });
    expect(yml).toContain(
      'webmcpcss test run --url "https://shop.test" --file "shop.webmcp.css" --junit webmcp-junit.xml',
    );
    expect(yml).toContain('pull_request');
  });
});

describe('testing · ejecución', () => {
  const html = `<html><body><input id="q"><button id="search-btn" data-cat="x">Buscar</button><button id="pay">Pagar</button><input id="cvv">
    <span class="price">12,50 €</span><ul class="list"><li>a</li></ul><h1 class="title">T</h1></body></html>`;
  const probeFor = (doc: Document): TestProbe => ({
    url: () => 'https://shop.test/',
    count: async (s) => doc.querySelectorAll(s).length,
    text: async (s) => doc.querySelector(s)?.textContent ?? null,
    fill: async (s, v) => {
      (doc.querySelector(s) as HTMLInputElement).value = v;
    },
    click: async (s) => (doc.querySelector(s) as HTMLElement).click(),
  });

  it('ejecuta el plan contra una página y reporta fallos con motivo', async () => {
    const doc = new JSDOM(html).window.document;
    const plan = buildTestPlan(map, { execute: true });
    const report = await runTestPlan(plan, probeFor(doc), { execute: true });
    expect(report.url).toBe('https://shop.test/');
    expect(report.total).toBe(plan.cases.length);
    const failed = report.results.filter((r) => r.status === 'failed');
    expect(failed.map((r) => r.name)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('eliminarCuenta'),
        expect.stringContaining('suscribirse'),
      ]),
    );
    expect(failed.find((r) => r.name.includes('eliminarCuenta'))?.message).toMatch(
      /#del/,
    );
    expect(
      report.results.find((r) => r.name.includes('precio') && r.name.includes('formato'))
        ?.status,
    ).toBe('passed');
    expect(report.results.find((r) => r.name.includes('se ejecuta'))?.status).toBe(
      'passed',
    );
    expect((doc.querySelector('#q') as HTMLInputElement).value).toBe('webmcp');
    expect(report.passed + report.failed + report.skipped).toBe(report.total);
  });

  it('sin execute los casos de ejecución se omiten y los errores de la sonda se capturan', async () => {
    const plan = buildTestPlan(map, { execute: true });
    const throwing: TestProbe = {
      url: () => 'x',
      count: async () => {
        throw new Error('sonda rota');
      },
      text: async () => null,
    };
    const report = await runTestPlan(plan, throwing);
    expect(report.skipped).toBe(1);
    expect(report.results.find((r) => r.status === 'skipped')?.message).toMatch(
      /--execute/,
    );
    expect(
      report.results.filter((r) => r.message === 'sonda rota').length,
    ).toBeGreaterThan(0);
  });

  it('toJUnit produce XML válido con failures y skipped', async () => {
    const doc = new JSDOM(html).window.document;
    const report = await runTestPlan(
      buildTestPlan(map, { execute: true }),
      probeFor(doc),
    );
    const xml = toJUnit(report);
    expect(xml.startsWith('<?xml version="1.0"')).toBe(true);
    expect(xml).toContain(`tests="${report.total}"`);
    expect(xml).toContain(`failures="${report.failed}"`);
    expect(xml).toContain('<skipped');
    expect(xml).toContain('<failure message=');
    expect(xml).toContain('name="tool &quot;buscar&quot; existe');
    // Bien formado (parseable por el DOMParser de jsdom).
    const parsed = new JSDOM(xml, { contentType: 'text/xml' }).window.document;
    expect(parsed.querySelectorAll('testcase').length).toBe(report.total);
  });
});
