/**
 * A11y-MCP (v1.0.0): reglas de auditoría de accesibilidad.
 *
 * `auditDocumentInPage` es una función AUTO-CONTENIDA apta para
 * `page.evaluate()` (Puppeteer) y para ejecutarse sobre un `Document` de
 * jsdom en tests. Implementa un subconjunto práctico de WCAG 2.2 AA
 * orientado a lo que un agente necesita para operar la página:
 *
 * | Regla                     | WCAG      | Impacto  |
 * | ------------------------- | --------- | -------- |
 * | image-alt                 | 1.1.1     | critical |
 * | button-name               | 4.1.2     | critical |
 * | link-name                 | 2.4.4     | serious  |
 * | label                     | 1.3.1/3.3.2 | critical |
 * | color-contrast            | 1.4.3     | serious  |
 * | html-has-lang             | 3.1.1     | serious  |
 * | document-title            | 2.4.2     | serious  |
 * | heading-order             | 1.3.1     | moderate |
 * | landmark-one-main         | 1.3.6     | moderate |
 * | duplicate-id              | 4.1.1     | minor    |
 * | tabindex-positive         | 2.4.3     | moderate |
 * | aria-valid-role           | 4.1.2     | serious  |
 * | target-size               | 2.5.8     | moderate |
 * | iframe-title              | 4.1.2     | serious  |
 * | autoplay-media            | 1.4.2     | moderate |
 * | meta-viewport-scalable    | 1.4.4     | serious  |
 */

/** Impacto de un problema. */
export type A11yImpact = 'critical' | 'serious' | 'moderate' | 'minor';

/** Problema detectado. */
export interface A11yIssue {
  rule: string;
  wcag: string;
  impact: A11yImpact;
  message: string;
  /** Selector del elemento afectado (estable en la medida de lo posible). */
  selector: string;
  /** Fragmento HTML recortado. */
  html: string;
  /** Corrección sugerida (atributos a añadir). */
  fix?: { attrs?: Record<string, string>; note?: string };
}

/** Resultado del análisis en página. */
export interface A11yPageAudit {
  url: string;
  title: string;
  lang: string;
  issues: A11yIssue[];
  /** Elementos comprobados por regla. */
  checked: Record<string, number>;
}

/**
 * Audita el documento. AUTO-CONTENIDA: no referencia nada externo.
 * @param doc Documento (navegador real o jsdom).
 */
export function auditDocumentInPage(doc: Document): A11yPageAudit {
  const issues: A11yIssue[] = [];
  const checked: Record<string, number> = {};
  const win = doc.defaultView;
  const count = (rule: string) => (checked[rule] = (checked[rule] ?? 0) + 1);

  const cssEsc = (v: string) => v.replace(/["\\]/g, '\\$&');
  const selectorFor = (el: Element): string => {
    if (
      el.id &&
      !/^\d|[:\s]/.test(el.id) &&
      doc.querySelectorAll(`#${cssEsc(el.id)}`).length === 1
    )
      return `#${el.id}`;
    for (const attr of ['data-tool', 'data-testid', 'name', 'aria-label']) {
      const v = el.getAttribute(attr);
      if (
        v &&
        doc.querySelectorAll(`${el.tagName.toLowerCase()}[${attr}="${cssEsc(v)}"]`)
          .length === 1
      )
        return `${el.tagName.toLowerCase()}[${attr}="${v}"]`;
    }
    const parts: string[] = [];
    let cur: Element | null = el;
    while (cur && cur !== doc.documentElement && parts.length < 5) {
      const tag = cur.tagName.toLowerCase();
      const parent: Element | null = cur.parentElement;
      if (!parent) break;
      const same = Array.from(parent.children).filter((c) => c.tagName === cur!.tagName);
      parts.unshift(
        same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(cur) + 1})` : tag,
      );
      if (cur.id && !/^\d|[:\s]/.test(cur.id)) {
        parts[0] = `#${cur.id}`;
        break;
      }
      cur = parent;
    }
    return parts.join(' > ');
  };
  const snippet = (el: Element) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 140);
  const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  const accessibleName = (el: Element): string => {
    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const name = labelledby
        .split(/\s+/)
        .map((id) => text(doc.getElementById(id) ?? doc.createElement('span')))
        .join(' ')
        .trim();
      if (name) return name;
    }
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria.trim();
    if (el.tagName === 'INPUT') {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (['submit', 'button', 'reset'].includes(type))
        return (el.getAttribute('value') ?? '').trim();
      if (type === 'image') return (el.getAttribute('alt') ?? '').trim();
    }
    const title = el.getAttribute('title');
    const inner =
      text(el) ||
      Array.from(el.querySelectorAll('img[alt]'))
        .map((i) => i.getAttribute('alt') ?? '')
        .join(' ')
        .trim();
    return inner || (title ?? '').trim();
  };
  const isHidden = (el: Element): boolean => {
    if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden'))
      return true;
    if (!win) return false;
    const st = win.getComputedStyle(el);
    return st.display === 'none' || st.visibility === 'hidden';
  };
  const push = (issue: A11yIssue) => issues.push(issue);

  // html-has-lang / document-title / meta-viewport
  count('html-has-lang');
  const lang = doc.documentElement.getAttribute('lang') ?? '';
  if (!lang.trim())
    push({
      rule: 'html-has-lang',
      wcag: '3.1.1',
      impact: 'serious',
      message: 'El elemento <html> no declara idioma (lang).',
      selector: 'html',
      html: '<html>',
      fix: { attrs: { lang: 'es' } },
    });
  count('document-title');
  if (!text(doc.querySelector('title') ?? doc.createElement('title')))
    push({
      rule: 'document-title',
      wcag: '2.4.2',
      impact: 'serious',
      message: 'El documento no tiene <title>.',
      selector: 'head > title',
      html: '<title>',
      fix: { note: 'Añade un <title> descriptivo.' },
    });
  const viewport = doc.querySelector('meta[name="viewport"]');
  if (viewport) {
    count('meta-viewport-scalable');
    const content = viewport.getAttribute('content') ?? '';
    if (
      /user-scalable\s*=\s*(no|0)/i.test(content) ||
      /maximum-scale\s*=\s*1(\.0)?\b/i.test(content)
    )
      push({
        rule: 'meta-viewport-scalable',
        wcag: '1.4.4',
        impact: 'serious',
        message: 'La meta viewport impide el zoom (user-scalable=no / maximum-scale=1).',
        selector: 'meta[name="viewport"]',
        html: snippet(viewport),
        fix: { attrs: { content: 'width=device-width, initial-scale=1' } },
      });
  }

  // image-alt
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    count('image-alt');
    if (isHidden(img) || img.getAttribute('role') === 'presentation') continue;
    if (!img.hasAttribute('alt'))
      push({
        rule: 'image-alt',
        wcag: '1.1.1',
        impact: 'critical',
        message: 'Imagen sin atributo alt.',
        selector: selectorFor(img),
        html: snippet(img),
        fix: {
          attrs: {
            alt:
              img.getAttribute('title') ??
              img
                .getAttribute('src')
                ?.split('/')
                .pop()
                ?.replace(/\.[a-z]+$/i, '')
                .replace(/[-_]/g, ' ') ??
              'Descripción de la imagen',
          },
        },
      });
  }

  // button-name / link-name / input image
  for (const btn of Array.from(
    doc.querySelectorAll(
      'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], input[type="image"]',
    ),
  )) {
    count('button-name');
    if (isHidden(btn)) continue;
    if (!accessibleName(btn))
      push({
        rule: 'button-name',
        wcag: '4.1.2',
        impact: 'critical',
        message: 'Botón sin nombre accesible.',
        selector: selectorFor(btn),
        html: snippet(btn),
        fix: {
          attrs: {
            'aria-label':
              btn.getAttribute('title') ??
              btn.getAttribute('name') ??
              btn.getAttribute('data-tool')?.replace(/-/g, ' ') ??
              'Describe la acción',
          },
        },
      });
  }
  for (const a of Array.from(doc.querySelectorAll('a[href]'))) {
    count('link-name');
    if (isHidden(a)) continue;
    const name = accessibleName(a);
    if (!name)
      push({
        rule: 'link-name',
        wcag: '2.4.4',
        impact: 'serious',
        message: 'Enlace sin texto ni nombre accesible.',
        selector: selectorFor(a),
        html: snippet(a),
        fix: {
          attrs: { 'aria-label': a.getAttribute('title') ?? 'Describe el destino' },
        },
      });
    else if (
      /^(aqu[ií]|click|clic|here|m[aá]s|more|leer m[aá]s|read more|ver|link|enlace)$/i.test(
        name,
      )
    )
      push({
        rule: 'link-name',
        wcag: '2.4.4',
        impact: 'moderate',
        message: `Texto de enlace poco descriptivo: "${name}".`,
        selector: selectorFor(a),
        html: snippet(a),
        fix: {
          attrs: {
            'aria-label': `${name} — ${a.getAttribute('href') ?? ''}`.slice(0, 80),
          },
        },
      });
  }

  // label
  for (const field of Array.from(doc.querySelectorAll('input, select, textarea'))) {
    const type = (field.getAttribute('type') ?? 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    count('label');
    if (isHidden(field)) continue;
    const id = field.getAttribute('id');
    const hasLabel = Boolean(
      (id && doc.querySelector(`label[for="${cssEsc(id)}"]`)) ||
      field.closest('label') ||
      field.getAttribute('aria-label') ||
      field.getAttribute('aria-labelledby') ||
      (field.getAttribute('title') ?? '').trim(),
    );
    if (!hasLabel) {
      const guess =
        field.getAttribute('placeholder') ?? field.getAttribute('name') ?? type;
      push({
        rule: 'label',
        wcag: '1.3.1',
        impact: 'critical',
        message: 'Campo de formulario sin etiqueta asociada.',
        selector: selectorFor(field),
        html: snippet(field),
        fix: {
          attrs: { 'aria-label': guess },
          note: 'Preferible un <label for> visible.',
        },
      });
    }
  }

  // color-contrast (solo si hay estilos computados: navegador real)
  if (win && typeof win.getComputedStyle === 'function') {
    const parse = (c: string): [number, number, number, number] | null => {
      const m = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)/.exec(c);
      return m
        ? [
            Number(m[1]),
            Number(m[2]),
            Number(m[3]),
            m[4] === undefined ? 1 : Number(m[4]),
          ]
        : null;
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el: Element): number[] | null => {
      let cur: Element | null = el;
      while (cur) {
        const c = parse(win.getComputedStyle(cur).backgroundColor);
        if (c && c[3] > 0.5) return c;
        cur = cur.parentElement;
      }
      return [255, 255, 255, 1];
    };
    const candidates = Array.from(
      doc.querySelectorAll(
        'p, span, a, button, label, li, td, th, h1, h2, h3, h4, h5, h6, input, small, strong, em, div',
      ),
    )
      .filter((el) =>
        Array.from(el.childNodes).some(
          (n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 1,
        ),
      )
      .slice(0, 400);
    for (const el of candidates) {
      count('color-contrast');
      if (isHidden(el)) continue;
      const st = win.getComputedStyle(el);
      const fg = parse(st.color);
      const bg = bgOf(el);
      if (!fg || !bg || fg[3] < 0.5) continue;
      const l1 = lum(fg);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(st.fontSize) || 16;
      const bold = parseInt(st.fontWeight, 10) >= 700;
      const large = size >= 24 || (size >= 18.66 && bold);
      const min = large ? 3 : 4.5;
      if (ratio < min)
        push({
          rule: 'color-contrast',
          wcag: '1.4.3',
          impact: 'serious',
          message: `Contraste ${ratio.toFixed(2)}:1 (mínimo ${min}:1) — texto ${st.color} sobre rgb(${bg.slice(0, 3).join(', ')}).`,
          selector: selectorFor(el),
          html: snippet(el),
          fix: { note: `Oscurece el texto o aclara el fondo hasta ≥ ${min}:1.` },
        });
    }
  }

  // heading-order / landmark-one-main
  const headings = Array.from(doc.querySelectorAll('h1, h2, h3, h4, h5, h6'));
  let last = 0;
  for (const h of headings) {
    count('heading-order');
    const level = Number(h.tagName[1]);
    if (last && level > last + 1)
      push({
        rule: 'heading-order',
        wcag: '1.3.1',
        impact: 'moderate',
        message: `Salto de nivel de encabezado: h${last} → h${level}.`,
        selector: selectorFor(h),
        html: snippet(h),
        fix: { note: `Usa h${last + 1}.` },
      });
    last = level;
  }
  if (headings.length && !doc.querySelector('h1'))
    push({
      rule: 'heading-order',
      wcag: '1.3.1',
      impact: 'moderate',
      message: 'La página no tiene <h1>.',
      selector: 'body',
      html: '<body>',
      fix: { note: 'Añade un h1 con el título principal.' },
    });
  count('landmark-one-main');
  const mains = doc.querySelectorAll('main, [role="main"]').length;
  if (mains === 0)
    push({
      rule: 'landmark-one-main',
      wcag: '1.3.6',
      impact: 'moderate',
      message: 'No hay región <main>.',
      selector: 'body',
      html: '<body>',
      fix: { note: 'Envuelve el contenido principal en <main>.' },
    });
  else if (mains > 1)
    push({
      rule: 'landmark-one-main',
      wcag: '1.3.6',
      impact: 'moderate',
      message: `Hay ${mains} regiones main.`,
      selector: 'main',
      html: '<main>',
      fix: { note: 'Deja una sola región main.' },
    });

  // duplicate-id
  const ids = new Map<string, number>();
  for (const el of Array.from(doc.querySelectorAll('[id]')))
    ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
  for (const [id, n] of ids) {
    count('duplicate-id');
    if (n > 1)
      push({
        rule: 'duplicate-id',
        wcag: '4.1.1',
        impact: 'minor',
        message: `id="${id}" repetido ${n} veces.`,
        selector: `[id="${id}"]`,
        html: `id="${id}"`,
        fix: { note: 'Los ids deben ser únicos (afecta a label[for] y aria-*).' },
      });
  }

  // tabindex-positive / aria-valid-role / iframe-title / autoplay / target-size
  for (const el of Array.from(doc.querySelectorAll('[tabindex]'))) {
    count('tabindex-positive');
    if (Number(el.getAttribute('tabindex')) > 0)
      push({
        rule: 'tabindex-positive',
        wcag: '2.4.3',
        impact: 'moderate',
        message: 'tabindex positivo altera el orden de foco.',
        selector: selectorFor(el),
        html: snippet(el),
        fix: { attrs: { tabindex: '0' } },
      });
  }
  const validRoles = new Set([
    'alert',
    'alertdialog',
    'application',
    'article',
    'banner',
    'button',
    'cell',
    'checkbox',
    'columnheader',
    'combobox',
    'complementary',
    'contentinfo',
    'definition',
    'dialog',
    'directory',
    'document',
    'feed',
    'figure',
    'form',
    'grid',
    'gridcell',
    'group',
    'heading',
    'img',
    'link',
    'list',
    'listbox',
    'listitem',
    'log',
    'main',
    'marquee',
    'math',
    'menu',
    'menubar',
    'menuitem',
    'menuitemcheckbox',
    'menuitemradio',
    'navigation',
    'none',
    'note',
    'option',
    'presentation',
    'progressbar',
    'radio',
    'radiogroup',
    'region',
    'row',
    'rowgroup',
    'rowheader',
    'scrollbar',
    'search',
    'searchbox',
    'separator',
    'slider',
    'spinbutton',
    'status',
    'switch',
    'tab',
    'table',
    'tablist',
    'tabpanel',
    'term',
    'textbox',
    'timer',
    'toolbar',
    'tooltip',
    'tree',
    'treegrid',
    'treeitem',
  ]);
  for (const el of Array.from(doc.querySelectorAll('[role]'))) {
    count('aria-valid-role');
    const role = (el.getAttribute('role') ?? '').trim().split(/\s+/)[0];
    if (role && !validRoles.has(role))
      push({
        rule: 'aria-valid-role',
        wcag: '4.1.2',
        impact: 'serious',
        message: `role="${role}" no es un rol ARIA válido.`,
        selector: selectorFor(el),
        html: snippet(el),
        fix: { note: 'Usa un rol válido o elimínalo.' },
      });
  }
  for (const fr of Array.from(doc.querySelectorAll('iframe, frame'))) {
    count('iframe-title');
    if (!(fr.getAttribute('title') ?? '').trim() && !isHidden(fr))
      push({
        rule: 'iframe-title',
        wcag: '4.1.2',
        impact: 'serious',
        message: 'iframe sin title.',
        selector: selectorFor(fr),
        html: snippet(fr),
        fix: { attrs: { title: 'Describe el contenido del marco' } },
      });
  }
  for (const media of Array.from(
    doc.querySelectorAll('video[autoplay], audio[autoplay]'),
  )) {
    count('autoplay-media');
    if (!media.hasAttribute('muted') || !media.hasAttribute('controls'))
      push({
        rule: 'autoplay-media',
        wcag: '1.4.2',
        impact: 'moderate',
        message: 'Medio con autoplay sin muted/controls.',
        selector: selectorFor(media),
        html: snippet(media),
        fix: { attrs: { muted: '', controls: '' } },
      });
  }
  if (win) {
    for (const el of Array.from(
      doc.querySelectorAll(
        'a[href], button, input[type="button"], input[type="submit"], [role="button"]',
      ),
    ).slice(0, 300)) {
      count('target-size');
      if (isHidden(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 24 || r.height < 24) {
        const inline =
          el.tagName === 'A' &&
          el.parentElement &&
          /^(P|LI|SPAN|TD)$/.test(el.parentElement.tagName) &&
          text(el.parentElement).length > text(el).length + 10;
        if (!inline)
          push({
            rule: 'target-size',
            wcag: '2.5.8',
            impact: 'moderate',
            message: `Objetivo táctil de ${Math.round(r.width)}×${Math.round(r.height)} px (mínimo 24×24).`,
            selector: selectorFor(el),
            html: snippet(el),
            fix: { note: 'Aumenta padding o tamaño mínimo a 24×24 px.' },
          });
      }
    }
  }

  return {
    url: doc.location?.href ?? '',
    title: text(doc.querySelector('title') ?? doc.createElement('title')),
    lang,
    issues,
    checked,
  };
}
