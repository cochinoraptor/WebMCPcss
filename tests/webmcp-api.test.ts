/**
 * Tests del soporte para la API imperativa de WebMCP
 * (`navigator.modelContext`).
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { DomAdapter } from '../src/adapters/dom-adapter';
import type { ApiToolSource } from '../src/adapters/page-adapter';
import { hasApiTools } from '../src/adapters/page-adapter';
import { WebMCPcss } from '../src/core';
import { parseWebMCP } from '../src/parser';
import type { RegisteredToolInfo } from '../src/types';
import {
  getRegisteredTools,
  installModelContextShim,
  invokeRegisteredTool,
  readRegisteredTools,
} from '../src/webmcp-api';

type ShimWindow = Window & { [k: string]: unknown };

/** Crea una window jsdom con el shim instalado. */
function makeWindow(html = '<!doctype html><body></body>'): ShimWindow {
  const dom = new JSDOM(html);
  const win = dom.window as unknown as ShimWindow;
  installModelContextShim(win);
  return win;
}

/** Adaptador de test: DomAdapter + fuente de herramientas API sobre jsdom. */
class TestApiAdapter extends DomAdapter implements ApiToolSource {
  constructor(private readonly win: ShimWindow) {
    super(win.document);
  }
  async listApiTools(): Promise<RegisteredToolInfo[]> {
    return readRegisteredTools(this.win);
  }
  async callApiTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return invokeRegisteredTool(this.win, name, args);
  }
}

describe('installModelContextShim', () => {
  it('instala navigator.modelContext si no existe', () => {
    const win = makeWindow();
    const nav = win.navigator as Navigator & { modelContext?: unknown };
    expect(nav.modelContext).toBeDefined();
  });

  it('captura registerTool() en el registro', () => {
    const win = makeWindow();
    const mc = (
      win.navigator as Navigator & { modelContext: { registerTool(t: unknown): void } }
    ).modelContext;
    mc.registerTool({
      name: 'searchFlights',
      description: 'Busca vuelos',
      inputSchema: { type: 'object' },
      execute: () => 'ok',
    });
    const tools = readRegisteredTools(win);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toEqual({
      name: 'searchFlights',
      description: 'Busca vuelos',
      inputSchema: { type: 'object' },
    });
  });

  it('re-registrar con el mismo nombre reemplaza la herramienta', () => {
    const win = makeWindow();
    const mc = (
      win.navigator as Navigator & { modelContext: { registerTool(t: unknown): void } }
    ).modelContext;
    mc.registerTool({ name: 'x', description: 'v1' });
    mc.registerTool({ name: 'x', description: 'v2' });
    const tools = readRegisteredTools(win);
    expect(tools).toHaveLength(1);
    expect(tools[0].description).toBe('v2');
  });

  it('rechaza herramientas sin nombre', () => {
    const win = makeWindow();
    const mc = (
      win.navigator as Navigator & { modelContext: { registerTool(t: unknown): void } }
    ).modelContext;
    expect(() => mc.registerTool({ description: 'sin nombre' })).toThrow(TypeError);
  });
});

describe('invokeRegisteredTool', () => {
  it('ejecuta la herramienta con argumentos y devuelve el resultado', async () => {
    const win = makeWindow();
    const mc = (
      win.navigator as Navigator & { modelContext: { registerTool(t: unknown): void } }
    ).modelContext;
    mc.registerTool({
      name: 'sum',
      execute: (args: { a: number; b: number }) => args.a + args.b,
    });
    expect(await invokeRegisteredTool(win, 'sum', { a: 2, b: 3 })).toBe(5);
  });

  it('lanza error para herramientas no registradas', async () => {
    const win = makeWindow();
    await expect(invokeRegisteredTool(win, 'nope', {})).rejects.toThrow('no registrada');
  });
});

describe('WebMCPcss + API imperativa', () => {
  it('getRegisteredTools devuelve las herramientas del adaptador', async () => {
    const win = makeWindow();
    const mc = (
      win.navigator as Navigator & { modelContext: { registerTool(t: unknown): void } }
    ).modelContext;
    mc.registerTool({ name: 'a' });
    mc.registerTool({ name: 'b' });
    const adapter = new TestApiAdapter(win);
    const tools = await getRegisteredTools(adapter);
    expect(tools.map((t) => t.name)).toEqual(['a', 'b']);
  });

  it('hasApiTools distingue adaptadores con y sin API', () => {
    const win = makeWindow();
    expect(hasApiTools(new TestApiAdapter(win))).toBe(true);
    expect(hasApiTools(new DomAdapter(win.document))).toBe(false);
  });

  it('execute() cae a la API cuando la herramienta no está en el CSS', async () => {
    const win = makeWindow();
    const mc = (
      win.navigator as Navigator & { modelContext: { registerTool(t: unknown): void } }
    ).modelContext;
    mc.registerTool({
      name: 'greet',
      execute: (args: { who: string }) => `hola ${args.who}`,
    });
    const webmcp = new WebMCPcss(parseWebMCP(''), new TestApiAdapter(win));
    const result = await webmcp.execute('greet', { who: 'agente' });
    expect(result.success).toBe(true);
    expect(result.via).toBe('api');
    expect(result.data?.result).toBe('hola agente');
  });

  it('las herramientas CSS tienen prioridad sobre las de la API', async () => {
    const win = makeWindow('<!doctype html><body><button id="go">Ir</button></body>');
    const mc = (
      win.navigator as Navigator & { modelContext: { registerTool(t: unknown): void } }
    ).modelContext;
    mc.registerTool({ name: 'go', execute: () => 'api' });
    const map = parseWebMCP('#go { webmcp-tool: "go"; }');
    const webmcp = new WebMCPcss(map, new TestApiAdapter(win));
    const result = await webmcp.execute('go');
    expect(result.success).toBe(true);
    expect(result.via).toBe('css');
  });

  it('validate({includeApi:true}) añade entradas kind=api', async () => {
    const win = makeWindow();
    const mc = (
      win.navigator as Navigator & { modelContext: { registerTool(t: unknown): void } }
    ).modelContext;
    mc.registerTool({ name: 'apiTool' });
    const webmcp = new WebMCPcss(parseWebMCP(''), new TestApiAdapter(win));
    const report = await webmcp.validate('test', { includeApi: true });
    expect(report.entries).toEqual([
      { name: 'apiTool', kind: 'api', selector: '(navigator.modelContext)', ok: true },
    ]);
  });
});
