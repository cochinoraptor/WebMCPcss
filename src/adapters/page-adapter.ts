/**
 * Interfaz `PageAdapter`: abstracción sobre "una página web".
 *
 * Permite que la lógica central de WebMCPcss (ejecución, validación y
 * auto-reparación) funcione igual sobre un navegador real (Puppeteer) que
 * sobre un DOM sintético (jsdom, usado en los tests). Cualquier motor de
 * automatización (Playwright, extensión de navegador...) puede integrarse
 * implementando esta interfaz.
 */
import type { ElementSnapshot, RegisteredToolInfo } from '../types';

/** Abstracción mínima de una página web para WebMCPcss. */
export interface PageAdapter {
  /**
   * Comprueba si existe al menos un elemento que case con el selector.
   * @param selector Selector CSS.
   */
  exists(selector: string): Promise<boolean>;

  /**
   * Hace clic sobre el primer elemento que case con el selector.
   * @param selector Selector CSS.
   */
  click(selector: string): Promise<void>;

  /**
   * Escribe un valor en un campo de formulario (reemplaza el contenido).
   * @param selector Selector CSS del campo.
   * @param value Valor a escribir.
   */
  fill(selector: string, value: string): Promise<void>;

  /**
   * Envía el formulario indicado (o el formulario contenedor del selector).
   * @param selector Selector CSS del formulario o de un elemento dentro de él.
   */
  submit(selector: string): Promise<void>;

  /**
   * Lee un atributo del primer elemento que case.
   * @param selector Selector CSS.
   * @param attr Nombre del atributo.
   * @returns El valor o `null` si no existe.
   */
  readAttr(selector: string, attr: string): Promise<string | null>;

  /**
   * Lee la propiedad `value` de un campo de formulario.
   * @param selector Selector CSS.
   */
  readValue(selector: string): Promise<string | null>;

  /**
   * Lee el texto visible del primer elemento que case.
   * @param selector Selector CSS.
   */
  readText(selector: string): Promise<string | null>;

  /**
   * Devuelve instantáneas de los elementos candidatos de la página,
   * usadas por el módulo de visión para la auto-reparación.
   */
  snapshot(): Promise<ElementSnapshot[]>;
}

/**
 * Capacidad opcional de un adaptador: acceso a las herramientas registradas
 * mediante la API imperativa de WebMCP (`document.modelContext`).
 *
 * Un adaptador que además implemente esta interfaz (p. ej.
 * `WebMCPApiAdapter`) permite a la clase `WebMCPcss` ejecutar herramientas
 * de la API cuando no existen en el archivo `.webmcp.css`.
 */
export interface ApiToolSource {
  /** Lista las herramientas registradas vía `registerTool()` en la página. */
  listApiTools(): Promise<RegisteredToolInfo[]>;

  /**
   * Invoca la función `execute` de una herramienta registrada.
   * @param name Nombre de la herramienta.
   * @param args Argumentos de entrada.
   */
  callApiTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Type guard: comprueba si un adaptador soporta la API imperativa de WebMCP.
 * @param adapter Adaptador a comprobar.
 */
export function hasApiTools(
  adapter: PageAdapter,
): adapter is PageAdapter & ApiToolSource {
  const a = adapter as Partial<ApiToolSource>;
  return typeof a.listApiTools === 'function' && typeof a.callApiTool === 'function';
}
