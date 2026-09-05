/**
 * IA-First Web Framework (v1.0.0): catálogo de componentes.
 *
 * Cada componente declara su intención, comportamiento y accesibilidad con
 * propiedades `webmcp-*`, de modo que un agente de IA entiende el sitio sin
 * inferir nada del DOM:
 *
 * ```css
 * .ia-button {
 *   webmcp-component: "button";
 *   webmcp-intent: "submit";        // submit | cancel | navigate | action
 *   webmcp-confirmation: "needed";  // needed | none
 *   webmcp-accessibility: "aria-label: Enviar formulario";
 * }
 * ```
 *
 * Los componentes se renderizan a HTML + CSS (`renderComponent`) y el CSS
 * resultante es un `.webmcp.css` válido para el resto de la herramienta.
 */
import type { ToolMap, ToolSpec } from '../types';

/** Intenciones reconocidas por el framework. */
export const IA_INTENTS = ['submit', 'cancel', 'navigate', 'action', 'read'] as const;
/** Intención de un componente. */
export type IaIntent = (typeof IA_INTENTS)[number];

/** Políticas de confirmación (humano en el bucle). */
export const IA_CONFIRMATIONS = ['needed', 'none'] as const;
/** Política de confirmación. */
export type IaConfirmation = (typeof IA_CONFIRMATIONS)[number];

/** Nombres de componentes IA-First. */
export const IA_COMPONENTS = ['button', 'form', 'card', 'nav', 'hero', 'grid'] as const;
/** Nombre de componente. */
export type IaComponentName = (typeof IA_COMPONENTS)[number];

/** Campo de un `IAForm`. */
export interface IaField {
  /** Nombre del parámetro (camelCase). */
  name: string;
  /** Etiqueta visible. */
  label: string;
  /** Tipo de input HTML. */
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'textarea' | 'select';
  /** Obligatorio. */
  required?: boolean;
  /** Opciones (para `select`). */
  options?: string[];
  /** Placeholder. */
  placeholder?: string;
}

/** Opciones de renderizado de un componente. */
export interface IaComponentOptions {
  /** Nombre de la herramienta WebMCP que declara (camelCase). */
  tool: string;
  /** Texto visible principal (botón, título, marca…). */
  label?: string;
  /** Descripción para agentes (`webmcp-description`). */
  description?: string;
  /** Intención (por defecto la del componente). */
  intent?: IaIntent;
  /** Política de confirmación (por defecto la del componente). */
  confirmation?: IaConfirmation;
  /** Texto accesible (`aria-label`). Si falta se deriva de `label`. */
  ariaLabel?: string;
  /** Campos (form) o elementos (nav/grid). */
  fields?: IaField[];
  /** Enlaces de navegación `[texto, href]` (nav) o items (grid). */
  items?: Array<{ label: string; href?: string; tool?: string }>;
  /** Subtítulo/cuerpo (hero, card). */
  body?: string;
  /** Prefijo de clase (def. `ia`). */
  prefix?: string;
}

/** Descriptor estático de un componente del catálogo. */
export interface IaComponentSpec {
  name: IaComponentName;
  /** Clase CSS base (`ia-button`). */
  className: string;
  /** Intención por defecto. */
  intent: IaIntent;
  /** Confirmación por defecto. */
  confirmation: IaConfirmation;
  /** Etiqueta HTML raíz. */
  tag: string;
  /** Rol ARIA implícito o recomendado. */
  role?: string;
  /** Qué hace para un agente. */
  purpose: string;
}

/** Catálogo de componentes IA-First. */
export const COMPONENT_CATALOG: Record<IaComponentName, IaComponentSpec> = {
  button: {
    name: 'button',
    className: 'ia-button',
    intent: 'action',
    confirmation: 'none',
    tag: 'button',
    role: 'button',
    purpose: 'Acción puntual (enviar, cancelar, navegar, ejecutar).',
  },
  form: {
    name: 'form',
    className: 'ia-form',
    intent: 'submit',
    confirmation: 'needed',
    tag: 'form',
    role: 'form',
    purpose: 'Conjunto de campos con un envío; cada campo es un parámetro.',
  },
  card: {
    name: 'card',
    className: 'ia-card',
    intent: 'read',
    confirmation: 'none',
    tag: 'article',
    role: 'article',
    purpose: 'Unidad de contenido con datos de contexto y una acción opcional.',
  },
  nav: {
    name: 'nav',
    className: 'ia-nav',
    intent: 'navigate',
    confirmation: 'none',
    tag: 'nav',
    role: 'navigation',
    purpose: 'Navegación principal: cada enlace es una herramienta navigate.',
  },
  hero: {
    name: 'hero',
    className: 'ia-hero',
    intent: 'navigate',
    confirmation: 'none',
    tag: 'section',
    role: 'region',
    purpose: 'Cabecera con propuesta de valor y llamada a la acción principal.',
  },
  grid: {
    name: 'grid',
    className: 'ia-grid',
    intent: 'read',
    confirmation: 'none',
    tag: 'section',
    role: 'list',
    purpose: 'Colección de elementos homogéneos (productos, artículos…).',
  },
};

/** Resultado de renderizar un componente. */
export interface RenderedComponent {
  component: IaComponentName;
  tool: string;
  /** Fragmento HTML con atributos `data-tool` estables. */
  html: string;
  /** Reglas `.webmcp.css` del componente. */
  css: string;
  /** Herramientas declaradas (nombre → selector). */
  tools: Record<string, string>;
}

/** Escapa texto para HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convierte un texto a camelCase seguro para nombres de herramienta. */
export function toToolName(text: string, fallback = 'action'): string {
  const words = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (words.length === 0) return fallback;
  return words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
}

/** Convierte camelCase a kebab-case (para `data-tool`). */
export function toKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .toLowerCase();
}

/**
 * Construye el bloque `webmcp-*` común a todos los componentes.
 * @param spec Componente.
 * @param opts Opciones.
 * @param extra Declaraciones adicionales (params, trigger…).
 */
function webmcpBlock(
  selector: string,
  spec: IaComponentSpec,
  opts: IaComponentOptions,
  extra: string[] = [],
  kind: 'tool' | 'context' = 'tool',
  name: string = opts.tool,
): string {
  const aria = opts.ariaLabel ?? opts.label ?? opts.description ?? name;
  const lines = [
    `${selector} {`,
    `  webmcp-${kind}: "${name}";`,
    `  webmcp-component: "${spec.name}";`,
  ];
  if (kind === 'tool') {
    lines.push(`  webmcp-intent: "${opts.intent ?? spec.intent}";`);
    lines.push(`  webmcp-confirmation: "${opts.confirmation ?? spec.confirmation}";`);
  }
  if (opts.description) lines.push(`  webmcp-description: "${opts.description}";`);
  lines.push(`  webmcp-accessibility: "aria-label: ${aria.replace(/"/g, "'")}";`);
  lines.push(...extra, '}');
  return lines.join('\n');
}

/**
 * Renderiza un componente IA-First a HTML + `.webmcp.css`.
 *
 * @param name Componente del catálogo.
 * @param opts Opciones (al menos `tool`).
 * @returns HTML, CSS y herramientas declaradas.
 */
export function renderComponent(name: IaComponentName, opts: IaComponentOptions): RenderedComponent {
  const spec = COMPONENT_CATALOG[name];
  if (!spec) throw new Error(`Componente IA-First desconocido: ${name}`);
  const prefix = opts.prefix ?? 'ia';
  const cls = `${prefix}-${name}`;
  const toolAttr = toKebab(opts.tool);
  const selector = `[data-tool="${toolAttr}"]`;
  const label = opts.label ?? opts.tool;
  const aria = escapeHtml(opts.ariaLabel ?? label);
  const tools: Record<string, string> = {};
  const cssBlocks: string[] = [];
  let html = '';

  switch (name) {
    case 'button': {
      const type = (opts.intent ?? spec.intent) === 'submit' ? 'submit' : 'button';
      html = `<button type="${type}" class="${cls}" data-tool="${toolAttr}" aria-label="${aria}">${escapeHtml(label)}</button>`;
      cssBlocks.push(webmcpBlock(selector, spec, opts));
      tools[opts.tool] = selector;
      break;
    }
    case 'form': {
      const fields = opts.fields ?? [];
      const formId = `${toolAttr}-form`;
      const inputs = fields
        .map((f) => {
          const id = `${toolAttr}-${toKebab(f.name)}`;
          const req = f.required ? ' required' : '';
          const ph = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : '';
          let control: string;
          if (f.type === 'textarea') {
            control = `<textarea id="${id}" name="${f.name}" data-param="${f.name}"${req}${ph}></textarea>`;
          } else if (f.type === 'select') {
            const options = (f.options ?? [])
              .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
              .join('');
            control = `<select id="${id}" name="${f.name}" data-param="${f.name}"${req}>${options}</select>`;
          } else {
            control = `<input id="${id}" type="${f.type ?? 'text'}" name="${f.name}" data-param="${f.name}"${req}${ph}>`;
          }
          return `    <div class="${cls}__field"><label for="${id}">${escapeHtml(f.label)}</label>${control}</div>`;
        })
        .join('\n');
      html = [
        `<form id="${formId}" class="${cls}" data-tool="${toolAttr}" aria-label="${aria}" novalidate>`,
        inputs,
        `    <button type="submit" class="${prefix}-button" data-tool="${toolAttr}-submit" aria-label="${escapeHtml(label)}">${escapeHtml(label)}</button>`,
        `    <p class="${cls}__status" data-confirmation="${toolAttr}" role="status" aria-live="polite" hidden></p>`,
        `</form>`,
      ].join('\n');
      const params = fields.map(
        (f) => `  webmcp-param-${f.name}: value(#${toolAttr}-${toKebab(f.name)});`,
      );
      params.push(`  webmcp-trigger: "submit" on #${formId};`);
      params.push(`  webmcp-confirmation-selector: "[data-confirmation='${toolAttr}']";`);
      // (la política needed|none va en webmcp-confirmation; el selector aquí)
      cssBlocks.push(webmcpBlock(`[data-tool="${toolAttr}-submit"]`, spec, opts, params));
      tools[opts.tool] = `[data-tool="${toolAttr}-submit"]`;
      break;
    }
    case 'card': {
      const action = opts.items?.[0];
      const actionTool = action?.tool ?? `${opts.tool}Action`;
      const actionAttr = toKebab(actionTool);
      html = [
        `<article class="${cls}" data-tool="${toolAttr}" aria-label="${aria}">`,
        `  <h3 class="${cls}__title" data-context="${toolAttr}-title">${escapeHtml(label)}</h3>`,
        opts.body ? `  <p class="${cls}__body" data-context="${toolAttr}-body">${escapeHtml(opts.body)}</p>` : '',
        action
          ? `  <button type="button" class="${prefix}-button" data-tool="${actionAttr}" aria-label="${escapeHtml(action.label)}">${escapeHtml(action.label)}</button>`
          : '',
        `</article>`,
      ]
        .filter(Boolean)
        .join('\n');
      cssBlocks.push(
        webmcpBlock(`[data-context="${toolAttr}-title"]`, spec, { ...opts, description: undefined }, [
          '  webmcp-format: "text";',
        ], 'context', `${opts.tool}Title`),
      );
      if (action) {
        cssBlocks.push(
          webmcpBlock(`[data-tool="${actionAttr}"]`, COMPONENT_CATALOG.button, {
            tool: actionTool,
            label: action.label,
            description: action.label,
            intent: 'action',
          }),
        );
        tools[actionTool] = `[data-tool="${actionAttr}"]`;
      }
      break;
    }
    case 'nav': {
      const items = opts.items ?? [];
      html = [
        `<nav class="${cls}" data-tool="${toolAttr}" aria-label="${aria}">`,
        `  <ul>`,
        ...items.map((it) => {
          const t = it.tool ?? toToolName(`go ${it.label}`);
          return `    <li><a href="${escapeHtml(it.href ?? '#')}" data-tool="${toKebab(t)}">${escapeHtml(it.label)}</a></li>`;
        }),
        `  </ul>`,
        `</nav>`,
      ].join('\n');
      for (const it of items) {
        const t = it.tool ?? toToolName(`go ${it.label}`);
        const sel = `[data-tool="${toKebab(t)}"]`;
        cssBlocks.push(
          webmcpBlock(sel, spec, {
            tool: t,
            label: it.label,
            description: `Navega a ${it.label}`,
            intent: 'navigate',
            confirmation: 'none',
          }),
        );
        tools[t] = sel;
      }
      break;
    }
    case 'hero': {
      const cta = opts.items?.[0];
      const ctaTool = cta?.tool ?? `${opts.tool}Cta`;
      html = [
        `<section class="${cls}" data-tool="${toolAttr}" aria-label="${aria}">`,
        `  <h1 class="${cls}__title">${escapeHtml(label)}</h1>`,
        opts.body ? `  <p class="${cls}__subtitle">${escapeHtml(opts.body)}</p>` : '',
        cta
          ? `  <a class="${prefix}-button ${cls}__cta" href="${escapeHtml(cta.href ?? '#')}" data-tool="${toKebab(ctaTool)}" aria-label="${escapeHtml(cta.label)}">${escapeHtml(cta.label)}</a>`
          : '',
        `</section>`,
      ]
        .filter(Boolean)
        .join('\n');
      if (cta) {
        const sel = `[data-tool="${toKebab(ctaTool)}"]`;
        cssBlocks.push(
          webmcpBlock(sel, spec, {
            tool: ctaTool,
            label: cta.label,
            description: opts.description ?? `Llamada a la acción: ${cta.label}`,
            intent: 'navigate',
          }),
        );
        tools[ctaTool] = sel;
      }
      break;
    }
    case 'grid': {
      const items = opts.items ?? [];
      html = [
        `<section class="${cls}" data-tool="${toolAttr}" role="list" aria-label="${aria}">`,
        ...items.map(
          (it, i) =>
            `  <article class="${cls}__item" role="listitem" data-item-index="${i}"><h3 data-context="${toolAttr}-name">${escapeHtml(it.label)}</h3>${
              it.tool
                ? `<button type="button" class="${prefix}-button" data-tool="${toKebab(it.tool)}" aria-label="${escapeHtml(it.label)}">${escapeHtml(it.label)}</button>`
                : ''
            }</article>`,
        ),
        `</section>`,
      ].join('\n');
      cssBlocks.push(
        webmcpBlock(`[data-context="${toolAttr}-name"]`, spec, opts, ['  webmcp-format: "text";'], 'context', `${opts.tool}Names`),
      );
      const itemTools = new Set(items.map((it) => it.tool).filter(Boolean) as string[]);
      for (const t of itemTools) {
        const sel = `[data-tool="${toKebab(t)}"]`;
        cssBlocks.push(
          webmcpBlock(sel, COMPONENT_CATALOG.button, {
            tool: t,
            description: `Acción '${t}' sobre un elemento de ${label}`,
            intent: 'action',
          }, ['  webmcp-param-index: attr(data-item-index);']),
        );
        tools[t] = sel;
      }
      break;
    }
  }

  return { component: name, tool: opts.tool, html, css: cssBlocks.join('\n\n') + '\n', tools };
}

/** CSS visual base del framework (tema neutro, accesible, sin dependencias). */
export const IA_FIRST_BASE_CSS = `/* IA-First base theme — WebMCPcss v1 */
:root { --ia-primary: #2563eb; --ia-bg: #ffffff; --ia-fg: #0f172a; --ia-muted: #64748b; --ia-radius: 8px; }
body { font-family: system-ui, sans-serif; color: var(--ia-fg); background: var(--ia-bg); margin: 0; line-height: 1.5; }
.ia-button { background: var(--ia-primary); color: #fff; border: 0; border-radius: var(--ia-radius); padding: .6rem 1.1rem; font: inherit; cursor: pointer; }
.ia-button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }
.ia-form { display: grid; gap: .8rem; max-width: 32rem; }
.ia-form__field { display: grid; gap: .25rem; }
.ia-form input, .ia-form textarea, .ia-form select { font: inherit; padding: .5rem; border: 1px solid #cbd5e1; border-radius: var(--ia-radius); }
.ia-card { border: 1px solid #e2e8f0; border-radius: var(--ia-radius); padding: 1rem; }
.ia-nav ul { display: flex; gap: 1rem; list-style: none; padding: 0; margin: 0; }
.ia-hero { padding: 4rem 1rem; text-align: center; }
.ia-hero__subtitle { color: var(--ia-muted); }
.ia-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr)); gap: 1rem; }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

/** Problema detectado al validar un `.webmcp.css` IA-First. */
export interface IaValidationIssue {
  tool: string;
  level: 'error' | 'warning';
  message: string;
}

/**
 * Valida las propiedades IA-First de un tool map: componentes conocidos,
 * intenciones válidas, política de confirmación y accesibilidad declarada.
 *
 * @param map Tool map parseado.
 * @returns Lista de problemas (vacía si todo es correcto).
 */
export function validateIaFirst(map: ToolMap): IaValidationIssue[] {
  const issues: IaValidationIssue[] = [];
  const check = (name: string, spec: ToolSpec | { meta?: Record<string, string> }, isTool: boolean) => {
    const meta = spec.meta ?? {};
    if (meta.component && !(IA_COMPONENTS as readonly string[]).includes(meta.component)) {
      issues.push({ tool: name, level: 'error', message: `webmcp-component desconocido: ${meta.component}` });
    }
    if (isTool) {
      if (!meta.intent) {
        issues.push({ tool: name, level: 'warning', message: 'Falta webmcp-intent' });
      } else if (!(IA_INTENTS as readonly string[]).includes(meta.intent)) {
        issues.push({ tool: name, level: 'error', message: `webmcp-intent inválido: ${meta.intent}` });
      }
      if (meta.confirmation && !(IA_CONFIRMATIONS as readonly string[]).includes(meta.confirmation)) {
        issues.push({ tool: name, level: 'error', message: `webmcp-confirmation inválida: ${meta.confirmation}` });
      }
      if (['submit', 'action'].includes(meta.intent ?? '') && !meta.confirmation) {
        issues.push({ tool: name, level: 'warning', message: 'Acción sin política de confirmación (needed|none)' });
      }
    }
    if (!meta.accessibility) {
      issues.push({ tool: name, level: 'warning', message: 'Falta webmcp-accessibility (aria-label)' });
    } else if (!/^[a-z-]+\s*:\s*.+/i.test(meta.accessibility)) {
      issues.push({ tool: name, level: 'error', message: `webmcp-accessibility debe ser "atributo: valor" (recibido: ${meta.accessibility})` });
    }
  };
  for (const [name, tool] of Object.entries(map.tools)) check(name, tool, true);
  for (const [name, ctx] of Object.entries(map.context)) check(name, ctx, false);
  return issues;
}

/**
 * Parsea `webmcp-accessibility: "aria-label: X; role: button"` a atributos.
 * @param value Valor de la propiedad.
 */
export function parseAccessibility(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const part of value.split(';')) {
    const idx = part.indexOf(':');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim().toLowerCase();
    const val = part.slice(idx + 1).trim();
    if (key) attrs[key] = val;
  }
  return attrs;
}
