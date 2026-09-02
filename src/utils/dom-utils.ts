/**
 * Utilidades para inspeccionar y manipular el DOM.
 *
 * IMPORTANTE: `collectCandidatesInPage` está escrita como función
 * AUTO-CONTENIDA (sin referencias externas) para que pueda serializarse y
 * ejecutarse dentro de un navegador real vía `page.evaluate(fn)` de
 * Puppeteer, además de poder invocarse directamente sobre un `Document` de
 * jsdom en los tests.
 */
import type { ElementSnapshot } from '../types';

/**
 * Recolecta instantáneas de los elementos "interesantes" de un documento:
 * elementos interactivos (botones, enlaces, inputs, selects) y elementos con
 * atributos `data-*`, id, o texto corto visible. Para cada uno infiere un
 * selector estable priorizando `data-*` > `id` > `name`/`aria-label` >
 * ruta de clases con `:nth-of-type`.
 *
 * @param doc Documento DOM (real o jsdom).
 * @returns Lista de {@link ElementSnapshot} serializables.
 */
export function collectCandidatesInPage(doc: Document): ElementSnapshot[] {
  /** Escapa un valor para usarlo dentro de un selector de atributo. */
  function escapeAttr(v: string): string {
    return v.replace(/["\\]/g, '\\$&');
  }

  /** Comprueba si un id/clase es "estable" (no parece autogenerado). */
  function looksStable(token: string): boolean {
    if (!token) return false;
    if (token.length > 32) return false;
    // Hashes tipo css-modules: sufijos de 5+ chars alfanuméricos aleatorios.
    if (/[_-][a-z0-9]{6,}$/i.test(token) && /\d/.test(token.slice(-6))) return false;
    if (/^[a-f0-9]{8,}$/i.test(token)) return false;
    return true;
  }

  /**
   * Construye un selector estable para un elemento.
   * Prioridad: data-* único → id → name/aria-label → tag+clases(+nth).
   */
  function buildSelector(el: Element): string {
    const tag = el.tagName.toLowerCase();

    // 1) Atributos data-* (los más estables frente a rediseños).
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith('data-') && attr.value) {
        const sel = `[${attr.name}="${escapeAttr(attr.value)}"]`;
        try {
          if (doc.querySelectorAll(sel).length === 1) return sel;
        } catch {
          /* selector inválido, continuar */
        }
      }
    }

    // 2) ID estable.
    const id = el.getAttribute('id');
    if (id && looksStable(id)) {
      const cssApi = (doc.defaultView as { CSS?: { escape(v: string): string } } | null)
        ?.CSS;
      const sel = `#${cssApi && typeof cssApi.escape === 'function' ? cssApi.escape(id) : id}`;
      try {
        if (doc.querySelectorAll(sel).length === 1) return sel;
      } catch {
        /* continuar */
      }
    }

    // 3) name / aria-label.
    for (const attrName of ['name', 'aria-label']) {
      const val = el.getAttribute(attrName);
      if (val) {
        const sel = `${tag}[${attrName}="${escapeAttr(val)}"]`;
        try {
          if (doc.querySelectorAll(sel).length === 1) return sel;
        } catch {
          /* continuar */
        }
      }
    }

    // 4) Clases estables (+ :nth-of-type como último recurso).
    const classes = Array.from(el.classList).filter(looksStable).slice(0, 2);
    let sel = tag + classes.map((c) => `.${c}`).join('');
    try {
      const matches = doc.querySelectorAll(sel);
      if (matches.length === 1) return sel;
      // Anclar con el padre.
      const parent = el.parentElement;
      if (parent) {
        const parentSel = buildParentAnchor(parent);
        if (parentSel) {
          const combined = `${parentSel} ${sel}`;
          if (doc.querySelectorAll(combined).length === 1) return combined;
        }
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === el.tagName,
        );
        const idx = siblings.indexOf(el) + 1;
        sel = `${sel}:nth-of-type(${idx})`;
        if (doc.querySelectorAll(sel).length === 1) return sel;
      }
    } catch {
      /* continuar */
    }
    return sel;
  }

  /** Intenta un ancla corta para el padre (data-*, id o clase). */
  function buildParentAnchor(parent: Element): string | null {
    for (const attr of Array.from(parent.attributes)) {
      if (attr.name.startsWith('data-')) {
        return attr.value
          ? `[${attr.name}="${escapeAttr(attr.value)}"]`
          : `[${attr.name}]`;
      }
    }
    const pid = parent.getAttribute('id');
    if (pid && looksStable(pid)) return `#${pid}`;
    const cls = Array.from(parent.classList).find(looksStable);
    if (cls) return `.${cls}`;
    return null;
  }

  /**
   * Selector de familia: tag + clases estables (opcionalmente ancladas a un
   * ancestro con clase estable). Solo se devuelve si matchea ≥2 elementos:
   * generaliza herramientas repetidas (un botón por tarjeta, etc.).
   */
  function buildFamilySelector(el: Element): string | undefined {
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).filter(looksStable).slice(0, 2);
    if (classes.length === 0) return undefined;
    const base = tag + classes.map((c) => `.${c}`).join('');
    try {
      const count = doc.querySelectorAll(base).length;
      if (count < 2) return undefined;
      // Ancla con el ancestro estable más cercano si mantiene la familia.
      let ancestor = el.parentElement;
      while (ancestor && ancestor !== doc.body) {
        const anchorCls = Array.from(ancestor.classList).find(looksStable);
        if (anchorCls) {
          const anchored = `.${anchorCls} ${base}`;
          const anchoredCount = doc.querySelectorAll(anchored).length;
          if (anchoredCount >= 2) return anchored;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      return base;
    } catch {
      return undefined;
    }
  }

  /** Extrae el texto visible directo (recortado). */
  function visibleText(el: Element): string {
    const raw =
      (el as HTMLElement).innerText !== undefined
        ? (el as HTMLElement).innerText
        : el.textContent || '';
    return raw.replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  /** Atributos relevantes para la huella. */
  function relevantAttrs(el: Element): Record<string, string> {
    const out: Record<string, string> = {};
    for (const attr of Array.from(el.attributes)) {
      if (
        attr.name.startsWith('data-') ||
        ['id', 'name', 'type', 'role', 'aria-label', 'placeholder', 'href'].includes(
          attr.name,
        )
      ) {
        out[attr.name] = attr.value.slice(0, 80);
      }
    }
    return out;
  }

  const INTERACTIVE =
    'a, button, input, select, textarea, [role="button"], [onclick], [data-action]';
  const seen = new Set<Element>();
  const results: ElementSnapshot[] = [];

  const interactive = Array.from(doc.querySelectorAll(INTERACTIVE));
  const withData = Array.from(doc.querySelectorAll('[id], [class]')).filter((el) => {
    const t = visibleText(el);
    return t.length > 0 && t.length <= 80 && el.children.length <= 2;
  });

  for (const el of [...interactive, ...withData]) {
    if (seen.has(el)) continue;
    seen.add(el);
    let rect: ElementSnapshot['rect'];
    let visible = true;
    try {
      const r = el.getBoundingClientRect();
      rect = { x: r.x, y: r.y, width: r.width, height: r.height };
      // jsdom devuelve 0x0; solo marcamos invisible en navegadores reales
      // cuando hay layout y el elemento no ocupa espacio.
      const style = el.ownerDocument.defaultView?.getComputedStyle?.(el) ?? undefined;
      if (style && (style.display === 'none' || style.visibility === 'hidden')) {
        visible = false;
      }
    } catch {
      /* sin layout */
    }
    results.push({
      selector: buildSelector(el),
      familySelector: buildFamilySelector(el),
      tag: el.tagName.toLowerCase(),
      text: visibleText(el),
      attrs: relevantAttrs(el),
      visible,
      rect,
    });
    if (results.length >= 400) break; // límite de seguridad
  }
  return results;
}

/**
 * Captura la huella ({@link import('../types').Fingerprint}) de un elemento.
 * También auto-contenida para poder ejecutarse en el navegador.
 *
 * @param el Elemento del DOM.
 * @returns Huella con tag, texto y atributos relevantes.
 */
export function captureFingerprint(el: Element): {
  tag: string;
  text: string;
  attrs: Record<string, string>;
} {
  const attrs: Record<string, string> = {};
  for (const attr of Array.from(el.attributes)) {
    if (
      attr.name.startsWith('data-') ||
      ['id', 'name', 'type', 'role', 'aria-label', 'placeholder'].includes(attr.name)
    ) {
      attrs[attr.name] = attr.value.slice(0, 80);
    }
  }
  const raw =
    (el as HTMLElement).innerText !== undefined
      ? (el as HTMLElement).innerText
      : el.textContent || '';
  return {
    tag: el.tagName.toLowerCase(),
    text: raw.replace(/\s+/g, ' ').trim().slice(0, 120),
    attrs,
  };
}
