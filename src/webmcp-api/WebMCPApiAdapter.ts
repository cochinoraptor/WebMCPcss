/**
 * `WebMCPApiAdapter`: adaptador Puppeteer que además captura las
 * herramientas registradas por el sitio vía `navigator.modelContext`.
 *
 * ```ts
 * const adapter = await WebMCPApiAdapter.create(page); // ANTES de page.goto()
 * await page.goto('https://sitio-con-webmcp.com');
 * ```
 */
import type { Page } from 'puppeteer';
import { PuppeteerAdapter } from '../adapters/PuppeteerAdapter';
import type { ApiToolSource } from '../adapters/PageAdapter';
import type { ApiToolInfo } from '../types';
import { normalizeRegistered, WEBMCP_API_SHIM_SOURCE } from './shim';

/**
 * Adaptador doble: página (como `PuppeteerAdapter`) + fuente de
 * herramientas de la API imperativa (`ApiToolSource`).
 */
export class WebMCPApiAdapter extends PuppeteerAdapter implements ApiToolSource {
  /**
   * Crea el adaptador e instala el shim en la página.
   *
   * **Importante**: llamar antes de `page.goto()` para que el shim esté
   * activo cuando el sitio ejecute `registerTool()`.
   *
   * @param page Página de Puppeteer.
   * @returns Adaptador listo para navegar.
   */
  static async create(page: Page): Promise<WebMCPApiAdapter> {
    await page.evaluateOnNewDocument(WEBMCP_API_SHIM_SOURCE);
    return new WebMCPApiAdapter(page);
  }

  /** @inheritdoc */
  async listApiTools(): Promise<ApiToolInfo[]> {
    try {
      const raw = await this.raw.evaluate(() => {
        return (window as unknown as { __WEBMCP_REGISTERED__?: unknown })
          .__WEBMCP_REGISTERED__;
      });
      return normalizeRegistered(raw);
    } catch {
      return [];
    }
  }

  /** @inheritdoc */
  async invokeApiTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.raw.evaluate(
      (toolName: string, toolArgs: Record<string, unknown>) => {
        const tools = (
          window as unknown as {
            __WEBMCP_TOOLS__?: Record<string, { execute?: (a: unknown) => unknown }>;
          }
        ).__WEBMCP_TOOLS__;
        const tool = tools?.[toolName];
        if (!tool || typeof tool.execute !== 'function') {
          throw new Error(`herramienta de API no registrada: ${toolName}`);
        }
        return tool.execute(toolArgs);
      },
      name,
      args,
    );
  }
}
