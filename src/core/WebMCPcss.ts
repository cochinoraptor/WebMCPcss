/**
 * Clase central `WebMCPcss`: ejecuta herramientas descritas en un
 * `.webmcp.css` contra una página, con auto-reparación transparente de
 * selectores y fallback a herramientas registradas vía la API imperativa.
 */
import type { ApiToolSource, PageAdapter, PageElement } from '../adapters/PageAdapter';
import type { ApiToolInfo, ExecuteResult, ParamSource, ToolMap } from '../types';
import { repairContext, repairTool } from './repair';

/** Opciones de construcción de {@link WebMCPcss}. */
export interface WebMCPcssOptions {
  /** Tiempo máximo de espera de `webmcp-confirmation` (ms, defecto 1500). */
  confirmationTimeoutMs?: number;
}

/**
 * Orquestador del tool map sobre una página concreta.
 *
 * ```ts
 * const webmcp = new WebMCPcss(parseWebMCP(css), new DomAdapter(document));
 * await webmcp.execute('addToCart', { quantity: '2' });
 * await webmcp.getContext('price');
 * ```
 */
export class WebMCPcss {
  private map: ToolMap;
  private readonly adapter: PageAdapter;
  private readonly confirmationTimeoutMs: number;

  /**
   * @param toolMap Mapa de herramientas (se muta en memoria al reparar).
   * @param adapter Adaptador de la página objetivo.
   * @param options Opciones adicionales.
   */
  constructor(toolMap: ToolMap, adapter: PageAdapter, options: WebMCPcssOptions = {}) {
    this.map = toolMap;
    this.adapter = adapter;
    this.confirmationTimeoutMs = options.confirmationTimeoutMs ?? 1500;
  }

  /**
   * Copia en vivo del tool map (incluye reparaciones aplicadas).
   */
  getToolMap(): ToolMap {
    return this.map;
  }

  /**
   * Nombres de las herramientas declaradas en el CSS.
   */
  listTools(): string[] {
    return Object.keys(this.map.tools);
  }

  /**
   * Nombres de los contextos declarados en el CSS.
   */
  listContexts(): string[] {
    return Object.keys(this.map.context);
  }

  /**
   * Herramientas registradas por el sitio vía `navigator.modelContext`,
   * si el adaptador tiene esa capacidad.
   */
  async listApiTools(): Promise<ApiToolInfo[]> {
    const source = this.adapter as PageAdapter & Partial<ApiToolSource>;
    if (typeof source.listApiTools === 'function') {
      return source.listApiTools();
    }
    return [];
  }

  /**
   * Ejecuta una herramienta contra la página.
   *
   * Flujo: resolver selector → (si está roto: reparar por visión y
   * reintentar) → seleccionar elemento por parámetros → disparar trigger →
   * verificar `webmcp-confirmation`. Si la herramienta no está en el CSS y
   * el adaptador es fuente de API, se invoca vía API (`via: 'api'`).
   *
   * @param name Nombre de la herramienta.
   * @param params Parámetros del agente (pueden desambiguar el elemento).
   * @returns Resultado de la ejecución.
   */
  async execute(
    name: string,
    params: Record<string, string> = {},
  ): Promise<ExecuteResult> {
    const tool = this.map.tools[name];
    if (!tool) {
      return this.executeViaApi(name, params);
    }

    let elements = await this.adapter.queryAll(tool.selector);
    let repaired: { from: string; to: string } | undefined;

    if (elements.length === 0) {
      // Empate entre candidatos: solo se acepta con confirmación que
      // verifique la acción a posteriori (lección del POC).
      const allowAmbiguous = Boolean(tool.confirmation);
      const outcome = await repairTool(this.adapter, this.map, name, { allowAmbiguous });
      if (!outcome.repaired || !outcome.to) {
        return {
          success: false,
          tool: name,
          via: 'css',
          error: `selector roto «${tool.selector}» y reparación fallida (${outcome.reason ?? 'unknown'})`,
        };
      }
      repaired = { from: outcome.from, to: outcome.to };
      elements = await this.adapter.queryAll(outcome.to);
      if (elements.length === 0) {
        return {
          success: false,
          tool: name,
          via: 'css',
          error: `reparación a «${outcome.to}» no resolvió elementos`,
        };
      }
    }

    const chosen = await this.chooseElement(elements, tool.params, params);
    const resolved = await this.resolveParams(chosen, tool.params, params);

    const trigger = tool.trigger ?? { event: 'click' };
    if (trigger.on) {
      const target = await this.adapter.query(trigger.on);
      if (target) {
        await target.dispatch(trigger.event);
      } else {
        return {
          success: false,
          tool: name,
          via: 'css',
          error: `webmcp-trigger "on ${trigger.on}" no resolvió elementos`,
          data: { params: resolved, confirmed: false, selector: tool.selector, repaired },
        };
      }
    } else {
      await chosen.dispatch(trigger.event);
    }

    let confirmed = true;
    if (tool.confirmation) {
      confirmed = await this.adapter.waitForSelector(
        tool.confirmation,
        this.confirmationTimeoutMs,
      );
    }

    return {
      success: confirmed,
      tool: name,
      via: 'css',
      data: {
        params: resolved,
        confirmed,
        selector: tool.selector,
        repaired,
      },
      ...(confirmed
        ? {}
        : { error: `webmcp-confirmation «${tool.confirmation}» no apareció` }),
    };
  }

  /**
   * Lee un dato de contexto (solo lectura) de la página. Repara su selector
   * por visión si se rompió.
   *
   * @param name Nombre del contexto.
   * @returns Texto normalizado del primer elemento, o `null`.
   */
  async getContext(name: string): Promise<string | null> {
    const ctx = this.map.context[name];
    if (!ctx) return null;
    let element = await this.adapter.query(ctx.selector);
    if (!element) {
      const outcome = await repairContext(this.adapter, this.map, name);
      if (outcome.repaired && outcome.to) {
        element = await this.adapter.query(outcome.to);
      }
    }
    if (!element) return null;
    const info = await element.info();
    return info.text || null;
  }

  /**
   * Ejecuta una herramienta registrada por el sitio vía API imperativa.
   */
  private async executeViaApi(
    name: string,
    params: Record<string, string>,
  ): Promise<ExecuteResult> {
    const source = this.adapter as PageAdapter & Partial<ApiToolSource>;
    if (typeof source.invokeApiTool !== 'function') {
      return {
        success: false,
        tool: name,
        via: 'api',
        error: `herramienta desconocida: ${name}`,
      };
    }
    try {
      await source.invokeApiTool(name, params);
      return {
        success: true,
        tool: name,
        via: 'api',
        data: { params, confirmed: false },
      };
    } catch (err) {
      return {
        success: false,
        tool: name,
        via: 'api',
        error: `API registerTool falló: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Elige el elemento a accionar: el primero cuyos parámetros resueltos
   * coincidan con los aportados por el agente (desambiguación);
   * si ninguno coincide o no hay parámetros, el primero.
   */
  private async chooseElement(
    elements: PageElement[],
    declared: Record<string, ParamSource>,
    provided: Record<string, string>,
  ): Promise<PageElement> {
    const providedNames = Object.keys(provided).filter((k) => k in declared);
    if (providedNames.length === 0 || elements.length === 1) return elements[0];
    for (const el of elements.slice(0, 50)) {
      const resolved = await this.resolveParams(el, declared, {});
      const matches = providedNames.every((k) => {
        const want = provided[k].toLowerCase();
        const got = (resolved[k] ?? '').toLowerCase();
        return got === want || got.includes(want) || want.includes(got);
      });
      if (matches) return el;
    }
    return elements[0];
  }

  /**
   * Resuelve los parámetros finales: valores declarados en el CSS sobre el
   * elemento elegido, sobrescritos por los aportados por el agente.
   */
  private async resolveParams(
    element: PageElement,
    declared: Record<string, ParamSource>,
    provided: Record<string, string>,
  ): Promise<Record<string, string>> {
    const info = await element.info();
    const out: Record<string, string> = {};
    for (const [name, source] of Object.entries(declared)) {
      switch (source.source) {
        case 'attr':
          out[name] = info.attrs[source.value] ?? '';
          break;
        case 'literal':
          out[name] = source.value;
          break;
        case 'value': {
          const target = source.selector
            ? await this.adapter.query(source.selector)
            : element;
          if (target) {
            const targetInfo = target === element ? info : await target.info();
            out[name] = targetInfo.value ?? '';
          } else {
            out[name] = '';
          }
          break;
        }
        case 'text': {
          const target = source.selector
            ? await this.adapter.query(source.selector)
            : element;
          if (target) {
            const targetInfo = target === element ? info : await target.info();
            out[name] = targetInfo.text;
          } else {
            out[name] = '';
          }
          break;
        }
      }
    }
    return { ...out, ...provided };
  }
}
