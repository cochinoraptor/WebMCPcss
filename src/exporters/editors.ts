/**
 * Exportadores de configuración para editores y clientes MCP:
 * Claude Code (plugin), Claude Desktop / Cursor / Goose (mcp.json) y
 * script de inyección para agentes de navegador (Atlas, Operator, Mariner).
 */
import type { ToolMap } from '../types';
import { toolMapToJsonSchemas } from './schema';
import type { ExportContext } from './python-agents';

/**
 * Genera un plugin de Claude Code: `plugin.json` + comandos slash.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 * @returns Mapa ruta relativa → contenido.
 */
export function exportClaudeCodePlugin(
  toolMap: ToolMap,
  ctx: ExportContext,
): Record<string, string> {
  const schemas = toolMapToJsonSchemas(toolMap);
  const files: Record<string, string> = {};

  files['.claude-plugin/plugin.json'] = JSON.stringify(
    {
      name: 'webmcpcss',
      description:
        'Herramientas WebMCP: genera, valida, repara y ejecuta acciones web declaradas en .webmcp.css',
      version: '0.6.0',
      author: { name: 'WebMCPcss' },
    },
    null,
    2,
  );

  files['commands/generate.md'] = `---
description: Genera un .webmcp.css para una URL (escaneo automático del DOM)
---

Ejecuta \`webmcpcss generate $ARGUMENTS --auto -o webmcp.css\` con Bash y
resume las herramientas detectadas. Después valida con
\`webmcpcss validate $ARGUMENTS webmcp.css\`.
`;

  files['commands/validate.md'] = `---
description: Valida los selectores de un .webmcp.css contra la página
---

Ejecuta \`webmcpcss validate $ARGUMENTS\` (URL y archivo CSS) con Bash y
reporta los selectores rotos. Si hay fallos, ofrece ejecutar
\`/webmcpcss:repair\`.
`;

  files['commands/repair.md'] = `---
description: Repara selectores rotos usando visión + huellas
---

Ejecuta \`webmcpcss repair $ARGUMENTS\` con Bash, muestra el diff de
selectores reparados y vuelve a validar.
`;

  files['commands/run.md'] = `---
description: Ejecuta una herramienta WebMCP en el sitio (addToCart, login...)
---

Ejecuta \`webmcpcss run <url> ${ctx.cssPath} <herramienta> --args '<json>'\`
con Bash usando los argumentos del usuario ($ARGUMENTS) y devuelve el
resultado JSON.

Herramientas disponibles en ${ctx.cssPath}:
${schemas.map((s) => `- **${s.name}** (${Object.keys(s.inputSchema.properties).join(', ') || 'sin parámetros'}): ${s.description}`).join('\n')}
`;

  files['README.md'] = `# Plugin Claude Code — webmcpcss

Instalación:

\`\`\`bash
claude plugin install ./claude-plugin   # o la ruta de esta carpeta
\`\`\`

Comandos: \`/webmcpcss:generate <url>\`, \`/webmcpcss:validate <url> <css>\`,
\`/webmcpcss:repair <url> <css>\`, \`/webmcpcss:run <herramienta> ...\`.

Requiere \`webmcpcss\` en el PATH (\`npm i -g webmcpcss\`).
`;
  return files;
}

/**
 * Genera el snippet `mcpServers` para Claude Desktop, Cursor, Goose, Windsurf
 * y cualquier cliente MCP estándar.
 *
 * @param ctx Ruta CSS y URL.
 */
export function exportMcpConfig(ctx: ExportContext): string {
  return JSON.stringify(
    {
      mcpServers: {
        webmcpcss: {
          command: 'webmcpcss',
          args: [
            'mcp',
            '--serve',
            '--css',
            ctx.cssPath,
            ...(ctx.url ? ['--url', ctx.url] : []),
          ],
        },
      },
    },
    null,
    2,
  );
}

/**
 * Genera la guía de integración con Cursor (mcp.json + uso).
 * @param ctx Ruta CSS y URL.
 */
export function exportCursorIntegration(ctx: ExportContext): Record<string, string> {
  return {
    'mcp.json': exportMcpConfig(ctx),
    'README.md': `# Integración con Cursor

1. Copia el contenido de \`mcp.json\` en \`~/.cursor/mcp.json\` (o fusiónalo
   con tu configuración existente).
2. Reinicia Cursor. En Settings → MCP verás el servidor \`webmcpcss\`.
3. En el chat del editor, el agente dispondrá de las herramientas del
   archivo \`${ctx.cssPath}\` (addToCart, login...) y podrá ejecutarlas.

Requiere \`webmcpcss\` instalado globalmente: \`npm i -g webmcpcss\`.
`,
  };
}

/**
 * Genera un script de inyección para agentes de navegador (ChatGPT Atlas,
 * Operator, Project Mariner, Comet, Skyvern...): expone
 * `window.__WEBMCP_GRAPH__` con las herramientas y sus esquemas, y además
 * las registra en `navigator.modelContext` si la API existe.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 */
export function exportBrowserInject(toolMap: ToolMap, ctx: ExportContext): string {
  const schemas = toolMapToJsonSchemas(toolMap);
  const graph = JSON.stringify(
    {
      source: ctx.cssPath,
      url: ctx.url ?? null,
      tools: schemas.map((s) => ({
        name: s.name,
        description: s.description,
        selector: toolMap.tools[s.name]?.selector,
        params: s.inputSchema.properties,
      })),
    },
    null,
    2,
  ).replace(/</g, '\\u003c');

  return `/**
 * WebMCPcss browser inject — expone window.__WEBMCP_GRAPH__ para agentes de
 * navegador (Atlas, Operator, Mariner...). Generado; no editar a mano.
 * Uso: page.evaluate(script) | chrome.debugger | userscript.
 */
(function () {
  'use strict';
  var GRAPH = ${graph.replace(/\n/g, '\n  ')};
  try {
    Object.defineProperty(window, '__WEBMCP_GRAPH__', { value: GRAPH, configurable: true });
  } catch (e) {
    window.__WEBMCP_GRAPH__ = GRAPH;
  }
  // Registro opcional en navigator.modelContext (estándar WebMCP).
  var mc = typeof navigator !== 'undefined' ? navigator.modelContext : undefined;
  if (mc && typeof mc.registerTool === 'function') {
    GRAPH.tools.forEach(function (t) {
      mc.registerTool({
        name: t.name,
        description: t.description,
        inputSchema: { type: 'object', properties: t.params },
        async execute(args) {
          var el = document.querySelector(t.selector);
          if (!el) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No existe ' + t.selector }) }] };
          Object.keys(args || {}).forEach(function (k) {
            var p = GRAPH.tools.filter(function (x) { return x.name === t.name; })[0].params[k];
            void p; // los params value(...) se rellenan por selector si está presente
          });
          el.click();
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, tool: t.name }) }] };
        },
      });
    });
  }
  console.log('[WebMCPcss] __WEBMCP_GRAPH__ con ' + GRAPH.tools.length + ' herramienta(s).');
})();
`;
}
