/**
 * Tests de A11y-MCP (v1.0.0): reglas WCAG en jsdom, resumen/puntuación,
 * corrección declarativa (.webmcp.css + script) y workflow de CI.
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  auditDocumentInPage,
  buildA11yCss,
  buildA11yFixScript,
  buildA11yToolMap,
  buildA11yWorkflow,
  passesThresholds,
  summarizeAudit,
} from '../src/a11y';
import { parseWebMCP } from '../src/parser';

const BAD = `<html><head><title></title><meta name="viewport" content="width=device-width, user-scalable=no"></head><body>
<img src="/img/logo-tienda.png"><img src="/x.png" alt=""><img src="/d.png" role="presentation">
<button></button><button aria-label="Cerrar">×</button><input type="submit" value="Enviar">
<a href="/x">aquí</a><a href="/y"></a><a href="/z" title="Ver detalle"></a>
<form><input type="text" name="email" placeholder="Email"><input type="password"><select id="pais"></select><label for="pais">País</label><input type="hidden" name="csrf"></form>
<h1>Título</h1><h3>Salto</h3>
<div id="dup"></div><div id="dup"></div>
<span tabindex="3">x</span><span tabindex="0">ok</span>
<div role="banana">r</div><div role="button">b</div>
<iframe src="/f"></iframe><iframe src="/g" title="Mapa"></iframe>
<video autoplay src="/v.mp4"></video>
</body></html>`;

const GOOD = `<!DOCTYPE html><html lang="es"><head><title>Tienda accesible</title><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<header><nav aria-label="Principal"><a href="/">Inicio</a> <a href="/productos">Catálogo de productos</a></nav></header>
<main><h1>Bienvenido</h1><h2>Sección</h2><img src="/logo.png" alt="Logo de la tienda">
<form><label for="q">Buscar</label><input id="q" name="q"><button type="submit">Buscar</button></form></main>
<footer><iframe src="/map" title="Mapa de la tienda"></iframe></footer>
</body></html>`;

const audit = (html: string) =>
  auditDocumentInPage(new JSDOM(html, { url: 'https://test.local/' }).window.document);

describe('a11y · reglas', () => {
  it('detecta los problemas del documento defectuoso con selectores y correcciones', () => {
    const result = audit(BAD);
    const byRule = (rule: string) => result.issues.filter((i) => i.rule === rule);
    expect(byRule('html-has-lang')).toHaveLength(1);
    expect(byRule('document-title')).toHaveLength(1);
    expect(byRule('meta-viewport-scalable')).toHaveLength(1);
    expect(byRule('image-alt')).toHaveLength(1); // alt="" y role=presentation no cuentan
    expect(byRule('image-alt')[0].fix?.attrs?.alt).toBe('logo tienda');
    expect(byRule('button-name')).toHaveLength(1); // aria-label y value cuentan como nombre
    expect(
      byRule('link-name')
        .map((i) => i.impact)
        .sort(),
    ).toEqual(['moderate', 'serious']); // "aquí" (moderate) y vacío (serious); title vale
    expect(byRule('label')).toHaveLength(2); // email y password; select tiene label[for]; hidden se ignora
    expect(byRule('label')[0].selector).toBe('input[name="email"]');
    expect(byRule('label')[0].fix?.attrs?.['aria-label']).toBe('Email');
    expect(byRule('heading-order')).toHaveLength(1);
    expect(byRule('landmark-one-main')).toHaveLength(1);
    expect(byRule('duplicate-id')).toHaveLength(1);
    expect(byRule('tabindex-positive')).toHaveLength(1);
    expect(byRule('aria-valid-role')).toHaveLength(1);
    expect(byRule('iframe-title')).toHaveLength(1);
    expect(byRule('autoplay-media')).toHaveLength(1);
    expect(result.url).toBe('https://test.local/');
    expect(Object.values(result.checked).reduce((a, b) => a + b, 0)).toBeGreaterThan(20);
  });

  it('un documento accesible no genera problemas (salvo target-size, que requiere layout real)', () => {
    const result = audit(GOOD);
    const rules = [...new Set(result.issues.map((i) => i.rule))];
    expect(rules.filter((r) => r !== 'target-size')).toEqual([]);
  });

  it('ignora elementos ocultos', () => {
    const result = audit(
      '<html lang="es"><head><title>t</title></head><body><main><h1>h</h1><img src="a.png" hidden><button aria-hidden="true"></button><a href="/x" style="display:none"></a></main></body></html>',
    );
    expect(
      result.issues.filter((i) =>
        ['image-alt', 'button-name', 'link-name'].includes(i.rule),
      ),
    ).toEqual([]);
  });
});

describe('a11y · resumen y umbrales', () => {
  it('summarizeAudit agrupa por impacto/regla y puntúa peor cuantos más problemas', () => {
    const bad = summarizeAudit(audit(BAD));
    const good = summarizeAudit(audit(GOOD));
    expect(bad.total).toBeGreaterThan(10);
    expect(bad.byImpact.critical).toBeGreaterThanOrEqual(3);
    expect(bad.byRule['label']).toBe(2);
    expect(bad.score).toBeLessThan(good.score);
    expect(good.score).toBeGreaterThanOrEqual(90);
    expect(bad.generatedBy).toMatch(/^webmcpcss@/);
  });

  it('passesThresholds aplica puntuación mínima e impacto máximo', () => {
    const bad = summarizeAudit(audit(BAD));
    expect(passesThresholds(bad, 0, 'none').ok).toBe(true);
    expect(passesThresholds(bad, 90, 'none')).toMatchObject({ ok: false });
    expect(passesThresholds(bad, 0, 'critical').reasons.join(' ')).toMatch(/critical/);
    expect(passesThresholds(bad, 0, 'minor').reasons.length).toBeGreaterThanOrEqual(3);
    const good = summarizeAudit(audit(GOOD));
    expect(passesThresholds(good, 80, 'critical').ok).toBe(true);
  });
});

describe('a11y · corrección declarativa', () => {
  it('buildA11yToolMap/buildA11yCss producen un .webmcp.css parseable con webmcp-accessibility por selector', () => {
    const summary = summarizeAudit(audit(BAD));
    const map = buildA11yToolMap(summary);
    const entries = Object.values(map.context);
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const e of entries) {
      expect(e.meta?.accessibility).toMatch(/^[a-z-]+: .+/);
      expect(e.meta?.['a11y-rule']).toBeTruthy();
      expect(e.meta?.['a11y-impact']).toMatch(/critical|serious|moderate|minor/);
    }
    const css = buildA11yCss(summary);
    expect(css).toContain('webmcpcss a11y fix');
    const reparsed = parseWebMCP(css);
    expect(Object.keys(reparsed.context).length).toBe(entries.length);
    expect(reparsed.context[Object.keys(reparsed.context)[0]].meta?.accessibility).toBe(
      entries[0].meta?.accessibility,
    );
  });

  it('el script de corrección aplica los atributos en la página sin pisar los existentes', () => {
    const summary = summarizeAudit(audit(BAD));
    const map = parseWebMCP(buildA11yCss(summary));
    const dom = new JSDOM(BAD, {
      url: 'https://test.local/',
      runScripts: 'outside-only',
    });
    const applied = (dom.window as unknown as { eval: (s: string) => number }).eval(
      buildA11yFixScript(map),
    );
    expect(applied).toBeGreaterThanOrEqual(6);
    const doc = dom.window.document;
    expect(doc.querySelector('img')?.getAttribute('alt')).toBe('logo tienda');
    expect(doc.querySelector('input[name="email"]')?.getAttribute('aria-label')).toBe(
      'Email',
    );
    expect(doc.documentElement.getAttribute('lang')).toBe('es');
    expect(doc.querySelector('span[tabindex]')?.getAttribute('tabindex')).toBe('0');
    expect(
      doc.querySelector('button[aria-label="Cerrar"]')?.getAttribute('aria-label'),
    ).toBe('Cerrar');
    expect(
      (dom.window as unknown as { __WEBMCP_A11Y__: { applied: number } }).__WEBMCP_A11Y__
        .applied,
    ).toBe(applied);
    // Tras aplicar, la auditoría mejora.
    const after = summarizeAudit(auditDocumentInPage(doc));
    expect(after.total).toBeLessThan(summary.total);
    expect(after.byImpact.critical).toBeLessThan(summary.byImpact.critical);
  });

  it('buildA11yWorkflow genera un workflow válido con umbrales', () => {
    const yml = buildA11yWorkflow({
      urls: ['https://a.test', 'https://b.test/x'],
      minScore: 85,
    });
    expect(yml).toContain('name: Accesibilidad');
    expect(yml).toContain(
      'webmcpcss a11y audit --url "https://a.test" --min-score 85 --fail-on critical',
    );
    expect(yml).toContain('https://b.test/x');
    expect(yml).toContain('upload-artifact');
    expect(
      buildA11yWorkflow({ urls: ['https://a.test'], failOnCritical: false }),
    ).not.toContain('--fail-on');
  });
});
