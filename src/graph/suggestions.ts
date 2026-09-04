/**
 * Recomendaciones de migración para selectores frágiles.
 *
 * Genera sugerencias accionables según los frameworks detectados por el
 * análisis de fragilidad y las heurísticas estructurales.
 */
import type { FragilityLevel } from './types';

/** Recomendación específica por framework detectado. */
const FRAMEWORK_ADVICE: Record<string, string> = {
  'Vue (scoped)':
    'Añade un atributo estable en el componente (`<button data-tool="add-to-cart">`) y selecciona `[data-tool="add-to-cart"]` en lugar del atributo data-v-*',
  Svelte:
    'Evita las clases svelte-*; expón un atributo propio (`data-testid` o `data-tool`) desde el componente Svelte',
  Angular:
    'No selecciones por _ngcontent/_nghost; usa un atributo del template (`data-tool`) o un id estable en el HTML del componente',
  'styled-components':
    'Las clases sc-* cambian en cada build: pasa una prop `data-tool` al styled component y selecciona por ella',
  Emotion:
    'Las clases css-* son hashes de Emotion: añade `data-tool` en el JSX y selecciona `[data-tool="..."]`',
  'CSS Modules':
    'El hash de CSS Modules cambia al recompilar: selecciona por atributo (`data-tool`) o usa `[class*="nombreBase"]` solo como último recurso',
  'CSS Modules (Next.js)':
    'El sufijo __hash de Next.js cambia por build: añade `data-tool` en el JSX o usa `[class^="styles_nombre__"]` como último recurso',
  'CSS Modules (Vite)':
    'El hash de CSS Modules de Vite cambia por build: expón `data-tool`/`data-testid` desde el componente',
  Astro:
    'No selecciones por astro-*/data-astro-cid-*: añade un atributo propio (`data-tool`) en el componente Astro',
  'Element Plus':
    'Las clases el-* son estables dentro de una versión mayor; añade `data-*` propio si planeas actualizar Element Plus',
  'JSS / MUI v4':
    'Los índices jss/makeStyles dependen del orden de montaje: usa `data-testid` (soportado por MUI) o roles ARIA',
  'React (useId)':
    'Los ids :r0: de React useId cambian por sesión: añade tu propio id o data-* estable',
  'MUI v5':
    'Las clases Mui*-slot son razonablemente estables, pero fija la versión de MUI o añade `data-testid` para desacoplarte',
  'Ant Design':
    'Las clases ant-* son estables dentro de una versión mayor; considera `data-*` propio si planeas actualizar AntD',
  Bootstrap:
    'Las clases de Bootstrap identifican estilo, no función: combina con un id o data-* que identifique la acción concreta',
  'Tailwind CSS':
    'Nunca uses utilidades de Tailwind como selector de herramienta: añade un id, una clase semántica propia o `data-tool`',
};

/** Consejos por heurística estructural. */
const STRUCTURAL_ADVICE: Array<{ test: RegExp; advice: string }> = [
  {
    test: /:nth-(child|of-type)\(/,
    advice:
      'Sustituye :nth-child por un identificador del propio elemento (id, data-*, aria-label): el orden de los hermanos cambia con facilidad',
  },
  {
    test: /^[a-z]+(\s+[a-z]+)+$/i,
    advice:
      'Un selector solo de etiquetas es ambiguo: ancla al menos un id, clase semántica o atributo data-*',
  },
];

/**
 * Genera la lista de sugerencias para un selector.
 *
 * @param selector Selector analizado.
 * @param frameworks Frameworks detectados por patrón.
 * @param level Nivel de fragilidad calculado.
 * @param declaredFramework Framework principal declarado por el usuario.
 * @returns Sugerencias ordenadas (sin duplicados).
 */
export function suggestionsFor(
  selector: string,
  frameworks: string[],
  level: FragilityLevel,
  declaredFramework?: string,
): string[] {
  const out: string[] = [];
  for (const fw of frameworks) {
    const advice = FRAMEWORK_ADVICE[fw];
    if (advice) out.push(advice);
  }
  for (const { test, advice } of STRUCTURAL_ADVICE) {
    if (test.test(selector)) out.push(advice);
  }
  if (declaredFramework) {
    const key = Object.keys(FRAMEWORK_ADVICE).find((k) =>
      k.toLowerCase().includes(declaredFramework.toLowerCase()),
    );
    if (key && !frameworks.includes(key)) {
      out.push(`(${key}) ${FRAMEWORK_ADVICE[key]}`);
    }
  }
  if (level !== 'low' && out.length === 0) {
    out.push(
      'Prefiere, por este orden: [data-tool]/[data-testid] → #id semántico → [name]/[aria-label] → clase semántica propia',
    );
  }
  if (level === 'high') {
    out.push(
      'Mientras migras, define webmcp-fingerprint (tag/text/attrs) para que `webmcpcss repair` pueda re-localizar el elemento',
    );
  }
  return [...new Set(out)];
}
