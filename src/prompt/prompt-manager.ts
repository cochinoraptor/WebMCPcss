/**
 * `PromptManager`: orquesta el flujo completo de una orden en lenguaje
 * natural sobre una página:
 *
 * 1. Interpreta el prompt ({@link interpretPrompt}) — LLM o heurísticas.
 * 2. Localiza el elemento objetivo ({@link ElementFinder}).
 * 3. Ejecuta la acción ({@link ActionExecutor}) salvo en `dryRun`.
 * 4. Recoge evidencia (captura de pantalla, estado posterior) y registra
 *    todo en un log de auditoría + historial del dashboard.
 *
 * Reutiliza la clase `WebMCPcss` cuando hay un `.webmcp.css`: las acciones
 * que coinciden con herramientas declaradas se ejecutan a través de ella,
 * heredando la auto-reparación de selectores.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { PageAdapter } from '../adapters/page-adapter';
import { WebMCPcss } from '../core';
import type { ToolMap } from '../types';
import { appendHistory } from '../utils/history';
import { logger } from '../utils/logger';
import { ActionExecutor } from './action-executor';
import { canMutate } from './dom-mutator';
import { ElementFinder } from './element-finder';
import { interpretPrompt } from './interpreter';
import type {
  AssetOptions,
  AuditEntry,
  ElementMatch,
  LlmClient,
  PageContext,
  PromptAction,
  PromptEvidence,
  PromptResult,
  RunOptions,
} from './types';

/** Opciones de construcción del orquestador. */
export interface PromptManagerOptions {
  /** Tool map del `.webmcp.css` (habilita delegación en herramientas). */
  toolMap?: ToolMap;
  /** Cliente LLM (o `null` para heurísticas puras). */
  llm?: LlmClient | null;
  /** URL de la página (informativa, para logs e historial). */
  url?: string;
  /** Título de la página (contexto para el LLM). */
  title?: string;
  /** Umbral mínimo de confianza para localización por texto/visión. */
  threshold?: number;
  /** Opciones de assets (límite de tamaño, carpeta temporal…). */
  assetOptions?: AssetOptions;
}

/** Orquestador del módulo `prompt`. */
export class PromptManager {
  private readonly finder: ElementFinder;
  private readonly executor: ActionExecutor;
  private readonly webmcp: WebMCPcss | null;

  /**
   * @param adapter Adaptador de la página (Puppeteer o DOM).
   * @param options Tool map, LLM, URL y umbrales.
   */
  constructor(
    private readonly adapter: PageAdapter,
    private readonly options: PromptManagerOptions = {},
  ) {
    this.webmcp = options.toolMap
      ? new WebMCPcss(options.toolMap, adapter, { repairThreshold: options.threshold })
      : null;
    this.finder = new ElementFinder(adapter, {
      toolMap: options.toolMap,
      llm: options.llm ?? null,
      threshold: options.threshold,
    });
    this.executor = new ActionExecutor(adapter, {
      toolMap: options.toolMap,
      assetOptions: options.assetOptions,
      findElement: async (description) => (await this.finder.find(description)).match,
      runTool: this.webmcp
        ? (tool, args) => (this.webmcp as WebMCPcss).execute(tool, args)
        : undefined,
    });
  }

  /**
   * Ejecuta una orden en lenguaje natural.
   *
   * @param prompt Orden del usuario ("sube esta imagen al carrusel").
   * @param options Adjuntos, dry-run, captura, historial…
   * @returns Resultado completo con acción, elemento, evidencia y log.
   */
  async run(prompt: string, options: RunOptions = {}): Promise<PromptResult> {
    const started = Date.now();
    const log: AuditEntry[] = [];
    const note = (
      phase: AuditEntry['phase'],
      message: string,
      data?: Record<string, unknown>,
    ) => {
      log.push({ ts: new Date().toISOString(), phase, message, data });
      logger.debug(`prompt[${phase}] ${message}`);
    };
    const dryRun = options.dryRun ?? false;
    const url = options.url ?? this.options.url;

    // 1) Interpretar.
    let action: PromptAction;
    try {
      const context = await this.buildContext(options);
      action = await interpretPrompt(
        prompt,
        { ...options, url, context },
        this.options.llm ?? null,
      );
      note(
        'interpret',
        `${action.action} → "${action.target}" (${action.source}, ${(action.confidence ?? 0).toFixed(2)})`,
        {
          action: action.action,
          target: action.target,
          parameters: action.parameters,
        },
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      note('error', error);
      return this.finish(
        prompt,
        url,
        { action: 'other', target: prompt, parameters: {} },
        null,
        dryRun,
        false,
        false,
        log,
        started,
        { error },
      );
    }

    // 2) Localizar (salvo `other` con herramienta explícita).
    let match: ElementMatch | null = null;
    let suggestions: string[] | undefined;
    const needsElement = !(action.action === 'other' && action.parameters.tool);
    if (needsElement) {
      const found = await this.finder.find(action.target, action.selector, {
        prefer:
          action.action === 'fill' || action.action === 'upload' ? 'field' : undefined,
      });
      match = found.match;
      if (match) {
        note(
          'find',
          `${match.selector} vía ${match.strategy} (${match.confidence.toFixed(2)})${match.tool ? ` · herramienta ${match.tool}` : ''}`,
          {
            selector: match.selector,
            strategy: match.strategy,
            tried: found.tried,
          },
        );
      } else {
        suggestions = found.suggestions;
        note(
          'find',
          `sin coincidencia para "${action.target}" (intentado: ${found.tried.join(' → ')})`,
          {
            tried: found.tried,
          },
        );
        return this.finish(
          prompt,
          url,
          action,
          null,
          dryRun,
          false,
          false,
          log,
          started,
          {
            error: `No se encontró el elemento: "${action.target}"`,
            suggestions,
          },
        );
      }
    }

    // 3) Dry-run: parar aquí.
    if (dryRun) {
      note('execute', 'dry-run: la página no se modificó');
      return this.finish(prompt, url, action, match, true, false, true, log, started, {});
    }
    if (
      needsElement &&
      !canMutate(this.adapter) &&
      !['click', 'fill', 'other'].includes(action.action)
    ) {
      const error =
        'El adaptador no soporta modificar la página (usa DomAdapter o PuppeteerAdapter).';
      note('error', error);
      return this.finish(prompt, url, action, match, false, false, false, log, started, {
        error,
      });
    }

    // 4) Ejecutar.
    const outcome = await this.executor.execute(action, match);
    this.finder.invalidate();
    note(outcome.success ? 'execute' : 'error', outcome.message, outcome.details);

    // 5) Evidencia.
    const evidence = await this.collectEvidence(match, options, note);

    const result = this.finish(
      prompt,
      url,
      action,
      match,
      false,
      true,
      outcome.success,
      log,
      started,
      {
        outcome,
        error: outcome.success ? undefined : outcome.error,
        evidence,
      },
    );
    this.record(result, options);
    return result;
  }

  /** Contexto de página para el LLM (solo si hay LLM: evita snapshots inútiles). */
  private async buildContext(options: RunOptions): Promise<PageContext> {
    const tools = this.options.toolMap
      ? Object.keys(this.options.toolMap.tools)
      : undefined;
    if (!this.options.llm) return { url: options.url ?? this.options.url, tools };
    let candidates: PageContext['candidates'];
    try {
      candidates = await this.finder.candidates();
    } catch {
      candidates = undefined;
    }
    return {
      url: options.url ?? this.options.url,
      title: this.options.title,
      tools,
      candidates,
    };
  }

  /** Captura de pantalla y estado posterior del elemento. */
  private async collectEvidence(
    match: ElementMatch | null,
    options: RunOptions,
    note: (
      phase: AuditEntry['phase'],
      message: string,
      data?: Record<string, unknown>,
    ) => void,
  ): Promise<PromptEvidence | undefined> {
    const evidence: PromptEvidence = {};
    const wantsShot = Boolean(options.screenshot) || options.screenshotBase64;
    if (wantsShot && canMutate(this.adapter) && this.adapter.screenshot) {
      const b64 = await this.adapter.screenshot();
      if (b64) {
        if (options.screenshot) {
          fs.mkdirSync(path.dirname(path.resolve(options.screenshot)), {
            recursive: true,
          });
          fs.writeFileSync(options.screenshot, Buffer.from(b64, 'base64'));
          evidence.screenshot = options.screenshot;
          note('evidence', `captura guardada en ${options.screenshot}`);
        }
        if (options.screenshotBase64) evidence.screenshotBase64 = b64;
      } else {
        note('evidence', 'el adaptador no pudo capturar pantalla');
      }
    } else if (wantsShot) {
      note('evidence', 'captura no disponible con este adaptador (requiere Puppeteer)');
    }
    if (match) {
      try {
        const after = (await this.adapter.snapshot()).find(
          (c) => c.selector === match.selector,
        );
        evidence.after = after ?? null;
      } catch {
        evidence.after = null;
      }
    }
    return Object.keys(evidence).length > 0 ? evidence : undefined;
  }

  /** Registra el evento en el historial del dashboard (salvo `historyFile: false`). */
  private record(result: PromptResult, options: RunOptions): void {
    if (options.historyFile === false) return;
    try {
      appendHistory(
        {
          type: 'prompt',
          url: result.url,
          tool: result.match?.tool ?? result.action.action,
          ok: result.success,
          details: {
            prompt: result.prompt,
            action: result.action.action,
            target: result.action.target,
            selector: result.match?.selector,
            strategy: result.match?.strategy,
            via: result.outcome?.via,
            error: result.error,
          },
        },
        options.historyFile || undefined,
      );
    } catch (err) {
      logger.debug(
        `prompt: no se pudo escribir el historial (${err instanceof Error ? err.message : err})`,
      );
    }
  }

  /** Construye el resultado final. */
  private finish(
    prompt: string,
    url: string | undefined,
    action: PromptAction,
    match: ElementMatch | null,
    dryRun: boolean,
    executed: boolean,
    success: boolean,
    log: AuditEntry[],
    started: number,
    extra: Partial<PromptResult>,
  ): PromptResult {
    return {
      prompt,
      url,
      action,
      match,
      dryRun,
      executed,
      success,
      ...extra,
      log,
      durationMs: Date.now() - started,
    };
  }
}

/**
 * Atajo funcional: ejecuta un prompt con un orquestador temporal.
 * @see PromptManager.run
 */
export async function runPrompt(
  adapter: PageAdapter,
  prompt: string,
  options: RunOptions & PromptManagerOptions = {},
): Promise<PromptResult> {
  const { toolMap, llm, title, threshold, assetOptions, ...run } = options;
  return new PromptManager(adapter, {
    toolMap,
    llm,
    title,
    threshold,
    assetOptions,
    url: run.url,
  }).run(prompt, run);
}
