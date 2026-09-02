/**
 * Exportación a Angular: envuelve HTML Tailwind en un componente standalone.
 */

/**
 * Genera un componente Angular standalone con template inline.
 *
 * @param html HTML de entrada.
 * @param componentName Nombre de la clase del componente.
 */
export function toAngularComponent(html: string, componentName: string): string {
  const selector = componentName.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  const body = html
    .trim()
    .replace(/`/g, '\\`')
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return `/** ${componentName} — generado por WebMCPcss (tailwind export). */
import { Component } from '@angular/core';

@Component({
  selector: 'app-${selector}',
  standalone: true,
  template: \`
${body}
  \`,
})
export class ${componentName} {}
`;
}
