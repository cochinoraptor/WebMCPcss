/**
 * Integración de la CLI `webmcpcss components …` contra un hub servido en
 * local (requiere build previo: npm run build). Los tests se saltan si no
 * existe dist/src/cli.js (como el resto de integraciones CLI del repo).
 */
import { execFile, execFileSync, spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import type { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildHubSite } from '../src/hub/site';

const CLI = path.resolve(__dirname, '../dist/src/cli.js');
const COMPONENTS = path.resolve(__dirname, '../components');

function serveStatic(dir: string): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dir, p);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('404');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      }),
    ),
  );
}

describe.skipIf(!fs.existsSync(CLI))('CLI components (integración)', () => {
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcpcss-cli-site-'));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcpcss-cli-work-'));
  let server: http.Server;
  let hubUrl: string;

  // Asíncrono a propósito: el servidor del hub vive en este mismo hilo, así que
  // una ejecución síncrona (execFileSync) bloquearía sus respuestas.
  const execFileAsync = promisify(execFile);
  const run = async (args: string[], cwd = work): Promise<string> => {
    const { stdout } = await execFileAsync('node', [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, WEBMCPCSS_HUB_URL: hubUrl, NO_COLOR: '1', FORCE_COLOR: '0' },
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  };

  beforeAll(async () => {
    buildHubSite({
      componentsDir: COMPONENTS,
      siteDir: site,
      baseUrl: 'http://placeholder',
      generatedAt: 'x',
    });
    const s = await serveStatic(site);
    server = s.server;
    hubUrl = s.url;
  });
  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    fs.rmSync(site, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  });

  it('components list filtra y devuelve JSON', async () => {
    const out = JSON.parse(
      await run([
        'components',
        'list',
        '--library',
        'tailwind',
        '--category',
        'forms',
        '--json',
      ]),
    );
    expect(out.source).toBe('remote');
    expect(out.hub).toBe(hubUrl);
    expect(out.components.map((c: { id: string }) => c.id).sort()).toEqual([
      'tailwind-contact-form',
      'tailwind-login-form',
    ]);
    const human = await run(['components', 'list', '--search', 'checkout']);
    expect(human).toContain('core-checkout-form');
    expect(human).toContain('Inteligentes');
    await expect(run(['components', 'list', '--category', 'nope'])).rejects.toThrow(
      /Categoría inválida/,
    );
  });

  it('components import escribe archivos, lock y fusiona; update detecta cambios', async () => {
    const out = JSON.parse(
      await run([
        'components',
        'import',
        'tailwind-button-primary',
        'core-fade-in',
        '--output',
        'src/ui',
        '--merge',
        'webmcp.css',
        '--json',
      ]),
    );
    expect(out.imported.length).toBe(2);
    expect(
      fs.existsSync(
        path.join(work, 'src/ui/tailwind-button-primary/button-primary.webmcp.css'),
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(work, 'src/ui/core-fade-in/fade-in.html'))).toBe(true);
    const lock = JSON.parse(
      fs.readFileSync(path.join(work, '.webmcpcss/components.lock.json'), 'utf8'),
    );
    expect(Object.keys(lock.components).sort()).toEqual([
      'core-fade-in',
      'tailwind-button-primary',
    ]);
    const merged = fs.readFileSync(path.join(work, 'webmcp.css'), 'utf8');
    expect(merged).toContain('@webmcpcss-component tailwind-button-primary v1.0.0');
    expect(merged).toContain('@webmcpcss-component core-fade-in v1.0.0');

    const upToDate = JSON.parse(await run(['components', 'update', '--json']));
    expect(
      upToDate.statuses.every((s: { status: string }) => s.status === 'up-to-date'),
    ).toBe(true);

    lock.components['core-fade-in'].hash = 'viejo';
    fs.writeFileSync(
      path.join(work, '.webmcpcss/components.lock.json'),
      JSON.stringify(lock),
    );
    const dry = await run(['components', 'update', '--dry-run']);
    expect(dry).toContain('core-fade-in');
    expect(dry).toMatch(/disponible 1\.0\.0/);
    const applied = JSON.parse(
      await run(['components', 'update', 'core-fade-in', '--json']),
    );
    expect(applied.statuses[0].status).toBe('updated');
  });

  it('components show, demo y publish --dry-run', async () => {
    const show = await run(['components', 'show', 'core-pulse']);
    expect(show).toContain('webmcp-animation: "pulse"');
    expect(show).toContain('data-animation="pulse"');

    const demo = JSON.parse(
      await run([
        'components',
        'demo',
        '--output',
        'demo',
        '--library',
        'bootstrap',
        '--json',
      ]),
    );
    expect(demo.components.length).toBe(10);
    expect(fs.existsSync(path.join(work, 'demo/index.html'))).toBe(true);
    expect(fs.readFileSync(path.join(work, 'demo/index.html'), 'utf8')).toContain(
      'bootstrap.min.css',
    );
    expect(fs.existsSync(path.join(work, 'demo/webmcp.css'))).toBe(true);

    fs.writeFileSync(
      path.join(work, 'mine.webmcp.css'),
      '[data-tool="hi"] { webmcp-tool: "sayHi"; webmcp-description: "Saluda"; }',
    );
    const pub = JSON.parse(
      await run([
        'components',
        'publish',
        'mine.webmcp.css',
        '--name',
        'Saludo',
        '--category',
        'buttons',
        '--library',
        'core',
        '--dry-run',
        '--json',
      ]),
    );
    expect(pub.dryRun).toBe(true);
    expect(pub.id).toBe('core-saludo');
    expect(pub.summary.tools).toBe(1);
    expect(() =>
      execFileSync(
        'node',
        [
          CLI,
          'components',
          'publish',
          'mine.webmcp.css',
          '--name',
          'Saludo',
          '--category',
          'buttons',
        ],
        {
          cwd: work,
          encoding: 'utf8',
          env: { ...process.env, GITHUB_TOKEN: '', WEBMCPCSS_HUB_URL: hubUrl },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      ),
    ).toThrow(/GITHUB_TOKEN/);
  });

  it('mcp --serve --http --hub expone /api/components y /api/tools con las tools del hub', async () => {
    const port = 18000 + Math.floor(Math.random() * 2000);
    const child = spawn(
      'node',
      [
        CLI,
        'mcp',
        '--serve',
        '--http',
        '-p',
        String(port),
        '--hub',
        '--no-prompt',
        '--no-animate',
        '--css',
        'no-existe.css',
      ],
      {
        cwd: work,
        env: { ...process.env, WEBMCPCSS_HUB_URL: hubUrl },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    try {
      let ready = false;
      for (let i = 0; i < 50 && !ready; i++) {
        await new Promise((r) => setTimeout(r, 200));
        try {
          const res = await fetch(`http://127.0.0.1:${port}/api/tools`);
          ready = res.ok;
        } catch {
          ready = false;
        }
      }
      expect(ready).toBe(true);
      const tools = (await (
        await fetch(`http://127.0.0.1:${port}/api/tools`)
      ).json()) as { tools: Array<{ name: string }> };
      expect(tools.tools.map((t) => t.name)).toEqual([
        'list_components',
        'get_component',
        'import_component',
      ]);
      const list = (await (
        await fetch(`http://127.0.0.1:${port}/api/components?search=parallax`)
      ).json()) as { components: Array<{ id: string }> };
      expect(list.components.map((c) => c.id)).toContain('core-parallax-scene');
      const call = await fetch(`http://127.0.0.1:${port}/api/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'import_component',
          args: { id: 'core-pulse', output: 'from-mcp' },
        }),
      });
      expect(call.status).toBe(200);
      expect(fs.existsSync(path.join(work, 'from-mcp/core-pulse/pulse.webmcp.css'))).toBe(
        true,
      );
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('exit', r));
    }
  });
});
