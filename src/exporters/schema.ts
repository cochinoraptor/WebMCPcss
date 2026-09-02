/**
 * Utilidades compartidas de los exportadores: JSON Schema por herramienta.
 */
import type { ToolMap, ToolSpec } from '../types';

/** Esquema JSON de los argumentos de una herramienta. */
export interface ToolJsonSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/**
 * Convierte una herramienta WebMCP a su JSON Schema (formato usado por MCP,
 * AutoGen, function calling de OpenAI, etc.).
 *
 * @param name Nombre de la herramienta.
 * @param tool Especificación.
 */
export function toolToJsonSchema(name: string, tool: ToolSpec): ToolJsonSchema {
  const properties: Record<string, { type: string; description: string }> = {};
  for (const [pName, spec] of Object.entries(tool.params)) {
    properties[pName] = {
      type: 'string',
      description:
        spec.source === 'value'
          ? `Valor a escribir en ${spec.selector ?? 'el elemento'}`
          : spec.source === 'attr'
            ? `Atributo ${spec.value ?? ''} del elemento`
            : `Parámetro ${pName}`,
    };
  }
  return {
    name,
    description: tool.description ?? `Herramienta WebMCP sobre ${tool.selector}`,
    inputSchema: { type: 'object', properties, required: [] },
  };
}

/**
 * Convierte el tool map completo a una lista de JSON Schemas.
 * @param toolMap Tool map parseado.
 */
export function toolMapToJsonSchemas(toolMap: ToolMap): ToolJsonSchema[] {
  return Object.entries(toolMap.tools).map(([name, tool]) =>
    toolToJsonSchema(name, tool),
  );
}

/** snake_case para identificadores Python. */
export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase();
}
