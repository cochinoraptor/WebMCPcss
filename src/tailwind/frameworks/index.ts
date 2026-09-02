/**
 * Formateadores de exportación por framework.
 */
import { toReactComponent } from './react';
import { toVueComponent } from './vue';
import { toAngularComponent } from './angular';

/** Frameworks soportados por `tailwind export`. */
export type Framework = 'html' | 'react' | 'vue' | 'angular';

export { toReactComponent, toVueComponent, toAngularComponent };

/**
 * Formatea un fragmento HTML con clases Tailwind para el framework indicado.
 *
 * @param html HTML de entrada (outerHTML del elemento exportado).
 * @param framework Framework de destino (`html` devuelve el HTML tal cual).
 * @param componentName Nombre del componente generado (def. `ExportedComponent`).
 */
export function formatForFramework(
  html: string,
  framework: Framework,
  componentName = 'ExportedComponent',
): string {
  switch (framework) {
    case 'react':
      return toReactComponent(html, componentName);
    case 'vue':
      return toVueComponent(html, componentName);
    case 'angular':
      return toAngularComponent(html, componentName);
    default:
      return html;
  }
}

/**
 * Deduce el framework a partir de la extensión de un archivo de salida.
 * @param filePath Ruta de salida (`Card.jsx`, `Card.vue`...).
 */
export function frameworkFromExtension(filePath: string): Framework {
  const ext = filePath.slice(filePath.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'jsx' || ext === 'tsx') return 'react';
  if (ext === 'vue') return 'vue';
  if (ext === 'ts' && /\.component\.ts$/i.test(filePath)) return 'angular';
  return 'html';
}
