/**
 * Exportación a Vue: envuelve HTML Tailwind en un Single File Component.
 */

/**
 * Genera un SFC de Vue 3 con el fragmento HTML en su `<template>`.
 *
 * @param html HTML de entrada.
 * @param componentName Nombre del componente (se incluye como comentario).
 */
export function toVueComponent(html: string, componentName: string): string {
  const body = html
    .trim()
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');
  return `<!-- ${componentName} — generado por WebMCPcss (tailwind export). -->
<template>
${body}
</template>

<script setup lang="ts">
// Sin lógica: componente de presentación con clases Tailwind.
</script>
`;
}
