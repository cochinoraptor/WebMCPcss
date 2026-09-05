/**
 * Herramientas MCP del Component Hub (v1.2.0): permiten a un agente
 * **descubrir** (`list_components`), **inspeccionar** (`get_component`) e
 * **importar** (`import_component`) componentes IA-First desde el servidor
 * `webmcpcss mcp --serve --hub`.
 *
 * Se activan con la opción `hub` de {@link McpServerOptions}; sin ella el
 * servidor no anuncia estas herramientas (compatibilidad total con 1.x).
 */
import {
  fetchComponent,
  importComponent,
  listComponents,
  type HubClientOptions,
} from './client';
import { HUB_CATEGORIES, HUB_LIBRARIES } from './types';

/** Nombres de las herramientas. */
export const HUB_TOOL_NAMES = [
  'list_components',
  'get_component',
  'import_component',
] as const;
export type HubToolName = (typeof HUB_TOOL_NAMES)[number];

/** Opciones del hub dentro del servidor MCP. */
export interface HubMcpOptions extends HubClientOptions {
  /** Carpeta destino por defecto para `import_component`. */
  outputDir?: string;
  /** Ruta del lock (por defecto `.webmcpcss/components.lock.json`). */
  lockPath?: string;
  /** Deshabilita la escritura en disco (solo descubrimiento). */
  readOnly?: boolean;
}

/** Esquemas MCP de las tres herramientas. */
export const HUB_TOOL_SCHEMAS: Array<Record<string, unknown>> = [
  {
    name: 'list_components',
    description:
      'Lista los componentes IA-First del WebMCPcss Component Hub (botones, tarjetas, formularios, layout, animaciones, inteligentes) con su contrato .webmcp.css, filtrando por categoría, librería (core, tailwind, bootstrap, mui, shadcn) o texto.',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: [...HUB_CATEGORIES], description: 'Categoría' },
        library: {
          type: 'string',
          enum: [...HUB_LIBRARIES],
          description: 'Librería/adaptador',
        },
        search: {
          type: 'string',
          description: 'Texto libre (nombre, herramienta, etiqueta)',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          description: 'Máximo de resultados (50)',
        },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'get_component',
    description:
      'Devuelve un componente del hub por id: metadatos, herramientas declaradas (webmcp-tool), contexto, animaciones, HTML de ejemplo y el .webmcp.css completo.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Identificador, p. ej. tailwind-button-primary',
        },
        includeSource: {
          type: 'boolean',
          description: 'Incluir HTML y CSS completos (true por defecto)',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'import_component',
    description:
      'Importa un componente del hub al proyecto actual: escribe <output>/<id>/ con el HTML, el .webmcp.css y component.json, lo registra en .webmcpcss/components.lock.json y, opcionalmente, fusiona el contrato en un CSS existente.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identificador del componente' },
        output: { type: 'string', description: 'Carpeta destino (webmcp-components)' },
        merge: { type: 'string', description: 'CSS existente al que añadir el contrato' },
        force: { type: 'boolean', description: 'Sobrescribir si ya existe' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

/** Resultado MCP (content + isError). */
export interface HubCallResult {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
}

const text = (data: unknown): HubCallResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});
const fail = (message: string): HubCallResult => ({
  isError: true,
  content: [{ type: 'text', text: message }],
});

/** ¿Es una de las herramientas del hub? */
export function isHubTool(name: string): name is HubToolName {
  return (HUB_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * Ejecuta una herramienta del hub.
 * @param name Nombre (`list_components` | `get_component` | `import_component`).
 * @param args Argumentos MCP.
 * @param options Opciones del hub (URL, modo offline, carpeta de salida…).
 */
export async function callHubTool(
  name: HubToolName,
  args: Record<string, unknown>,
  options: HubMcpOptions = {},
): Promise<HubCallResult> {
  try {
    switch (name) {
      case 'list_components': {
        const limit = Math.min(Math.max(Number(args.limit ?? 50) || 50, 1), 200);
        const { components, resolved } = await listComponents(
          {
            category: args.category as string | undefined,
            library: args.library as string | undefined,
            search: args.search as string | undefined,
          },
          options,
        );
        return text({
          source: resolved.source,
          hub: resolved.location,
          total: components.length,
          components: components.slice(0, limit).map((c) => ({
            id: c.id,
            name: c.name,
            category: c.category,
            library: c.library,
            version: c.version,
            description: c.description,
            tools: c.tools.map((t) => t.name),
            animations: c.animations.map((a) => a.name),
            importCommand: c.importCommand,
            page: `${resolved.index.baseUrl}/${c.files.page}`,
          })),
        });
      }
      case 'get_component': {
        const id = String(args.id ?? '').trim();
        if (!id) return fail('Falta "id".');
        const files = await fetchComponent(id, options);
        const includeSource = args.includeSource !== false;
        return text({
          ...files.entry,
          meta: files.meta,
          ...(includeSource ? { html: files.html, css: files.css } : {}),
        });
      }
      case 'import_component': {
        const id = String(args.id ?? '').trim();
        if (!id) return fail('Falta "id".');
        if (options.readOnly) {
          return fail(
            'El servidor se inició en modo solo lectura; importa con la CLI: npx webmcpcss components import ' +
              id,
          );
        }
        const result = await importComponent(id, {
          ...options,
          output: (args.output as string | undefined) ?? options.outputDir,
          merge: args.merge as string | undefined,
          force: args.force === true,
          lockPath: options.lockPath,
        });
        return text({
          success: true,
          ...result,
          next: [
            `Añade el HTML de ${result.dir} a tu página`,
            `Sirve el contrato: npx webmcpcss mcp --serve --css ${result.merged ?? result.files[0]}`,
          ],
        });
      }
      default:
        return fail(`Herramienta desconocida: ${String(name)}`);
    }
  } catch (err) {
    return fail(`Error en ${name}: ${(err as Error).message}`);
  }
}
