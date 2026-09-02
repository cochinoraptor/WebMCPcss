/**
 * Servidor MCP (Model Context Protocol) de WebMCPcss.
 *
 * Dos modos, ambos sin dependencias externas:
 * - **stdio** (por defecto): JSON-RPC 2.0 delimitado por saltos de línea,
 *   compatible con Claude Desktop, Claude Code, Cursor, Goose, Windsurf...
 * - **HTTP** (`--http`): API REST mínima con `http` nativo
 *   (`GET /api/tools`, `GET /api/graph`, `POST /api/call`).
 *
 * La ejecución real de herramientas se delega en un callback `execute`
 * que el CLI cablea con Puppeteer solo cuando se pasa `--url`; así este
 * módulo no importa puppeteer y puede usarse en cualquier entorno.
 */
import * as http from 'http';
import * as readline from 'readline';
import type { ToolMap } from '../types';
import { toolMapToJsonSchemas, type ToolJsonSchema } from './schema';

/** Firma del ejecutor de herramientas que provee el CLI. */
export type ToolExecutor = (
  toolName: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

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
  private readonly schemas: ToolJsonSchema[];

  constructor(private readonly options: McpServerOptions) {
    this.schemas = toolMapToJsonSchemas(options.toolMap);
  }

  /** Lista de herramientas en formato MCP. */
  listTools(): { tools: Array<Record<string, unknown>> } {
    return {
      tools: this.schemas.map((s) => ({
        name: s.name,
        description: s.description,
        inputSchema: s.inputSchema,
      })),
    };
  }

  /** Ejecuta (o simula) una herramienta y envuelve el resultado como MCP. */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
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
          serverInfo: { name: 'webmcpcss', version: this.options.version ?? '0.5.0' },
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
 * @param options Configuración del servidor.
 * @param input Stream de entrada (por defecto `process.stdin`).
 * @param output Stream de salida (por defecto `process.stdout`).
 * @returns Promesa que resuelve cuando la entrada se cierra.
 */
export function startMcpStdioServer(
  options: McpServerOptions,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  const core = new McpCore(options);
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
 *
 * @param options Configuración del servidor.
 * @returns Servidor `http.Server` sin arrancar (llama a `.listen`).
 */
export function createMcpHttpServer(options: McpServerOptions): http.Server {
  const core = new McpCore(options);
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
    respond(404, {
      error: 'Ruta no encontrada. Usa /api/tools, /api/graph o POST /api/call.',
    });
  });
}
