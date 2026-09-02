/**
 * Generador desde código fuente (v0.6.0): analiza componentes React (JSX/TSX),
 * Vue (SFC) y Svelte SIN navegador ni build, extrayendo elementos
 * interactivos con heurísticas de texto sobre el markup.
 *
 * Alcance deliberado: no es un parser AST completo — cubre el 90% de los
 * componentes reales (tags estáticos con atributos literales). Los casos
 * dinámicos (spread props, atributos calculados) se ignoran con aviso.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { ToolMap } from '../types';
import { toCamelName } from './analyzer';

/** Framework detectado por extensión/contenido del archivo fuente. */
export type SourceFramework = 'react' | 'vue' | 'svelte' | 'html';

/** Elemento interactivo encontrado en el código fuente. */
export interface SourceElement {
  /** Archivo de origen (relativo). */
  file: string;
  /** Tag del elemento (button, input, form, a...). */
  tag: string;
  /** Atributos literales extraídos. */
  attrs: Record<string, string>;
  /** Texto estático interior (si lo hay). */
  text: string;
  /** Nombre del handler (onClick, @click, on:click...) si existe. */
  handler?: string;
  /** Selector estable propuesto (vacío si no hay ancla estable). */
  selector: string;
  /** Aviso si el elemento no tiene ancla estable. */
  warning?: string;
}

/** Resultado del escaneo de una carpeta/archivo de código fuente. */
export interface SourceScan {
  framework: SourceFramework;
  elements: SourceElement[];
  /** Archivos analizados. */
  files: string[];
  /** Avisos globales (elementos sin ancla estable, etc.). */
  warnings: string[];
}

/** Extensiones soportadas por framework. */
const EXTENSIONS: Record<string, SourceFramework> = {
  '.jsx': 'react',
  '.tsx': 'react',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.html': 'html',
};

const INTERACTIVE_TAGS = /^(button|form|input|textarea|select|a)$/i;
const HANDLER_ATTRS =
  /^(onClick|onSubmit|onChange|@click|@submit|v-on:click|v-on:submit|on:click|on:submit)$/;

/**
 * Extrae los atributos literales de la cadena de atributos de un tag.
 * Ignora atributos con valores dinámicos (`{...}`, `:prop`, `bind:`).
 * @param raw Texto entre el nombre del tag y el cierre.
 */
export function parseAttributes(raw: string): {
  attrs: Record<string, string>;
  handler?: string;
} {
  const attrs: Record<string, string> = {};
  let handler: string | undefined;
  const re =
    /([@:a-zA-Z][\w:.@-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})|([@a-zA-Z][\w:.@-]*)(?=[\s/>]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1] ?? m[5];
    if (!name) continue;
    if (HANDLER_ATTRS.test(name)) {
      handler = name;
      continue;
    }
    const literal = m[2] ?? m[3];
    if (literal !== undefined) {
      // className de React → class
      attrs[name === 'className' ? 'class' : name] = literal;
    }
    // m[4] = valor dinámico {expr}: se ignora (no es literal).
  }
  return { attrs, handler };
}

/** Selector estable desde atributos literales: data-* → id → name → aria-label. */
export function selectorFromAttrs(tag: string, attrs: Record<string, string>): string {
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('data-') && !k.startsWith('data-v-') && v) return `[${k}="${v}"]`;
  }
  if (attrs.id) return `#${attrs.id}`;
  if (attrs.name) return `${tag.toLowerCase()}[name="${attrs.name}"]`;
  if (attrs['aria-label'])
    return `${tag.toLowerCase()}[aria-label="${attrs['aria-label']}"]`;
  // Clases estáticas (si las hay y no parecen utilitarias infinitas).
  const cls = (attrs.class ?? '')
    .split(/\s+/)
    .filter((c) => c && c.length <= 32 && !/^(css|sc|jss)-/.test(c))
    .slice(0, 2);
  if (cls.length > 0) return `${tag.toLowerCase()}.${cls.join('.')}`;
  return '';
}

/**
 * Escanea el markup de un componente y devuelve sus elementos interactivos.
 * @param code Código fuente completo del archivo.
 * @param file Nombre del archivo (para reportes).
 */
export function scanSourceCode(code: string, file: string): SourceElement[] {
  const elements: SourceElement[] = [];
  // En Vue solo interesa el <template>; en Svelte/JSX, todo el archivo.
  let markup = code;
  if (file.endsWith('.vue')) {
    const tpl = /<template[^>]*>([\s\S]*?)<\/template>/i.exec(code);
    markup = tpl ? tpl[1] : '';
  }

  const tagRe = /<([a-zA-Z][\w-]*)((?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^}]*\})*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(markup)) !== null) {
    const tag = m[1].toLowerCase();
    const { attrs, handler } = parseAttributes(m[2] ?? '');
    const interactive =
      INTERACTIVE_TAGS.test(tag) || handler !== undefined || attrs.role === 'button';
    if (!interactive) continue;
    // Inputs no interesantes.
    const type = (attrs.type ?? '').toLowerCase();
    if (tag === 'input' && ['hidden', 'image', 'reset'].includes(type)) continue;
    // Texto estático: lo que sigue al tag hasta '<' (si no es expresión).
    const rest = markup.slice(tagRe.lastIndex, tagRe.lastIndex + 120);
    const textMatch = /^([^<{]{1,80})</.exec(rest);
    const text = textMatch ? textMatch[1].replace(/\s+/g, ' ').trim() : '';

    const selector = selectorFromAttrs(tag, attrs);
    elements.push({
      file,
      tag,
      attrs,
      text,
      handler,
      selector,
      warning: selector
        ? undefined
        : `${file}: <${tag}${text ? ` "${text}"` : ''}> sin ancla estable — añade id o data-tool`,
    });
  }
  return elements;
}

/**
 * Escanea un archivo o carpeta de código fuente (recursivo).
 * @param target Ruta a un archivo .jsx/.tsx/.vue/.svelte/.html o carpeta.
 */
export function scanSource(target: string): SourceScan {
  const files: string[] = [];
  const collect = (p: string): void => {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      if (/node_modules|dist|build|\.git/.test(path.basename(p))) return;
      for (const entry of fs.readdirSync(p)) collect(path.join(p, entry));
      return;
    }
    if (EXTENSIONS[path.extname(p)]) files.push(p);
  };
  collect(target);

  const elements: SourceElement[] = [];
  const fwCount: Record<string, number> = {};
  for (const f of files) {
    const fw = EXTENSIONS[path.extname(f)];
    fwCount[fw] = (fwCount[fw] ?? 0) + 1;
    elements.push(
      ...scanSourceCode(fs.readFileSync(f, 'utf8'), path.relative(process.cwd(), f)),
    );
  }
  const framework =
    (Object.entries(fwCount).sort((a, b) => b[1] - a[1])[0]?.[0] as SourceFramework) ??
    'html';
  return {
    framework,
    elements,
    files,
    warnings: elements.filter((e) => e.warning).map((e) => e.warning as string),
  };
}

/**
 * Convierte los elementos con ancla estable en un {@link ToolMap}.
 * Los `input`/`textarea`/`select` se agrupan como parámetros de la
 * herramienta del mismo archivo (heurística: comparten formulario/componente).
 * @param scan Resultado de {@link scanSource}.
 */
export function buildToolMapFromSource(scan: SourceScan): ToolMap {
  const map: ToolMap = { tools: {}, context: {} };
  const used = new Set<string>();
  const uniqueName = (base: string): string => {
    let name = base;
    let n = 2;
    while (used.has(name)) name = `${base}${n++}`;
    used.add(name);
    return name;
  };

  // Campos por archivo (para asociarlos a la acción del mismo componente).
  const fieldsByFile = new Map<string, SourceElement[]>();
  for (const el of scan.elements) {
    if (/^(input|textarea|select)$/.test(el.tag) && el.selector) {
      const list = fieldsByFile.get(el.file) ?? [];
      list.push(el);
      fieldsByFile.set(el.file, list);
    }
  }

  for (const el of scan.elements) {
    if (!el.selector) continue;
    if (/^(input|textarea|select)$/.test(el.tag)) continue; // son params
    const source =
      el.text || el.attrs['aria-label'] || el.attrs.id || el.attrs.name || el.tag;
    const name = uniqueName(toCamelName(source, `${el.tag}Action`));
    const params: ToolMap['tools'][string]['params'] = {};
    for (const field of fieldsByFile.get(el.file) ?? []) {
      const pSource =
        field.attrs.name || field.attrs.placeholder || field.attrs.id || field.tag;
      let pName = toCamelName(pSource, 'value').replace(/[^a-zA-Z0-9]/g, '') || 'value';
      let n = 2;
      while (params[pName]) pName = `${pName}${n++}`;
      params[pName] = { source: 'value', selector: field.selector };
    }
    map.tools[name] = {
      selector: el.selector,
      description: el.text
        ? `${el.text} (${el.file})`.replace(/"/g, "'")
        : `Acción de ${el.file}`.replace(/"/g, "'"),
      params,
      ...(el.tag === 'form'
        ? { trigger: { event: 'submit', selector: el.selector } }
        : {}),
      fingerprint: {
        tag: el.tag,
        ...(el.text ? { text: el.text } : {}),
      },
    };
  }
  return map;
}
