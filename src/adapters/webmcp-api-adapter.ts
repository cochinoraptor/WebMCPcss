/**
 * `WebMCPApiAdapter`: adaptador de Puppeteer con soporte para la API
 * imperativa de WebMCP (`navigator.modelContext`).
 *
 * Implementa {@link PageAdapter} (hereda todas las operaciones DOM de
 * `PuppeteerAdapter`) y además {@link ApiToolSource}: puede listar e invocar
 * herramientas registradas con `registerTool()` en la página.
 *
 * IMPORTANTE: crear el adaptador con {@link WebMCPApiAdapter.create} ANTES
 * de navegar, para que el shim de captura quede instalado cuando el sitio
 * ejecute sus `registerTool()`.
 */
import type { Page } from 'puppeteer';
import type { RegisteredToolInfo } from '../types';
import {
  installModelContextShim,
  invokeRegisteredTool,
  readRegisteredTools,
} from '../webmcp-api/api-client';
import type { ApiToolSource } from './page-adapter';
import { PuppeteerAdapter } from './puppeteer-adapter';

/** Adaptador Puppeteer + API imperativa de WebMCP. */
export class WebMCPApiAdapter extends PuppeteerAdapter implements ApiToolSource {
  private constructor(private readonly apiPage: Page) {
    super(apiPage);
  }

  /**
   * Crea el adaptador e instala el shim de `navigator.modelContext` tanto
   * para futuras navegaciones (`evaluateOnNewDocument`) como en el documento
   * actual (por si la página ya está cargada).
   *
   * @param page Página de Puppeteer.
   */
  static async create(page: Page): Promise<WebMCPApiAdapter> {
    await page.evaluateOnNewDocument(installModelContextShim, undefined as never);
    try {
      await page.evaluate(installModelContextShim, undefined as never);
    } catch {
      /* la página puede no estar lista todavía; el OnNewDocument cubre la navegación */
    }
    return new WebMCPApiAdapter(page);
  }

  /** @inheritdoc */
  async listApiTools(): Promise<RegisteredToolInfo[]> {
    return this.apiPage.evaluate(readRegisteredTools, undefined as never);
  }

  /** @inheritdoc */
  async callApiTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.apiPage.evaluate(
      invokeRegisteredTool,
      undefined as never,
      name,
      args as never,
    );
  }
}
