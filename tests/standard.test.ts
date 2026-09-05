/**
 * Tests de `src/standard/`: localización canónica de `modelContext`
 * (`document.modelContext` con alias `navigator.modelContext`) y compilador
 * bidireccional de la API declarativa (`toolname`/`tooldescription`).
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { generateApiScript } from '../src/generator';
import { exportBrowserInject } from '../src/exporters/editors';
import { parseWebMCP, serializeToolMap } from '../src/parser';
import { buildRetroInjectScript } from '../src/retro';
import {
  applyDeclarativeToHtml,
  buildDeclarativeRuntimeScript,
  declarativeToolsToToolMap,
  defineModelContext,
  extractDeclarativeTools,
  extractDeclarativeToolsFromDocument,
  getModelContext,
  MODEL_CONTEXT_CANONICAL,
  MODEL_CONTEXT_EXPR,
  modelContextLocation,
  parseAttrs,
  toolMapToDeclarative,
  toParamKey,
} from '../src/standard';
import { buildTailwindToolsScript, registerTailwindTools } from '../src/tailwind';
import type { ToolMap } from '../src/types';
import { installModelContextShim, readRegisteredTools } from '../src/webmcp-api';

type AnyWindow = Window & { [k: string]: unknown };

const fakeApi = () => {
  const tools: unknown[] = [];
  return {
    tools,
    registerTool(t: unknown) {
      tools.push(t);
    },
  };
};

describe('modelContext: ubicación canónica', () => {
  it('la ubicación canónica es document.modelContext', () => {
    expect(MODEL_CONTEXT_CANONICAL).toBe('document.modelContext');
    expect(MODEL_CONTEXT_EXPR).toContain('document.modelContext');
    expect(MODEL_CONTEXT_EXPR).toContain('navigator.modelContext');
  });

  it('getModelContext prefiere document sobre navigator', () => {
    const win = new JSDOM('<!doctype html>').window as unknown as AnyWindow;
    const onDoc = fakeApi();
    const onNav = fakeApi();
    (win.navigator as unknown as Record<string, unknown>).modelContext = onNav;
    expect(modelContextLocation(win)).toBe('navigator');
    expect(getModelContext(win)).toBe(onNav);
    (win.document as unknown as Record<string, unknown>).modelContext = onDoc;
    expect(modelContextLocation(win)).toBe('document');
    expect(getModelContext(win)).toBe(onDoc);
  });

  it('getModelContext devuelve undefined sin API', () => {
    const win = new JSDOM('<!doctype html>').window as unknown as AnyWindow;
    expect(getModelContext(win)).toBeUndefined();
    expect(modelContextLocation(win)).toBe('none');
  });

  it('defineModelContext publica en document y navigator', () => {
    const win = new JSDOM('<!doctype html>').window as unknown as AnyWindow;
    const api = fakeApi();
    defineModelContext(win, api);
    expect((win.document as unknown as { modelContext: unknown }).modelContext).toBe(api);
    expect((win.navigator as unknown as { modelContext: unknown }).modelContext).toBe(
      api,
    );
  });
});

describe('shim de captura y las dos ubicaciones', () => {
  it('sin API nativa, el polyfill queda en document y navigator', () => {
    const win = new JSDOM('<!doctype html>').window as unknown as AnyWindow;
    installModelContextShim(win);
    const doc = (
      win.document as unknown as { modelContext: { registerTool(t: unknown): void } }
    ).modelContext;
    const nav = (win.navigator as unknown as { modelContext: unknown }).modelContext;
    expect(doc).toBeDefined();
    expect(nav).toBe(doc);
    doc.registerTool({ name: 'a', execute: () => 1 });
    expect(readRegisteredTools(win).map((t) => t.name)).toEqual(['a']);
  });

  it('el polyfill implementa getTools/executeTool/clearContext del borrador', async () => {
    const win = new JSDOM('<!doctype html>').window as unknown as AnyWindow;
    installModelContextShim(win);
    const mc = getModelContext(win)!;
    mc.registerTool({
      name: 'sum',
      description: 'suma',
      execute: (a: unknown) => {
        const { x, y } = a as { x: number; y: number };
        return x + y;
      },
    });
    expect((mc.getTools!() as Array<{ name: string }>).map((t) => t.name)).toEqual([
      'sum',
    ]);
    expect(await mc.executeTool!('sum', { x: 2, y: 3 })).toBe(5);
    await expect(mc.executeTool!('nope', {})).rejects.toThrow(/no registrada/);
    mc.clearContext!();
    expect(mc.getTools!()).toEqual([]);
  });

  it('con API nativa solo en document, la espeja en navigator y captura', () => {
    const win = new JSDOM('<!doctype html>').window as unknown as AnyWindow;
    const native = fakeApi();
    (win.document as unknown as Record<string, unknown>).modelContext = native;
    installModelContextShim(win);
    getModelContext(win)!.registerTool({ name: 'nativeTool' });
    expect(native.tools).toHaveLength(1);
    expect(readRegisteredTools(win).map((t) => t.name)).toEqual(['nativeTool']);
    expect((win.navigator as unknown as { modelContext: unknown }).modelContext).toBe(
      native,
    );
  });

  it('con API nativa solo en navigator (Chrome < 150), también captura', () => {
    const win = new JSDOM('<!doctype html>').window as unknown as AnyWindow;
    const native = fakeApi();
    (win.navigator as unknown as Record<string, unknown>).modelContext = native;
    installModelContextShim(win);
    (
      win.navigator as unknown as { modelContext: { registerTool(t: unknown): void } }
    ).modelContext.registerTool({
      name: 'legacyTool',
    });
    expect(native.tools).toHaveLength(1);
    expect(readRegisteredTools(win).map((t) => t.name)).toEqual(['legacyTool']);
  });
});

describe('código generado usa document.modelContext con fallback', () => {
  const map = parseWebMCP(`#btn { webmcp-tool: "go"; webmcp-description: "Ir"; }`);

  it('generate --api', () => {
    const script = generateApiScript(map, { banner: 'x' });
    expect(script).toContain('document.modelContext');
    expect(script).toMatch(
      /const mc = \(\(typeof document !== 'undefined' && document\.modelContext\)/,
    );
  });

  it('browser-inject y retro inject', () => {
    expect(exportBrowserInject(map, { cssPath: 'x.css' })).toContain(
      'document.modelContext',
    );
    expect(buildRetroInjectScript(map, '')).toContain('document.modelContext');
  });

  it('tailwind generate y registerTailwindTools', () => {
    const descriptor = {
      name: 'editCard',
      description: 'Edita el espaciado',
      selector: '#card',
      category: 'spacing',
      currentClasses: ['p-4'],
      inputSchema: { type: 'object', properties: {}, required: [] },
    } as never;
    expect(buildTailwindToolsScript([descriptor])).toContain('document.modelContext');
    const win = new JSDOM('<!doctype html><div id="card" class="p-4"></div>')
      .window as unknown as Window;
    const api = fakeApi();
    (win.document as unknown as Record<string, unknown>).modelContext = api;
    expect(registerTailwindTools(win, [descriptor])).toBe(1);
    expect(api.tools).toHaveLength(1);
  });
});

const HTML = `<!doctype html><html><body>
<form id="search" action="/buscar" method="get" toolname="searchProducts"
      tooldescription="Busca productos en el catálogo por texto" toolautosubmit>
  <label for="q">Texto a buscar</label>
  <input id="q" name="q" type="search" required toolparamdescription="Palabras clave del producto">
  <select name="cat" toolparamtitle="category">
    <option value="all">Todas</option><option value="shoes">Zapatillas</option>
  </select>
  <button type="submit">Buscar</button>
</form>
<form name="contact" toolname="sendContact" tooldescription="Envía un mensaje al soporte">
  <input type="email" name="email" placeholder="Tu correo">
  <textarea name="msg" toolparamtitle="message" toolparamdescription="Cuerpo del mensaje"></textarea>
  <input type="hidden" name="csrf" value="x">
  <input type="submit" value="Enviar">
</form>
<form id="broken" toolname="noDesc"><input name="a"></form>
<form id="plain"><input name="b"></form>
</body></html>`;

describe('API declarativa: HTML → herramientas (sin navegador)', () => {
  it('extrae toolname/tooldescription/toolautosubmit y los parámetros', () => {
    const scan = extractDeclarativeTools(HTML);
    expect(scan.tools.map((t) => t.name)).toEqual(['searchProducts', 'sendContact']);
    const s = scan.tools[0];
    expect(s.description).toBe('Busca productos en el catálogo por texto');
    expect(s.autoSubmit).toBe(true);
    expect(s.formSelector).toBe('#search');
    expect(s.submitSelector).toBe('#search button[type="submit"]');
    expect(s.action).toBe('/buscar');
    expect(s.method).toBe('get');
    expect(s.params.map((p) => p.name)).toEqual(['q', 'category']);
    expect(s.params[0]).toMatchObject({
      selector: '#q',
      inputType: 'search',
      required: true,
      description: 'Palabras clave del producto',
    });
    expect(s.params[1].options).toEqual(['all', 'shoes']);
    const c = scan.tools[1];
    expect(c.autoSubmit).toBe(false);
    expect(c.formSelector).toBe('form[name="contact"]');
    expect(c.params.map((p) => p.name)).toEqual(['email', 'message']);
    expect(c.params[0].description).toBe('Tu correo');
    expect(c.params[1].description).toBe('Cuerpo del mensaje');
    expect(c.submitSelector).toBe('form[name="contact"] input[type="submit"]');
  });

  it('avisa de formularios incompletos y de nombres duplicados', () => {
    const scan = extractDeclarativeTools(
      HTML + '<form toolname="searchProducts" tooldescription="dup"></form>',
    );
    expect(
      scan.warnings.some((w) => w.includes('#broken') && w.includes('tooldescription')),
    ).toBe(true);
    expect(scan.warnings.some((w) => w.includes('duplicado'))).toBe(true);
    expect(scan.tools).toHaveLength(2);
  });

  it('la variante sobre Document da el mismo resultado', () => {
    const doc = new JSDOM(HTML).window.document;
    const a = extractDeclarativeToolsFromDocument(doc);
    const b = extractDeclarativeTools(HTML);
    expect(a.tools.map((t) => t.name)).toEqual(b.tools.map((t) => t.name));
    expect(a.tools[0].params.map((p) => [p.name, p.selector])).toEqual(
      b.tools[0].params.map((p) => [p.name, p.selector]),
    );
    expect(a.tools[0].submitSelector).toBe(b.tools[0].submitSelector);
    expect(a.tools[1].submitSelector).toBe(b.tools[1].submitSelector);
    expect(a.tools[0].params[1].options).toEqual(['all', 'shoes']);
    expect(a.warnings).toHaveLength(1);
  });

  it('parseAttrs tolera comillas simples, sin comillas y booleanos', () => {
    expect(parseAttrs(` id='a' toolname=b required data-x="1 &amp; 2"`)).toEqual({
      id: 'a',
      toolname: 'b',
      required: '',
      'data-x': '1 & 2',
    });
  });

  it('toParamKey normaliza etiquetas', () => {
    expect(toParamKey('Correo electrónico', 'p')).toBe('correoElectronico');
    expect(toParamKey('2ª dirección', 'p')).toBe('p2Direccion');
    expect(toParamKey('***', 'fallback')).toBe('fallback');
  });
});

describe('API declarativa ↔ ToolMap', () => {
  it('declarativeToolsToToolMap produce un contrato .webmcp.css válido y round-trip', () => {
    const scan = extractDeclarativeTools(HTML);
    const map = declarativeToolsToToolMap(scan.tools);
    const s = map.tools.searchProducts;
    expect(s.trigger).toEqual({ event: 'submit', selector: '#search' });
    expect(s.params.q).toEqual({ source: 'value', selector: '#q' });
    expect(s.meta).toMatchObject({
      source: 'declarative',
      autosubmit: 'true',
      intent: 'submit',
    });
    expect(map.tools.sendContact.meta).toMatchObject({ confirmation: 'needed' });
    const css = serializeToolMap(map);
    const again = parseWebMCP(css);
    expect(Object.keys(again.tools)).toEqual(['searchProducts', 'sendContact']);
    expect(again.tools.searchProducts.params.category).toEqual({
      source: 'value',
      selector: '#search select[name="cat"]',
    });
  });

  it('toolparamdescription ↔ webmcp-doc-<param> sobrevive al round-trip y documenta el inputSchema', async () => {
    const map = declarativeToolsToToolMap(extractDeclarativeTools(HTML).tools);
    expect(map.tools.searchProducts.meta?.['doc-q']).toBe('Palabras clave del producto');
    const again = parseWebMCP(serializeToolMap(map));
    expect(again.tools.searchProducts.meta?.['doc-q']).toBe(
      'Palabras clave del producto',
    );
    const { buildInputSchema } = await import('../src/generator/js-generator');
    expect(buildInputSchema(again.tools.searchProducts).properties.q.description).toBe(
      'Palabras clave del producto',
    );
    const back = toolMapToDeclarative(again);
    const q = back.patches[0].fieldAttrs.find((f) => f.attrs.toolparamtitle === 'q')!;
    expect(q.attrs.toolparamdescription).toBe('Palabras clave del producto');
  });

  it('el CSS explícito tiene prioridad sobre lo declarativo', () => {
    const base = parseWebMCP(`#x { webmcp-tool: "searchProducts"; }`);
    const map = declarativeToolsToToolMap(extractDeclarativeTools(HTML).tools, base);
    expect(map.tools.searchProducts.selector).toBe('#x');
    expect(map.tools.sendContact).toBeDefined();
  });

  it('toolMapToDeclarative separa formularios de acciones imperativas', () => {
    const map: ToolMap = parseWebMCP(`
      #login-btn {
        webmcp-tool: "login";
        webmcp-description: "Inicia sesión";
        webmcp-param-user: value(#user);
        webmcp-param-pass: value(#pass);
        webmcp-trigger: "submit" on #login-form;
        webmcp-confirmation: "none";
      }
      .btn-add { webmcp-tool: "addToCart"; webmcp-param-id: attr(data-id); }
      #newsletter { webmcp-tool: "subscribe"; webmcp-param-email: value(#nl-email); webmcp-param-plan: attr(data-plan); webmcp-confirmation: ".ok"; }
    `);
    const c = toolMapToDeclarative(map);
    expect(c.imperativeOnly).toEqual(['addToCart']);
    const login = c.patches.find((p) => p.tool === 'login')!;
    expect(login.formSelector).toBe('#login-form');
    expect(login.formAttrs).toEqual({
      toolname: 'login',
      tooldescription: 'Inicia sesión',
      toolautosubmit: '',
    });
    expect(login.fieldAttrs).toEqual([
      { selector: '#user', attrs: { toolparamtitle: 'user' } },
      { selector: '#pass', attrs: { toolparamtitle: 'pass' } },
    ]);
    const nl = c.patches.find((p) => p.tool === 'subscribe')!;
    expect(nl.formAttrs.toolautosubmit).toBeUndefined();
    expect(nl.skipped).toMatch(/plan/);
  });

  it("applyDeclarativeToHtml localiza campos con [name=q], [name='q'] y compuestos, e informa de los que faltan", () => {
    const html = `<form id="search"><input name="q"><select name='cat'></select><input class="x"></form>`;
    const map = parseWebMCP(`
      #search button { webmcp-tool: "s"; webmcp-description: "d"; webmcp-param-q: value(#search [name=q]); webmcp-param-cat: value(#search select[name='cat']); webmcp-param-other: value(#search .x); webmcp-trigger: "submit" on #search; }
    `);
    const res = applyDeclarativeToHtml(html, toolMapToDeclarative(map));
    expect(res.applied).toEqual(['s']);
    expect(res.html).toContain('<input name="q" toolparamtitle="q">');
    expect(res.html).toContain(`<select name='cat' toolparamtitle="cat">`);
    expect(res.fieldsNotFound).toEqual(['s.other → #search .x']);
  });

  it('applyDeclarativeToHtml escribe los atributos sin duplicar y respeta los existentes', () => {
    const html = `<form id="login-form" action="/login"><input id="user"><input id="pass" type="password"/><button>Entrar</button></form>
<form id="nl" toolname="keepMe" tooldescription="ya"><input id="nl-email"></form>`;
    const map = parseWebMCP(`
      #login-form button { webmcp-tool: "login"; webmcp-description: "Inicia sesión"; webmcp-param-user: value(#user); webmcp-param-pass: value(#pass); webmcp-trigger: "submit" on #login-form; }
      #nl { webmcp-tool: "subscribe"; webmcp-description: "Alta"; webmcp-param-email: value(#nl-email); }
      #ghost { webmcp-tool: "ghost"; webmcp-param-x: value(#gx); webmcp-trigger: "submit" on #no-such-form; }
    `);
    const res = applyDeclarativeToHtml(html, toolMapToDeclarative(map));
    expect(res.applied).toEqual(['login', 'subscribe']);
    expect(res.notFound).toEqual(['ghost → #no-such-form']);
    expect(res.html).toContain(
      '<form id="login-form" action="/login" toolname="login" tooldescription="Inicia sesión">',
    );
    expect(res.html).toContain('<input id="user" toolparamtitle="user">');
    expect(res.html).toContain(
      '<input id="pass" type="password" toolparamtitle="pass" />',
    );
    // el formulario ya anotado conserva sus valores
    expect(res.html).toContain('toolname="keepMe" tooldescription="ya"');
    expect(res.html).not.toContain('toolname="subscribe"');
    const forced = applyDeclarativeToHtml(html, toolMapToDeclarative(map), {
      force: true,
    });
    expect(forced.html).toContain('toolname="subscribe"');
    expect(forced.html).not.toContain('keepMe');
    // lo generado se vuelve a leer con el extractor
    const back = extractDeclarativeTools(forced.html);
    expect(back.tools.map((t) => t.name)).toEqual(['login', 'subscribe']);
    expect(back.tools[0].params.map((p) => p.name)).toEqual(['user', 'pass']);
  });

  it('buildDeclarativeRuntimeScript aplica los atributos en un DOM vivo', () => {
    const map = parseWebMCP(`
      #f button { webmcp-tool: "go"; webmcp-description: "Go"; webmcp-param-q: value(#q); webmcp-trigger: "submit" on #f; webmcp-confirmation: "none"; }
    `);
    const script = buildDeclarativeRuntimeScript(toolMapToDeclarative(map));
    const dom = new JSDOM(`<form id="f"><input id="q"><button>ok</button></form>`, {
      runScripts: 'outside-only',
    });
    dom.window.eval(script);
    const form = dom.window.document.querySelector('#f')!;
    expect(form.getAttribute('toolname')).toBe('go');
    expect(form.getAttribute('tooldescription')).toBe('Go');
    expect(form.hasAttribute('toolautosubmit')).toBe(true);
    expect(dom.window.document.querySelector('#q')!.getAttribute('toolparamtitle')).toBe(
      'q',
    );
    expect(
      (dom.window as unknown as { __WEBMCP_DECLARATIVE__: { applied: number } })
        .__WEBMCP_DECLARATIVE__,
    ).toEqual({
      applied: 1,
      total: 1,
    });
  });
});

describe('detección declarativa en retro scan', () => {
  it('conserva las tools declaradas con toolname y desplaza a las inferidas para el mismo form', async () => {
    const { scanLegacyHtml } = await import('../src/retro/scanner');
    const html = `<!DOCTYPE html><html><body>
      <form name="contact" action="/contact" toolname="sendContact" tooldescription="Envía un mensaje">
        <input name="email" type="email" toolparamtitle="Correo" required>
        <textarea name="msg" toolparamdescription="Cuerpo del mensaje"></textarea>
        <input type="submit" value="Enviar">
      </form>
      <form name="search" action="/search"><input name="q"><input type="submit" value="Buscar"></form>
    </body></html>`;
    const scan = scanLegacyHtml(html);
    expect(scan.declarative).toEqual(['sendContact']);
    expect(scan.toolMap.tools.sendContact).toBeDefined();
    expect(scan.toolMap.tools.sendContact.trigger).toEqual({
      event: 'submit',
      selector: 'form[name="contact"]',
    });
    expect(scan.toolMap.tools.sendContact.meta?.source).toBe('declarative');
    // La tool inferida para el mismo formulario desaparece; la otra sigue.
    const others = Object.entries(scan.toolMap.tools).filter(
      ([n]) => n !== 'sendContact',
    );
    expect(others.some(([, t]) => t.trigger?.selector === 'form[name="contact"]')).toBe(
      false,
    );
    expect(others.some(([, t]) => t.trigger?.selector === 'form[name="search"]')).toBe(
      true,
    );
    expect(scan.notes.some((n) => n.includes('API declarativa'))).toBe(true);
  });
});
