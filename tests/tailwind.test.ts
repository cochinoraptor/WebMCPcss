/**
 * Tests del módulo de integración Tailwind CSS.
 */
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  buildStableSelector,
  classifyClass,
  inspectClassList,
  inspectElement,
  isTailwindClass,
  scanDocument,
  splitVariants,
} from '../src/tailwind/inspector';
import { ChangeHistory } from '../src/tailwind/history';
import { TailwindEditor } from '../src/tailwind/editor';
import {
  applyToolArgs,
  buildTailwindToolsScript,
  generateTailwindTools,
} from '../src/tailwind/tool-generator';
import { registerTailwindTools } from '../src/tailwind/tool-registry';
import { formatForFramework, frameworkFromExtension } from '../src/tailwind/frameworks';
import { htmlToJsx } from '../src/tailwind/frameworks/react';
import {
  installModelContextShim,
  invokeRegisteredTool,
  readRegisteredTools,
} from '../src/webmcp-api';

/* ------------------------------------------------------------------ */
/* Inspector                                                          */
/* ------------------------------------------------------------------ */

describe('tailwind/inspector — clasificación', () => {
  it('clasifica utilidades básicas en su categoría', () => {
    expect(classifyClass('p-4')?.category).toBe('spacing');
    expect(classifyClass('mt-2')?.category).toBe('spacing');
    expect(classifyClass('w-full')?.category).toBe('sizing');
    expect(classifyClass('max-w-3xl')?.category).toBe('sizing');
    expect(classifyClass('flex')?.category).toBe('layout');
    expect(classifyClass('grid-cols-3')?.category).toBe('flexbox-grid');
    expect(classifyClass('gap-6')?.category).toBe('flexbox-grid');
    expect(classifyClass('font-bold')?.category).toBe('typography');
    expect(classifyClass('text-xl')?.category).toBe('typography');
    expect(classifyClass('rounded-lg')?.category).toBe('borders');
    expect(classifyClass('border')?.category).toBe('borders');
    expect(classifyClass('shadow-md')?.category).toBe('effects');
    expect(classifyClass('opacity-50')?.category).toBe('effects');
    expect(classifyClass('rotate-45')?.category).toBe('transforms');
    expect(classifyClass('transition-colors')?.category).toBe('transitions');
    expect(classifyClass('cursor-pointer')?.category).toBe('interactivity');
    expect(classifyClass('bg-gradient-to-r')?.category).toBe('backgrounds');
  });

  it('desambigua text-/bg-/border- entre color y su otra categoría', () => {
    expect(classifyClass('text-slate-800')?.category).toBe('colors');
    expect(classifyClass('text-center')?.category).toBe('typography');
    expect(classifyClass('bg-indigo-600')?.category).toBe('colors');
    expect(classifyClass('bg-cover')?.category).toBe('backgrounds');
    expect(classifyClass('border-slate-200')?.category).toBe('colors');
    expect(classifyClass('border-2')?.category).toBe('borders');
    expect(classifyClass('text-white')?.category).toBe('colors');
    expect(classifyClass('bg-white/50')?.category).toBe('colors');
  });

  it('gestiona variantes, negativos y valores arbitrarios', () => {
    expect(splitVariants('md:hover:bg-blue-500')).toEqual({
      base: 'bg-blue-500',
      variants: ['md', 'hover'],
    });
    const c = classifyClass('md:hover:bg-blue-500');
    expect(c?.category).toBe('colors');
    expect(c?.variants).toEqual(['md', 'hover']);
    expect(classifyClass('-mt-2')?.category).toBe('spacing');
    expect(classifyClass('p-[13px]')?.category).toBe('spacing');
    expect(classifyClass('bg-[#1da1f2]')?.category).toBe('colors');
  });

  it('rechaza clases que no son de Tailwind', () => {
    expect(classifyClass('site-header')).toBeNull();
    expect(classifyClass('mi-clase-propia')).toBeNull();
    expect(isTailwindClass('p-4')).toBe(true);
    expect(isTailwindClass('navbar')).toBe(false);
  });

  it('inspectClassList agrupa por categoría y separa desconocidas', () => {
    const result = inspectClassList([
      'card',
      'p-6',
      'bg-white',
      'rounded-xl',
      'shadow-md',
    ]);
    expect(result.classes.spacing).toEqual(['p-6']);
    expect(result.classes.colors).toEqual(['bg-white']);
    expect(result.classes.borders).toEqual(['rounded-xl']);
    expect(result.classes.effects).toEqual(['shadow-md']);
    expect(result.unknown).toEqual(['card']);
    expect(result.all).toHaveLength(4);
  });
});

describe('tailwind/inspector — DOM', () => {
  const html = `<!doctype html><html><body>
    <header id="top" class="bg-indigo-600 text-white px-8 py-6 flex"></header>
    <section class="feature-card bg-white p-6 rounded-xl"></section>
    <div class="plain"></div>
    <button data-cy="cta" class="bg-emerald-500 px-6 py-3"></button>
  </body></html>`;

  it('inspectElement devuelve selector estable y clases clasificadas', () => {
    const dom = new JSDOM(html);
    const header = dom.window.document.querySelector('header')!;
    const result = inspectElement(header);
    expect(result.selector).toBe('#top');
    expect(result.tag).toBe('header');
    expect(result.classes.colors).toContain('bg-indigo-600');
    expect(result.classes.spacing).toEqual(['px-8', 'py-6']);
  });

  it('buildStableSelector prefiere id → data-* → clase propia → nth-of-type', () => {
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    expect(buildStableSelector(doc.querySelector('header')!)).toBe('#top');
    expect(buildStableSelector(doc.querySelector('button')!)).toBe('[data-cy="cta"]');
    expect(buildStableSelector(doc.querySelector('section')!)).toBe(
      'section.feature-card',
    );
    expect(buildStableSelector(doc.querySelector('div')!)).toBe('div.plain');
  });

  it('scanDocument encuentra los elementos con clases Tailwind', () => {
    const dom = new JSDOM(html);
    const entries = scanDocument(dom.window.document);
    const selectors = entries.map((e) => e.selector);
    expect(selectors).toContain('#top');
    expect(selectors).toContain('section.feature-card');
    expect(selectors).toContain('[data-cy="cta"]');
    // div.plain no tiene clases Tailwind → fuera.
    expect(selectors).not.toContain('div.plain');
    const card = entries.find((e) => e.selector === 'section.feature-card')!;
    expect(card.id).toBe('FeatureCard');
  });

  it('scanDocument respeta minClasses y maxElements', () => {
    const dom = new JSDOM(html);
    expect(scanDocument(dom.window.document, { maxElements: 1 })).toHaveLength(1);
    expect(
      scanDocument(dom.window.document, { minClasses: 5 }).map((e) => e.selector),
    ).toEqual(['#top']);
  });
});

/* ------------------------------------------------------------------ */
/* Historial y editor                                                 */
/* ------------------------------------------------------------------ */

describe('tailwind/history — ChangeHistory', () => {
  it('gestiona undo/redo y limpia la pila de redo al añadir', () => {
    const h = new ChangeHistory();
    let value = 0;
    h.push({ label: 'a', undo: () => (value -= 1), redo: () => (value += 1) });
    value = 1;
    h.push({ label: 'b', undo: () => (value -= 10), redo: () => (value += 10) });
    value = 11;
    expect(h.undo()).toBe('b');
    expect(value).toBe(1);
    expect(h.canRedo()).toBe(true);
    expect(h.redo()).toBe('b');
    expect(value).toBe(11);
    h.undo();
    h.push({ label: 'c', undo: () => (value -= 100), redo: () => (value += 100) });
    expect(h.canRedo()).toBe(false);
    expect(h.list()).toEqual(['a', 'c']);
    expect(h.undo()).toBe('c');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeNull();
  });
});

describe('tailwind/editor — TailwindEditor', () => {
  function makeCard(): Element {
    const dom = new JSDOM(
      '<!doctype html><body><div id="card" class="p-4 bg-white rounded-lg"></div></body>',
    );
    return dom.window.document.querySelector('#card')!;
  }

  it('addClass / removeClass modifican el DOM en tiempo real', () => {
    const el = makeCard();
    const editor = new TailwindEditor();
    expect(editor.addClass(el, 'shadow-md')).toBe(true);
    expect(el.classList.contains('shadow-md')).toBe(true);
    expect(editor.addClass(el, 'shadow-md')).toBe(false); // ya estaba
    expect(editor.removeClass(el, 'p-4')).toBe(true);
    expect(el.classList.contains('p-4')).toBe(false);
    expect(editor.removeClass(el, 'inexistente')).toBe(false);
  });

  it('replaceClass sustituye y toggleClass alterna', () => {
    const el = makeCard();
    const editor = new TailwindEditor();
    editor.replaceClass(el, 'p-4', 'p-8');
    expect(el.classList.contains('p-4')).toBe(false);
    expect(el.classList.contains('p-8')).toBe(true);
    expect(editor.toggleClass(el, 'hidden')).toBe(true);
    expect(editor.toggleClass(el, 'hidden')).toBe(false);
    expect(el.classList.contains('hidden')).toBe(false);
  });

  it('undo/redo revierte y reaplica cambios sobre el DOM', () => {
    const el = makeCard();
    const editor = new TailwindEditor();
    editor.addClass(el, 'mt-4');
    editor.replaceClass(el, 'bg-white', 'bg-slate-100');
    expect(editor.undo()).toContain('replace');
    expect(el.classList.contains('bg-white')).toBe(true);
    expect(el.classList.contains('bg-slate-100')).toBe(false);
    expect(editor.undo()).toContain('add mt-4');
    expect(el.classList.contains('mt-4')).toBe(false);
    expect(editor.redo()).toContain('add mt-4');
    expect(el.classList.contains('mt-4')).toBe(true);
  });

  it('exportDiffs devuelve el before/after de cada elemento tocado', () => {
    const el = makeCard();
    const editor = new TailwindEditor();
    editor.addClass(el, 'shadow-lg');
    editor.removeClass(el, 'p-4');
    const diffs = editor.exportDiffs();
    expect(diffs).toHaveLength(1);
    expect(diffs[0].selector).toBe('#card');
    expect(diffs[0].before).toBe('p-4 bg-white rounded-lg');
    expect(diffs[0].after).toBe('bg-white rounded-lg shadow-lg');
    expect(editor.getChanges().map((c) => c.op)).toEqual(['add', 'remove']);
  });
});

/* ------------------------------------------------------------------ */
/* Generador y registro de herramientas                               */
/* ------------------------------------------------------------------ */

describe('tailwind/tool-generator', () => {
  function entries() {
    const dom = new JSDOM(
      `<!doctype html><body>
        <div id="card" class="p-6 bg-white rounded-xl text-slate-800"></div>
      </body>`,
    );
    return scanDocument(dom.window.document);
  }

  it('genera herramientas por categoría con nombres edit<Id><Categoria>', () => {
    const tools = generateTailwindTools(entries());
    const names = tools.map((t) => t.name);
    expect(names).toContain('editCardSpacing');
    expect(names).toContain('editCardColors');
    expect(names).toContain('editCardBorders');
    const spacing = tools.find((t) => t.name === 'editCardSpacing')!;
    expect(spacing.selector).toBe('#card');
    expect(spacing.currentClasses).toEqual(['p-6']);
    expect(Object.keys(spacing.inputSchema.properties)).toEqual([
      'add',
      'remove',
      'replace',
    ]);
  });

  it('includeGeneric añade edit<Id>Classes', () => {
    const tools = generateTailwindTools(entries(), { includeGeneric: true });
    expect(tools.map((t) => t.name)).toContain('editCardClasses');
  });

  it('applyToolArgs añade, elimina y reemplaza clases', () => {
    const dom = new JSDOM(
      '<!doctype html><body><div id="x" class="p-4 bg-white"></div></body>',
    );
    const el = dom.window.document.querySelector('#x')!;
    const result = applyToolArgs(el, {
      add: 'mt-2 shadow',
      remove: 'bg-white',
      replace: 'p-4:p-8',
    });
    expect(result.added).toEqual(['p-8', 'mt-2', 'shadow']);
    expect(result.removed).toEqual(['p-4', 'bg-white']);
    expect(el.getAttribute('class')).toBe('p-8 mt-2 shadow');
  });

  it('buildTailwindToolsScript emite un script defensivo y autónomo', () => {
    const script = buildTailwindToolsScript(generateTailwindTools(entries()));
    expect(script).toContain("'use strict'");
    expect(script).toContain('navigator.modelContext');
    expect(script).toContain('registerTool');
    expect(script).toContain('editCardSpacing');
    // Guard defensivo si la API no existe.
    expect(script).toContain("typeof mc.registerTool !== 'function'");
  });

  it('el script generado registra y ejecuta herramientas en jsdom con el shim', async () => {
    const dom = new JSDOM(
      '<!doctype html><body><div id="card" class="p-6 bg-white rounded-xl"></div></body>',
      { runScripts: 'outside-only' },
    );
    const win = dom.window as unknown as Window & { [k: string]: unknown };
    installModelContextShim(win);
    const script = buildTailwindToolsScript(
      generateTailwindTools(scanDocument(dom.window.document)),
    );
    dom.window.eval(script);
    const tools = readRegisteredTools(win);
    expect(tools.map((t) => t.name)).toContain('editCardColors');
    const result = (await invokeRegisteredTool(win, 'editCardColors', {
      replace: 'bg-white:bg-slate-900',
    })) as { content: Array<{ text: string }> };
    const payload = JSON.parse(result.content[0].text) as {
      success: boolean;
      classList: string;
    };
    expect(payload.success).toBe(true);
    expect(payload.classList).toContain('bg-slate-900');
    expect(
      dom.window.document.querySelector('#card')!.classList.contains('bg-slate-900'),
    ).toBe(true);
  });
});

describe('tailwind/tool-registry', () => {
  it('registerTailwindTools registra closures vivos sobre el DOM', async () => {
    const dom = new JSDOM(
      '<!doctype html><body><button id="cta" class="bg-emerald-500 px-6 py-3"></button></body>',
    );
    const win = dom.window as unknown as Window & { [k: string]: unknown };
    installModelContextShim(win);
    const tools = generateTailwindTools(scanDocument(dom.window.document));
    const count = registerTailwindTools(win, tools);
    expect(count).toBe(tools.length);
    const result = (await invokeRegisteredTool(win, 'editCtaSpacing', {
      add: 'mt-8',
    })) as {
      content: Array<{ text: string }>;
    };
    const payload = JSON.parse(result.content[0].text) as { success: boolean };
    expect(payload.success).toBe(true);
    expect(dom.window.document.querySelector('#cta')!.classList.contains('mt-8')).toBe(
      true,
    );
  });

  it('devuelve 0 si navigator.modelContext no existe', () => {
    const dom = new JSDOM('<!doctype html><body></body>');
    expect(registerTailwindTools(dom.window as unknown as Window, [])).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Frameworks                                                         */
/* ------------------------------------------------------------------ */

describe('tailwind/frameworks', () => {
  const html =
    '<div class="p-4 bg-white"><label for="a">A</label><input id="a" class="border"></div>';

  it('react: convierte class→className, for→htmlFor y autocierra voids', () => {
    const jsx = htmlToJsx(html);
    expect(jsx).toContain('className="p-4 bg-white"');
    expect(jsx).toContain('htmlFor="a"');
    expect(jsx).toContain('<input id="a" className="border" />');
    const component = formatForFramework(html, 'react', 'Card');
    expect(component).toContain('export default function Card()');
  });

  it('vue: envuelve en <template> de un SFC', () => {
    const sfc = formatForFramework(html, 'vue', 'Card');
    expect(sfc).toContain('<template>');
    expect(sfc).toContain('class="p-4 bg-white"');
    expect(sfc).toContain('<script setup lang="ts">');
  });

  it('angular: genera componente standalone con selector kebab-case', () => {
    const cmp = formatForFramework(html, 'angular', 'FeatureCard');
    expect(cmp).toContain("selector: 'app-feature-card'");
    expect(cmp).toContain('standalone: true');
    expect(cmp).toContain('export class FeatureCard');
  });

  it('frameworkFromExtension deduce el framework por la extensión', () => {
    expect(frameworkFromExtension('Card.jsx')).toBe('react');
    expect(frameworkFromExtension('Card.tsx')).toBe('react');
    expect(frameworkFromExtension('Card.vue')).toBe('vue');
    expect(frameworkFromExtension('card.component.ts')).toBe('angular');
    expect(frameworkFromExtension('card.html')).toBe('html');
  });
});
