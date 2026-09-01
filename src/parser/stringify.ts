/**
 * Serialización inversa: {@link ToolMap} → CSS `.webmcp.css`.
 *
 * La usa `webmcpcss repair` para reescribir el archivo tras una reparación
 * y las pruebas de round-trip del parser.
 */
import type { ParamSource, ToolMap } from '../types';

/**
 * Convierte un tool map de vuelta en CSS con propiedades `webmcp-*`.
 *
 * @param map Tool map a serializar.
 * @returns CSS formateado, listo para escribir a disco.
 */
export function stringifyWebMCP(map: ToolMap): string {
  const blocks: string[] = [];

  for (const [name, tool] of Object.entries(map.tools)) {
    const lines: string[] = [`  webmcp-tool: '${name}';`];
    if (tool.description)
      lines.push(`  webmcp-description: '${escapeCss(tool.description)}';`);
    for (const [param, source] of Object.entries(tool.params)) {
      lines.push(`  webmcp-param-${camelToKebab(param)}: ${paramSourceToCss(source)};`);
    }
    if (tool.trigger && !(tool.trigger.event === 'click' && !tool.trigger.on)) {
      const on = tool.trigger.on ? ` on ${tool.trigger.on}` : '';
      lines.push(`  webmcp-trigger: '${tool.trigger.event}'${on};`);
    }
    if (tool.confirmation) {
      lines.push(`  webmcp-confirmation: '${escapeCss(tool.confirmation)}';`);
    }
    blocks.push(`${tool.selector} {\n${lines.join('\n')}\n}`);
  }

  for (const [name, ctx] of Object.entries(map.context)) {
    const lines: string[] = [`  webmcp-context: '${name}';`];
    if (ctx.format && ctx.format !== 'text') {
      lines.push(`  webmcp-format: '${ctx.format}';`);
    }
    blocks.push(`${ctx.selector} {\n${lines.join('\n')}\n}`);
  }

  return `${blocks.join('\n\n')}\n`;
}

/**
 * Convierte un {@link ParamSource} en su sintaxis CSS.
 */
function paramSourceToCss(source: ParamSource): string {
  switch (source.source) {
    case 'attr':
      return `attr(${source.value})`;
    case 'value':
      return source.selector ? `value(${source.selector})` : 'value()';
    case 'text':
      return source.selector ? `text(${source.selector})` : 'text()';
    case 'literal':
      return `'${escapeCss(source.value)}'`;
  }
}

/**
 * Escapa comillas simples y barras para valores dentro de comillas CSS.
 */
function escapeCss(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Convierte `camelCase` en `kebab-case`.
 */
function camelToKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}
