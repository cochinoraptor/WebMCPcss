/**
 * Tests del grabador (`webmcpcss generate`), el historial de eventos y el
 * dashboard HTTP.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildToolMapFromEvents } from '../src/core/recorder';
import { parseWebMCP, stringifyWebMCP } from '../src/parser';
import { appendEvent, historyStats, loadHistory } from '../src/utils/history';
import { startDashboard } from '../src/dashboard/server';
import type { ElementInfo } from '../src/adapters/PageAdapter';

/** Huella de un botón add real de la carta (estructura del fixture). */
function addClick(ariaLabel: string): ElementInfo {
  return {
    tag: 'button',
    id: null,
    classes: ['card-add'],
    attrs: { 'aria-label': ariaLabel },
    text: '+',
    value: null,
  };
}

describe('grabador: buildToolMapFromEvents', () => {
  it('deduplica por huella y genera un tool map válido', () => {
    const events = [
      addClick('Agregar Club dorada al pedido'),
      addClick('Agregar Corona al pedido'), // misma familia: mismo botón
      addClick('Agregar Chouffe al pedido'),
      {
        tag: 'button',
        id: null,
        classes: ['cat-chip', 'active'],
        attrs: {},
        text: 'Todas',
        value: null,
      },
    ];
    const map = buildToolMapFromEvents(events);
    const names = Object.keys(map.tools).sort();
    expect(names).toHaveLength(2);
    // El botón add compartido y el chip son herramientas distintas.
    const selectors = names.map((n) => map.tools[n].selector);
    expect(selectors).toContain('.card-add');
    expect(selectors).toContain('.cat-chip');
    // El CSS generado re-parsea al mismo mapa (round-trip del grabado).
    expect(parseWebMCP(stringifyWebMCP(map))).toEqual(map);
  });

  it('aprovecha el aria-label como parámetro y descripción', () => {
    const map = buildToolMapFromEvents([addClick('Agregar Corona al pedido')]);
    const tool = Object.values(map.tools)[0];
    expect(tool.params['label']).toEqual({ source: 'attr', value: 'aria-label' });
    expect(tool.description).toContain('Agregar Corona');
  });

  it('ignora clases de scope de Vue al inferir el selector', () => {
    const map = buildToolMapFromEvents([
      { ...addClick('x'), classes: ['data-v-abc', 'card-add'] },
    ]);
    expect(Object.values(map.tools)[0].selector).toBe('.card-add');
  });
});

describe('historial de eventos', () => {
  function tmpDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-history-'));
  }

  it('appendEvent persiste, rellena ts y recorta a 500', () => {
    const dir = tmpDir();
    const stored = appendEvent(
      { type: 'validate', target: 'https://x.com', ok: true },
      dir,
    );
    expect(stored.ts).toBeDefined();
    for (let i = 0; i < 510; i++) {
      appendEvent({ type: 'repair', target: 'https://x.com' }, dir);
    }
    const events = loadHistory(dir);
    expect(events).toHaveLength(500);
    expect(events[0].type).toBe('repair'); // los más antiguos se descartan
    expect(historyStats(events)).toMatchObject({ total: 500, repair: 500 });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loadHistory devuelve [] si no existe el archivo', () => {
    const dir = tmpDir();
    expect(loadHistory(dir)).toEqual([]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('dashboard HTTP', () => {
  it('sirve la UI, el estado y acepta eventos', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-dash-'));
    const cssPath = path.join(cwd, 'map.css');
    fs.writeFileSync(cssPath, '.btn { webmcp-tool: "buy"; }');
    const server = await startDashboard({ port: 0, cssPath, cwd });
    const address = server.address();
    if (typeof address !== 'object' || !address) throw new Error('sin dirección');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const index = await fetch(`${base}/`);
      expect(index.status).toBe(200);
      expect(await index.text()).toContain('WebMCPcss');

      const state = (await (await fetch(`${base}/api/state`)).json()) as {
        toolMap: { tools: Record<string, unknown> };
        stats: Record<string, number>;
      };
      expect(Object.keys(state.toolMap.tools)).toEqual(['buy']);

      const posted = await fetch(`${base}/api/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'validate', target: 'https://x.com', ok: true }),
      });
      expect(posted.status).toBe(201);
      const state2 = (await (await fetch(`${base}/api/state`)).json()) as {
        stats: Record<string, number>;
      };
      expect(state2.stats['validate']).toBe(1);
    } finally {
      server.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('POST /api/inject valida la URL, delega y registra el evento', async () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-dash-'));
    const calls: { url: string; communityDir?: string }[] = [];
    const server = await startDashboard({
      port: 0,
      cwd,
      communityDir: path.join(cwd, 'styles'),
      injectImpl: async (url, opts) => {
        calls.push({ url, communityDir: opts.communityDir });
        if (url === 'https://falla.example.com') {
          throw new Error('navegador no disponible');
        }
        return {
          url,
          source: 'community',
          injected: true,
          toolMap: {
            tools: {
              buy: { selector: '.btn', params: {}, trigger: { event: 'click' } },
            },
            context: {},
          },
        };
      },
    });
    const address = server.address();
    if (typeof address !== 'object' || !address) throw new Error('sin dirección');
    const base = `http://127.0.0.1:${address.port}`;
    const post = (body: string) =>
      fetch(`${base}/api/inject`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    try {
      // URL inválida → 400 sin llegar a inyectar.
      const bad = await post(JSON.stringify({ url: 'ftp://no-http.com' }));
      expect(bad.status).toBe(400);
      expect(calls).toHaveLength(0);

      // URL válida → delega con el communityDir configurado y responde.
      const ok = await post(JSON.stringify({ url: 'https://tienda.example.com' }));
      expect(ok.status).toBe(200);
      const result = (await ok.json()) as { injected: boolean; source: string };
      expect(result.injected).toBe(true);
      expect(result.source).toBe('community');
      expect(calls).toEqual([
        { url: 'https://tienda.example.com', communityDir: path.join(cwd, 'styles') },
      ]);

      // El evento queda en el historial del dashboard.
      const state = (await (await fetch(`${base}/api/state`)).json()) as {
        stats: Record<string, number>;
        history: { type: string; target?: string }[];
      };
      expect(state.stats['inject']).toBe(1);
      expect(state.history.at(-1)?.target).toBe('https://tienda.example.com');

      // Errores del inyector → 500 con mensaje, sin romper el servidor.
      const failing = await post(JSON.stringify({ url: 'https://falla.example.com' }));
      expect(failing.status).toBe(500);
      expect(await failing.text()).toContain('navegador no disponible');
    } finally {
      server.close();
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});
