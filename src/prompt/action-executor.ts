/**
 * Ejecutor de acciones: aplica una {@link PromptAction} ya interpretada
 * sobre un elemento localizado ({@link ElementMatch}) a través del
 * {@link PageAdapter} (+ {@link DomMutator}) de la página.
 *
 * Integración con el resto de WebMCPcss:
 * - Si el buscador asoció una **herramienta WebMCP** al objetivo (por
 *   ejemplo `click` sobre "añadir al carrito" ≈ `addToCart`), la acción
 *   `click`/`fill`/`other` se delega en `WebMCPcss.execute`, que aporta
 *   auto-reparación de selectores y confirmaciones.
 * - Las mutaciones (`changeColor`, `delete`, `hide`, `move`, `setText`,
 *   `setStyle`, `upload`) usan el {@link DomMutator} del adaptador
 *   (`DomAdapter` y `PuppeteerAdapter` lo implementan).
 */
import type { PageAdapter } from '../adapters/page-adapter';
import { logger } from '../utils/logger';
import { AssetManager } from './asset-manager';
import { canMutate, type DomMutator } from './dom-mutator';
import type { ActionOutcome, ElementMatch, ExecuteContext, PromptAction } from './types';

/** Propiedades CSS permitidas en `setStyle` (lista blanca de seguridad). */
const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'background',
  'background-color',
  'background-image',
  'border',
  'border-color',
  'border-radius',
  'border-width',
  'border-style',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'text-align',
  'text-decoration',
  'text-transform',
  'line-height',
  'letter-spacing',
  'opacity',
  'display',
  'visibility',
  'width',
  'height',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'padding-top',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'position',
  'top',
  'left',
  'right',
  'bottom',
  'z-index',
  'box-shadow',
  'outline',
  'cursor',
  'transform',
  'filter',
  'gap',
  'flex-direction',
  'justify-content',
  'align-items',
  'order',
  'float',
  'overflow',
]);

/** Filtra estilos a la lista blanca y descarta valores peligrosos (`url(javascript:`). */
export function sanitizeStyles(styles: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rawProp, rawValue] of Object.entries(styles)) {
    const prop = rawProp
      .trim()
      .replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      .toLowerCase();
    const value = String(rawValue).trim();
    if (!ALLOWED_STYLE_PROPS.has(prop)) continue;
    if (/javascript:|expression\(|<|>/i.test(value)) continue;
    if (value.length > 200) continue;
    out[prop] = value;
  }
  return out;
}

/** Comprueba que un valor de color CSS tenga una forma razonable. */
export function isSafeColor(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 60) return false;
  return (
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
    /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%/-]+\)$/i.test(v) ||
    /^[a-z]+$/i.test(v) ||
    /^var\(--[\w-]+\)$/i.test(v)
  );
}

/** Ejecuta acciones interpretadas sobre la página. */
export class ActionExecutor {
  /**
   * @param adapter Adaptador de la página (idealmente con {@link DomMutator}).
   * @param ctx Tool map, localizador secundario y ejecutor de herramientas.
   */
  constructor(
    private readonly adapter: PageAdapter,
    private readonly ctx: ExecuteContext = {},
  ) {}

  /**
   * Ejecuta la acción sobre el elemento localizado.
   * Nunca lanza: los errores se devuelven en `ActionOutcome.error`.
   *
   * @param action Acción interpretada.
   * @param match Elemento localizado (puede ser `null` para `other` con `tool`).
   */
  async execute(
    action: PromptAction,
    match: ElementMatch | null,
  ): Promise<ActionOutcome> {
    try {
      switch (action.action) {
        case 'click':
          return await this.click(action, this.require(match));
        case 'fill':
          return await this.fill(action, this.require(match));
        case 'changeColor':
          return await this.changeColor(action, this.require(match));
        case 'setStyle':
          return await this.setStyle(action, this.require(match));
        case 'setText':
          return await this.setText(action, this.require(match));
        case 'delete':
          return await this.remove(action, this.require(match));
        case 'hide':
          return await this.hide(action, this.require(match));
        case 'move':
          return await this.move(action, this.require(match));
        case 'upload':
          return await this.upload(action, this.require(match));
        case 'other':
          return await this.other(action, match);
        default:
          return fail(`Acción no soportada: ${String(action.action)}`);
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  /* ---------------------------------------------------------------- */
  /* Acciones                                                           */
  /* ---------------------------------------------------------------- */

  private async click(action: PromptAction, match: ElementMatch): Promise<ActionOutcome> {
    // Delegar en la herramienta WebMCP si existe (auto-reparación + confirmación).
    if (match.tool && this.ctx.runTool) {
      const result = await this.ctx.runTool(match.tool, action.parameters.args ?? {});
      return toolOutcome(match.tool, result);
    }
    await this.adapter.click(match.selector);
    return ok(`Clic en ${match.selector}`, { selector: match.selector }, 'dom');
  }

  private async fill(action: PromptAction, match: ElementMatch): Promise<ActionOutcome> {
    const text = action.parameters.text;
    if (text === undefined)
      return fail('Falta el texto a escribir (usa --text o comillas).');
    if (match.tool && this.ctx.runTool && this.ctx.toolMap) {
      // Si la herramienta tiene un único parámetro `value()`, rellénalo con el texto.
      const tool = this.ctx.toolMap.tools[match.tool];
      const valueParams = Object.entries(tool?.params ?? {}).filter(
        ([, p]) => p.source === 'value',
      );
      if (valueParams.length === 1) {
        const args = { ...(action.parameters.args ?? {}), [valueParams[0][0]]: text };
        const result = await this.ctx.runTool(match.tool, args);
        return toolOutcome(match.tool, result);
      }
    }
    const target = await this.resolveFillTarget(match);
    await this.adapter.fill(target, text);
    return ok(`Texto escrito en ${target}`, { selector: target, text }, 'dom');
  }

  private async changeColor(
    action: PromptAction,
    match: ElementMatch,
  ): Promise<ActionOutcome> {
    const color = action.parameters.color;
    if (!color)
      return fail('No se reconoció el color (ej. "rojo", "#ff0000", "rgb(0,0,0)").');
    if (!isSafeColor(color)) return fail(`Color no válido: ${color}`);
    const property = action.parameters.property ?? inferColorProperty(match);
    const m = this.mutator();
    const count = await m.setStyles(
      match.selector,
      { [property]: color },
      action.parameters.all,
    );
    if (count === 0) return fail(`Elemento no encontrado: ${match.selector}`);
    return ok(
      `${property} = ${color} en ${count} elemento(s) (${match.selector})`,
      { selector: match.selector, property, color, count },
      'dom',
    );
  }

  private async setStyle(
    action: PromptAction,
    match: ElementMatch,
  ): Promise<ActionOutcome> {
    const styles = sanitizeStyles(action.parameters.styles ?? {});
    if (Object.keys(styles).length === 0) {
      return fail(
        'No hay estilos válidos que aplicar (propiedades permitidas: color, font-size, …).',
      );
    }
    const count = await this.mutator().setStyles(
      match.selector,
      styles,
      action.parameters.all,
    );
    if (count === 0) return fail(`Elemento no encontrado: ${match.selector}`);
    return ok(
      `Estilos aplicados a ${count} elemento(s): ${Object.entries(styles)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')}`,
      { selector: match.selector, styles, count },
      'dom',
    );
  }

  private async setText(
    action: PromptAction,
    match: ElementMatch,
  ): Promise<ActionOutcome> {
    const text = action.parameters.text;
    if (text === undefined) return fail('Falta el texto nuevo (usa comillas o --text).');
    await this.mutator().setText(match.selector, text);
    return ok(
      `Texto de ${match.selector} cambiado`,
      { selector: match.selector, text },
      'dom',
    );
  }

  private async remove(
    action: PromptAction,
    match: ElementMatch,
  ): Promise<ActionOutcome> {
    const m = this.mutator();
    const count = await m.remove(match.selector, action.parameters.all);
    if (count === 0) return fail(`Elemento no encontrado: ${match.selector}`);
    return ok(
      `${count} elemento(s) eliminado(s) (${match.selector})`,
      { selector: match.selector, count },
      'dom',
    );
  }

  private async hide(action: PromptAction, match: ElementMatch): Promise<ActionOutcome> {
    const m = this.mutator();
    const count = await m.hide(match.selector, action.parameters.all);
    if (count === 0) return fail(`Elemento no encontrado: ${match.selector}`);
    return ok(
      `${count} elemento(s) oculto(s) (${match.selector})`,
      { selector: match.selector, count },
      'dom',
    );
  }

  private async move(action: PromptAction, match: ElementMatch): Promise<ActionOutcome> {
    const m = this.mutator();
    const { position, destination, placement } = action.parameters;
    if (position) {
      await m.moveTo(match.selector, position.x, position.y);
      return ok(
        `${match.selector} movido a (${position.x}, ${position.y})`,
        { selector: match.selector, position },
        'dom',
      );
    }
    if (!destination)
      return fail('Indica el destino ("antes del menú", "dentro del footer"…).');
    let destSelector: string | null = null;
    if (this.ctx.findElement) {
      const dest = await this.ctx.findElement(destination);
      destSelector = dest?.selector ?? null;
    } else if (await this.adapter.exists(destination)) {
      destSelector = destination;
    }
    if (!destSelector) return fail(`No se encontró el destino: "${destination}"`);
    const place = placement ?? 'inside';
    await m.move(match.selector, destSelector, place);
    return ok(
      `${match.selector} movido ${place} ${destSelector}`,
      { selector: match.selector, destination: destSelector, placement: place },
      'dom',
    );
  }

  private async upload(
    action: PromptAction,
    match: ElementMatch,
  ): Promise<ActionOutcome> {
    const refs =
      action.parameters.files ?? (action.parameters.file ? [action.parameters.file] : []);
    if (refs.length === 0)
      return fail('No hay archivo que subir (usa --image o --file).');
    const assets = new AssetManager(this.ctx.assetOptions);
    try {
      const resolved = await assets.resolveAll(refs);
      const m = this.mutator();
      const { inputSelector, count } = await m.uploadFiles(
        match.selector,
        resolved.map((a) => a.path),
      );
      return ok(
        `${count} archivo(s) asignado(s) a ${inputSelector}`,
        {
          selector: match.selector,
          inputSelector,
          files: resolved.map((a) => ({
            name: a.name,
            mimeType: a.mimeType,
            size: a.size,
          })),
        },
        'dom',
      );
    } finally {
      // Puppeteer ya leyó los archivos al asignarlos; los temporales pueden irse.
      assets.cleanup();
    }
  }

  private async other(
    action: PromptAction,
    match: ElementMatch | null,
  ): Promise<ActionOutcome> {
    const toolName = action.parameters.tool ?? match?.tool;
    if (toolName && this.ctx.runTool) {
      const args = { ...(action.parameters.args ?? {}) };
      // Texto suelto + herramienta con un único parámetro value() → rellénalo.
      if (action.parameters.text !== undefined && this.ctx.toolMap) {
        const valueParams = Object.entries(
          this.ctx.toolMap.tools[toolName]?.params ?? {},
        ).filter(([, p]) => p.source === 'value');
        if (valueParams.length === 1 && args[valueParams[0][0]] === undefined) {
          args[valueParams[0][0]] = action.parameters.text;
        }
      }
      const result = await this.ctx.runTool(toolName, args);
      return toolOutcome(toolName, result);
    }
    if (match) {
      // Sin herramienta: la acción genérica más segura es un clic.
      await this.adapter.click(match.selector);
      return ok(
        `Clic en ${match.selector} (acción genérica)`,
        { selector: match.selector },
        'dom',
      );
    }
    return fail(
      'No sé cómo ejecutar esta orden. Reformúlala con un verbo (clic, escribe, oculta, elimina, cambia el color, mueve, sube…) o indica una herramienta WebMCP.',
    );
  }

  /* ---------------------------------------------------------------- */
  /* Utilidades                                                         */
  /* ---------------------------------------------------------------- */

  private require(match: ElementMatch | null): ElementMatch {
    if (!match) throw new Error('No se localizó el elemento objetivo.');
    return match;
  }

  private mutator(): DomMutator {
    if (!canMutate(this.adapter)) {
      throw new Error(
        'Este adaptador no soporta modificar la página (implementa DomMutator: DomAdapter o PuppeteerAdapter).',
      );
    }
    return this.adapter;
  }

  /** Si el objetivo no es un campo, busca el campo de formulario más cercano dentro. */
  private async resolveFillTarget(match: ElementMatch): Promise<string> {
    const FIELD_TAGS = ['input', 'textarea', 'select'];
    if (match.tag && FIELD_TAGS.includes(match.tag)) return match.selector;
    if (match.tag === 'label') {
      const forId =
        match.attrs?.for ?? (await this.adapter.readAttr(match.selector, 'for'));
      if (forId) {
        const byId = `#${forId.replace(/([^\w-])/g, '\\$1')}`;
        if (await this.adapter.exists(byId)) {
          logger.debug(`fill: "${match.selector}" es una etiqueta; usando ${byId}`);
          return byId;
        }
      }
    }
    const inner = `${match.selector} input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), ${match.selector} textarea, ${match.selector} select`;
    if (
      match.tag &&
      !FIELD_TAGS.includes(match.tag) &&
      (await this.adapter.exists(inner))
    ) {
      logger.debug(`fill: "${match.selector}" no es un campo; usando el campo interior`);
      return inner;
    }
    return match.selector;
  }
}

/** Infiera qué propiedad colorear según el tipo de elemento. */
function inferColorProperty(match: ElementMatch): string {
  const tag = match.tag ?? '';
  if (
    [
      'button',
      'body',
      'header',
      'footer',
      'nav',
      'section',
      'div',
      'aside',
      'main',
    ].includes(tag)
  ) {
    return 'background-color';
  }
  if (tag === 'input' && ['submit', 'button'].includes(match.attrs?.type ?? '')) {
    return 'background-color';
  }
  return 'color';
}

/** Resultado exitoso. */
function ok(
  message: string,
  details: Record<string, unknown>,
  via: ActionOutcome['via'],
): ActionOutcome {
  return { success: true, message, details, via };
}

/** Resultado fallido. */
function fail(error: string): ActionOutcome {
  return { success: false, message: error, error };
}

/** Convierte el resultado de `WebMCPcss.execute` en un ActionOutcome. */
function toolOutcome(tool: string, result: unknown): ActionOutcome {
  const r = (result ?? {}) as { success?: boolean; error?: string; [k: string]: unknown };
  const success = r.success !== false;
  return {
    success,
    message: success
      ? `Herramienta WebMCP "${tool}" ejecutada${r.repaired ? ' (selector auto-reparado)' : ''}`
      : `Herramienta "${tool}" falló: ${r.error ?? 'error desconocido'}`,
    details: { tool, result },
    error: success ? undefined : (r.error ?? 'error desconocido'),
    via: 'tool',
  };
}
