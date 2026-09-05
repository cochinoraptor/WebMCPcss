/**
 * Retro-WebMCP: publicación al repositorio comunitario.
 *
 * Reutiliza `publishToCommunity` (fork + rama + PR) añadiendo una cabecera
 * con los metadatos del escaneo legacy, y ofrece `prepareRetroSubmission`
 * para revisar el resultado sin publicar.
 */
import { publishToCommunity, validateForPublish, type PublishResult } from '../community/publish';
import { serializeToolMap } from '../parser';
import { VERSION } from '../version';
import type { RetroScan } from './scanner';

/** Opciones de publicación retro. */
export interface RetroPublishOptions {
  domain: string;
  /** Token de GitHub (solo por entorno/flag; nunca se escribe en disco). */
  token: string;
  /** Escaneo (para la cabecera) o CSS ya preparado. */
  scan?: RetroScan;
  css?: string;
  /** Solo preparar (no publicar). */
  dryRun?: boolean;
  apiBase?: string;
}

/** Envío preparado. */
export interface RetroSubmission {
  domain: string;
  css: string;
  tools: number;
  context: number;
  header: string;
}

/**
 * Prepara el CSS a publicar con cabecera de procedencia.
 * @param scan Escaneo legacy.
 * @param domain Dominio destino.
 */
export function prepareRetroSubmission(scan: RetroScan, domain: string): RetroSubmission {
  const header = [
    `/* WebMCPcss community style — ${domain}`,
    ` * Generado por webmcpcss retro scan v${VERSION}`,
    ` * Fuente: ${scan.url ?? 'HTML local'} · legacyScore: ${scan.legacyScore}`,
    ` * Señales: ${scan.signals.map((s) => `${s.kind}(${s.count})`).join(', ') || 'ninguna'}`,
    ' * Revisa las herramientas marcadas con webmcp-confidence < 0.5 antes de confiar en ellas.',
    ' */',
    '',
  ].join('\n');
  const css = header + serializeToolMap(scan.toolMap).replace(/^\/\* Generado por WebMCPcss[^\n]*\n\n?/, '');
  const counts = validateForPublish(css);
  return { domain, css, tools: counts.tools, context: counts.context, header };
}

/**
 * Publica (o prepara) la definición legacy en el repositorio comunitario.
 */
export async function publishRetro(opts: RetroPublishOptions): Promise<{ submission: RetroSubmission; result?: PublishResult }> {
  let submission: RetroSubmission;
  if (opts.scan) submission = prepareRetroSubmission(opts.scan, opts.domain);
  else if (opts.css) {
    const counts = validateForPublish(opts.css);
    submission = { domain: opts.domain, css: opts.css, tools: counts.tools, context: counts.context, header: '' };
  } else throw new Error('publishRetro requiere scan o css');
  if (opts.dryRun) return { submission };
  const result = await publishToCommunity({ domain: opts.domain, css: submission.css, token: opts.token, apiBase: opts.apiBase });
  return { submission, result };
}
