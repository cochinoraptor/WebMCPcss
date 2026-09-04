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

/**
 * Cierra un servidor HTTP también en Node 18, donde `server.close()` no
 * cierra las conexiones keep-alive ociosas que deja `fetch` y espera al
 * `keepAliveTimeout` (5 s). Node 19+ ya lo hace automáticamente.
 */
async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
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
    await closeServer(server);
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

describe('Herramienta MCP webmcpcss_prompt (v0.7.0)', () => {
  const calls: Array<Record<string, unknown>> = [];
  const promptExecutor = async (args: Record<string, unknown>) => {
    calls.push(args);
    return {
      success: args.prompt !== 'falla',
      action: { action: 'hide', target: String(args.prompt) },
      dryRun: args.dryRun === true,
      evidence: args.screenshot ? { screenshotBase64: 'iVBORw0KGgo=' } : undefined,
    };
  };

  it('tools/list solo la expone cuando hay ejecutor de prompts', async () => {
    const without = new McpCore(makeOptions());
    expect(without.listTools().tools.map((t) => t.name)).toEqual(['buyNow']);
    const withPrompt = new McpCore(makeOptions({ prompt: promptExecutor }));
    const names = withPrompt.listTools().tools.map((t) => t.name);
    expect(names).toEqual(['buyNow', 'webmcpcss_prompt']);
    const schema = withPrompt.listTools().tools[1] as {
      inputSchema: { required: string[]; properties: Record<string, unknown> };
    };
    expect(schema.inputSchema.required).toEqual(['prompt']);
    expect(Object.keys(schema.inputSchema.properties)).toEqual(
      expect.arrayContaining(['prompt', 'url', 'files', 'dryRun', 'screenshot']),
    );
  });

  it('tools/call webmcpcss_prompt delega en el ejecutor y devuelve JSON', async () => {
    const core = new McpCore(makeOptions({ prompt: promptExecutor }));
    const res = (await core.dispatch({
      id: 9,
      method: 'tools/call',
      params: {
        name: 'webmcpcss_prompt',
        arguments: { prompt: 'oculta el popup', files: ['a.png', 7], dryRun: true },
      },
    })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };
    expect(res.isError).toBeUndefined();
    const payload = JSON.parse(res.content[0].text ?? '{}');
    expect(payload.action.action).toBe('hide');
    expect(payload.dryRun).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      prompt: 'oculta el popup',
      files: ['a.png'],
      dryRun: true,
    });
  });

  it('devuelve la captura como bloque image y marca isError si falla', async () => {
    const core = new McpCore(makeOptions({ prompt: promptExecutor }));
    const shot = await core.callTool('webmcpcss_prompt', {
      prompt: 'x',
      screenshot: true,
    });
    expect(shot.content).toHaveLength(2);
    expect(shot.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(JSON.parse(String(shot.content[0].text)).evidence.screenshotBase64).toBe(
      '<image>',
    );

    const failed = await core.callTool('webmcpcss_prompt', { prompt: 'falla' });
    expect(failed.isError).toBe(true);

    const empty = await core.callTool('webmcpcss_prompt', {});
    expect(empty.isError).toBe(true);

    const disabled = await core.callTool.call(
      new McpCore(makeOptions()),
      'webmcpcss_prompt',
      {
        prompt: 'x',
      },
    );
    expect(disabled.isError).toBe(true);
  });

  it('POST /api/prompt por HTTP', async () => {
    const server = createMcpHttpServer(makeOptions({ prompt: promptExecutor }));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const ok = await fetch(`${base}/api/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'oculta el footer' }),
      });
      expect(ok.status).toBe(200);
      const data = await ok.json();
      expect(JSON.parse(data.content[0].text).success).toBe(true);

      const bad = await fetch(`${base}/api/prompt`, { method: 'POST', body: '{}' });
      expect(bad.status).toBe(422);
      const notJson = await fetch(`${base}/api/prompt`, { method: 'POST', body: '{{{' });
      expect(notJson.status).toBe(400);
    } finally {
      await closeServer(server);
    }
  });

  it('POST /api/prompt responde 404 si el servidor no tiene ejecutor', async () => {
    const server = createMcpHttpServer(makeOptions());
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const res = await fetch(`${base}/api/prompt`, {
        method: 'POST',
        body: '{"prompt":"x"}',
      });
      expect(res.status).toBe(404);
    } finally {
      await closeServer(server);
    }
  });
});
