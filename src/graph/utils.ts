/**
 * Utilidades del módulo de grafo: sanitización de nombres de archivo,
 * escape YAML y helpers varios.
 */

/**
 * Convierte un texto arbitrario (selector, nombre de herramienta...) en un
 * nombre de archivo válido en Windows, Linux y macOS.
 *
 * Reemplaza caracteres prohibidos (`< > : " / \ | ? * # [ ] ^`), colapsa
 * espacios, recorta puntos/espacios finales (Windows) y limita la longitud.
 *
 * @param name Texto de entrada.
 * @param maxLength Longitud máxima (def. 80).
 * @returns Nombre de archivo seguro y no vacío.
 */
export function sanitizeFileName(name: string, maxLength = 80): string {
  const replaced = name
    .replace(/[<>:"/\\|?*#[\]^]/g, '-') // prohibidos en FS y en enlaces [[wiki]]
    // eslint-disable-next-line no-control-regex -- limpieza deliberada de caracteres de control
    .replace(/[\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim()
    .replace(/[. ]+$/g, ''); // Windows no permite punto/espacio final
  const cut = replaced.slice(0, maxLength).trim();
  return !cut || /^-+$/.test(cut) ? 'sin-nombre' : cut;
}

/**
 * Escapa un valor para incluirlo en frontmatter YAML entre comillas dobles.
 * @param value Texto a escapar.
 */
export function yamlEscape(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Devuelve un enlace wiki de Obsidian `[[archivo|alias]]`.
 * @param file Nombre de la nota (sin `.md`), ya sanitizado.
 * @param alias Alias visible (opcional; se omite si coincide).
 */
export function wikiLink(file: string, alias?: string): string {
  if (alias && alias !== file) return `[[${file}|${alias}]]`;
  return `[[${file}]]`;
}

/**
 * Elimina duplicados de una lista conservando el orden.
 * @param items Lista de entrada.
 */
export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

/**
 * Asigna nombres de archivo únicos a una lista de etiquetas: si dos
 * etiquetas sanitizan igual, añade sufijos `-2`, `-3`...
 *
 * @param labels Etiquetas originales (en orden).
 * @returns Mapa etiqueta original → nombre de archivo único.
 */
export function uniqueFileNames(labels: string[]): Map<string, string> {
  const used = new Map<string, number>();
  const result = new Map<string, string>();
  for (const label of labels) {
    if (result.has(label)) continue;
    const base = sanitizeFileName(label);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    result.set(label, count === 0 ? base : `${base}-${count + 1}`);
  }
  return result;
}
