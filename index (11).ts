/**
 * Proxy comunitario: inyecta estilos WebMCP comunitarios en páginas web.
 *
 * Dado un dominio, busca en el repositorio comunitario un `.webmcp.css` y lo
 * inyecta en la página como `<style type="text/webmcp">` además de exponer el
 * tool map parseado en `window.__WEBMCP__`, de modo que cualquier agente de
 * IA (o extensión de navegador) pueda descubrir las herramientas del sitio.
 */
import type { Page } from 'puppeteer';
import { parseWebMCP } from '../parser';
import type { ToolMap } from '../types';
import { logger } from '../utils/logger';
import {
  findCommunityStyle,
  type CommunityLookupOptions,
  type CommunityStyle,
} from './community';

export { findCommunityStyle, normalizeDomain, domainChain } from './community';
export type { CommunityLookupOptions, CommunityStyle } from './community';

/** Resultado de una inyección comunitaria. */
export interface InjectionResult {
  injected: boolean;
  style?: CommunityStyle;
  toolMap?: ToolMap;
}

/**
 * Inyecta un CSS WebMCP en una página de Puppeteer:
 * - Añade `<style type="text/webmcp">` con el CSS original (no afecta al render).
 * - Expone `window.__WEBMCP__` con el tool map parseado.
 *
 * @param page Página de Puppeteer.
 * @param css Contenido del `.webmcp.css`.
 * @returns El tool map parseado que se inyectó.
 */
export async function injectWebMCP(page: Page, css: string): Promise<ToolMap> {
  const toolMap = parseWebMCP(css);
  await page.evaluate(
    (cssText, mapJson) => {
      const style = document.createElement('style');
      style.setAttribute('type', 'text/webmcp');
      style.setAttribute('data-webmcpcss', 'true');
      style.textContent = cssText;
      document.head.appendChild(style);
      (window as unknown as Record<string, unknown>).__WEBMCP__ = JSON.parse(mapJson);
    },
    css,
    JSON.stringify(toolMap),
  );
  return toolMap;
}

/**
 * Busca un estilo comunitario para la URL de la página y, si existe, lo
 * inyecta con {@link injectWebMCP}.
 *
 * @param page Página de Puppeteer ya navegada.
 * @param options Opciones de búsqueda comunitaria.
 * @returns Resultado con el estilo y tool map inyectados (si los hubo).
 */
export async function applyCommunityStyles(
  page: Page,
  options: CommunityLookupOptions = {},
): Promise<InjectionResult> {
  const url = page.url();
  const style = await findCommunityStyle(url, options);
  if (!style) {
    logger.debug(`proxy: sin estilos comunitarios para ${url}`);
    return { injected: false };
  }
  const toolMap = await injectWebMCP(page, style.css);
  logger.success(
    `Estilos comunitarios de "${style.domain}" inyectados (${Object.keys(toolMap.tools).length} herramientas)`,
  );
  return { injected: true, style, toolMap };
}

/**
 * Genera un script standalone que inyecta el tool map en una página
 * (pensado para usarse desde una extensión de navegador o bookmarklet).
 *
 * @param css Contenido del `.webmcp.css`.
 * @returns Código JavaScript autoejecutable.
 */
export function buildInjectionScript(css: string): string {
  const toolMap = parseWebMCP(css);
  return [
    '(function () {',
    "  var s = document.createElement('style');",
    "  s.setAttribute('type', 'text/webmcp');",
    "  s.setAttribute('data-webmcpcss', 'true');",
    `  s.textContent = ${JSON.stringify(css)};`,
    '  document.head.appendChild(s);',
    `  window.__WEBMCP__ = ${JSON.stringify(toolMap)};`,
    '})();',
  ].join('\n');
}

export {
  discoverWebMCP,
  extractDeclaredStylesheet,
  parseWellKnown,
  type DiscoveryResult,
  type DiscoveryOptions,
  type FetchLike,
} from './discovery';

/** Resultado de la resolución combinada (descubrimiento + comunidad). */
export interface ResolvedStyles {
  /** Mecanismo que encontró el CSS. */
  origin: 'meta' | 'link' | 'well-known' | 'community';
  /** Origen concreto (URL o ruta local). */
  source: string;
  /** Contenido del `.webmcp.css`. */
  css: string;
}

/**
 * Resuelve los estilos WebMCP para una URL con auto-descubrimiento primero
 * (meta tag / well-known del propio sitio) y, como fallback, el repositorio
 * comunitario. Este es el orden que usa `webmcpcss inject`.
 *
 * @param url URL del sitio.
 * @param options Opciones de búsqueda comunitaria + fetch inyectable.
 * @returns Los estilos resueltos o `null` si no hay ninguno.
 */
export async function resolveWebMCPStyles(
  url: string,
  options: CommunityLookupOptions & import('./discovery').DiscoveryOptions = {},
): Promise<ResolvedStyles | null> {
  const { discoverWebMCP: discover } = await import('./discovery');
  const discovered = await discover(url, { fetchFn: options.fetchFn });
  if (discovered) {
    return { origin: discovered.source, source: discovered.cssUrl, css: discovered.css };
  }
  const community = await findCommunityStyle(url, options);
  if (community) {
    return { origin: 'community', source: community.source, css: community.css };
  }
  return null;
}
