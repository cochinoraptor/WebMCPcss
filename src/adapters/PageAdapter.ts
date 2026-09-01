/**
 * Interfaz `PageAdapter`: todo acceso a una página pasa por aquí
 * (regla de oro de CONTRIBUTING.md).
 *
 * Implementaciones: {@link DomAdapter} (jsdom/DOM real) y
 * {@link PuppeteerAdapter} (navegador vía Puppeteer).
 */

/**
 * Descripción serializable de un elemento: la "huella" que ve el modo
 * visión. Se obtiene con una sola consulta por elemento.
 */
export interface ElementInfo {
  /** Etiqueta en minúsculas (`button`, `a`, ...). */
  tag: string;
  /** Valor del atributo `id` o `null`. */
  id: string | null;
  /** Lista de clases del elemento. */
  classes: string[];
  /** Atributos (excluidos `class`/`id`/estilo), valores como cadena. */
  attrs: Record<string, string>;
  /** Texto visible normalizado. */
  text: string;
  /** Valor de control de formulario (`value`), si aplica. */
  value: string | null;
}

/**
 * Referencia viva a un elemento de la página, capaz de disparar eventos.
 */
export interface PageElement {
  /**
   * Devuelve la huella serializable del elemento.
   */
  info(): Promise<ElementInfo>;
  /**
   * Dispara un clic sobre el elemento.
   */
  click(): Promise<void>;
  /**
   * Dispara un evento DOM arbitrario (`submit`, `input`, ...).
   */
  dispatch(event: string): Promise<void>;
  /**
   * Comprueba si algún ancestro del elemento coincide con el selector.
   */
  closest(selector: string): Promise<boolean>;
}

/**
 * Adaptador de página: consulta de selectores y espera de elementos.
 */
export interface PageAdapter {
  /**
   * URL (o identificador) de la página adaptada.
   */
  readonly url: string;
  /**
   * Consulta todos los elementos que matchean un selector.
   */
  queryAll(selector: string): Promise<PageElement[]>;
  /**
   * Consulta el primer elemento que matchea un selector (`null` si no hay).
   */
  query(selector: string): Promise<PageElement | null>;
  /**
   * Espera a que exista un selector en la página (polling en DOM,
   * `waitForSelector` en Puppeteer).
   *
   * @param selector Selector CSS (lista separada por comas: basta uno).
   * @param timeoutMs Tiempo máximo de espera (por defecto 1500 ms).
   * @returns `true` si apareció, `false` si agotó el tiempo.
   */
  waitForSelector(selector: string, timeoutMs?: number): Promise<boolean>;
}

/**
 * Capacidad opcional de un adaptador: consumir herramientas registradas
 * por el propio sitio vía la API imperativa de WebMCP
 * (`navigator.modelContext.registerTool`).
 */
export interface ApiToolSource {
  /**
   * Lista las herramientas registradas por la página.
   */
  listApiTools(): Promise<import('../types').ApiToolInfo[]>;
  /**
   * Invoca una herramienta registrada por la página.
   */
  invokeApiTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}
