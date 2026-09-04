/**
 * Ejecutor de animaciones sobre una página real (Puppeteer) o un DOM en
 * memoria (jsdom).
 *
 * - **Puppeteer** (`animateWithPage`): inyecta el runtime del navegador
 *   (ver `runtime-bundle.ts`), ejecuta el mapa dentro de la página y
 *   devuelve el resultado serializado + captura opcional. También puede
 *   generar el bundle en disco (`--output`).
 * - **DOM local** (`animateInWindow`): usa el orquestador directamente
 *   (tests, extensiones, entornos con DOM propio).
 *
 * Además registra cada ejecución en el historial (`type: 'animate'`).
 */
import type { Page } from 'puppeteer';
import { appendHistory } from '../utils/history';
import { AnimationOrchestrator } from './orchestrator';
import { buildRuntimeScript, RUNTIME_GLOBAL } from './runtime-bundle';
import {
  type AnimationMap,
  type AnimationPlan,
  type AnimationValidationReport,
  type OrchestrationResult,
  type OrchestratorOptions,
} from './types';
import { validateAnimations } from './validators';

/** Opciones de ejecución. */
export interface ExecuteOptions extends OrchestratorOptions {
  /** URL (informativa, para el historial). */
  url?: string;
  /** Ruta del historial o `false` para no registrar. */
  historyFile?: string | false;
  /** Capturar pantalla (base64 PNG) tras ejecutar (solo Puppeteer). */
  screenshot?: boolean;
  /** Milisegundos a esperar tras lanzar las animaciones antes de capturar. */
  settleMs?: number;
  /** Validar antes de ejecutar (por defecto `true`); aborta si hay errores. */
  validate?: boolean;
}

/** Resultado completo de una ejecución. */
export interface ExecuteResult {
  /** Plan por prioridad. */
  plan: AnimationPlan[];
  /** Informe de validación previo (si se validó). */
  validation?: AnimationValidationReport;
  /** Resultado del orquestador (ausente en dry-run o si la validación falló). */
  result?: OrchestrationResult;
  /** ¿Modo dry-run? */
  dryRun: boolean;
  /** ¿Éxito global? */
  success: boolean;
  /** Captura en base64 (si se pidió). */
  screenshotBase64?: string;
  /** Mensaje resumen. */
  message: string;
}

/** Datos que se serializan hacia/desde la página. */
interface PageRunPayload {
  plan: AnimationPlan[];
  validation: AnimationValidationReport;
  result?: OrchestrationResult;
}

/**
 * Ejecuta un mapa de animaciones dentro de una `Page` de Puppeteer.
 * @param page Página ya navegada.
 * @param map Animaciones parseadas.
 * @param options Opciones.
 */
export async function animateWithPage(
  page: Page,
  map: AnimationMap,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const dryRun = options.dryRun === true;
  const injected = await page.evaluate(
    (g) => typeof (window as unknown as Record<string, unknown>)[g] === 'object',
    RUNTIME_GLOBAL,
  );
  if (!injected) await page.addScriptTag({ content: buildRuntimeScript() });

  const {
    url: _u,
    historyFile: _h,
    screenshot: _s,
    settleMs: _m,
    validate: _v,
    ...orch
  } = options;
  const shouldValidate = options.validate !== false;
  const payload = (await page.evaluate(
    async (g, m, o, dry, doValidate) => {
      const ns = (
        window as unknown as Record<string, { animation: Record<string, unknown> }>
      )[g].animation;
      type Orch = {
        plan(map: unknown): unknown;
        runAll(map: unknown): Promise<unknown>;
      };
      const orchestrator = (ns.orchestrator as (o: unknown) => Orch)({
        ...(o as object),
        dryRun: dry,
      });
      const plan = orchestrator.plan(m);
      const validation = (ns.validate as (map: unknown, o: unknown) => { ok: boolean })(
        m,
        o,
      );
      const out: { plan: unknown; validation: unknown; result?: unknown } = {
        plan,
        validation,
      };
      if (!dry && (!doValidate || validation.ok))
        out.result = await orchestrator.runAll(m);
      else if (dry) out.result = await orchestrator.runAll(m);
      return JSON.parse(JSON.stringify(out));
    },
    RUNTIME_GLOBAL,
    map as unknown as Record<string, unknown>,
    orch as unknown as Record<string, unknown>,
    dryRun,
    shouldValidate,
  )) as PageRunPayload;

  let screenshotBase64: string | undefined;
  if (!dryRun && options.screenshot) {
    await new Promise((r) => setTimeout(r, options.settleMs ?? 600));
    screenshotBase64 = (await page.screenshot({
      encoding: 'base64',
      type: 'png',
    })) as string;
  }
  const result = finalize(map, payload, dryRun, shouldValidate, options);
  if (screenshotBase64) result.screenshotBase64 = screenshotBase64;
  return result;
}

/**
 * Ejecuta un mapa de animaciones sobre una ventana DOM local (jsdom o DOM
 * real cuando el módulo se usa dentro del navegador).
 * @param win Ventana.
 * @param map Animaciones parseadas.
 * @param options Opciones.
 */
export async function animateInWindow(
  win: Window,
  map: AnimationMap,
  options: ExecuteOptions = {},
): Promise<ExecuteResult & { orchestrator: AnimationOrchestrator }> {
  const dryRun = options.dryRun === true;
  const {
    url: _u,
    historyFile: _h,
    screenshot: _s,
    settleMs: _m,
    validate: _v,
    ...orch
  } = options;
  const shouldValidate = options.validate !== false;
  const orchestrator = new AnimationOrchestrator(win, { ...orch, dryRun });
  const plan = orchestrator.plan(map);
  const validation = validateAnimations(map, win, orch);
  const payload: PageRunPayload = { plan, validation };
  if (dryRun || !shouldValidate || validation.ok)
    payload.result = await orchestrator.runAll(map);
  return { ...finalize(map, payload, dryRun, shouldValidate, options), orchestrator };
}

/** Construye el resultado final y registra el historial. */
function finalize(
  map: AnimationMap,
  payload: PageRunPayload,
  dryRun: boolean,
  validated: boolean,
  options: ExecuteOptions,
): ExecuteResult {
  const names = Object.keys(map.animations);
  const blocked = validated && !payload.validation.ok && !dryRun;
  const success = blocked ? false : payload.result ? payload.result.success : true;
  let message: string;
  if (dryRun) {
    message = `[dry-run] ${names.length} animación(es) planificadas`;
  } else if (blocked) {
    const errs = payload.validation.entries.flatMap((e) => e.errors);
    message = `Validación fallida (${errs.length} error(es)): ${errs.slice(0, 3).join(' · ')}`;
  } else if (payload.result) {
    const counts = payload.result.outcomes.reduce<Record<string, number>>((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1;
      return acc;
    }, {});
    message = Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ');
  } else {
    message = 'Sin resultado';
  }
  const result: ExecuteResult = {
    plan: payload.plan,
    validation: payload.validation,
    result: payload.result,
    dryRun,
    success,
    message,
  };
  if (options.historyFile !== false && !dryRun) {
    try {
      appendHistory(
        {
          type: 'animate',
          url: options.url,
          ok: success,
          details: {
            animations: names,
            outcomes: payload.result?.outcomes.map((o) => ({
              name: o.name,
              status: o.status,
              engine: o.engine,
            })),
            strategy: options.strategy ?? 'queue',
          },
        },
        options.historyFile || undefined,
      );
    } catch {
      /* el historial nunca debe romper la ejecución */
    }
  }
  return result;
}
