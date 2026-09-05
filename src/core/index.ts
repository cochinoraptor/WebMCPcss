/**
 * Clase principal `WebMCPcss`.
 *
 * Orquesta la ejecución de herramientas WebMCP sobre una página, con
 * auto-reparación de selectores: si un selector definido en `.webmcp.css`
 * deja de existir (rediseño del sitio), WebMCPcss busca el elemento por
 * huella/texto/posición, infiere un selector estable nuevo, actualiza el
 * tool map en memoria y reintenta la acción.
 */
import { hasApiTools, type PageAdapter } from '../adapters/page-adapter';
import type {
  ExecuteResult,
  RegisteredToolInfo,
  ToolMap,
  ValidationEntry,
  ValidationReport,
} from '../types';
import { logger } from '../utils/logger';
import { repairSelector, repairToolMap } from './repair';

export { repairSelector, repairToolMap } from './repair';
export * as vision from './vision';

/** Opciones de configuración de {@link WebMCPcss}. */
export interface WebMCPcssOptions {
  /** Umbral mínimo de confianza para aceptar una reparación (0-1). */
  repairThreshold?: number;
  /** Desactiva la auto-reparación (falla directamente si el selector no existe). */
  autoRepair?: boolean;
}

/** Clase principal: ejecuta herramientas WebMCP con auto-reparación. */
export class WebMCPcss {
  private readonly threshold: number;
  private readonly autoRepair: boolean;

  /**
   * @param toolMap Tool map parseado desde `.webmcp.css` (ver módulo `parser`).
   * @param adapter Adaptador de página (Puppeteer, DOM, etc.).
   * @param options Opciones de comportamiento.
   */
  constructor(
    private readonly toolMap: ToolMap,
    private readonly adapter: PageAdapter,
    options: WebMCPcssOptions = {},
  ) {
    this.threshold = options.repairThreshold ?? 0.45;
    this.autoRepair = options.autoRepair ?? true;
  }

  /** Devuelve el tool map actual (incluye reparaciones en memoria). */
  getToolMap(): ToolMap {
    return this.toolMap;
  }

  /** Lista los nombres de herramientas disponibles definidas en CSS. */
  listTools(): string[] {
    return Object.keys(this.toolMap.tools);
  }

  /**
   * Lista las herramientas registradas mediante la API imperativa de WebMCP
   * (`document.modelContext.registerTool()`), si el adaptador la soporta.
   *
   * @returns Herramientas de la API, o `[]` si el adaptador no la soporta.
   */
  async listApiTools(): Promise<RegisteredToolInfo[]> {
    if (!hasApiTools(this.adapter)) return [];
    return this.adapter.listApiTools();
  }

  /**
   * Ejecuta una herramienta:
   * 1. Localiza el elemento con el selector definido.
   * 2. Si no existe y `autoRepair` está activo, intenta repararlo con el
   *    módulo de visión, actualiza el tool map en memoria y reintenta.
   * 3. Rellena los parámetros de entrada, dispara la acción (click/submit)
   *    y comprueba la confirmación si está definida.
   *
   * @param toolName Nombre de la herramienta (`addToCart`...).
   * @param params Valores de entrada para los parámetros `value()`.
   * @returns Resultado con `success`, `data` y metadatos de reparación.
   */
  async execute(
    toolName: string,
    params: Record<string, string> = {},
  ): Promise<ExecuteResult> {
    const tool = this.toolMap.tools[toolName];
    if (!tool) {
      // Fallback: ¿existe como herramienta de la API imperativa de WebMCP?
      if (hasApiTools(this.adapter)) {
        const apiTools = await this.adapter.listApiTools();
        if (apiTools.some((t) => t.name === toolName)) {
          try {
            const result = await this.adapter.callApiTool(toolName, params);
            return { success: true, data: { result }, via: 'api' };
          } catch (err) {
            return {
              success: false,
              error: err instanceof Error ? err.message : String(err),
              via: 'api',
            };
          }
        }
      }
      return { success: false, error: `Herramienta desconocida: "${toolName}"` };
    }

    let repaired = false;
    let newSelector: string | undefined;

    // Paso 1: localizar el elemento (con reparación si hace falta).
    if (!(await this.adapter.exists(tool.selector))) {
      if (!this.autoRepair) {
        return {
          success: false,
          error: `Selector no encontrado: "${tool.selector}" (auto-reparación desactivada)`,
        };
      }
      logger.debug(`Selector roto para "${toolName}", activando visión...`);
      const result = await repairSelector(
        this.adapter,
        toolName,
        tool,
        'tool',
        this.threshold,
      );
      if (!result.repaired || !result.newSelector) {
        return {
          success: false,
          error: `No se pudo reparar el selector "${tool.selector}" para "${toolName}"`,
        };
      }
      // Actualiza el tool map EN MEMORIA y reintenta.
      tool.selector = result.newSelector;
      repaired = true;
      newSelector = result.newSelector;
      if (!(await this.adapter.exists(tool.selector))) {
        return {
          success: false,
          error: `El selector reparado "${tool.selector}" tampoco existe`,
          repaired,
          newSelector,
        };
      }
    }

    try {
      const data: Record<string, unknown> = {};

      // Paso 2: rellenar parámetros de entrada y leer los de salida.
      for (const [pName, pSpec] of Object.entries(tool.params)) {
        const provided = params[pName];
        switch (pSpec.source) {
          case 'value': {
            const target = pSpec.selector ?? tool.selector;
            if (provided !== undefined) {
              await this.adapter.fill(target, provided);
              data[pName] = provided;
            } else {
              data[pName] = await this.adapter.readValue(target);
            }
            break;
          }
          case 'attr': {
            data[pName] = await this.adapter.readAttr(tool.selector, pSpec.value ?? '');
            break;
          }
          case 'text': {
            data[pName] = await this.adapter.readText(pSpec.selector ?? tool.selector);
            break;
          }
          case 'literal': {
            data[pName] = pSpec.value;
            break;
          }
        }
      }

      // Paso 3: disparar la acción.
      const trigger = tool.trigger ?? { event: 'click' };
      const target = trigger.selector ?? tool.selector;
      if (trigger.event === 'submit') {
        await this.adapter.submit(target);
      } else {
        await this.adapter.click(target);
      }

      // Paso 4: confirmación.
      if (tool.confirmation) {
        const confirmed = await this.adapter.exists(tool.confirmation);
        data.confirmed = confirmed;
        if (!confirmed) {
          return {
            success: false,
            error: `Confirmación no encontrada: "${tool.confirmation}"`,
            data,
            repaired,
            newSelector,
          };
        }
      }

      return { success: true, data, repaired, newSelector, via: 'css' };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        repaired,
        newSelector,
      };
    }
  }

  /**
   * Lee un dato de contexto declarado con `webmcp-context`, reparando el
   * selector si es necesario.
   *
   * @param name Nombre del dato (`price`...).
   * @returns Valor textual (formateado según `webmcp-format` si aplica) o `null`.
   */
  async getContext(name: string): Promise<string | null> {
    const ctx = this.toolMap.context[name];
    if (!ctx) return null;

    if (!(await this.adapter.exists(ctx.selector)) && this.autoRepair) {
      const result = await repairSelector(
        this.adapter,
        name,
        ctx,
        'context',
        this.threshold,
      );
      if (result.repaired && result.newSelector) ctx.selector = result.newSelector;
    }

    const text = await this.adapter.readText(ctx.selector);
    if (text === null) return null;
    if (ctx.format === 'currency') {
      const m = /-?[\d.,]+/.exec(text);
      return m ? m[0] : text;
    }
    if (ctx.format === 'number') {
      const m = /-?\d+(?:[.,]\d+)?/.exec(text);
      return m ? m[0] : text;
    }
    return text;
  }

  /**
   * Valida todos los selectores del tool map contra la página actual.
   *
   * @param url URL informativa para el reporte.
   * @param options `includeApi: true` añade al reporte las herramientas
   *   registradas vía `document.modelContext` (si el adaptador lo soporta).
   * @returns Reporte con el estado de cada selector.
   */
  async validate(
    url = '',
    options: { includeApi?: boolean } = {},
  ): Promise<ValidationReport> {
    const entries: ValidationEntry[] = [];

    const check = async (
      name: string,
      kind: ValidationEntry['kind'],
      selector: string,
    ) => {
      entries.push({
        name,
        kind,
        selector,
        ok: await this.adapter.exists(selector),
        // Las confirmaciones suelen aparecer solo tras ejecutar la acción.
        optional: kind === 'confirmation' || undefined,
      });
    };

    for (const [name, tool] of Object.entries(this.toolMap.tools)) {
      await check(name, 'tool', tool.selector);
      for (const [pName, pSpec] of Object.entries(tool.params)) {
        if (pSpec.selector) await check(`${name}.${pName}`, 'param', pSpec.selector);
      }
      if (tool.confirmation) {
        await check(`${name} (confirmación)`, 'confirmation', tool.confirmation);
      }
      if (tool.trigger?.selector) {
        await check(`${name} (trigger)`, 'trigger', tool.trigger.selector);
      }
    }
    for (const [name, ctx] of Object.entries(this.toolMap.context)) {
      await check(name, 'context', ctx.selector);
    }

    // Herramientas de la API imperativa (document.modelContext).
    if (options.includeApi && hasApiTools(this.adapter)) {
      for (const apiTool of await this.adapter.listApiTools()) {
        entries.push({
          name: apiTool.name,
          kind: 'api',
          selector: '(document.modelContext)',
          ok: true,
        });
      }
    }

    const passed = entries.filter((e) => e.ok).length;
    const failed = entries.filter((e) => !e.ok && !e.optional).length;
    return {
      url,
      total: entries.length,
      passed,
      failed,
      entries,
    };
  }

  /**
   * Repara todos los selectores rotos del tool map (en memoria).
   * @returns Lista de reparaciones intentadas.
   */
  async repairAll() {
    return repairToolMap(this.adapter, this.toolMap, this.threshold);
  }
}
