/**
 * Tests del servidor MCP v0.5.0: núcleo JSON-RPC, transporte stdio
 * (con streams en memoria) y API HTTP nativa.
 */
import * as http from 'http';
import { PassThrough } from 'stream';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMcpHttpServer,
  McpCore,
  startMcpStdioServer,
  type McpServerOptions,
} from '../src/exporters';
import { parseWebMCP } from '../src/parser';

const CSS = `
#buy {
  webmcp-tool: "buyNow";
  webmcp-description: "Compra inmediata";
  webmcp-param-qty: value(#qty);
}
.price { webmcp-context: "price"; webmcp-format: "currency"; }
`;

function makeOptions(extra: Partial<McpServerOptions> = {}): McpServerOptions {
  return {
    toolMap: parseWebMCP(CSS),
    cssSource: CSS,
    cssPath: 'shop.webmcp.css',
    url: 'https://shop.test',
    version: '0.5.0',
    ...extra,
  };
}

describe('McpCore', () => {
  const core = new McpCore(makeOptions());

  it('initialize devuelve serverInfo y capabilities', async () => {
    const res = (await core.dispatch({ method: 'initialize', id: 1 })) as {
      serverInfo: { name: string; version: string };
      capabilities: object;
    };
    expect(res.serverInfo.name).toBe('webmcpcss');
    expect(res.serverInfo.version).toBe('0.5.0');
    expect(res.capabilities).toHaveProperty('tools');
  });

  it('tools/list expone las herramientas con inputSchema', async () => {
    const res = (await core.dispatch({ method: 'tools/list', id: 2 })) as {
      tools: Array<{ name: string; inputSchema: { properties: object } }>;
    };
    expect(res.tools).toHaveLength(1);
    expect(res.tools[0].name).toBe('buyNow');
    expect(Object.keys(res.tools[0].inputSchema.properties)).toEqual(['qty']);
  });

  it('tools/call sin executor responde dry-run', async () => {
    const res = await core.callTool('buyNow', { qty: '2' });
    const payload = JSON.parse(res.content[0].text);
    expect(payload.dryRun).toBe(true);
    expect(payload.selector).toBe('#buy');
  });

  it('tools/call con executor devuelve su resultado', async () => {
    const withExec = new McpCore(
      makeOptions({
        execute: async (name, args) => ({ success: true, tool: name, args }),
      }),
    );
    const res = await withExec.callTool('buyNow', { qty: '3' });
    const payload = JSON.parse(res.content[0].text);
    expect(payload).toEqual({ success: true, tool: 'buyNow', args: { qty: '3' } });
  });

  it('tools/call de herramienta desconocida marca isError', async () => {
    const res = await core.callTool('nope', {});
    expect(res.isError).toBe(true);
  });

  it('tools/call captura errores del executor', async () => {
    const failing = new McpCore(
      makeOptions({
        execute: async () => {
          throw new Error('navegador caído');
        },
      }),
    );
    const res = await failing.callTool('buyNow', {});
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain('navegador caído');
  });

  it('resources/list y resources/read exponen fuente y grafo', async () => {
    const list = core.listResources();
    const uris = list.resources.map((r) => r.uri);
    expect(uris).toContain('webmcp://source');
    expect(uris).toContain('webmcp://graph');

    const src = core.readResource('webmcp://source');
    expect(src.contents[0].text).toContain('webmcp-tool');

    const graph = core.readResource('webmcp://graph');
    const parsed = JSON.parse(String(graph.contents[0].text));
    expect(parsed.tools[0].name).toBe('buyNow');
    expect(parsed.context[0].name).toBe('price');
  });

  it('método desconocido lanza -32601', async () => {
    await expect(core.dispatch({ method: 'foo/bar', id: 9 })).rejects.toMatchObject({
      code: -32601,
    });
  });
});

describe('MCP por stdio (streams en memoria)', () => {
  it('responde el handshake y tools/list, ignora notificaciones', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const done = startMcpStdioServer(makeOptions(), input, output);

    const chunks: string[] = [];
    output.on('data', (c) => chunks.push(String(c)));

    input.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n',
    );
    input.write(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
    );
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    input.write('esto no es json\n');
    input.end();
    await done;

    const lines = chunks
      .join('')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    // initialize + tools/list + error de parseo (la notificación no responde).
    expect(lines).toHaveLength(3);
    expect(lines[0].id).toBe(1);
    expect(lines[0].result.serverInfo.name).toBe('webmcpcss');
    expect(lines[1].id).toBe(2);
    expect(lines[1].result.tools[0].name).toBe('buyNow');
    expect(lines[2].error.code).toBe(-32700);
  });
});

describe('MCP por HTTP nativo', () => {
  let server: http.Server;
  let base: string;

  beforeAll(async () => {
    server = createMcpHttpServer(
      makeOptions({ execute: async (name) => ({ success: true, tool: name }) }),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('GET /api/tools', async () => {
    const res = await fetch(`${base}/api/tools`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.tools[0].name).toBe('buyNow');
  });

  it('GET /api/graph incluye context', async () => {
    const res = await fetch(`${base}/api/graph`);
    const data = await res.json();
    expect(data.url).toBe('https://shop.test');
    expect(data.context[0].name).toBe('price');
  });

  it('POST /api/call ejecuta la herramienta', async () => {
    const res = await fetch(`${base}/api/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'buyNow', args: { qty: '1' } }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(JSON.parse(data.content[0].text)).toEqual({ success: true, tool: 'buyNow' });
  });

  it('POST /api/call sin tool → 400; ruta inexistente → 404', async () => {
    const bad = await fetch(`${base}/api/call`, { method: 'POST', body: '{}' });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${base}/api/nada`);
    expect(missing.status).toBe(404);
  });
});
