/**
 * Inyección del proxy comunitario: resuelve el tool map de un sitio
 * (descubrimiento → comunidad) y lo inyecta en la página viva como
 * `window.__WEBMCP__` + `<style type="text/webmcp">`.
 */
import puppeteer from 'puppeteer';
import { parseWebMCP } from '../parser';
import type { ToolMap } from '../types';
import { resolveWebMCPStyles, type DiscoveryOptions } from './discovery';

/** Resultado de una inyección. */
export interface InjectResult {
  /** URL inyectada. */
  url: string;
  /** Origen del CSS: descubrimiento del sitio o comunidad. */
  source: 'discovery' | 'community' | 'none';
  /** Ruta local del archivo comunitario usado (si aplica). */
  path?: string;
  /** Tool map inyectado (si se resolvió CSS). */
  toolMap?: ToolMap;
  /** `true` si la inyección se completó en el navegador. */
  injected: boolean;
}

/** Opciones de inyección. */
export interface InjectOptions extends DiscoveryOptions {
  /** Directorio de estilos comunitarios (`community-styles/`). */
  communityDir?: string;
  /** Lanzar Chromium en modo visible (defecto: headless). */
  headless?: boolean;
  /** Segundos a mantener el navegador abierto tras inyectar (defecto 0). */
  holdOpenSec?: number;
}

/**
 * Resuelve e inyecta el WebMCP de un sitio en un navegador real.
 *
 * El tool map queda disponible para cualquier agente que inspeccione la
 * página como `window.__WEBMCP__`, y el CSS original como
 * `<style type="text/webmcp">`.
 *
 * @param url URL del sitio objetivo.
 * @param opts Opciones de inyección.
 * @returns Resultado con el origen y el mapa inyectado.
 */
export async function injectWebMCP(
  url: string,
  opts: InjectOptions = {},
): Promise<InjectResult> {
  const resolved = await resolveWebMCPStyles(url, opts.communityDir, opts);
  if (resolved.source === 'none' || !resolved.css) {
    return { url, source: 'none', injected: false };
  }
  const toolMap = parseWebMCP(resolved.css);

  const browser = await puppeteer.launch({ headless: opts.headless ?? true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(
      (map: ToolMap, css: string) => {
        (window as unknown as { __WEBMCP__: ToolMap }).__WEBMCP__ = map;
        const style = document.createElement('style');
        style.setAttribute('type', 'text/webmcp');
        style.textContent = css;
        document.head.appendChild(style);
      },
      toolMap,
      resolved.css,
    );
    if (opts.holdOpenSec) {
      const holdMs = opts.holdOpenSec * 1000;
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    }
    return {
      url,
      source: resolved.source,
      path: resolved.path,
      toolMap,
      injected: true,
    };
  } finally {
    await browser.close();
  }
}
