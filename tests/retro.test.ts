/**
 * Tests de Retro-WebMCP (v1.0.0): escáner legacy, proxy de compatibilidad
 * (servidor origen real en localhost), script de inyección ejecutado en
 * jsdom y preparación/publicación en el repositorio comunitario.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import * as zlib from 'zlib';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseWebMCP } from '../src/parser';
import type { LlmClient } from '../src/prompt/types';
import {
  PROXY_PREFIX,
  buildRetroInjectScript,
  createRetroProxy,
  decodeEntities,
  detectLegacySignals,
  enhanceRetroWithLlm,
  fetchHtml,
  injectRetro,
  injectWebMcpIntoHtml,
  legacyScore,
  prepareRetroSubmission,
  proposeSelector,
  publishRetro,
  rewriteAbsoluteUrls,
  scanLegacyHtml,
} from '../src/retro';

const legacyHtml = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'legacy-site.html'),
  'utf8',
);

const listen = (server: http.Server) =>
  new Promise<number>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as { port: number }).port),
    ),
  );
const closeServer = (server: http.Server) =>
  new Promise<void>((resolve) => {
    (
      server as http.Server & { closeAllConnections?: () => void }
    ).closeAllConnections?.();
    server.close(() => resolve());
  });

describe('retro · scanner', () => {
  it('detecta señales legacy y puntúa alto en el fixture', () => {
    const signals = detectLegacySignals(legacyHtml);
    const kinds = signals.map((s) => s.kind);
    expect(kinds).toEqual(
      expect.arrayContaining([
        'table-layout',
        'inline-handlers',
        'font-tags',
        'no-doctype',
        'name-only-inputs',
        'javascript-links',
        'old-jquery',
      ]),
    );
    expect(legacyScore(signals)).toBeGreaterThanOrEqual(60);
    expect(legacyScore([])).toBe(0);
    const modern =
      '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><main><form id="f"><label for="q">Buscar</label><input id="q" name="q"><button>Ir</button></form></main></body></html>';
    expect(legacyScore(detectLegacySignals(modern))).toBeLessThan(20);
  });

  it('scanLegacyHtml propone tools con nombres útiles, selectores estables y confianza', () => {
    const scan = scanLegacyHtml(legacyHtml, 'https://ferreteria.example/');
    expect(scan.title).toContain('Ferretería');
    expect(scan.legacyScore).toBeGreaterThan(50);
    const tools = scan.toolMap.tools;
    expect(Object.keys(tools)).toEqual(
      expect.arrayContaining([
        'buscar',
        'enviarConsulta',
        'iniciarSesion',
        'comprar',
        'verCarrito',
      ]),
    );
    expect(
      tools.buscar.params.q ??
        tools.buscar.params.query ??
        Object.values(tools.buscar.params)[0],
    ).toBeDefined();
    expect(tools.iniciarSesion.selector).toBe('a[title="Acceso clientes"]');
    expect(tools.verCarrito.selector).toBe('a[href="/carrito.asp"]');
    expect(tools.comprar.selector).toContain('onclick');
    for (const t of Object.values(tools)) {
      expect(Number(t.meta?.confidence)).toBeGreaterThan(0);
      expect(Number(t.meta?.confidence)).toBeLessThanOrEqual(1);
      expect(t.description).toBeTruthy();
    }
    // Serializable y re-parseable.
    const back = parseWebMCP(prepareRetroSubmission(scan, 'ferreteria.example').css);
    expect(Object.keys(back.tools)).toEqual(Object.keys(tools));
  });

  it('proposeSelector prioriza id > name > title > href y evita javascript:', () => {
    expect(proposeSelector('a', { id: 'login-link', href: '/y' }, {}).selector).toBe(
      '#login-link',
    );
    // ids inestables (ASP.NET ctl00, hashes) se descartan.
    expect(
      proposeSelector('a', { id: 'ctl00_Main_lnk', href: '/y' }, {}).selector,
    ).not.toContain('ctl00');
    expect(proposeSelector('input', { name: 'email', type: 'text' }, {}).selector).toBe(
      'input[name="email"]',
    );
    expect(
      proposeSelector(
        'a',
        { title: 'Acceso', href: 'javascript:login()' },
        { text: 'Entrar' },
      ).selector,
    ).toBe('a[title="Acceso"]');
    expect(
      proposeSelector('a', { href: 'javascript:login()' }, { text: 'Entrar' }).selector,
    ).toBe('a[href^="javascript:login"]');
    expect(
      proposeSelector('a', { href: '/carrito.asp' }, { text: 'Carrito' }).selector,
    ).toBe('a[href="/carrito.asp"]');
    expect(
      proposeSelector('img', { alt: 'Comprar', src: '/b.gif' }, {}).selector,
    ).toContain('alt="Comprar"');
  });

  it('decodeEntities decodifica entidades HTML habituales', () => {
    expect(
      decodeEntities('Ferreter&iacute;a &amp; m&aacute;s &#169; &quot;x&quot;'),
    ).toBe('Ferretería & más © "x"');
  });

  it('enhanceRetroWithLlm mejora descripciones y nombres con un modelo simulado', async () => {
    const scan = scanLegacyHtml(legacyHtml);
    const llm: LlmClient = {
      provider: 'openai',
      model: 'test',
      complete: async () =>
        JSON.stringify({
          tools: {
            buscar: { description: 'Busca productos en el catálogo de la ferretería' },
            comprar: {
              name: 'anadirAlCarrito',
              description: 'Añade el producto al carrito',
            },
          },
        }),
    };
    const improved = await enhanceRetroWithLlm(scan, llm);
    expect(improved).toBeGreaterThanOrEqual(2);
    expect(scan.toolMap.tools.buscar.description).toContain('catálogo');
    expect(scan.toolMap.tools.anadirAlCarrito).toBeDefined();
    expect(scan.toolMap.tools.comprar).toBeUndefined();
    const broken: LlmClient = {
      provider: 'openai',
      model: 'test',
      complete: async () => 'nada',
    };
    expect(await enhanceRetroWithLlm(scan, broken)).toBe(0);
  });
});

describe('retro · proxy', () => {
  let origin: http.Server;
  let proxy: http.Server;
  let originPort: number;
  let proxyPort: number;
  const css =
    '#buscar { webmcp-tool: "buscar"; webmcp-description: "Busca"; webmcp-param-q: value(input[name="q"]); }';

  beforeAll(async () => {
    origin = http.createServer((req, res) => {
      if (req.url === '/gz') {
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'gzip',
        });
        res.end(
          zlib.gzipSync('<html><head><title>gz</title></head><body>zip</body></html>'),
        );
        return;
      }
      if (req.url === '/style.css') {
        res.writeHead(200, { 'content-type': 'text/css' });
        res.end('body{color:red}');
        return;
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { location: `http://127.0.0.1:${originPort}/` });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<html><head><title>Legacy</title></head><body><a href="http://127.0.0.1:${originPort}/x">abs</a><form><input name="q"><input type="submit" id="buscar"></form></body></html>`,
      );
    });
    originPort = await listen(origin);
    proxy = createRetroProxy({ target: `http://127.0.0.1:${originPort}`, css });
    proxyPort = await listen(proxy);
  });

  afterAll(async () => {
    await closeServer(proxy);
    await closeServer(origin);
  });

  it('inyecta link/meta/script en el HTML y reescribe URLs absolutas del origen', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain(
      `<link rel="webmcp" type="text/webmcp" href="${PROXY_PREFIX}/webmcp.css">`,
    );
    expect(html).toMatch(/<meta name="webmcp"/);
    expect(html).toContain('__WEBMCP_GRAPH__');
    expect(html).toContain('"buscar"');
    expect(html).toContain(`href="http://127.0.0.1:${proxyPort}/x"`);
    expect(html).not.toContain(`href="http://127.0.0.1:${originPort}/x"`);
  });

  it('descomprime respuestas gzip antes de inyectar y deja pasar recursos no HTML', async () => {
    const gz = await fetch(`http://127.0.0.1:${proxyPort}/gz`);
    const gzHtml = await gz.text();
    expect(gzHtml).toContain('zip');
    expect(gzHtml).toContain('__WEBMCP_GRAPH__');
    const cssRes = await fetch(`http://127.0.0.1:${proxyPort}/style.css`);
    expect(cssRes.headers.get('content-type')).toContain('text/css');
    expect(await cssRes.text()).toBe('body{color:red}');
  });

  it('sirve sus rutas propias: webmcp.css, graph.json y .well-known/webmcp.json', async () => {
    const c = await fetch(`http://127.0.0.1:${proxyPort}${PROXY_PREFIX}/webmcp.css`);
    expect(c.headers.get('content-type')).toContain('text/webmcp');
    expect(await c.text()).toBe(css);
    const g = (await (
      await fetch(`http://127.0.0.1:${proxyPort}${PROXY_PREFIX}/graph.json`)
    ).json()) as { tools: Record<string, unknown> };
    expect(Object.keys(g.tools)).toEqual(['buscar']);
    const wk = (await (
      await fetch(`http://127.0.0.1:${proxyPort}/.well-known/webmcp.json`)
    ).json()) as { css: string; origin: string };
    expect(wk.css).toBe(`${PROXY_PREFIX}/webmcp.css`);
    expect(wk.origin).toBe(`http://127.0.0.1:${originPort}`);
  });

  it('reescribe la cabecera Location de las redirecciones hacia el proxy', async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/redirect`, {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`http://127.0.0.1:${proxyPort}/`);
  });

  it('injectWebMcpIntoHtml / rewriteAbsoluteUrls funcionan sin <head>', () => {
    const out = injectWebMcpIntoHtml(
      '<body><p>x</p></body>',
      parseWebMCP(css),
      css,
      true,
    );
    expect(out.indexOf('<link rel="webmcp"')).toBeLessThan(out.indexOf('<p>x</p>'));
    expect(out).toContain('navigator.modelContext');
    expect(injectWebMcpIntoHtml('<p>y</p>', parseWebMCP(css), css, false)).not.toContain(
      'navigator.modelContext',
    );
    expect(
      rewriteAbsoluteUrls(
        '<a href="https://old.example/a">a</a> <img src="//old.example/i.png">',
        'https://old.example',
        'http://localhost:8080',
      ),
    ).toBe(
      '<a href="http://localhost:8080/a">a</a> <img src="http://localhost:8080/i.png">',
    );
  });

  it('fetchHtml descarga con el user-agent de webmcpcss y falla con estados no 2xx', async () => {
    const html = await fetchHtml(`http://127.0.0.1:${originPort}/`);
    expect(html).toContain('Legacy');
    const failing = (async () =>
      new Response('x', { status: 500 })) as unknown as typeof fetch;
    await expect(fetchHtml('http://x', failing)).rejects.toThrow(/500/);
  });
});

describe('retro · injector (jsdom)', () => {
  it('expone window.__WEBMCP_GRAPH__ y __WEBMCP_RETRO__ con run/context/status y registra modelContext', () => {
    const css = `
      #go { webmcp-tool: "buscar"; webmcp-description: "Busca"; webmcp-param-q: value(#q); webmcp-trigger: "submit" on #f; }
      #total { webmcp-context: "total"; webmcp-format: "currency"; }
      #nope { webmcp-tool: "fantasma"; }
    `;
    const map = parseWebMCP(css);
    const dom = new JSDOM(
      '<html><head></head><body><form id="f" onsubmit="window.__submitted = true; return false;"><input id="q"><button id="go" type="submit">Ir</button></form><span id="total">12,50 €</span></body></html>',
      { runScripts: 'outside-only' },
    );
    const win = dom.window as unknown as Window & {
      __WEBMCP_GRAPH__: { tools: Array<{ name: string }> };
      __WEBMCP_RETRO__: {
        run: (
          n: string,
          a?: Record<string, string>,
        ) => { success: boolean; error?: string };
        context: () => Record<string, string | null>;
        status: () => Array<{ name: string; exists: boolean }>;
      };
      navigator: Navigator & { modelContext?: { registerTool: (t: unknown) => void } };
      eval: (s: string) => unknown;
      __submitted?: boolean;
    };
    const registered: unknown[] = [];
    Object.defineProperty(win.navigator, 'modelContext', {
      value: { registerTool: (t: unknown) => registered.push(t) },
      configurable: true,
    });
    win.eval(buildRetroInjectScript(map, css));
    expect(win.__WEBMCP_GRAPH__.tools.map((t) => t.name)).toEqual(['buscar', 'fantasma']);
    expect(win.__WEBMCP_RETRO__.status()).toEqual([
      { name: 'buscar', exists: true },
      { name: 'fantasma', exists: false },
    ]);
    expect(win.__WEBMCP_RETRO__.context()).toEqual({ total: '12,50 €' });
    const r = win.__WEBMCP_RETRO__.run('buscar', { q: 'tornillos' });
    expect(r.success).toBe(true);
    expect((dom.window.document.getElementById('q') as HTMLInputElement).value).toBe(
      'tornillos',
    );
    expect(win.__WEBMCP_RETRO__.run('fantasma').success).toBe(false);
    expect(win.__WEBMCP_RETRO__.run('otra').error).toMatch(/desconocida/);
    expect(registered.length).toBe(2);
    expect(
      dom.window.document.querySelector('style[data-webmcpcss="retro"]')?.textContent,
    ).toContain('webmcp-tool');
    // Idempotente.
    win.eval(buildRetroInjectScript(map, css));
    expect(registered.length).toBe(2);
  });

  it('puede omitir el registro en modelContext', () => {
    const script = buildRetroInjectScript(parseWebMCP('#a { webmcp-tool: "a"; }'), '', {
      registerModelContext: false,
    });
    expect(script).not.toContain('registerTool');
  });

  it('injectRetro inyecta en una página Puppeteer (simulada con jsdom) y en futuras navegaciones', async () => {
    const dom = new JSDOM('<!DOCTYPE html><body><button id="a">A</button></body>', {
      runScripts: 'outside-only',
    });
    const w = dom.window as unknown as { eval: (s: string) => unknown };
    const onNewDocument: string[] = [];
    const page = {
      evaluateOnNewDocument: async (script: string) => {
        onNewDocument.push(script);
      },
      evaluate: async (fnOrScript: string | (() => unknown)) =>
        typeof fnOrScript === 'string'
          ? w.eval(fnOrScript)
          : w.eval(`(${fnOrScript.toString()})()`),
    } as unknown as import('puppeteer').Page;
    const map = parseWebMCP('#a { webmcp-tool: "a"; } #zz { webmcp-tool: "falta"; }');
    const result = await injectRetro(page, map, '#a { webmcp-tool: "a"; }', {
      highlight: true,
    });
    expect(result).toEqual({
      injected: true,
      tools: [
        { name: 'a', exists: true },
        { name: 'falta', exists: false },
      ],
      missing: ['falta'],
    });
    expect(onNewDocument).toHaveLength(1);
    expect(
      dom.window.document.querySelector('#a')?.getAttribute('data-webmcp-tool'),
    ).toBe('a');
    // Es idempotente: una segunda inyección no duplica ni cambia el estado.
    const again = await injectRetro(page, map, '');
    expect(again.tools).toEqual(result.tools);
    // Sin tools (página nueva), se considera inyectado igualmente.
    const fresh = new JSDOM('<!DOCTYPE html><body></body>', {
      runScripts: 'outside-only',
    }).window as unknown as { eval: (s: string) => unknown };
    const emptyPage = {
      evaluateOnNewDocument: async () => undefined,
      evaluate: async (fnOrScript: string | (() => unknown)) =>
        typeof fnOrScript === 'string'
          ? fresh.eval(fnOrScript)
          : fresh.eval(`(${fnOrScript.toString()})()`),
    } as unknown as import('puppeteer').Page;
    const empty = await injectRetro(emptyPage, { tools: {}, context: {} }, '');
    expect(empty).toEqual({ injected: true, tools: [], missing: [] });
  });
});

describe('retro · repository', () => {
  it('prepareRetroSubmission añade cabecera de procedencia y cuenta tools/contexto', () => {
    const scan = scanLegacyHtml(legacyHtml, 'https://ferreteria.example/');
    const sub = prepareRetroSubmission(scan, 'ferreteria.example');
    expect(sub.header).toContain('ferreteria.example');
    expect(sub.header).toContain(`legacyScore: ${scan.legacyScore}`);
    expect(sub.tools).toBe(Object.keys(scan.toolMap.tools).length);
    expect(sub.css.startsWith('/* WebMCPcss community style')).toBe(true);
  });

  it('publishRetro en dry-run no llama a la red y con token usa publishToCommunity', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const css = '#a { webmcp-tool: "a"; webmcp-description: "A"; }';
    const dry = await publishRetro({
      domain: 'legacy.example',
      token: '',
      css,
      dryRun: true,
    });
    expect(dry.result).toBeUndefined();
    expect(dry.submission.tools).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();

    const responses: Record<string, unknown> = {
      'GET /user': { login: 'bot' },
      'POST /repos/cochinoraptor/WebMCPcss/forks': { full_name: 'bot/WebMCPcss' },
      'GET /repos/cochinoraptor/WebMCPcss/git/ref/heads/main': { object: { sha: 'abc' } },
      'GET /repos/cochinoraptor/WebMCPcss/contents/': null,
      'GET /repos/bot/WebMCPcss': { default_branch: 'main', fork: true },
      'POST /repos/bot/WebMCPcss/git/refs': { ref: 'refs/heads/x' },
      'PUT /repos/bot/WebMCPcss/contents/': { content: { sha: 'def' } },
      'POST /repos/cochinoraptor/WebMCPcss/pulls': {
        html_url: 'https://github.com/cochinoraptor/WebMCPcss/pull/99',
      },
    };
    fetchSpy.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      const key = `${init?.method ?? 'GET'} ${url.pathname}`;
      const hit = Object.entries(responses).find(([k]) => key.startsWith(k));
      if (!hit || hit[1] === null)
        return new Response('{"message":"Not Found"}', {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      return new Response(JSON.stringify(hit[1]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const pub = await publishRetro({
        domain: 'legacy.example',
        token: 'ghp_test',
        css,
        apiBase: 'https://api.github.test',
      });
      expect(pub.result?.prUrl).toContain('/pull/99');
      expect(pub.result?.path).toContain('legacy.example');
      expect(fetchSpy).toHaveBeenCalled();
      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers.Authorization).toContain('ghp_test');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
