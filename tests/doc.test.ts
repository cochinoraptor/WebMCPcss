/**
 * Tests de Doc-MCP (v1.0.0): modelo de documentación, render HTML/MD/
 * llms.txt/AGENTS.md/JSON y servidor HTTP con recarga.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDocModel,
  createDocServer,
  generateDocs,
  renderAgentsMd,
  renderHtml,
  renderLlmsTxt,
  renderMarkdown,
  startDocServer,
} from '../src/doc';
import { parseWebMCP } from '../src/parser';

const css = `
#search-btn { webmcp-tool: "buscar"; webmcp-description: "Busca productos por texto"; webmcp-param-query: value(#q); webmcp-confirmation: "none"; }
#pay { webmcp-tool: "pagarPedido"; webmcp-description: "Paga el pedido"; webmcp-confirmation: "#ok"; webmcp-permissions: "full"; webmcp-payment: "required"; webmcp-network: "base"; webmcp-amount: "0.5 USDC"; webmcp-intent: "submit"; }
div > div > span:nth-child(3) > a { webmcp-tool: "fragil"; webmcp-description: "Selector frágil"; }
.price { webmcp-context: "precio"; webmcp-format: "currency"; }
`;
const map = parseWebMCP(css);

describe('doc · buildDocModel', () => {
  it('describe tools, parámetros, pagos, permisos, fragilidad y ejemplos', () => {
    const model = buildDocModel(map, {
      title: 'Tienda',
      url: 'https://tienda.test',
      cssPath: 'tienda.webmcp.css',
    });
    expect(model.title).toBe('Tienda');
    expect(model.stats).toMatchObject({
      tools: 3,
      context: 1,
      params: 1,
      withConfirmation: 1,
    });
    expect(model.stats.fragile).toBeGreaterThanOrEqual(1);
    const buscar = model.tools.find((t) => t.name === 'buscar')!;
    expect(buscar.params[0]).toMatchObject({
      name: 'query',
      source: 'value',
      selector: '#q',
    });
    expect(buscar.examples.cli).toContain('webmcpcss run');
    expect(buscar.examples.cli).toContain('https://tienda.test');
    expect(buscar.examples.mcp).toMatchObject({ method: 'tools/call' });
    expect(buscar.examples.rest).toContain('buscar');
    expect(buscar.examples.prompt).toBeTruthy();
    const pay = model.tools.find((t) => t.name === 'pagarPedido')!;
    expect(pay.payment).toEqual({ required: true, network: 'base', amount: '0.5 USDC' });
    expect(pay.permissions).toBe('full');
    expect(pay.intent).toBe('submit');
    expect(pay.confirmation).toBe('#ok');
    expect(model.tools.find((t) => t.name === 'fragil')!.fragility?.level).not.toBe(
      'low',
    );
    expect(model.context[0]).toMatchObject({ name: 'precio', format: 'currency' });
  });

  it('puede desactivar el análisis de fragilidad', () => {
    const model = buildDocModel(map, { fragility: false });
    expect(model.tools.every((t) => t.fragility === undefined)).toBe(true);
    expect(model.stats.fragile).toBe(0);
  });
});

describe('doc · renderers', () => {
  const model = buildDocModel(map, { title: 'Tienda', url: 'https://tienda.test' });

  it('HTML autocontenido con búsqueda, filtros y pestañas (sin recursos externos)', () => {
    const html = renderHtml(model);
    expect(html).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('Tienda');
    expect(html).toContain('buscar');
    expect(html).toContain('pagarPedido');
    expect(html).toMatch(/<input[^>]+type="search"/);
    expect(html).toContain('data-tab');
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+href="http/);
    // Escapa contenido peligroso.
    const evil = buildDocModel(
      parseWebMCP(
        '#a { webmcp-tool: "x"; webmcp-description: "<script>alert(1)</script>"; }',
      ),
    );
    expect(renderHtml(evil)).not.toContain('<script>alert(1)</script>');
  });

  it('Markdown, llms.txt y AGENTS.md contienen las herramientas y avisos clave', () => {
    const md = renderMarkdown(model);
    expect(md).toMatch(/^# /);
    expect(md).toContain('[`buscar`](#buscar)');
    expect(md).toContain('pagarPedido');
    expect(md).toContain('webmcpcss run');
    const llms = renderLlmsTxt(model);
    expect(llms.startsWith('# ')).toBe(true);
    expect(llms).toContain('- buscar: Busca productos por texto');
    expect(llms).toMatch(/pagarPedido.*(pago|USDC|confirmaci)/i);
    const agents = renderAgentsMd(model);
    expect(agents).toContain('# AGENTS.md');
    expect(agents).toContain('### pagarPedido');
    expect(agents).toMatch(/requiere confirmación/i);
    expect(agents).toMatch(/0\.5 USDC/);
  });

  it('generateDocs devuelve los cinco archivos y doc.json es el modelo serializado', () => {
    const docs = generateDocs(map, { title: 'T' });
    expect(Object.keys(docs).sort()).toEqual([
      'AGENTS.md',
      'README.md',
      'doc.json',
      'index.html',
      'llms.txt',
    ]);
    const json = JSON.parse(docs['doc.json']);
    expect(json.title).toBe('T');
    expect(json.tools).toHaveLength(3);
  });
});

describe('doc · servidor', () => {
  let server: http.Server;
  let port: number;
  let cssPath: string;

  beforeAll(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-doc-'));
    cssPath = path.join(dir, 'site.webmcp.css');
    fs.writeFileSync(cssPath, css);
    server = createDocServer({ cssPath, title: 'Docs test' });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    (
      server as http.Server & { closeAllConnections?: () => void }
    ).closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const get = async (p: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`);
    return {
      status: res.status,
      type: res.headers.get('content-type') ?? '',
      body: await res.text(),
    };
  };

  it('sirve index, README, doc.json, llms.txt y AGENTS.md con sus MIME', async () => {
    const index = await get('/');
    expect(index.status).toBe(200);
    expect(index.type).toContain('text/html');
    expect(index.body).toContain('Docs test');
    expect((await get('/README.md')).type).toContain('text/markdown');
    const json = await get('/doc.json');
    expect(json.type).toContain('application/json');
    expect(JSON.parse(json.body).tools.length).toBe(3);
    expect((await get('/llms.txt')).type).toContain('text/plain');
    expect((await get('/AGENTS.md')).body).toContain('AGENTS.md');
    expect((await get('/nada')).status).toBe(404);
  });

  it('recarga el CSS en cada petición (sin reiniciar)', async () => {
    fs.appendFileSync(
      cssPath,
      '\n#new { webmcp-tool: "nuevaTool"; webmcp-description: "Nueva"; }\n',
    );
    const json = await get('/doc.json');
    expect(JSON.parse(json.body).tools.map((t: { name: string }) => t.name)).toContain(
      'nuevaTool',
    );
  });

  it('startDocServer arranca en un puerto libre y devuelve la URL', async () => {
    const started = await startDocServer({ cssPath, port: 0, host: '127.0.0.1' });
    try {
      expect(started.url).toMatch(/^http:\/\/localhost:\d+$/);
      const port = Number(started.url.split(':').pop());
      const res = await fetch(`http://127.0.0.1:${port}/llms.txt`);
      expect(res.status).toBe(200);
    } finally {
      (
        started.server as http.Server & { closeAllConnections?: () => void }
      ).closeAllConnections?.();
      await new Promise<void>((resolve) => started.server.close(() => resolve()));
    }
    // Puerto ocupado → rechaza en vez de colgarse.
    await expect(startDocServer({ cssPath, port, host: '127.0.0.1' })).rejects.toThrow(
      /EADDRINUSE/,
    );
  });

  it('responde 500 legible si el CSS desaparece', async () => {
    fs.unlinkSync(cssPath);
    const res = await get('/doc.json');
    expect(res.status).toBe(500);
    fs.writeFileSync(cssPath, css);
  });
});
