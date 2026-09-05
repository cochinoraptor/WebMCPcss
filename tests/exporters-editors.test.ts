/**
 * Tests v0.9.0 de los exportadores para editores: plugin de Claude Code
 * (comandos prompt/animate + skill webmcp-audit) e integración con Cursor
 * (snippets `webmcp:`, selectores estables, regla de proyecto y registro
 * automático en ~/.cursor/mcp.json).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildCursorRule,
  buildCursorSnippets,
  exportClaudeCodePlugin,
  exportCursorIntegration,
  exportForAgent,
  kebabCase,
  registerCursorMcpServer,
  stableSelectorCandidates,
} from '../src/exporters';
import { parseWebMCP } from '../src/parser';
import { VERSION } from '../src/version';

const CSS = `
#add-to-cart {
  webmcp-tool: "addToCart";
  webmcp-description: "Añade el producto al carrito";
  webmcp-param-quantity: value(#qty-input);
  webmcp-param-productId: attr(data-product-id);
  webmcp-confirmation: ".cart-badge";
}
.sc-1x9j8k > button {
  webmcp-tool: "checkout";
  webmcp-param-coupon: value(#coupon);
}
.total-price { webmcp-context: "cartTotal"; webmcp-format: "currency"; }
`;
const toolMap = parseWebMCP(CSS);
const ctx = { cssPath: 'tienda.webmcp.css', url: 'https://tienda.com' };

describe('VERSION', () => {
  it('coincide con package.json', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'),
    );
    expect(VERSION).toBe(pkg.version);
  });
});

describe('exportClaudeCodePlugin', () => {
  const files = exportClaudeCodePlugin(toolMap, ctx);

  it('genera manifiesto con la versión del paquete y rutas de comandos/skills/mcp', () => {
    const plugin = JSON.parse(files['.claude-plugin/plugin.json']);
    expect(plugin.name).toBe('webmcpcss');
    expect(plugin.version).toBe(VERSION);
    expect(plugin.commands).toBe('./commands');
    expect(plugin.skills).toBe('./skills');
    expect(plugin.mcpServers).toBe('./.mcp.json');
  });

  it('incluye los seis comandos slash con frontmatter', () => {
    for (const cmd of ['generate', 'validate', 'repair', 'run', 'prompt', 'animate']) {
      const md = files[`commands/${cmd}.md`];
      expect(md, cmd).toBeDefined();
      expect(md.startsWith('---\ndescription: ')).toBe(true);
    }
  });

  it('prompt.md hace dry-run + confirmación antes de --execute', () => {
    const md = files['commands/prompt.md'];
    expect(md).toContain(
      'webmcpcss prompt "$ARGUMENTS" --url https://tienda.com --css tienda.webmcp.css --json',
    );
    expect(md).toContain('--execute');
    expect(md.indexOf('--json')).toBeLessThan(md.indexOf('--execute'));
    expect(md).toMatch(/confirmación/);
  });

  it('animate.md valida conflictos antes de animar y menciona --sandbox', () => {
    const md = files['commands/animate.md'];
    expect(md).toContain(
      'webmcpcss validate-conflicts $ARGUMENTS --url https://tienda.com',
    );
    expect(md).toContain('webmcpcss animate $ARGUMENTS --url https://tienda.com');
    expect(md).toContain('--sandbox');
    expect(md).toContain('--conflict-strategy');
  });

  it('la skill webmcp-audit tiene frontmatter válido y usa graph --fragility', () => {
    const md = files['skills/webmcp-audit/SKILL.md'];
    expect(md).toMatch(/^---\nname: webmcp-audit\ndescription: .+\nallowed-tools:\n/);
    expect(md).toContain('webmcpcss graph tienda.webmcp.css --fragility');
    expect(md).toContain('metadata.fragility');
    expect(md).toContain('webmcp-fingerprint');
  });

  it('.mcp.json arranca el servidor MCP con css y url', () => {
    const cfg = JSON.parse(files['.mcp.json']);
    expect(cfg.mcpServers.webmcpcss.args).toEqual([
      'mcp',
      '--serve',
      '--css',
      'tienda.webmcp.css',
      '--url',
      'https://tienda.com',
    ]);
  });

  it('run.md lista las herramientas y el README documenta todo', () => {
    expect(files['commands/run.md']).toContain('**addToCart**');
    expect(files['commands/run.md']).toContain('**checkout**');
    expect(files['README.md']).toContain('/webmcpcss:prompt');
    expect(files['README.md']).toContain('/webmcpcss:animate');
    expect(files['README.md']).toContain('webmcp-audit');
  });

  it('sin URL usa el marcador <url>', () => {
    const noUrl = exportClaudeCodePlugin(toolMap, { cssPath: 'x.webmcp.css' });
    expect(noUrl['commands/run.md']).toContain('webmcpcss run <url> x.webmcp.css');
    expect(JSON.parse(noUrl['.mcp.json']).mcpServers.webmcpcss.args).not.toContain(
      '--url',
    );
  });
});

describe('Cursor · selectores estables y snippets', () => {
  it('kebabCase convierte camelCase y limpia símbolos', () => {
    expect(kebabCase('addToCart')).toBe('add-to-cart');
    expect(kebabCase('searchProducts2')).toBe('search-products2');
    expect(kebabCase('__weird name__')).toBe('weird-name');
  });

  it('stableSelectorCandidates prioriza el selector actual si ya es estable', () => {
    const c = stableSelectorCandidates('addToCart', '#add-to-cart');
    expect(c[0]).toBe('#add-to-cart');
    expect(c).toContain('[data-tool="add-to-cart"]');
    expect(c).toContain('[data-testid="add-to-cart"]');
    expect(new Set(c).size).toBe(c.length);
  });

  it('stableSelectorCandidates relega selectores frágiles al final', () => {
    const c = stableSelectorCandidates('checkout', '.sc-1x9j8k > button');
    expect(c[0]).toBe('[data-tool="checkout"]');
    expect(c[c.length - 1]).toBe('.sc-1x9j8k > button');
  });

  it('extrae un id semántico presente en un selector frágil', () => {
    const c = stableSelectorCandidates('buy', '.css-1x9j8k #buy-now');
    expect(c[0]).toBe('#buy-now');
  });

  it('genera snippets genéricos y uno por herramienta con prefijo webmcp:', () => {
    const snippets = JSON.parse(buildCursorSnippets(toolMap));
    const prefixes = Object.values(snippets).map((s) => (s as { prefix: string }).prefix);
    expect(prefixes).toEqual(
      expect.arrayContaining([
        'webmcp:tool',
        'webmcp:context',
        'webmcp:param',
        'webmcp:fingerprint',
        'webmcp:animation',
        'webmcp:addToCart',
        'webmcp:checkout',
      ]),
    );
    const add = snippets['WebMCP: addToCart'];
    expect(add.scope).toBe('css,scss,less');
    expect(add.body[0]).toMatch(/^\$\{1\|#add-to-cart,/);
    expect(add.body).toContain('  webmcp-param-quantity: value(#qty-input);');
    expect(add.body).toContain('  webmcp-param-productId: attr(data-product-id);');
    expect(add.body).toContain('  webmcp-confirmation: ".cart-badge";');
    expect(add.description).toContain('fragilidad low');
  });

  it('escapa caracteres especiales de snippet en los candidatos', () => {
    const snippets = JSON.parse(
      buildCursorSnippets(parseWebMCP('a[href$="x"], .b { webmcp-tool: "odd"; }')),
    );
    const body: string = snippets['WebMCP: odd'].body[0];
    expect(body).toContain('\\$');
    expect(body).toContain('\\,');
  });

  it('la regla .mdc lista herramientas con fragilidad y selector recomendado', () => {
    const rule = buildCursorRule(toolMap, ctx);
    expect(rule).toMatch(/^---\ndescription: /);
    expect(rule).toContain('globs: ["**/*.webmcp.css", "**/webmcp.css"]');
    expect(rule).toContain(
      '| `checkout` | `.sc-1x9j8k > button` | high (styled-components) | `[data-tool="checkout"]` |',
    );
    expect(rule).toContain('| `addToCart` | `#add-to-cart` | low | `#add-to-cart` |');
  });

  it('exportCursorIntegration devuelve mcp.json, snippets, regla y README', () => {
    const files = exportCursorIntegration(ctx, toolMap);
    expect(Object.keys(files).sort()).toEqual(
      [
        '.cursor/rules/webmcpcss.mdc',
        '.vscode/webmcp.code-snippets',
        'README.md',
        'mcp.json',
      ].sort(),
    );
    expect(JSON.parse(files['mcp.json']).mcpServers.webmcpcss.args).toContain(
      'https://tienda.com',
    );
    expect(files['README.md']).toContain('--register');
    expect(files['README.md']).toContain('webmcp:addToCart');
  });

  it('exportCursorIntegration sin toolMap sigue funcionando (compatibilidad)', () => {
    const files = exportCursorIntegration(ctx);
    const snippets = JSON.parse(files['.vscode/webmcp.code-snippets']);
    expect(Object.keys(snippets)).toHaveLength(5);
    expect(files['README.md']).toContain('webmcp:addToCart');
  });

  it('exportForAgent("cursor") pasa el toolMap', () => {
    const { files, note } = exportForAgent('cursor', toolMap, ctx);
    expect(files['.vscode/webmcp.code-snippets']).toContain('webmcp:checkout');
    expect(note).toContain('--register');
  });
});

describe('registerCursorMcpServer', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-home-'));
  afterAll(() => fs.rmSync(home, { recursive: true, force: true }));

  it('crea ~/.cursor/mcp.json si no existe', () => {
    const { path: cfg, updated } = registerCursorMcpServer(ctx, { home });
    expect(cfg).toBe(path.join(home, '.cursor', 'mcp.json'));
    expect(updated).toBe(false);
    const json = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    expect(json.mcpServers.webmcpcss.command).toBe('webmcpcss');
    expect(json.mcpServers.webmcpcss.args).toContain('tienda.webmcp.css');
  });

  it('conserva otros servidores y actualiza el existente', () => {
    const cfg = path.join(home, '.cursor', 'mcp.json');
    fs.writeFileSync(
      cfg,
      JSON.stringify({
        mcpServers: { otro: { command: 'x' }, webmcpcss: { command: 'viejo' } },
        extra: true,
      }),
    );
    const { updated } = registerCursorMcpServer(
      { cssPath: 'nuevo.webmcp.css' },
      { home },
    );
    expect(updated).toBe(true);
    const json = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    expect(json.extra).toBe(true);
    expect(json.mcpServers.otro).toEqual({ command: 'x' });
    expect(json.mcpServers.webmcpcss.args).toContain('nuevo.webmcp.css');
    expect(json.mcpServers.webmcpcss.args).not.toContain('--url');
  });

  it('acepta configPath y serverName personalizados', () => {
    const configPath = path.join(home, 'proj', '.cursor', 'mcp.json');
    registerCursorMcpServer(ctx, { configPath, serverName: 'tienda' });
    const json = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(Object.keys(json.mcpServers)).toEqual(['tienda']);
  });

  it('falla con un archivo existente que no es JSON', () => {
    const configPath = path.join(home, 'broken.json');
    fs.writeFileSync(configPath, '{ esto no es json');
    expect(() => registerCursorMcpServer(ctx, { configPath })).toThrow(
      /no es JSON válido/,
    );
  });

  it('trata un archivo vacío como configuración nueva', () => {
    const configPath = path.join(home, 'empty.json');
    fs.writeFileSync(configPath, '');
    expect(registerCursorMcpServer(ctx, { configPath }).updated).toBe(false);
  });
});
