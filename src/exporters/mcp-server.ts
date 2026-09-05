/**
 * Servidor MCP (Model Context Protocol) de WebMCPcss.
 *
 * Dos modos, ambos sin dependencias externas:
 * - **stdio** (por defecto): JSON-RPC 2.0 delimitado por saltos de línea,
 *   compatible con Claude Desktop, Claude Code, Cursor, Goose, Windsurf...
 * - **HTTP** (`--http`): API REST mínima con `http` nativo
 *   (`GET /api/tools`, `GET /api/graph`, `POST /api/call`, `POST /api/prompt`).
 *
 * La ejecución real de herramientas se delega en un callback `execute`
 * que el CLI cablea con Puppeteer solo cuando se pasa `--url`; así este
 * módulo no importa puppeteer y puede usarse en cualquier entorno.
 */
import * as http from 'http';
import * as readline from 'readline';
import type { ToolMap } from '../types';
import { toolMapToJsonSchemas, type ToolJsonSchema } from './schema';
import { VERSION } from '../version';
import {
  HUB_TOOL_SCHEMAS,
  callHubTool,
  isHubTool,
  type HubMcpOptions,
} from '../hub/mcp-tools';

/** Firma del ejecutor de herramientas que provee el CLI. */
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Argumentos de la herramienta MCP `webmcpcss_prompt` (v0.7.0). */
export interface PromptToolArgs {
  /** Orden en lenguaje natural. */
  prompt: string;
  /** URL a modificar (por defecto la del servidor). */
  url?: string;
  /** Archivos a subir (rutas locales, URLs o data-URIs). */
  files?: string[];
  /** Texto adicional (valor a rellenar). */
  text?: string;
  /** Solo interpretar y localizar, sin modificar la página. */
  dryRun?: boolean;
  /** Incluir captura de pantalla en la respuesta. */
  screenshot?: boolean;
}

/** Firma del ejecutor de prompts (v0.7.0). El CLI lo cablea con Puppeteer. */
export type PromptExecutor = (args: PromptToolArgs) => Promise<unknown>;

/** Nombre de la herramienta MCP de lenguaje natural. */
export const PROMPT_TOOL_NAME = 'webmcpcss_prompt';

/** Definición MCP de la herramienta `webmcpcss_prompt`. */
export const PROMPT_TOOL_SCHEMA = {
  name: PROMPT_TOOL_NAME,
  description:
    'Modifica un sitio web usando lenguaje natural: clic, rellenar, subir archivos, cambiar colores/estilos/texto, ocultar, eliminar o mover elementos. Usa dryRun para previsualizar la acción interpretada.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Orden en lenguaje natural (es/en)' },
      url: {
        type: 'string',
        description: 'URL de la página (opcional si el servidor tiene --url)',
      },
      files: {
        type: 'array',
        items: { type: 'string' },
        description: 'Archivos a subir: rutas locales, URLs http(s) o data-URIs',
      },
      text: { type: 'string', description: 'Texto adicional (valor a escribir)' },
      dryRun: {
        type: 'boolean',
        description: 'Solo interpretar y localizar, sin ejecutar',
      },
      screenshot: {
        type: 'boolean',
        description: 'Devolver captura PNG (base64) tras ejecutar',
      },
    },
    required: ['prompt'],
  },
} as const;

/** Argumentos de la herramienta MCP `webmcpcss_animate` (v0.8.0). */
export interface AnimateToolArgs {
  /** Ruta a un `.webmcp.css` con reglas `webmcp-animation-*`. */
  animationFile?: string;
  /** CSS inline con las reglas (alternativa a `animationFile`). */
  css?: string;
  /** URL a animar (por defecto la del servidor). */
  url?: string;
  /** Estrategia global de conflictos. */
  strategy?: 'replace' | 'queue' | 'ignore' | 'merge';
  /** Motor forzado. */
  engine?: 'css' | 'waapi' | 'three';
  /** Solo planificar/validar, sin ejecutar. */
  dryRun?: boolean;
  /** Incluir captura de pantalla en la respuesta. */
  screenshot?: boolean;
}

/** Firma del ejecutor de animaciones (v0.8.0). El CLI lo cablea con Puppeteer. */
export type AnimateExecutor = (args: AnimateToolArgs) => Promise<unknown>;

/** Nombre de la herramienta MCP de animaciones. */
export const ANIMATE_TOOL_NAME = 'webmcpcss_animate';

/** Definición MCP de la herramienta `webmcpcss_animate`. */
export const ANIMATE_TOOL_SCHEMA = {
  name: ANIMATE_TOOL_NAME,
  description:
    'Aplica animaciones declarativas (webmcp-animation-*: parallax, isométrico, 3D, keyframes, escenas Three.js 2.5D) a un sitio web, resolviendo conflictos con otras animaciones y librerías (GSAP, Anime.js, CSS). Usa dryRun para obtener el plan y la validación sin ejecutar.',
  inputSchema: {
    type: 'object',
    properties: {
      animationFile: {
        type: 'string',
        description: 'Ruta a un .webmcp.css con reglas webmcp-animation-*',
      },
      css: { type: 'string', description: 'CSS inline con las reglas (alternativa)' },
      url: {
        type: 'string',
        description: 'URL de la página (opcional si el servidor tiene --url)',
      },
      strategy: {
        type: 'string',
        enum: ['replace', 'queue', 'ignore', 'merge'],
        description: 'Estrategia global de conflictos (por defecto queue)',
      },
      engine: {
        type: 'string',
        enum: ['css', 'waapi', 'three'],
        description: 'Forzar un motor concreto',
      },
      dryRun: { type: 'boolean', description: 'Solo planificar y validar' },
      screenshot: { type: 'boolean', description: 'Devolver captura PNG (base64)' },
    },
  },
} as const;

/** Opciones del servidor MCP. */
export interface McpServerOptions {
  /** Tool map parseado del .webmcp.css. */
  toolMap: ToolMap;
  /** Contenido crudo del .webmcp.css (expuesto como resource MCP). */
  cssSource?: string;
  /** Ruta del archivo CSS (informativa). */
  cssPath?: string;
  /** URL del sitio objetivo, si se conoce. */
  url?: string;
  /** Ejecutor real (Puppeteer). Si falta, tools/call responde en modo dry-run. */
  execute?: ToolExecutor;
  /**
   * Ejecutor de prompts en lenguaje natural (v0.7.0). Si está definido, el
   * servidor expone la herramienta `webmcpcss_prompt` y `POST /api/prompt`.
   */
  prompt?: PromptExecutor;
  /**
   * Ejecutor de animaciones declarativas (v0.8.0). Si está definido, el
   * servidor expone la herramienta `webmcpcss_animate` y `POST /api/animate`.
   */
  animate?: AnimateExecutor;
  /**
   * Component Hub (v1.2.0). Si está definido, el servidor expone
   * `list_components`, `get_component` e `import_component` y las rutas
   * `GET /api/components` y `GET /api/components/:id`.
   */
  hub?: HubMcpOptions;
  /** Versión del servidor a anunciar. */
  version?: string;
}

/** Mensaje JSON-RPC entrante. */
interface RpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
}

/**
 * Núcleo compartido: resuelve una petición MCP y devuelve el resultado
 * (o lanza `{code,message}` para errores JSON-RPC).
 */
export class McpCore {
  protected readonly schemas: ToolJsonSchema[];

  constructor(protected readonly options: McpServerOptions) {
    this.schemas = toolMapToJsonSchemas(options.toolMap);
  }

  /** ¿Está habilitada la herramienta `webmcpcss_prompt`? */
  get promptEnabled(): boolean {
    return Boolean(this.options.prompt);
  }

  /** ¿Está habilitada la herramienta `webmcpcss_animate`? */
  get animateEnabled(): boolean {
    return Boolean(this.options.animate);
  }

  /** ¿Están habilitadas las herramientas del Component Hub? */
  get hubEnabled(): boolean {
    return Boolean(this.options.hub);
  }

  /** Nombre y versión que anuncia `initialize`. */
  protected serverInfo(): { name: string; version: string } {
    return { name: 'webmcpcss', version: this.options.version ?? VERSION };
  }

  /** Lista de herramientas en formato MCP (+ `webmcpcss_prompt` si está habilitada). */
  listTools(): { tools: Array<Record<string, unknown>> } {
    const tools: Array<Record<string, unknown>> = this.schemas.map((s) => ({
      name: s.name,
      description: s.description,
      inputSchema: s.inputSchema,
    }));
    if (this.options.prompt) tools.push({ ...PROMPT_TOOL_SCHEMA });
    if (this.options.animate) tools.push({ ...ANIMATE_TOOL_SCHEMA });
    if (this.options.hub) tools.push(...HUB_TOOL_SCHEMAS.map((s) => ({ ...s })));
    return { tools };
  }

  /** Ejecuta una herramienta del Component Hub (si está habilitado). */
  async callHub(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }> {
    if (!this.options.hub || !isHubTool(name)) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'El Component Hub no está habilitado. Arranca el servidor con --hub.',
          },
        ],
      };
    }
    return callHubTool(name, args, this.options.hub);
  }

  /** Ejecuta la herramienta de lenguaje natural y envuelve el resultado como MCP. */
  async callPrompt(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }> {
    if (!this.options.prompt) {
      return {
        isError: true,
        content: [
          { type: 'text', text: 'La herramienta webmcpcss_prompt no está habilitada.' },
        ],
      };
    }
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) {
      return { isError: true, content: [{ type: 'text', text: 'Falta "prompt".' }] };
    }
    const files = Array.isArray(args.files)
      ? args.files.filter((f): f is string => typeof f === 'string')
      : undefined;
    try {
      const result = (await this.options.prompt({
        prompt,
        url: typeof args.url === 'string' ? args.url : undefined,
        files,
        text: typeof args.text === 'string' ? args.text : undefined,
        dryRun: args.dryRun === true,
        screenshot: args.screenshot === true,
      })) as { success?: boolean; evidence?: { screenshotBase64?: string } } | undefined;
      const content: Array<Record<string, unknown>> = [];
      const shot = result?.evidence?.screenshotBase64;
      if (shot) {
        // La imagen va como bloque MCP `image`; en el JSON se sustituye por un marcador.
        const { evidence, ...rest } = result as Record<string, unknown> & {
          evidence: Record<string, unknown>;
        };
        content.push({
          type: 'text',
          text: JSON.stringify({
            ...rest,
            evidence: { ...evidence, screenshotBase64: '<image>' },
          }),
        });
        content.push({ type: 'image', data: shot, mimeType: 'image/png' });
      } else {
        content.push({ type: 'text', text: JSON.stringify(result) });
      }
      return { content, isError: result?.success === false ? true : undefined };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Error en webmcpcss_prompt: ${(err as Error).message}` },
        ],
      };
    }
  }

  /** Ejecuta la herramienta de animaciones y envuelve el resultado como MCP. */
  async callAnimate(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }> {
    if (!this.options.animate) {
      return {
        isError: true,
        content: [
          { type: 'text', text: 'La herramienta webmcpcss_animate no está habilitada.' },
        ],
      };
    }
    const animationFile =
      typeof args.animationFile === 'string' ? args.animationFile.trim() : '';
    const css = typeof args.css === 'string' ? args.css : '';
    if (!animationFile && !css.trim()) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Falta "animationFile" o "css".' }],
      };
    }
    const strategies = ['replace', 'queue', 'ignore', 'merge'];
    const engines = ['css', 'waapi', 'three'];
    try {
      const result = (await this.options.animate({
        animationFile: animationFile || undefined,
        css: css || undefined,
        url: typeof args.url === 'string' ? args.url : undefined,
        strategy:
          typeof args.strategy === 'string' && strategies.includes(args.strategy)
            ? (args.strategy as AnimateToolArgs['strategy'])
            : undefined,
        engine:
          typeof args.engine === 'string' && engines.includes(args.engine)
            ? (args.engine as AnimateToolArgs['engine'])
            : undefined,
        dryRun: args.dryRun === true,
        screenshot: args.screenshot === true,
      })) as { success?: boolean; screenshotBase64?: string } | undefined;
      const content: Array<Record<string, unknown>> = [];
      const shot = result?.screenshotBase64;
      if (shot) {
        const { screenshotBase64: _omit, ...rest } = result as Record<string, unknown>;
        content.push({
          type: 'text',
          text: JSON.stringify({ ...rest, screenshotBase64: '<image>' }),
        });
        content.push({ type: 'image', data: shot, mimeType: 'image/png' });
      } else {
        content.push({ type: 'text', text: JSON.stringify(result) });
      }
      return { content, isError: result?.success === false ? true : undefined };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Error en webmcpcss_animate: ${(err as Error).message}` },
        ],
      };
    }
  }

  /** Ejecuta (o simula) una herramienta y envuelve el resultado como MCP. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }> {
    if (name === PROMPT_TOOL_NAME) return this.callPrompt(args);
    if (name === ANIMATE_TOOL_NAME) return this.callAnimate(args);
    if (this.options.hub && isHubTool(name)) return this.callHub(name, args);
    const tool = this.options.toolMap.tools[name];
    if (!tool) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Herramienta desconocida: ${name}` }],
      };
    }
    if (!this.options.execute) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              success: false,
              dryRun: true,
              tool: name,
              selector: tool.selector,
              args,
              hint: 'Arranca el servidor con --url para ejecutar de verdad.',
            }),
          },
        ],
      };
    }
    try {
      const result = await this.options.execute(name, args);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (err) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Error ejecutando ${name}: ${(err as Error).message}` },
        ],
      };
    }
  }

  /** Recursos MCP disponibles (el propio .webmcp.css y el grafo JSON). */
  listResources(): { resources: Array<Record<string, unknown>> } {
    const resources: Array<Record<string, unknown>> = [
      {
        uri: 'webmcp://graph',
        name: 'Grafo de herramientas WebMCP',
        mimeType: 'application/json',
      },
    ];
    if (this.options.cssSource) {
      resources.unshift({
        uri: 'webmcp://source',
        name: this.options.cssPath ?? 'webmcp.css',
        mimeType: 'text/css',
      });
    }
    return { resources };
  }

  /** Lee un recurso por URI. */
  readResource(uri: string): { contents: Array<Record<string, unknown>> } {
    if (uri === 'webmcp://source' && this.options.cssSource) {
      return {
        contents: [{ uri, mimeType: 'text/css', text: this.options.cssSource }],
      };
    }
    if (uri === 'webmcp://graph') {
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(this.graphPayload(), null, 2),
          },
        ],
      };
    }
    throw { code: -32002, message: `Recurso desconocido: ${uri}` };
  }

  /** Payload del grafo para HTTP y resources. */
  graphPayload(): Record<string, unknown> {
    return {
      source: this.options.cssPath ?? null,
      url: this.options.url ?? null,
      tools: this.schemas.map((s) => ({
        name: s.name,
        description: s.description,
        selector: this.options.toolMap.tools[s.name]?.selector,
        inputSchema: s.inputSchema,
      })),
      context: Object.entries(this.options.toolMap.context).map(([name, c]) => ({
        name,
        selector: c.selector,
        format: c.format ?? 'text',
      })),
    };
  }

  /** Despacha un método JSON-RPC MCP. */
  async dispatch(req: RpcRequest): Promise<unknown> {
    const params = req.params ?? {};
    switch (req.method) {
      case 'initialize':
        return {
          protocolVersion: (params.protocolVersion as string) ?? '2024-11-05',
          capabilities: { tools: {}, resources: {} },
          serverInfo: this.serverInfo(),
        };
      case 'ping':
        return {};
      case 'tools/list':
        return this.listTools();
      case 'tools/call':
        return this.callTool(
          String(params.name ?? ''),
          (params.arguments as Record<string, unknown>) ?? {},
        );
      case 'resources/list':
        return this.listResources();
      case 'resources/read':
        return this.readResource(String(params.uri ?? ''));
      default:
        throw { code: -32601, message: `Método no soportado: ${req.method}` };
    }
  }
}

/**
 * Arranca el servidor MCP por stdio (JSON-RPC delimitado por líneas).
 * No cierra el proceso: queda escuchando hasta EOF de stdin.
 *
 * @param options Configuración del servidor o un núcleo ya construido (p. ej.
 *   {@link FlomnyMcpCore} de `./flomny`).
 * @param input Stream de entrada (por defecto `process.stdin`).
 * @param output Stream de salida (por defecto `process.stdout`).
 * @returns Promesa que resuelve cuando la entrada se cierra.
 */
export function startMcpStdioServer(
  options: McpServerOptions | McpCore,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const core = options instanceof McpCore ? options : new McpCore(options);
  const rl = readline.createInterface({ input, terminal: false });

  const send = (msg: Record<string, unknown>): void => {
    output.write(JSON.stringify(msg) + '\n');
  };

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let req: RpcRequest;
    try {
      req = JSON.parse(trimmed) as RpcRequest;
    } catch {
      // Asíncrono para conservar el orden FIFO con las respuestas normales.
      void Promise.resolve().then(() =>
        send({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'JSON inválido' },
        }),
      );
      return;
    }
    // Notificaciones (sin id) no se responden.
    const isNotification =
      req.id === undefined || req.method?.startsWith('notifications/');
    void core
      .dispatch(req)
      .then((result) => {
        if (!isNotification) send({ jsonrpc: '2.0', id: req.id ?? null, result });
      })
      .catch((err: { code?: number; message?: string }) => {
        if (!isNotification)
          send({
            jsonrpc: '2.0',
            id: req.id ?? null,
            error: { code: err.code ?? -32603, message: err.message ?? 'Error interno' },
          });
      });
  });

  return new Promise((resolve) => rl.on('close', resolve));
}

/**
 * Crea el servidor HTTP nativo con la API REST:
 * - `GET /api/tools` → lista de herramientas con esquemas.
 * - `GET /api/graph` → grafo completo (tools + context).
 * - `POST /api/call` → `{ "tool": "...", "args": {...} }`.
 * - `POST /api/prompt` → `{ "prompt": "...", "files": [...], "dryRun": bool }` (v0.7.0).
 * - `POST /api/animate` → `{ "animationFile" | "css", "strategy", "dryRun": bool }` (v0.8.0).
 *
 * @param options Configuración del servidor.
 * @returns Servidor `http.Server` sin arrancar (llama a `.listen`).
 */
export function createMcpHttpServer(options: McpServerOptions | McpCore): http.Server {
  const core = options instanceof McpCore ? options : new McpCore(options);
  return http.createServer((req, res) => {
    const respond = (status: number, body: unknown): void => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      });
      res.end(JSON.stringify(body, null, 2));
    };

    if (req.method === 'OPTIONS') {
      respond(204, {});
      return;
    }
    if (req.method === 'GET' && req.url === '/api/tools') {
      respond(200, core.listTools());
      return;
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/components')) {
      if (!core.hubEnabled) {
        respond(404, { error: 'Component Hub no habilitado (usa --hub)' });
        return;
      }
      const u = new URL(req.url, 'http://localhost');
      const id = u.pathname.replace(/^\/api\/components\/?/, '');
      void (async () => {
        const result = id
          ? await core.callHub('get_component', {
              id,
              includeSource: u.searchParams.get('source') !== '0',
            })
          : await core.callHub('list_components', {
              category: u.searchParams.get('category') ?? undefined,
              library: u.searchParams.get('library') ?? undefined,
              search:
                u.searchParams.get('search') ?? u.searchParams.get('q') ?? undefined,
              limit: u.searchParams.get('limit') ?? undefined,
            });
        const textPart = result.content[0] as { text?: string } | undefined;
        if (result.isError) {
          respond(id ? 404 : 500, { error: textPart?.text });
          return;
        }
        try {
          respond(200, JSON.parse(textPart?.text ?? '{}'));
        } catch {
          respond(200, result);
        }
      })();
      return;
    }
    if (req.method === 'GET' && (req.url === '/api/graph' || req.url === '/')) {
      respond(200, core.graphPayload());
      return;
    }
    if (req.method === 'POST' && req.url === '/api/call') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        void (async () => {
          try {
            const parsed = JSON.parse(body || '{}') as {
              tool?: string;
              args?: Record<string, unknown>;
            };
            if (!parsed.tool) {
              respond(400, { error: 'Falta "tool" en el cuerpo' });
              return;
            }
            const result = await core.callTool(parsed.tool, parsed.args ?? {});
            respond(result.isError ? 500 : 200, result);
          } catch (err) {
            respond(400, { error: (err as Error).message });
          }
        })();
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/prompt') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        void (async () => {
          try {
            const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
            const result = await core.callPrompt(parsed);
            respond(result.isError ? (core.promptEnabled ? 422 : 404) : 200, result);
          } catch (err) {
            respond(400, { error: (err as Error).message });
          }
        })();
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/api/animate') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        void (async () => {
          try {
            const parsed = JSON.parse(body || '{}') as Record<string, unknown>;
            const result = await core.callAnimate(parsed);
            respond(result.isError ? (core.animateEnabled ? 422 : 404) : 200, result);
          } catch (err) {
            respond(400, { error: (err as Error).message });
          }
        })();
      });
      return;
    }
    respond(404, {
      error:
        'Ruta no encontrada. Usa /api/tools, /api/graph, POST /api/call, POST /api/prompt o POST /api/animate.',
    });
  });
}
