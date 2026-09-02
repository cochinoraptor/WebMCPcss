/**
 * Exportación a React: convierte HTML Tailwind en un componente JSX.
 */

/**
 * Convierte atributos HTML a sus equivalentes JSX (`class` → `className`,
 * `for` → `htmlFor`, autocierre de void elements).
 *
 * @param html Fragmento HTML.
 */
export function htmlToJsx(html: string): string {
  return html
    .replace(/\bclass=/g, 'className=')
    .replace(/\bfor=/g, 'htmlFor=')
    .replace(/\btabindex=/g, 'tabIndex=')
    .replace(/\breadonly\b/g, 'readOnly')
    .replace(/\bmaxlength=/g, 'maxLength=')
    .replace(/<(img|input|br|hr|meta|link|source)([^>]*?)\s*\/?>/g, '<$1$2 />');
}

/**
 * Envuelve un fragmento HTML Tailwind en un componente React funcional.
 *
 * @param html HTML de entrada.
 * @param componentName Nombre del componente.
 */
export function toReactComponent(html: string, componentName: string): string {
  const jsx = htmlToJsx(html.trim())
    .split('\n')
    .map((line) => `      ${line}`)
    .join('\n');
  return `/** Componente generado por WebMCPcss (tailwind export). */
export default function ${componentName}() {
  return (
    <>
${jsx}
    </>
  );
}
`;
}
