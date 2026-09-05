/**
 * Conversor Markdown → HTML mínimo y sin dependencias para las páginas de
 * documentación del Component Hub (`docs/hub/*.md`). Soporta lo que usan
 * esos documentos: encabezados, párrafos, listas, bloques de código,
 * tablas sencillas, énfasis, código en línea, enlaces y citas.
 */

/** Escapa texto para insertarlo en HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Genera un `id` estable a partir del texto de un encabezado. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Traduce enlaces entre documentos del hub escritos para GitHub
 * (`./component-usage.md`, `contributing.md#seccion`) a las rutas del sitio
 * generado (`../component-usage/`), donde cada guía vive en su carpeta.
 */
export function rewriteDocHref(href: string): string {
  const m = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/i.exec(href);
  return m ? `../${m[1]}/${m[2] ?? ''}` : href;
}

/** Formato en línea: código, negrita, cursiva y enlaces. */
export function renderInline(text: string): string {
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\uE000${codes.length - 1}\uE001`;
  });
  out = escapeHtml(out);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // Cursiva con guiones bajos (formato que produce Prettier): solo entre límites
  // de palabra, para no romper identificadores como snake_case.
  out = out.replace(/(^|[\s(>])_([^_\n]+)_(?=$|[\s.,;:)!?<])/g, '$1<em>$2</em>');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    const external = /^https?:/i.test(href);
    return `<a href="${rewriteDocHref(href)}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  return out.replace(/\uE000(\d+)\uE001/g, (_m, i: string) => codes[Number(i)]);
}

/** Encabezado extraído (para índices laterales). */
export interface MdHeading {
  level: number;
  text: string;
  id: string;
}

/**
 * Convierte Markdown a HTML.
 * @returns HTML y lista de encabezados (h2/h3) para navegación.
 */
export function renderMarkdownDoc(md: string): { html: string; headings: MdHeading[] } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const headings: MdHeading[] = [];
  let i = 0;
  const flushParagraph = (buf: string[]): void => {
    if (buf.length) out.push(`<p>${renderInline(buf.join(' '))}</p>`);
    buf.length = 0;
  };
  const para: string[] = [];
  while (i < lines.length) {
    const line = lines[i];
    // Bloque de código
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushParagraph(para);
      const lang = fence[1];
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; // cierre
      out.push(
        `<pre><code${lang ? ` class="language-${escapeHtml(lang)}"` : ''}>${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }
    // Encabezados
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flushParagraph(para);
      const level = h[1].length;
      const text = h[2];
      const id = slugify(text);
      if (level === 2 || level === 3) headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      i++;
      continue;
    }
    // Tablas (| a | b |)
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])
    ) {
      flushParagraph(para);
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, '')
          .split('|')
          .map((c) => renderInline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]))
        rows.push(cells(lines[i++]));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`,
      );
      continue;
    }
    // Listas
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flushParagraph(para);
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        i++;
        // continuación indentada
        while (
          i < lines.length &&
          /^\s{2,}\S/.test(lines[i]) &&
          !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
        ) {
          item += ' ' + lines[i].trim();
          i++;
        }
        items.push(`<li>${renderInline(item)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    // Citas
    if (/^\s*>\s?/.test(line)) {
      flushParagraph(para);
      const quote: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i]))
        quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`);
      continue;
    }
    // Separador
    if (/^\s*---+\s*$/.test(line)) {
      flushParagraph(para);
      out.push('<hr>');
      i++;
      continue;
    }
    if (line.trim() === '') {
      flushParagraph(para);
      i++;
      continue;
    }
    para.push(line.trim());
    i++;
  }
  flushParagraph(para);
  return { html: out.join('\n'), headings };
}
