/**
 * Design-to-WebMCP: validador diseño ↔ sitio real.
 *
 * Compara la estructura de diseño (o el `.webmcp.css` generado) con la
 * página implementada:
 * - **Selectores**: ¿existe cada herramienta propuesta en el DOM?
 * - **Etiquetas**: ¿coincide el texto visible con el del diseño?
 * - **Posición** (opcional): si el diseño trae cajas y la captura tiene el
 *   mismo tamaño, ¿está el elemento en la zona esperada?
 * - **Visión** (opcional): un LLM con visión compara mockup y captura y
 *   lista diferencias.
 *
 * El acceso a la página se abstrae en `DesignPageProbe` para poder validar
 * con Puppeteer o con jsdom (tests).
 */
import type { LlmClient } from '../prompt/types';
import { extractJsonObject } from '../prompt/llm-client';
import type { ToolMap } from '../types';
import type { DesignElement, DesignStructure } from './analyzer';
import { toDataUrl } from './analyzer';

/** Sonda de página mínima. */
export interface DesignPageProbe {
  /** Devuelve datos del primer elemento que case, o `null`. */
  probe(selector: string): Promise<{ text: string; box?: { x: number; y: number; width: number; height: number }; visible: boolean } | null>;
  /** Captura PNG de la página (opcional, para comparación visual). */
  screenshot?(): Promise<Buffer>;
  /** Tamaño del viewport (para normalizar posiciones). */
  viewport?(): Promise<{ width: number; height: number }>;
}

/** Resultado por herramienta. */
export interface DesignCheck {
  tool: string;
  selector: string;
  elementId?: string;
  exists: boolean;
  visible?: boolean;
  labelExpected?: string;
  labelFound?: string;
  labelMatch?: boolean;
  /** Desplazamiento relativo (0-1) entre diseño y realidad, si hay cajas. */
  positionDelta?: number;
  status: 'ok' | 'moved' | 'relabeled' | 'missing';
}

/** Informe completo. */
export interface DesignValidationReport {
  url: string;
  total: number;
  ok: number;
  missing: number;
  moved: number;
  relabeled: number;
  score: number;
  checks: DesignCheck[];
  visualDiff?: { summary: string; differences: string[] };
}

/** Normaliza texto para comparar etiquetas. */
function norm(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Similitud simple (Dice sobre bigramas). */
export function similarity(a: string, b: string): number {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1;
  const grams = (s: string) => {
    const g = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) ?? 0) + 1);
    return g;
  };
  const ga = grams(na);
  const gb = grams(nb);
  let inter = 0;
  for (const [k, v] of ga) inter += Math.min(v, gb.get(k) ?? 0);
  return (2 * inter) / (na.length - 1 + nb.length - 1);
}

/**
 * Valida el tool map generado (y opcionalmente el diseño) contra la página.
 * @param map Tool map generado desde el diseño.
 * @param probe Sonda de página.
 * @param design Estructura de diseño (para etiquetas/cajas).
 * @param url URL (informativa).
 */
export async function validateDesign(map: ToolMap, probe: DesignPageProbe, design?: DesignStructure, url = ''): Promise<DesignValidationReport> {
  const byDesignId = new Map<string, DesignElement>((design?.elements ?? []).map((e) => [e.id, e]));
  const viewport = probe.viewport ? await probe.viewport() : undefined;
  const checks: DesignCheck[] = [];
  for (const [name, tool] of Object.entries(map.tools)) {
    const designId = tool.meta?.['design-id'];
    const el = designId ? byDesignId.get(designId) : undefined;
    const found = await probe.probe(tool.selector);
    const check: DesignCheck = { tool: name, selector: tool.selector, elementId: designId, exists: Boolean(found), status: 'missing' };
    if (!found) {
      checks.push(check);
      continue;
    }
    check.visible = found.visible;
    check.status = 'ok';
    if (el?.label) {
      check.labelExpected = el.label;
      check.labelFound = found.text.slice(0, 120);
      check.labelMatch = similarity(el.label, found.text) >= 0.6;
      if (!check.labelMatch && found.text) check.status = 'relabeled';
    }
    if (el?.box && found.box && design?.source.width && design.source.height && viewport) {
      const dx = el.box.x / design.source.width - found.box.x / viewport.width;
      const dy = el.box.y / design.source.height - found.box.y / viewport.height;
      check.positionDelta = Math.round(Math.hypot(dx, dy) * 1000) / 1000;
      if (check.positionDelta > 0.25 && check.status === 'ok') check.status = 'moved';
    }
    checks.push(check);
  }
  const count = (s: DesignCheck['status']) => checks.filter((c) => c.status === s).length;
  const ok = count('ok');
  const total = checks.length;
  return {
    url,
    total,
    ok,
    missing: count('missing'),
    moved: count('moved'),
    relabeled: count('relabeled'),
    score: total ? Math.round(((ok + 0.5 * (count('moved') + count('relabeled'))) / total) * 100) : 100,
    checks,
  };
}

const DIFF_SYSTEM = `Comparas dos imágenes: la primera es el diseño (mockup) y la segunda la implementación real. Devuelve JSON: {"summary": string, "differences": [string]} con las diferencias relevantes para un agente que debe operar la página (elementos que faltan, cambiaron de sitio o de texto, estados distintos). Máximo 12 diferencias, en español.`;

/**
 * Comparación visual diseño ↔ captura con un LLM con visión.
 * @param designImage Imagen del diseño.
 * @param screenshot Captura real.
 * @param client LLM con visión.
 */
export async function compareVisually(designImage: Buffer, designMime: string, screenshot: Buffer, client: LlmClient): Promise<{ summary: string; differences: string[] }> {
  const raw = await client.complete({
    system: DIFF_SYSTEM,
    user: 'Primera imagen: diseño. Segunda imagen: implementación. Enumera diferencias.',
    json: true,
    images: [toDataUrl(designImage, designMime), toDataUrl(screenshot, 'image/png')],
    maxTokens: 1500,
  });
  const obj = extractJsonObject(raw);
  return {
    summary: String(obj?.summary ?? 'Sin resumen'),
    differences: Array.isArray(obj?.differences) ? (obj?.differences as unknown[]).map(String).slice(0, 12) : [],
  };
}
