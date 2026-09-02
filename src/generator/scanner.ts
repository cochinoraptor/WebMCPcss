/**
 * Scanner del generador automático.
 *
 * `scanInteractiveElementsInPage` es una función AUTO-CONTENIDA (sin
 * referencias externas) apta para `page.evaluate(fn)` de Puppeteer y para
 * ejecutarse directamente sobre un `Document` de jsdom en los tests.
 *
 * Extrae formularios, botones, enlaces de acción y marcadores de framework.
 */

/** Campo de entrada detectado dentro de un formulario. */
export interface ScannedField {
  selector: string;
  tag: string;
  type: string;
  name: string;
  placeholder: string;
  label: string;
}

/** Formulario detectado. */
export interface ScannedForm {
  selector: string;
  /** Selector del botón/submit que dispara el formulario. */
  submitSelector: string;
  /** Texto del botón de envío. */
  submitText: string;
  action: string;
  id: string;
  fields: ScannedField[];
}

/** Botón o enlace de acción fuera de formularios. */
export interface ScannedAction {
  selector: string;
  tag: string;
  text: string;
  ariaLabel: string;
  href: string;
  id: string;
  name: string;
}

/** Resultado completo del escaneo. */
export interface PageScan {
  forms: ScannedForm[];
  actions: ScannedAction[];
  /** Marcadores crudos para detección de framework. */
  frameworkMarkers: string[];
  title: string;
}

/**
 * Escanea el documento y devuelve formularios, acciones y marcadores.
 * AUTO-CONTENIDA: no referencia nada fuera de su cuerpo.
 *
 * @param doc Documento DOM (navegador real o jsdom).
 */
export function scanInteractiveElementsInPage(doc: Document): PageScan {
  /** ¿Token de clase/id estable (no hash autogenerado)? */
  function stable(token: string): boolean {
    if (!token || token.length > 32) return false;
    if (/^(css|sc|jss)-/.test(token)) return false;
    if (/[_-][a-z0-9]{6,}$/i.test(token) && /\d/.test(token.slice(-6))) return false;
    if (/^[a-f0-9]{8,}$/i.test(token)) return false;
    return true;
  }

  /** Selector estable: data-* único → id → name → aria-label → tag.clase. */
  function sel(el: Element): string {
    const tag = el.tagName.toLowerCase();
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.indexOf('data-') === 0 && attr.name !== 'data-v' && attr.value) {
        if (/^data-v-/.test(attr.name)) continue;
        const s = '[' + attr.name + '="' + attr.value.replace(/["\\]/g, '\\$&') + '"]';
        try {
          if (doc.querySelectorAll(s).length === 1) return s;
        } catch {
          /* seguir */
        }
      }
    }
    const id = el.getAttribute('id');
    if (id && stable(id)) {
      try {
        if (doc.querySelectorAll('#' + id.replace(/([^\w-])/g, '\\$1')).length === 1)
          return '#' + id;
      } catch {
        /* seguir */
      }
    }
    for (const a of ['name', 'aria-label']) {
      const v = el.getAttribute(a);
      if (v) {
        const s = tag + '[' + a + '="' + v.replace(/["\\]/g, '\\$&') + '"]';
        try {
          if (doc.querySelectorAll(s).length === 1) return s;
        } catch {
          /* seguir */
        }
      }
    }
    const classes: string[] = [];
    for (const c of Array.from(el.classList)) {
      if (stable(c)) classes.push(c);
      if (classes.length === 2) break;
    }
    let s = tag + classes.map((c) => '.' + c).join('');
    try {
      if (doc.querySelectorAll(s).length === 1) return s;
      const parent = el.parentElement;
      if (parent) {
        const pCls = Array.from(parent.classList).filter(stable)[0];
        const pid = parent.getAttribute('id');
        const anchor = pid && stable(pid) ? '#' + pid : pCls ? '.' + pCls : '';
        if (anchor) {
          const combined = anchor + ' ' + s;
          if (doc.querySelectorAll(combined).length === 1) return combined;
        }
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === el.tagName,
        );
        const idx = siblings.indexOf(el) + 1;
        s = s + ':nth-of-type(' + idx + ')';
      }
    } catch {
      /* seguir */
    }
    return s;
  }

  /** Texto visible recortado. */
  function txt(el: Element): string {
    const raw =
      (el as HTMLElement).innerText !== undefined
        ? (el as HTMLElement).innerText
        : el.textContent || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  /** Etiqueta (<label>) asociada a un campo. */
  function labelFor(field: Element): string {
    const id = field.getAttribute('id');
    if (id) {
      const lab = doc.querySelector('label[for="' + id + '"]');
      if (lab) return txt(lab);
    }
    const parentLabel = field.closest ? field.closest('label') : null;
    return parentLabel ? txt(parentLabel) : '';
  }

  // --- Formularios ---
  const forms: ScannedForm[] = [];
  for (const form of Array.from(doc.querySelectorAll('form'))) {
    const fields: ScannedField[] = [];
    for (const f of Array.from(form.querySelectorAll('input, textarea, select'))) {
      const type = (f.getAttribute('type') || f.tagName.toLowerCase()).toLowerCase();
      if (['submit', 'button', 'hidden', 'image', 'reset'].indexOf(type) >= 0) continue;
      fields.push({
        selector: sel(f),
        tag: f.tagName.toLowerCase(),
        type,
        name: f.getAttribute('name') || f.getAttribute('id') || '',
        placeholder: f.getAttribute('placeholder') || '',
        label: labelFor(f),
      });
    }
    const submit =
      form.querySelector('button[type="submit"], input[type="submit"]') ||
      form.querySelector('button');
    forms.push({
      selector: sel(form),
      submitSelector: submit ? sel(submit) : sel(form),
      submitText: submit ? txt(submit) || submit.getAttribute('value') || '' : '',
      action: form.getAttribute('action') || '',
      id: form.getAttribute('id') || '',
      fields,
    });
  }

  // --- Botones y enlaces de acción fuera de formularios ---
  const actions: ScannedAction[] = [];
  const ACTION_HREF =
    /(cart|checkout|login|signin|signup|register|buy|add|subscribe|search)/i;
  const candidates = Array.from(
    doc.querySelectorAll('button, input[type="button"], [role="button"], a[href]'),
  );
  for (const el of candidates) {
    if (el.closest && el.closest('form')) continue;
    const href = el.getAttribute('href') || '';
    const isRoleButton = el.getAttribute('role') === 'button';
    if (el.tagName.toLowerCase() === 'a' && !isRoleButton && !ACTION_HREF.test(href))
      continue;
    const text = txt(el);
    const aria = el.getAttribute('aria-label') || '';
    if (!text && !aria && !el.getAttribute('id')) continue;
    actions.push({
      selector: sel(el),
      tag: el.tagName.toLowerCase(),
      text,
      ariaLabel: aria,
      href,
      id: el.getAttribute('id') || '',
      name: el.getAttribute('name') || '',
    });
    if (actions.length >= 40) break;
  }

  // --- Marcadores de framework ---
  const markers: string[] = [];
  const html = doc.documentElement;
  if (doc.querySelector('[data-reactroot], #__next, #root [data-reactid]'))
    markers.push('react');
  if (doc.querySelector('script#__NEXT_DATA__') || doc.querySelector('#__next'))
    markers.push('next');
  const anyEl = doc.querySelector('[class]');
  for (const el of Array.from(doc.querySelectorAll('*')).slice(0, 300)) {
    for (const attr of Array.from(el.attributes)) {
      if (/^data-v-[0-9a-f]/.test(attr.name)) {
        markers.push('vue');
        break;
      }
      if (/^_ngcontent|^ng-version/.test(attr.name)) {
        markers.push('angular');
        break;
      }
    }
    if (
      markers.indexOf('svelte') < 0 &&
      /(^|\s)svelte-[a-z0-9]/.test(el.className + '')
    ) {
      markers.push('svelte');
    }
    if (markers.length >= 4) break;
  }
  if (html && html.getAttribute('ng-version')) markers.push('angular');
  if (doc.querySelector('[class*="Mui"]')) markers.push('mui');
  if (doc.querySelector('[class*="ant-"]')) markers.push('antd');
  if (doc.querySelector('.btn, .navbar, .container-fluid')) markers.push('bootstrap');
  if (anyEl) {
    const cls = Array.from(doc.querySelectorAll('[class]'))
      .slice(0, 50)
      .map((e) => e.getAttribute('class') || '')
      .join(' ');
    if (
      /(^|\s)(flex|grid|px-\d|py-\d|mt-\d|bg-\w+-\d{2,3}|text-\w+-\d{2,3})(\s|$)/.test(
        cls,
      )
    ) {
      markers.push('tailwind');
    }
  }

  return {
    forms,
    actions,
    frameworkMarkers: Array.from(new Set(markers)),
    title: doc.title || '',
  };
}
