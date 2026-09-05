/**
 * Servidor MCP dedicado para **Flomny** — orquestador de workflows por
 * lenguaje natural que descubre herramientas externas vía MCP (grafo de
 * agentes + ejecución paso a paso con validación previa).
 *
 * A diferencia del servidor genérico (`webmcpcss mcp --serve`), que expone
 * una herramienta MCP por cada herramienta del sitio, Flomny prefiere una
 * **API de introspección** estable con seis herramientas fijas:
 *
 * | Herramienta            | Uso                                                        |
 * | ---------------------- | ---------------------------------------------------------- |
 * | `list_tools`           | Catálogo de herramientas WebMCP (nombre, descripción, params, fragilidad) |
 * | `get_tool_info`        | Detalle de una herramienta (selector, params, confirmación, fragilidad)   |
 * | `get_selector_status`  | Estado de un selector: existe / fragilidad / sugerencias   |
 * | `suggest_repair`       | Propuesta de reparación (visión + huellas), sin escribir   |
 * | `execute_prompt`       | Orden en lenguaje natural (`webmcpcss_prompt`)             |
 * | `apply_animation`      | Animaciones declarativas (`webmcpcss_animate`)             |
 *
 * `FlomnyMcpCore` extiende {@link McpCore}, así que sirve por stdio o HTTP
 * con las mismas funciones (`startMcpStdioServer`, `createMcpHttpServer`).
 * Además, `exportFlomny()` genera el paquete de configuración
 * (`flomny-mcp.json`, `workflow.example.json`, README).
 */
import { analyzeFragility } from '../graph/fragility';
import type { RepairResult, ToolMap, ValidationReport } from '../types';
import { VERSION } from '../version';
import { McpCore, type McpServerOptions } from './mcp-server';
import type { ExportContext } from './python-agents';
import { toolToJsonSchema } from './schema';

/** Nombres de las herramientas del servidor Flomny. */
export const FLOMNY_TOOL_NAMES = [
  'list_tools',
  'get_tool_info',
  'get_selector_status',
  'suggest_repair',
  'execute_prompt',
  'apply_animation',
] as const;

/** Nombre de herramienta Flomny. */
export type FlomnyToolName = (typeof FLOMNY_TOOL_NAMES)[number];

/** Resultado MCP (`tools/call`). */
type CallResult = { content: Array<Record<string, unknown>>; isError?: boolean };

/** Opciones del servidor Flomny: las del servidor MCP + validador/reparador. */
export interface FlomnyServerOptions extends McpServerOptions {
  /**
   * Valida los selectores del tool map contra la página real. Si falta,
   * `get_selector_status` responde solo con el análisis estático.
   */
  validateSelectors?: (url?: string) => Promise<ValidationReport>;
  /**
   * Propone reparaciones (dry-run) para las herramientas rotas. Si falta,
   * `suggest_repair` devuelve únicamente sugerencias heurísticas.
   */
  suggestRepairs?: (url?: string) => Promise<RepairResult[]>;
}

/** Esquemas MCP de las seis herramientas Flomny. */
export const FLOMNY_TOOL_SCHEMAS: Array<Record<string, unknown>> = [
  {
    name: 'list_tools',
    description:
      'Lista las herramientas WebMCP declaradas para el sitio: nombre, descripción, parámetros y fragilidad del selector. Llama primero a esta herramienta para planificar un workflow.',
    inputSchema: {
      type: 'object',
      properties: {
        includeContext: {
          type: 'boolean',
          description: 'Incluir también los datos de contexto (webmcp-context).',
        },
      },
    },
  },
  {
    name: 'get_tool_info',
    description:
      'Detalle de una herramienta WebMCP: selector, parámetros (origen y selector), confirmación, disparador, huella y análisis de fragilidad.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Nombre de la herramienta.' } },
      required: ['name'],
    },
  },
  {
    name: 'get_selector_status',
    description:
      'Estado de un selector CSS (o del selector de una herramienta): si existe en la página, nivel de fragilidad, framework detectado y sugerencias de migración.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Selector CSS a comprobar.' },
        tool: { type: 'string', description: 'Alternativa: nombre de la herramienta.' },
        url: { type: 'string', description: 'URL del sitio (opcional).' },
      },
    },
  },
  {
    name: 'suggest_repair',
    description:
      'Propone un selector de reemplazo para una herramienta rota (visión + huellas) sin modificar el archivo. Devuelve old/new selector y confianza.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description: 'Herramienta a reparar (vacío = todas las rotas).',
        },
        url: { type: 'string', description: 'URL del sitio (opcional).' },
      },
    },
  },
  {
    name: 'execute_prompt',
    description:
      'Ejecuta una orden en lenguaje natural sobre el sitio ("sube esta imagen al carrusel", "oculta el popup"). Con dryRun=true solo interpreta.',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Orden en español o inglés.' },
        url: { type: 'string', description: 'URL del sitio (opcional).' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Archivos/imágenes a subir.',
        },
        text: { type: 'string', description: 'Texto adicional (valor a escribir).' },
        dryRun: { type: 'boolean', description: 'Solo interpretar, sin ejecutar.' },
        screenshot: { type: 'boolean', description: 'Adjuntar captura tras ejecutar.' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'apply_animation',
    description:
      'Aplica animaciones declarativas (webmcp-animation-*) respetando las del sitio. Con dryRun=true devuelve plan, validación y conflictos previstos.',
    inputSchema: {
      type: 'object',
      properties: {
        animationFile: {
          type: 'string',
          description: 'Ruta al .webmcp.css de animaciones.',
        },
        css: {
          type: 'string',
          description: 'Alternativa: CSS inline con webmcp-animation-*.',
        },
        url: { type: 'string', description: 'URL del sitio (opcional).' },
        strategy: {
          type: 'string',
          enum: ['replace', 'queue', 'ignore', 'merge'],
          description: 'Estrategia global de conflictos.',
        },
        engine: { type: 'string', enum: ['css', 'waapi', 'three'] },
        dryRun: { type: 'boolean' },
        screenshot: { type: 'boolean' },
      },
    },
  },
];

/** Envuelve un objeto como contenido MCP de texto. */
function textResult(payload: unknown, isError = false): CallResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Núcleo MCP dedicado a Flomny: seis herramientas fijas de introspección y
 * ejecución sobre el tool map.
 */
export class FlomnyMcpCore extends McpCore {
  constructor(protected readonly flomnyOptions: FlomnyServerOptions) {
    super(flomnyOptions);
  }

  /** `initialize` anuncia `webmcpcss-flomny`. */
  protected serverInfo(): { name: string; version: string } {
    return { name: 'webmcpcss-flomny', version: this.flomnyOptions.version ?? VERSION };
  }

  /** Solo las seis herramientas Flomny (las del sitio se consultan con `list_tools`). */
  listTools(): { tools: Array<Record<string, unknown>> } {
    return { tools: FLOMNY_TOOL_SCHEMAS.map((s) => ({ ...s })) };
  }

  /** Despacha una de las seis herramientas Flomny. */
  async callTool(name: string, args: Record<string, unknown>): Promise<CallResult> {
    switch (name as FlomnyToolName) {
      case 'list_tools':
        return this.listSiteTools(args.includeContext === true);
      case 'get_tool_info':
        return this.toolInfo(String(args.name ?? ''));
      case 'get_selector_status':
        return this.selectorStatus(args);
      case 'suggest_repair':
        return this.repairSuggestion(args);
      case 'execute_prompt':
        return this.callPrompt(args);
      case 'apply_animation':
        return this.callAnimate(args);
      default:
        return textResult(
          {
            success: false,
            error: `Herramienta desconocida: ${name}. Disponibles: ${FLOMNY_TOOL_NAMES.join(', ')}`,
          },
          true,
        );
    }
  }

  /** Catálogo de herramientas del sitio con fragilidad. */
  private listSiteTools(includeContext: boolean): CallResult {
    const toolMap: ToolMap = this.flomnyOptions.toolMap;
    const tools = Object.entries(toolMap.tools).map(([name, tool]) => {
      const schema = toolToJsonSchema(name, tool);
      const frag = analyzeFragility(tool.selector);
      return {
        name,
        description: schema.description,
        selector: tool.selector,
        params: Object.keys(tool.params),
        inputSchema: schema.inputSchema,
        fragility: frag.level,
        framework: frag.framework ?? null,
      };
    });
    const payload: Record<string, unknown> = {
      source: this.flomnyOptions.cssPath ?? null,
      url: this.flomnyOptions.url ?? null,
      count: tools.length,
      tools,
    };
    if (includeContext) {
      payload.context = Object.entries(toolMap.context).map(([name, c]) => ({
        name,
        selector: c.selector,
        format: c.format ?? 'text',
      }));
    }
    return textResult(payload);
  }

  /** Detalle de una herramienta. */
  private toolInfo(name: string): CallResult {
    const tool = this.flomnyOptions.toolMap.tools[name];
    if (!tool) {
      return textResult(
        {
          success: false,
          error: `Herramienta desconocida: ${name || '(vacío)'}`,
          available: Object.keys(this.flomnyOptions.toolMap.tools),
        },
        true,
      );
    }
    const schema = toolToJsonSchema(name, tool);
    return textResult({
      name,
      description: schema.description,
      selector: tool.selector,
      params: Object.fromEntries(
        Object.entries(tool.params).map(([p, spec]) => [
          p,
          {
            source: spec.source,
            selector: spec.selector ?? null,
            value: spec.value ?? null,
          },
        ]),
      ),
      inputSchema: schema.inputSchema,
      confirmation: tool.confirmation ?? null,
      trigger: tool.trigger ?? { event: 'click' },
      fingerprint: tool.fingerprint ?? null,
      fragility: analyzeFragility(tool.selector),
    });
  }

  /** Estado (estático + opcionalmente en vivo) de un selector. */
  private async selectorStatus(args: Record<string, unknown>): Promise<CallResult> {
    const toolName = typeof args.tool === 'string' ? args.tool : undefined;
    const selector =
      typeof args.selector === 'string' && args.selector.trim()
        ? args.selector.trim()
        : toolName
          ? this.flomnyOptions.toolMap.tools[toolName]?.selector
          : undefined;
    if (!selector) {
      return textResult({ success: false, error: 'Indica "selector" o "tool".' }, true);
    }
    const fragility = analyzeFragility(selector);
    const payload: Record<string, unknown> = {
      selector,
      tool: toolName ?? null,
      fragility: fragility.level,
      framework: fragility.framework ?? null,
      reasons: fragility.reasons,
      suggestions: fragility.suggestions,
      exists: null,
      checked: false,
    };
    if (this.flomnyOptions.validateSelectors) {
      try {
        const report = await this.flomnyOptions.validateSelectors(
          typeof args.url === 'string' ? args.url : undefined,
        );
        const entries = report.entries.filter(
          (e) => e.selector === selector || (toolName ? e.name === toolName : false),
        );
        if (entries.length > 0) {
          payload.exists = entries.every((e) => e.ok || e.optional === true);
          payload.checked = true;
          payload.entries = entries;
        }
      } catch (err) {
        payload.error = (err as Error).message;
      }
    }
    return textResult(payload);
  }

  /** Propuesta de reparación (dry-run). */
  private async repairSuggestion(args: Record<string, unknown>): Promise<CallResult> {
    const toolName = typeof args.tool === 'string' && args.tool ? args.tool : undefined;
    const tool = toolName ? this.flomnyOptions.toolMap.tools[toolName] : undefined;
    if (toolName && !tool) {
      return textResult(
        { success: false, error: `Herramienta desconocida: ${toolName}` },
        true,
      );
    }
    const heuristics = tool ? analyzeFragility(tool.selector).suggestions : [];
    if (!this.flomnyOptions.suggestRepairs) {
      return textResult({
        tool: toolName ?? null,
        applied: false,
        repairs: [],
        heuristics,
        hint: 'Arranca el servidor con --url para obtener propuestas basadas en la página real.',
      });
    }
    try {
      const all = await this.flomnyOptions.suggestRepairs(
        typeof args.url === 'string' ? args.url : undefined,
      );
      const repairs = toolName ? all.filter((r) => r.name === toolName) : all;
      return textResult({ tool: toolName ?? null, applied: false, repairs, heuristics });
    } catch (err) {
      return textResult({ success: false, error: (err as Error).message }, true);
    }
  }
}

/**
 * Configuración MCP (`mcpServers`) que apunta al servidor Flomny.
 *
 * @param ctx Ruta CSS y URL.
 */
export function buildFlomnyMcpConfig(ctx: ExportContext): string {
  return (
    JSON.stringify(
      {
        mcpServers: {
          'webmcpcss-flomny': {
            command: 'webmcpcss',
            args: [
              'mcp',
              '--serve',
              '--flomny',
              '--css',
              ctx.cssPath,
              ...(ctx.url ? ['--url', ctx.url] : []),
            ],
            description:
              'Servidor MCP dedicado a Flomny: list_tools, get_tool_info, get_selector_status, suggest_repair, execute_prompt, apply_animation',
          },
        },
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * Workflow de ejemplo para Flomny (descomposición en pasos que usan las
 * herramientas del servidor).
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 */
export function buildFlomnyWorkflowExample(toolMap: ToolMap, ctx: ExportContext): string {
  const first = Object.keys(toolMap.tools)[0] ?? 'addToCart';
  return (
    JSON.stringify(
      {
        name: `webmcp-${first}`,
        description: `Workflow generado por webmcpcss v${VERSION}: descubre, valida y ejecuta ${first} en ${ctx.url ?? 'el sitio'}.`,
        integrations: ['webmcpcss-flomny'],
        steps: [
          { id: 1, tool: 'list_tools', args: {}, output: 'catalog' },
          { id: 2, tool: 'get_tool_info', args: { name: first }, output: 'tool' },
          {
            id: 3,
            tool: 'get_selector_status',
            args: { tool: first },
            output: 'status',
            on_failure: { tool: 'suggest_repair', args: { tool: first } },
          },
          {
            id: 4,
            tool: 'execute_prompt',
            args: { prompt: `ejecuta ${first}`, dryRun: true },
            output: 'plan',
            requires_confirmation: true,
          },
          {
            id: 5,
            tool: 'execute_prompt',
            args: { prompt: `ejecuta ${first}`, dryRun: false, screenshot: true },
            output: 'result',
          },
        ],
      },
      null,
      2,
    ) + '\n'
  );
}

/**
 * Exporta el paquete de integración con Flomny.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 * @returns Mapa ruta relativa → contenido.
 */
export function exportFlomny(
  toolMap: ToolMap,
  ctx: ExportContext,
): Record<string, string> {
  return {
    'flomny-mcp.json': buildFlomnyMcpConfig(ctx),
    'workflow.example.json': buildFlomnyWorkflowExample(toolMap, ctx),
    'README.md': `# Integración con Flomny (webmcpcss v${VERSION})

Flomny descubre herramientas externas por MCP y las encadena en workflows
generados desde lenguaje natural. WebMCPcss le ofrece un **servidor MCP
dedicado** con una API de introspección fija:

| Herramienta | Uso |
| --- | --- |
| \`list_tools\` | Catálogo de herramientas del sitio (con fragilidad) |
| \`get_tool_info\` | Selector, parámetros, confirmación, huella |
| \`get_selector_status\` | ¿Existe? · fragilidad · framework · sugerencias |
| \`suggest_repair\` | Propuesta de reparación sin escribir el archivo |
| \`execute_prompt\` | Orden en lenguaje natural (dry-run por defecto) |
| \`apply_animation\` | Animaciones declarativas con resolución de conflictos |

## Instalación

1. \`npm i -g webmcpcss\`
2. Registra el servidor en Flomny (Integrations → MCP) con el contenido de
   \`flomny-mcp.json\`, o arráncalo a mano:
   \`webmcpcss mcp --serve --flomny --css ${ctx.cssPath}${ctx.url ? ` --url ${ctx.url}` : ''}\`
3. Importa \`workflow.example.json\` como plantilla de workflow.

Sin \`--url\` el servidor responde en modo estático (catálogo y fragilidad);
con \`--url\` valida selectores, propone reparaciones y ejecuta acciones en un
navegador headless.

Docs: https://github.com/cochinoraptor/WebMCPcss/blob/main/docs/agents/flomny.md
`,
  };
}
