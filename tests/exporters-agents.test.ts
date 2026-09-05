/**
 * Tests v0.9.0 de los exportadores para DeerFlow (herramientas Python del
 * grupo browser + skill + extensions_config) y Flomny (servidor MCP dedicado
 * con seis herramientas de introspección/ejecución).
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import { describe, expect, it } from 'vitest';
import {
  DEERFLOW_TOOL_NAMES,
  FLOMNY_TOOL_NAMES,
  FLOMNY_TOOL_SCHEMAS,
  FlomnyMcpCore,
  buildDeerFlowConfigYaml,
  buildDeerFlowExtensions,
  buildDeerFlowSkill,
  buildDeerFlowTools,
  buildFlomnyMcpConfig,
  buildFlomnyWorkflowExample,
  createMcpHttpServer,
  exportDeerFlow,
  exportFlomny,
  exportForAgent,
  startMcpStdioServer,
  type FlomnyServerOptions,
} from '../src/exporters';
import { parseWebMCP } from '../src/parser';
import type { RepairResult, ValidationReport } from '../src/types';
import { VERSION } from '../src/version';

const CSS = `
#add-to-cart {
  webmcp-tool: "addToCart";
  webmcp-description: "Añade el producto al carrito";
  webmcp-param-quantity: value(#qty-input);
  webmcp-param-productId: attr(data-product-id);
  webmcp-confirmation: ".cart-badge";
}
.sc-1x9j8k > button { webmcp-tool: "checkout"; webmcp-param-coupon: value(#coupon); }
.total-price { webmcp-context: "cartTotal"; webmcp-format: "currency"; }
`;
const toolMap = parseWebMCP(CSS);
const ctx = { cssPath: 'tienda.webmcp.css', url: 'https://tienda.com' };

/** ¿Hay python3 disponible para validar sintaxis? */
function hasPython(): boolean {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('exportDeerFlow', () => {
  const files = exportDeerFlow(toolMap, ctx);

  it('genera los cinco archivos del paquete', () => {
    expect(Object.keys(files).sort()).toEqual(
      [
        'README.md',
        'deerflow-tools.yaml',
        'extensions_config.json',
        'skills/webmcp-browser/SKILL.md',
        'webmcp_tools.py',
      ].sort(),
    );
  });

  it('el módulo Python define las cinco herramientas del grupo browser con @tool', () => {
    const py = files['webmcp_tools.py'];
    for (const name of DEERFLOW_TOOL_NAMES) {
      expect(py).toMatch(new RegExp(`@tool\\ndef ${name}\\(`));
    }
    expect(py).toContain('from langchain_core.tools import tool');
    expect(py).toContain('BROWSER_TOOLS = [');
    expect(py).toContain(`webmcpcss v${VERSION}`);
  });

  it('incrusta el grafo estático como mensaje estructurado webmcp_graph', () => {
    const py = files['webmcp_tools.py'];
    const m = py.match(/STATIC_GRAPH: dict\[str, Any\] = json\.loads\((".*")\)\n/);
    expect(m).not.toBeNull();
    const graph = JSON.parse(JSON.parse(m![1]));
    expect(graph.type).toBe('webmcp_graph');
    expect(graph.url).toBe('https://tienda.com');
    expect(graph.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      'addToCart',
      'checkout',
    ]);
    expect(graph.tools[0].selector).toBe('#add-to-cart');
    expect(graph.context[0]).toEqual({
      name: 'cartTotal',
      selector: '.total-price',
      format: 'currency',
    });
  });

  it('cada herramienta devuelve un mensaje estructurado con su tipo', () => {
    const py = files['webmcp_tools.py'];
    for (const kind of [
      'webmcp_graph',
      'webmcp_selector',
      'webmcp_repair',
      'webmcp_prompt',
      'webmcp_animation',
    ]) {
      expect(py).toMatch(new RegExp(`_structured\\(\\s*"${kind}"`));
    }
  });

  it.skipIf(!hasPython())('el módulo Python es sintácticamente válido', () => {
    const tmp = path.join(os.tmpdir(), `webmcp_tools_${process.pid}.py`);
    fs.writeFileSync(tmp, files['webmcp_tools.py']);
    try {
      execFileSync('python3', [
        '-c',
        `import ast,sys; ast.parse(open(sys.argv[1]).read())`,
        tmp,
      ]);
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('el YAML declara el grupo browser y una entrada por herramienta', () => {
    const yaml = buildDeerFlowConfigYaml(ctx);
    expect(yaml).toContain('tool_groups:\n  - name: browser');
    for (const name of DEERFLOW_TOOL_NAMES) {
      expect(yaml).toContain(
        `  - name: ${name}\n    group: browser\n    use: webmcp_tools:${name}`,
      );
    }
    expect(yaml).toContain('WEBMCP_CSS=tienda.webmcp.css');
  });

  it('extensions_config.json registra el servidor MCP con routing hints y la skill', () => {
    const cfg = JSON.parse(buildDeerFlowExtensions(toolMap, ctx));
    const srv = cfg.mcpServers.webmcpcss;
    expect(srv.enabled).toBe(true);
    expect(srv.type).toBe('stdio');
    expect(srv.args).toEqual([
      'mcp',
      '--serve',
      '--css',
      'tienda.webmcp.css',
      '--url',
      'https://tienda.com',
    ]);
    expect(srv.routing.mode).toBe('prefer');
    expect(srv.routing.keywords).toEqual(
      expect.arrayContaining(['webmcp', 'addToCart', 'checkout']),
    );
    expect(cfg.skills['webmcp-browser'].enabled).toBe(true);
  });

  it('la skill tiene frontmatter con allowed-tools y describe el flujo', () => {
    const skill = buildDeerFlowSkill(toolMap, ctx);
    expect(skill).toMatch(
      /^---\nname: webmcp-browser\ndescription: .+addToCart, checkout.+\nlicense: MIT\nallowed-tools:\n/,
    );
    for (const name of DEERFLOW_TOOL_NAMES) expect(skill).toContain(`  - ${name}`);
    expect(skill).toContain('"type": "webmcp_graph"');
    expect(skill).toContain('- `addToCart` — Añade el producto al carrito');
  });

  it('buildDeerFlowTools sin URL deja WEBMCP_URL vacío', () => {
    expect(buildDeerFlowTools(toolMap, { cssPath: 'x.webmcp.css' })).toContain(
      'WEBMCP_URL = os.environ.get("WEBMCP_URL", "")',
    );
  });

  it('exportForAgent("deerflow") y sin URL', () => {
    const { files: f, note } = exportForAgent('deerflow', toolMap, {
      cssPath: 'x.webmcp.css',
    });
    expect(note).toContain('DeerFlow');
    expect(f['webmcp_tools.py']).toContain(
      'WEBMCP_URL = os.environ.get("WEBMCP_URL", "")',
    );
    expect(
      JSON.parse(f['extensions_config.json']).mcpServers.webmcpcss.args,
    ).not.toContain('--url');
  });
});

describe('exportFlomny · archivos', () => {
  it('genera config MCP, workflow de ejemplo y README', () => {
    const files = exportFlomny(toolMap, ctx);
    expect(Object.keys(files).sort()).toEqual([
      'README.md',
      'flomny-mcp.json',
      'workflow.example.json',
    ]);
    const cfg = JSON.parse(buildFlomnyMcpConfig(ctx));
    expect(cfg.mcpServers['webmcpcss-flomny'].args).toEqual([
      'mcp',
      '--serve',
      '--flomny',
      '--css',
      'tienda.webmcp.css',
      '--url',
      'https://tienda.com',
    ]);
    const wf = JSON.parse(buildFlomnyWorkflowExample(toolMap, ctx));
    expect(wf.steps.map((s: { tool: string }) => s.tool)).toEqual([
      'list_tools',
      'get_tool_info',
      'get_selector_status',
      'execute_prompt',
      'execute_prompt',
    ]);
    expect(wf.steps[2].on_failure.tool).toBe('suggest_repair');
    expect(files['README.md']).toContain('--flomny');
    for (const name of FLOMNY_TOOL_NAMES)
      expect(files['README.md']).toContain(`\`${name}\``);
  });

  it('exportForAgent("flomny") incluye la nota', () => {
    const { note } = exportForAgent('flomny', toolMap, ctx);
    expect(note).toContain('--flomny');
  });
});

/** Extrae el JSON del primer bloque de texto de un resultado MCP. */
function payload(result: { content: Array<Record<string, unknown>>; isError?: boolean }) {
  return JSON.parse(String(result.content[0].text));
}

describe('FlomnyMcpCore', () => {
  const base: FlomnyServerOptions = {
    toolMap,
    cssPath: 'tienda.webmcp.css',
    url: 'https://tienda.com',
  };

  it('initialize anuncia webmcpcss-flomny con la versión del paquete', async () => {
    const core = new FlomnyMcpCore(base);
    const init = (await core.dispatch({ id: 1, method: 'initialize', params: {} })) as {
      serverInfo: { name: string; version: string };
    };
    expect(init.serverInfo).toEqual({ name: 'webmcpcss-flomny', version: VERSION });
  });

  it('tools/list expone exactamente las seis herramientas Flomny', () => {
    const core = new FlomnyMcpCore(base);
    const names = core.listTools().tools.map((t) => t.name);
    expect(names).toEqual([...FLOMNY_TOOL_NAMES]);
    expect(FLOMNY_TOOL_SCHEMAS.every((s) => typeof s.description === 'string')).toBe(
      true,
    );
  });

  it('list_tools devuelve el catálogo con fragilidad y framework', async () => {
    const core = new FlomnyMcpCore(base);
    const res = payload(await core.callTool('list_tools', { includeContext: true }));
    expect(res.count).toBe(2);
    const checkout = res.tools.find((t: { name: string }) => t.name === 'checkout');
    expect(checkout.fragility).toBe('high');
    expect(checkout.framework).toBe('styled-components');
    const add = res.tools.find((t: { name: string }) => t.name === 'addToCart');
    expect(add.params.sort()).toEqual(['productId', 'quantity']);
    expect(add.framework).toBeNull();
    expect(res.context).toEqual([
      { name: 'cartTotal', selector: '.total-price', format: 'currency' },
    ]);
    const noCtx = payload(await core.callTool('list_tools', {}));
    expect(noCtx.context).toBeUndefined();
  });

  it('get_tool_info detalla parámetros, confirmación y fragilidad; error si no existe', async () => {
    const core = new FlomnyMcpCore(base);
    const info = payload(await core.callTool('get_tool_info', { name: 'addToCart' }));
    expect(info.selector).toBe('#add-to-cart');
    expect(info.params.quantity).toEqual({
      source: 'value',
      selector: '#qty-input',
      value: null,
    });
    expect(info.params.productId).toEqual({
      source: 'attr',
      selector: null,
      value: 'data-product-id',
    });
    expect(info.confirmation).toBe('.cart-badge');
    expect(info.trigger).toEqual({ event: 'click' });
    expect(info.fragility.level).toBe('low');
    const missing = await core.callTool('get_tool_info', { name: 'nope' });
    expect(missing.isError).toBe(true);
    expect(payload(missing).available).toEqual(['addToCart', 'checkout']);
  });

  it('get_selector_status sin validador responde solo con análisis estático', async () => {
    const core = new FlomnyMcpCore(base);
    const st = payload(await core.callTool('get_selector_status', { tool: 'checkout' }));
    expect(st.selector).toBe('.sc-1x9j8k > button');
    expect(st.fragility).toBe('high');
    expect(st.framework).toBe('styled-components');
    expect(st.checked).toBe(false);
    expect(st.exists).toBeNull();
    expect(st.suggestions.length).toBeGreaterThan(0);
    const bad = await core.callTool('get_selector_status', {});
    expect(bad.isError).toBe(true);
  });

  it('get_selector_status con validador informa exists/checked', async () => {
    const report: ValidationReport = {
      url: 'https://tienda.com',
      total: 2,
      passed: 1,
      failed: 1,
      entries: [
        { name: 'addToCart', kind: 'tool', selector: '#add-to-cart', ok: true },
        { name: 'checkout', kind: 'tool', selector: '.sc-1x9j8k > button', ok: false },
      ],
    };
    const seen: Array<string | undefined> = [];
    const core = new FlomnyMcpCore({
      ...base,
      validateSelectors: async (url) => {
        seen.push(url);
        return report;
      },
    });
    const ok = payload(
      await core.callTool('get_selector_status', {
        selector: '#add-to-cart',
        url: 'https://otra.com',
      }),
    );
    expect(ok.exists).toBe(true);
    expect(ok.checked).toBe(true);
    expect(seen).toEqual(['https://otra.com']);
    const broken = payload(
      await core.callTool('get_selector_status', { tool: 'checkout' }),
    );
    expect(broken.exists).toBe(false);
    const unknown = payload(
      await core.callTool('get_selector_status', { selector: '#no-en-informe' }),
    );
    expect(unknown.checked).toBe(false);
  });

  it('get_selector_status captura errores del validador', async () => {
    const core = new FlomnyMcpCore({
      ...base,
      validateSelectors: async () => {
        throw new Error('navegador caído');
      },
    });
    const st = payload(await core.callTool('get_selector_status', { selector: '#x' }));
    expect(st.error).toBe('navegador caído');
    expect(st.fragility).toBe('low');
  });

  it('suggest_repair sin reparador devuelve heurísticas y pista', async () => {
    const core = new FlomnyMcpCore(base);
    const res = payload(await core.callTool('suggest_repair', { tool: 'checkout' }));
    expect(res.repairs).toEqual([]);
    expect(res.heuristics.length).toBeGreaterThan(0);
    expect(res.hint).toMatch(/--url/);
    expect((await core.callTool('suggest_repair', { tool: 'nope' })).isError).toBe(true);
  });

  it('suggest_repair con reparador filtra por herramienta y nunca aplica', async () => {
    const repairs: RepairResult[] = [
      {
        name: 'checkout',
        kind: 'tool',
        repaired: true,
        oldSelector: '.sc-1x9j8k > button',
        newSelector: '#checkout',
        score: 0.91,
      },
      { name: 'addToCart', kind: 'tool', repaired: false, oldSelector: '#add-to-cart' },
    ];
    const core = new FlomnyMcpCore({ ...base, suggestRepairs: async () => repairs });
    const one = payload(await core.callTool('suggest_repair', { tool: 'checkout' }));
    expect(one.applied).toBe(false);
    expect(one.repairs).toEqual([repairs[0]]);
    const all = payload(await core.callTool('suggest_repair', {}));
    expect(all.repairs).toHaveLength(2);
    const failing = new FlomnyMcpCore({
      ...base,
      suggestRepairs: async () => {
        throw new Error('sin visión');
      },
    });
    expect((await failing.callTool('suggest_repair', {})).isError).toBe(true);
  });

  it('execute_prompt y apply_animation delegan en los ejecutores', async () => {
    const calls: string[] = [];
    const core = new FlomnyMcpCore({
      ...base,
      prompt: async (args) => {
        calls.push(`prompt:${args.prompt}:${args.dryRun}`);
        return { success: true, action: 'hide' };
      },
      animate: async (args) => {
        calls.push(`animate:${args.animationFile}:${args.strategy}`);
        return { success: true, dryRun: args.dryRun };
      },
    });
    const p = payload(
      await core.callTool('execute_prompt', { prompt: 'oculta el popup', dryRun: true }),
    );
    expect(p.action).toBe('hide');
    const a = payload(
      await core.callTool('apply_animation', {
        animationFile: 'hero.webmcp.css',
        strategy: 'merge',
        dryRun: true,
      }),
    );
    expect(a.dryRun).toBe(true);
    expect(calls).toEqual([
      'prompt:oculta el popup:true',
      'animate:hero.webmcp.css:merge',
    ]);
  });

  it('execute_prompt sin ejecutor y herramienta desconocida son errores', async () => {
    const core = new FlomnyMcpCore(base);
    expect((await core.callTool('execute_prompt', { prompt: 'x' })).isError).toBe(true);
    expect((await core.callTool('apply_animation', { css: 'x' })).isError).toBe(true);
    const unknown = await core.callTool('addToCart', {});
    expect(unknown.isError).toBe(true);
    expect(payload(unknown).error).toContain('list_tools');
  });

  it('sirve por stdio con el núcleo Flomny', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const done = startMcpStdioServer(new FlomnyMcpCore(base), input, output);
    let buffer = '';
    output.on('data', (c) => (buffer += c));
    input.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n',
    );
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
    input.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'get_tool_info', arguments: { name: 'checkout' } },
      }) + '\n',
    );
    await new Promise((r) => setTimeout(r, 50));
    input.end();
    await done;
    const lines = buffer
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines[0].result.serverInfo.name).toBe('webmcpcss-flomny');
    expect(lines[1].result.tools).toHaveLength(6);
    expect(JSON.parse(lines[2].result.content[0].text).selector).toBe(
      '.sc-1x9j8k > button',
    );
  });

  it('sirve por HTTP con el núcleo Flomny (/api/tools y /api/call)', async () => {
    const server = createMcpHttpServer(new FlomnyMcpCore(base));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      const tools = (await (
        await fetch(`http://127.0.0.1:${port}/api/tools`)
      ).json()) as {
        tools: Array<{ name: string }>;
      };
      expect(tools.tools.map((t) => t.name)).toEqual([...FLOMNY_TOOL_NAMES]);
      const res = await fetch(`http://127.0.0.1:${port}/api/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: 'list_tools', args: {} }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { content: Array<{ text: string }> };
      expect(JSON.parse(body.content[0].text).count).toBe(2);
      const prompt = await fetch(`http://127.0.0.1:${port}/api/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'x' }),
      });
      expect(prompt.status).toBe(404); // sin ejecutor de prompt
    } finally {
      server.closeAllConnections?.();
      await new Promise((r) => server.close(r));
    }
  });
});
