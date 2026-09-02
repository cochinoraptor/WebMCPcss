/**
 * Tests de la publicación comunitaria (v0.6.0): validación, rutas y flujo
 * completo de PR contra una API de GitHub simulada (http nativo).
 */
import * as http from 'http';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  communityPathFor,
  publishToCommunity,
  validateForPublish,
} from '../src/community';

const VALID_CSS = `
#buy { webmcp-tool: "buyNow"; webmcp-param-qty: value(#qty); }
.price { webmcp-context: "price"; }
`;

describe('validateForPublish', () => {
  it('cuenta herramientas y contextos', () => {
    expect(validateForPublish(VALID_CSS)).toEqual({ tools: 1, context: 1 });
  });

  it('rechaza CSS sin declaraciones webmcp', () => {
    expect(() => validateForPublish('.a { color: red; }')).toThrow(/ninguna herramienta/);
  });

  it('rechaza CSS inválido', () => {
    expect(() => validateForPublish('esto no es css {{{')).toThrow();
  });
});

describe('communityPathFor', () => {
  it('normaliza dominios y URLs', () => {
    expect(communityPathFor('tienda.com')).toBe('community-styles/tienda.com.webmcp.css');
    expect(communityPathFor('https://www.tienda.com/x')).toBe(
      'community-styles/tienda.com.webmcp.css',
    );
  });

  it('rechaza dominios inválidos', () => {
    expect(() => communityPathFor('no-es-dominio')).toThrow(/Dominio inválido/);
  });
});

describe('publishToCommunity (API simulada)', () => {
  let server: http.Server;
  let apiBase: string;
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : undefined;
        calls.push({ method: req.method ?? '', url: req.url ?? '', body });
        const send = (status: number, data: unknown): void => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        };
        const url = req.url ?? '';
        if (url === '/user') return send(200, { login: 'colaboradora' });
        if (url.endsWith('/forks')) return send(202, {});
        if (url === '/repos/colaboradora/WebMCPcss') return send(200, { id: 1 });
        if (url.includes('/git/ref/heads/main'))
          return send(200, { object: { sha: 'abc123' } });
        if (url.includes('/git/refs')) return send(201, { ref: 'ok' });
        if (url.includes('/contents/community-styles/') && req.method === 'GET')
          return send(404, { message: 'Not Found' }); // archivo nuevo
        if (url.includes('/contents/community-styles/') && req.method === 'PUT')
          return send(201, { commit: { sha: 'def456' } });
        if (url.endsWith('/pulls'))
          return send(201, { html_url: 'https://github.com/up/repo/pull/7' });
        send(404, { message: `sin ruta: ${url}` });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    apiBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  it('hace fork → rama → commit → PR y devuelve la URL', async () => {
    const result = await publishToCommunity({
      domain: 'https://www.tienda.com',
      css: VALID_CSS,
      token: 'tok',
      apiBase,
    });
    expect(result.prUrl).toBe('https://github.com/up/repo/pull/7');
    expect(result.path).toBe('community-styles/tienda.com.webmcp.css');
    expect(result.fork).toBe('colaboradora/WebMCPcss');
    expect(result.branch).toMatch(/^community\/tienda\.com-/);

    // Secuencia de llamadas clave.
    const seq = calls.map((c) => `${c.method} ${c.url.split('?')[0]}`);
    expect(seq).toContain('GET /user');
    expect(seq.some((s) => s.startsWith('POST') && s.endsWith('/forks'))).toBe(true);
    expect(seq).toContain('POST /repos/colaboradora/WebMCPcss/git/refs');
    expect(seq).toContain(
      'PUT /repos/colaboradora/WebMCPcss/contents/community-styles/tienda.com.webmcp.css',
    );

    // El commit sube el CSS en base64 a la rama nueva.
    const put = calls.find((c) => c.method === 'PUT');
    const putBody = put?.body as { content: string; branch: string; message: string };
    expect(Buffer.from(putBody.content, 'base64').toString('utf8')).toBe(VALID_CSS);
    expect(putBody.message).toContain('añade tienda.com.webmcp.css');

    // El PR va del fork al upstream.
    const pr = calls.find((c) => c.url.endsWith('/pulls'));
    const prBody = pr?.body as { head: string; base: string; title: string };
    expect(prBody.head).toMatch(/^colaboradora:community\/tienda\.com-/);
    expect(prBody.base).toBe('main');
    expect(prBody.title).toContain('tienda.com');
  });

  it('propaga errores de la API con mensaje claro', async () => {
    await expect(
      publishToCommunity({
        domain: 'otra.com',
        css: VALID_CSS,
        token: 'tok',
        apiBase,
        upstream: {
          owner: 'cochinoraptor',
          repo: 'WebMCPcss',
          branch: 'rama-inexistente',
        },
      }),
    ).rejects.toThrow(/GitHub API/);
  });
});
