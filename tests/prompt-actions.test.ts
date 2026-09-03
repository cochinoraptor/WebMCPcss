/**
 * Tests de la ejecución de prompts (v0.7.0) sobre jsdom: buscador de
 * elementos, ejecutor de acciones, gestor de assets y PromptManager
 * (incluida la delegación en herramientas WebMCP con auto-reparación).
 */
// @vitest-environment node
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DomAdapter } from '../src/adapters/dom-adapter';
import { parseWebMCP } from '../src/parser';
import {
  ActionExecutor,
  isSafeColor,
  sanitizeStyles,
} from '../src/prompt/action-executor';
import {
  AssetManager,
  classifySource,
  detectMime,
  sniffMime,
} from '../src/prompt/asset-manager';
import { canMutate } from '../src/prompt/dom-mutator';
import { ElementFinder } from '../src/prompt/element-finder';
import { PromptManager, runPrompt } from '../src/prompt/prompt-manager';
import type { LlmClient } from '../src/prompt/types';
import { readHistory } from '../src/utils/history';

const PAGE = `<!doctype html><html><head><title>Tienda Demo</title></head><body>
  <header id="top">
    <a class="logo" href="/"><img src="/logo.png" alt="Tienda Demo" /></a>
    <nav class="menu"><a href="/ofertas">Ofertas</a><a href="/contacto">Contacto</a></nav>
    <form class="search-form" role="search">
      <input type="search" name="q" placeholder="Buscar productos" />
    </form>
  </header>
  <div class="cookie-banner" id="cookies">Usamos cookies <button id="accept-cookies">Aceptar</button></div>
  <main>
    <h1 class="title">Teclado mecánico Aurora</h1>
    <section class="carousel" id="hero-carousel">
      <img class="slide" src="/1.png" alt="Slide 1" />
      <label for="slide-upload">Subir imagen</label>
      <input type="file" id="slide-upload" accept="image/*" />
    </section>
    <section data-product data-product-id="SKU-42">
      <div class="product-price">$249.900</div>
      <label for="qty-input">Cantidad</label>
      <input type="number" id="qty-input" value="1" />
      <button class="btn-add" data-action="add-to-cart">Añadir al carrito</button>
    </section>
    <form class="newsletter">
      <input type="email" name="email" placeholder="Tu correo" />
      <button type="submit">Suscribirme</button>
    </form>
    <div class="ad">Anuncio 1</div>
    <div class="ad">Anuncio 2</div>
  </main>
  <footer id="footer">© Tienda Demo</footer>
</body></html>`;

const CSS = `
[data-product] .btn-add {
  webmcp-tool: "addToCart";
  webmcp-description: "Añade el producto al carrito";
  webmcp-param-productId: attr(data-product-id);
  webmcp-param-quantity: value(#qty-input);
}
.newsletter input[type="email"] {
  webmcp-tool: "subscribeNewsletter";
  webmcp-param-email: value();
  webmcp-trigger: "submit" on .newsletter;
}
`;

function load(html = PAGE) {
  const dom = new JSDOM(html, { url: 'https://tienda.test/' });
  return { dom, doc: dom.window.document, adapter: new DomAdapter(dom.window.document) };
}

describe('DomAdapter implementa DomMutator', () => {
  it('canMutate detecta las capacidades', () => {
    const { adapter } = load();
    expect(canMutate(adapter)).toBe(true);
    expect(canMutate({} as never)).toBe(false);
  });

  it('setStyles / hide / remove / setText / move / moveTo', async () => {
    const { adapter, doc } = load();
    expect(await adapter.setStyles('.ad', { color: 'red' }, true)).toBe(2);
    expect(
      (doc.querySelector('.ad') as HTMLElement).style.getPropertyPriority('color'),
    ).toBe('important');
    expect(await adapter.hide('.ad', false)).toBe(1);
    expect((doc.querySelector('.ad') as HTMLElement).style.display).toBe('none');
    expect(await adapter.remove('.ad', true)).toBe(2);
    expect(doc.querySelectorAll('.ad')).toHaveLength(0);

    await adapter.setText('h1', 'Nuevo título');
    expect(doc.querySelector('h1')?.textContent).toBe('Nuevo título');
    await adapter.setText('input[name="email"]', 'x@y.z');
    expect(
      (doc.querySelector('input[name="email"]') as HTMLInputElement).placeholder,
    ).toBe('x@y.z');

    await adapter.move('#footer', '#top', 'before');
    expect(doc.body.firstElementChild?.id).toBe('footer');
    await adapter.move('#footer', 'main', 'inside');
    expect(doc.querySelector('main')?.lastElementChild?.id).toBe('footer');
    await adapter.moveTo('h1', 10, 20);
    expect((doc.querySelector('h1') as HTMLElement).style.left).toBe('10px');
    await expect(adapter.move('#nope', '#top', 'before')).rejects.toThrow(
      /No se pudo mover/,
    );
    expect(await adapter.count('nav a')).toBe(2);
  });

  it('uploadFiles localiza el input de archivo desde el contenedor o el label', async () => {
    const { adapter, doc } = load();
    const r1 = await adapter.uploadFiles('#hero-carousel', ['/tmp/a.png']);
    expect(r1.inputSelector).toBe('#slide-upload');
    expect(r1.count).toBe(1);
    expect(
      doc.querySelector('#slide-upload')?.getAttribute('data-webmcp-files'),
    ).toContain('/tmp/a.png');
    const r2 = await adapter.uploadFiles('label[for="slide-upload"]', ['/tmp/b.png']);
    expect(r2.inputSelector).toBe('#slide-upload');
    // Único input de la página como último recurso.
    const r3 = await adapter.uploadFiles('h1', ['/tmp/c.png']);
    expect(r3.inputSelector).toBe('#slide-upload');
    const { adapter: noInput } = load('<html><body><p id="p">x</p></body></html>');
    await expect(noInput.uploadFiles('#p', ['/tmp/x'])).rejects.toThrow(
      /input\[type="file"\]/,
    );
  });
});

describe('ElementFinder', () => {
  it('selector explícito', async () => {
    const { adapter } = load();
    const r = await new ElementFinder(adapter).find('#qty-input');
    expect(r.match?.strategy).toBe('selector');
    expect(r.match?.selector).toBe('#qty-input');
  });

  it('herramienta del tool map por nombre humanizado', async () => {
    const { adapter } = load();
    const finder = new ElementFinder(adapter, { toolMap: parseWebMCP(CSS) });
    const r = await finder.find('add to cart');
    expect(r.match?.strategy).toBe('tool');
    expect(r.match?.tool).toBe('addToCart');
    expect(r.match?.selector).toBe('[data-product] .btn-add');
  });

  it('texto visible', async () => {
    const { adapter } = load();
    const r = await new ElementFinder(adapter).find('botón Añadir al carrito');
    expect(['text', 'vision']).toContain(r.match?.strategy);
    expect(r.match?.text).toBe('Añadir al carrito');
  });

  it('sondeo por tipo: carrusel, buscador, footer, cookies', async () => {
    const { adapter } = load();
    const finder = new ElementFinder(adapter);
    expect((await finder.find('carrusel')).match?.selector).toBe('.carousel');
    const search = (await finder.find('el buscador')).match;
    expect(search?.selector).toContain('search');
    expect((await finder.find('pie de página')).match?.selector).toBe('footer');
    expect((await finder.find('popup de cookies')).match?.selector).toMatch(/cookie/i);
  });

  it('LLM elige entre candidatos (y se verifica)', async () => {
    const { adapter } = load();
    const llm: LlmClient = {
      provider: 'ollama',
      model: 'fake',
      complete: async () => '{"selector":"#accept-cookies","confidence":0.95}',
    };
    const r = await new ElementFinder(adapter, { llm }).find(
      'el botón para aceptar las cookies',
    );
    expect(r.match?.strategy).toBe('llm');
    expect(r.match?.selector).toBe('#accept-cookies');

    const liar: LlmClient = {
      provider: 'ollama',
      model: 'fake',
      complete: async () => '{"selector":"#no-existe","confidence":0.95}',
    };
    const r2 = await new ElementFinder(adapter, { llm: liar }).find('aceptar cookies');
    expect(r2.match?.strategy).not.toBe('llm');
    expect(r2.tried).toContain('llm');
  });

  it('sin coincidencia devuelve sugerencias y estrategias intentadas', async () => {
    const { adapter } = load();
    const r = await new ElementFinder(adapter, { toolMap: parseWebMCP(CSS) }).find(
      'zzzz qqqq xxxx',
    );
    expect(r.match).toBeNull();
    expect(r.tried).toEqual(['selector', 'tool', 'text', 'vision', 'probe']);
    expect(r.suggestions.join('\n')).toMatch(/específico/);
    expect(r.suggestions.join('\n')).toContain('addToCart');
  });
});

describe('ActionExecutor', () => {
  it('sanitizeStyles e isSafeColor', () => {
    expect(
      sanitizeStyles({
        color: 'red',
        fontSize: '2em',
        behavior: 'url(x)',
        'background-image': 'url(javascript:alert(1))',
      }),
    ).toEqual({
      color: 'red',
      'font-size': '2em',
    });
    expect(isSafeColor('#fff')).toBe(true);
    expect(isSafeColor('rgb(1, 2, 3)')).toBe(true);
    expect(isSafeColor('red; background: url(x)')).toBe(false);
  });

  it('errores descriptivos sin lanzar', async () => {
    const { adapter } = load();
    const ex = new ActionExecutor(adapter);
    const r = await ex.execute(
      { action: 'fill', target: 'x', parameters: {} },
      { selector: '#qty-input', strategy: 'selector', confidence: 1 },
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/texto/);
    const r2 = await ex.execute({ action: 'delete', target: 'x', parameters: {} }, null);
    expect(r2.error).toMatch(/No se localizó/);
    const r3 = await ex.execute(
      { action: 'upload', target: 'x', parameters: { file: '/no/existe.png' } },
      { selector: '#slide-upload', strategy: 'selector', confidence: 1 },
    );
    expect(r3.error).toMatch(/no existe/);
  });
});

describe('AssetManager', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcpcss-assets-test-'));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16, 1),
  ]);
  let server: http.Server;
  let base = '';

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/img') {
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(png);
      } else if (req.url === '/noext') {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(png);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('clasifica orígenes y detecta MIME por extensión y firma', () => {
    expect(classifySource('./a.png')).toBe('local');
    expect(classifySource('https://x/a')).toBe('url');
    expect(classifySource('data:image/png;base64,AA')).toBe('data');
    expect(sniffMime(png)).toBe('image/png');
    expect(sniffMime(Buffer.from('%PDF-1.4'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from('<svg xmlns="x"/>'))).toBe('image/svg+xml');
    const noExt = path.join(tmp, 'blob');
    fs.writeFileSync(noExt, png);
    expect(detectMime(noExt)).toBe('image/png');
    expect(detectMime('/x/y.webp')).toBe('image/webp');
  });

  it('resuelve locales, URLs y data-URIs; limpia temporales', async () => {
    const local = path.join(tmp, 'foto.jpg');
    fs.writeFileSync(local, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const am = new AssetManager({ tmpDir: path.join(tmp, 'dl') });
    const a = await am.resolve(local);
    expect(a).toMatchObject({
      source: 'local',
      mimeType: 'image/jpeg',
      name: 'foto.jpg',
      temporary: false,
    });

    const b = await am.resolve(`${base}/img`);
    expect(b).toMatchObject({ source: 'url', mimeType: 'image/png', temporary: true });
    expect(fs.existsSync(b.path)).toBe(true);
    expect(b.name.endsWith('.png')).toBe(true);
    const b2 = await am.resolve(`${base}/noext`);
    expect(b2.mimeType).toBe('image/png');

    const c = await am.resolve(
      `data:image/png;name=inline.png;base64,${png.toString('base64')}`,
    );
    expect(c).toMatchObject({
      source: 'data',
      mimeType: 'image/png',
      name: 'inline.png',
      size: png.length,
    });

    am.cleanup();
    expect(fs.existsSync(b.path)).toBe(false);
    expect(fs.existsSync(c.path)).toBe(false);
    expect(fs.existsSync(a.path)).toBe(true);
  });

  it('rechaza inexistentes, 404, protocolos raros y tamaños excesivos', async () => {
    const am = new AssetManager({ tmpDir: path.join(tmp, 'dl2'), maxBytes: 10 });
    await expect(am.resolve('/no/existe.png')).rejects.toThrow(/no existe/);
    await expect(am.resolve(`${base}/404`)).rejects.toThrow(/404/);
    await expect(am.resolve('ftp://x/y')).rejects.toThrow();
    await expect(am.resolve(`${base}/img`)).rejects.toThrow(/tamaño máximo/);
    await expect(am.resolve('data:image/png;base64,')).rejects.toThrow(/vacío/);
  });
});

describe('PromptManager (flujo completo sobre jsdom)', () => {
  let historyFile: string;
  beforeEach(() => {
    historyFile = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'webmcpcss-hist-')),
      'h.json',
    );
  });

  it('dry-run interpreta y localiza sin tocar la página', async () => {
    const { adapter, doc } = load();
    const r = await new PromptManager(adapter).run('elimina el popup de cookies', {
      dryRun: true,
      historyFile: false,
    });
    expect(r.success).toBe(true);
    expect(r.executed).toBe(false);
    expect(r.action.action).toBe('delete');
    expect(r.match?.selector).toMatch(/cookie/);
    expect(doc.querySelector('#cookies')).not.toBeNull();
    expect(r.log.map((l) => l.phase)).toEqual(['interpret', 'find', 'execute']);
  });

  it('fill resuelve el campo por su <label> ("pon la cantidad en 3") y por placeholder', async () => {
    const { adapter, doc } = load();
    const pm = new PromptManager(adapter);
    const r = await pm.run('pon la cantidad en 3', { historyFile: false });
    expect(r.success).toBe(true);
    expect(r.action.action).toBe('fill');
    expect(r.outcome?.details?.selector).toBe('#qty-input');
    expect((doc.querySelector('#qty-input') as HTMLInputElement).value).toBe('3');

    const r2 = await pm.run('escribe "teclado" en el buscador', { historyFile: false });
    expect(r2.success).toBe(true);
    expect((doc.querySelector('input[name="q"]') as HTMLInputElement).value).toBe(
      'teclado',
    );
  });

  it('hide / delete / changeColor / setText / setStyle / move modifican el DOM', async () => {
    const { adapter, doc } = load();
    const pm = new PromptManager(adapter);
    const opts = { historyFile: false as const };

    expect((await pm.run('oculta todos los anuncios', opts)).success).toBe(true);
    expect((doc.querySelector('.ad') as HTMLElement).style.display).toBe('none');

    expect((await pm.run('elimina el popup de cookies', opts)).success).toBe(true);
    expect(doc.querySelector('#cookies')).toBeNull();

    const color = await pm.run(
      'cambia el color del botón Añadir al carrito a rojo',
      opts,
    );
    expect(color.success).toBe(true);
    expect((doc.querySelector('.btn-add') as HTMLElement).style.backgroundColor).toBe(
      'red',
    );

    const text = await pm.run('cambia el título a "Oferta relámpago"', opts);
    expect(text.success).toBe(true);
    expect(doc.querySelector('h1')?.textContent).toBe('Oferta relámpago');

    const style = await pm.run('haz el título más grande y en negrita', opts);
    expect(style.success).toBe(true);
    expect((doc.querySelector('h1') as HTMLElement).style.fontWeight).toBe('bold');

    const move = await pm.run('mueve el pie de página antes del header', opts);
    expect(move.success).toBe(true);
    expect(doc.body.firstElementChild?.id).toBe('footer');
  });

  it('fill sobre el buscador y click con delegación en herramienta WebMCP', async () => {
    const { adapter, doc, dom } = load();
    let submitted = 0;
    doc.querySelector('.search-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted++;
    });
    let clicks = 0;
    doc.querySelector('.btn-add')?.addEventListener('click', () => clicks++);
    void dom;

    const pm = new PromptManager(adapter, { toolMap: parseWebMCP(CSS) });
    const fill = await pm.run('escribe "teclado" en el buscador', { historyFile: false });
    expect(fill.success).toBe(true);
    expect((doc.querySelector('input[name="q"]') as HTMLInputElement).value).toBe(
      'teclado',
    );

    const click = await pm.run('haz clic en añadir al carrito', { historyFile: false });
    expect(click.success).toBe(true);
    expect(click.match?.tool).toBe('addToCart');
    expect(click.outcome?.via).toBe('tool');
    expect(clicks).toBe(1);
    expect(
      (click.outcome?.details?.result as { data: { productId: string } }).data.productId,
    ).toBe('SKU-42');
    expect(submitted).toBe(0);
  });

  it('fill delega en una herramienta con un único value() y usa su trigger submit', async () => {
    const { adapter, doc } = load();
    let submitted = false;
    doc.querySelector('.newsletter')?.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted = true;
    });
    const pm = new PromptManager(adapter, { toolMap: parseWebMCP(CSS) });
    const r = await pm.run('subscribe newsletter con ana@test.com', {
      historyFile: false,
    });
    expect(r.success).toBe(true);
    // Sin verbo reconocible, la heurística detecta el nombre de la herramienta
    // y la ejecuta directamente (sin localizar elemento).
    expect(r.action.action).toBe('other');
    expect(r.action.parameters.tool).toBe('subscribeNewsletter');
    expect(r.outcome?.via).toBe('tool');
    expect((doc.querySelector('input[name="email"]') as HTMLInputElement).value).toBe(
      'ana@test.com',
    );
    expect(submitted).toBe(true);
  });

  it('la delegación hereda la auto-reparación de selectores', async () => {
    // El botón ya no tiene la clase .btn-add pero conserva data-action y texto.
    const { adapter, doc } = load(PAGE.replace('class="btn-add"', 'class="buy-button"'));
    let clicks = 0;
    doc.querySelector('.buy-button')?.addEventListener('click', () => clicks++);
    const pm = new PromptManager(adapter, { toolMap: parseWebMCP(CSS) });
    const r = await pm.run('click add to cart', { historyFile: false });
    expect(r.success).toBe(true);
    expect(r.outcome?.via).toBe('tool');
    expect((r.outcome?.details?.result as { repaired: boolean }).repaired).toBe(true);
    expect(clicks).toBe(1);
  });

  it('upload asigna el archivo al input del carrusel', async () => {
    const { adapter, doc } = load();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcpcss-up-'));
    const file = path.join(tmp, 'foto.png');
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const r = await runPrompt(adapter, 'sube esta imagen en el carrusel', {
      files: [file],
      historyFile: false,
    });
    expect(r.success).toBe(true);
    expect(r.outcome?.details?.inputSelector).toBe('#slide-upload');
    expect(
      doc.querySelector('#slide-upload')?.getAttribute('data-webmcp-files'),
    ).toContain('foto.png');
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('elemento no encontrado → error, sugerencias y sin ejecución', async () => {
    const { adapter } = load();
    const r = await new PromptManager(adapter).run('elimina el widget zzqx', {
      historyFile: false,
    });
    expect(r.success).toBe(false);
    expect(r.executed).toBe(false);
    expect(r.error).toMatch(/No se encontró/);
    expect(r.suggestions?.length).toBeGreaterThan(0);
  });

  it('registra el evento en el historial del dashboard', async () => {
    const { adapter } = load();
    await new PromptManager(adapter, { url: 'https://tienda.test' }).run(
      'oculta el footer',
      {
        historyFile,
      },
    );
    const events = readHistory(historyFile);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'prompt',
      ok: true,
      url: 'https://tienda.test',
    });
    expect(events[0].details?.selector).toBe('footer');
  });

  it('other con herramienta explícita no necesita localizar elemento', async () => {
    const { adapter, doc } = load();
    let clicks = 0;
    doc.querySelector('.btn-add')?.addEventListener('click', () => clicks++);
    const llm: LlmClient = {
      provider: 'ollama',
      model: 'fake',
      complete: async () =>
        '{"action":"other","target":"","parameters":{"tool":"addToCart","args":{"quantity":"3"}}}',
    };
    const r = await new PromptManager(adapter, { toolMap: parseWebMCP(CSS), llm }).run(
      'compra tres unidades',
      { historyFile: false },
    );
    expect(r.success).toBe(true);
    expect(r.match).toBeNull();
    expect(clicks).toBe(1);
    expect((doc.querySelector('#qty-input') as HTMLInputElement).value).toBe('3');
  });
});
