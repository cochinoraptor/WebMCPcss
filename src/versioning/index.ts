/**
 * Version-MCP (v1.0.0): versionado semántico de tool maps.
 *
 * - `createSnapshot(map, { url, live })` congela el contrato: hash por tool,
 *   fingerprints y metadatos de la página.
 * - `diffSnapshots(a, b)` calcula cambios y clasifica el impacto en
 *   `major` (tools eliminadas/renombradas, parámetros eliminados, selector
 *   incompatible), `minor` (tools/params/contextos nuevos) o `patch`
 *   (descripciones, meta, fingerprints).
 * - `buildMigration(diff)` genera un plan de migración legible por agentes y
 *   `applyMigration()` lo aplica sobre un tool map antiguo (renombres,
 *   selectores nuevos, params) para producir el `.webmcp.css` migrado.
 */
import { createHash } from 'node:crypto';
import type { Page } from 'puppeteer';
import type { ContextSpec, ParamSpec, ToolMap, ToolSpec, TriggerSpec } from '../types';
import { VERSION } from '../version';

/** Snapshot de una tool. */
export interface ToolSnapshot {
  selector: string;
  description: string;
  /** Parámetros con su especificación completa (source/selector/value). */
  params: Record<string, ParamSpec>;
  confirmation?: string;
  trigger?: TriggerSpec;
  meta?: Record<string, string>;
  hash: string;
  /** Presencia en la página en el momento del snapshot (si `live`). */
  present?: boolean;
  /** Huella textual del elemento (si `live`). */
  fingerprint?: { tag?: string; text?: string; attrs?: Record<string, string> };
}

/** Snapshot completo. */
export interface Snapshot {
  version: string;
  generatedBy: string;
  createdAt: string;
  url?: string;
  title?: string;
  hash: string;
  tools: Record<string, ToolSnapshot>;
  context: Record<
    string,
    { selector: string; format?: string; hash: string; present?: boolean }
  >;
}

/** Nivel de impacto. */
export type Impact = 'major' | 'minor' | 'patch' | 'none';

/** Cambio individual. */
export interface Change {
  kind:
    | 'tool-added'
    | 'tool-removed'
    | 'tool-renamed'
    | 'selector-changed'
    | 'param-added'
    | 'param-removed'
    | 'param-selector-changed'
    | 'description-changed'
    | 'confirmation-changed'
    | 'meta-changed'
    | 'context-added'
    | 'context-removed'
    | 'context-changed';
  target: string;
  impact: Impact;
  from?: string;
  to?: string;
  detail?: string;
}

/** Diff entre snapshots. */
export interface SnapshotDiff {
  from: { version: string; hash: string; createdAt: string };
  to: { version: string; hash: string; createdAt: string };
  impact: Impact;
  suggestedVersion: string;
  changes: Change[];
  summary: { added: number; removed: number; renamed: number; changed: number };
}

/** Paso de migración. */
export interface MigrationStep {
  action:
    | 'rename-tool'
    | 'update-selector'
    | 'add-param'
    | 'drop-param'
    | 'update-param'
    | 'drop-tool'
    | 'note';
  tool: string;
  from?: string;
  to?: string;
  param?: string;
  note: string;
}

/** Plan de migración. */
export interface MigrationPlan {
  fromVersion: string;
  toVersion: string;
  impact: Impact;
  steps: MigrationStep[];
  /** Instrucciones para agentes (markdown). */
  agentNotes: string;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

const toolHash = (t: ToolSpec) =>
  sha(
    JSON.stringify([
      t.selector,
      t.description ?? '',
      t.params ?? {},
      t.confirmation ?? '',
      t.trigger ?? '',
      t.meta ?? {},
    ]),
  );
const ctxHash = (c: ContextSpec) => sha(JSON.stringify([c.selector, c.format ?? 'text']));
/** Representación textual de un ParamSpec para diffs legibles. */
const paramText = (p: ParamSpec) =>
  p.selector
    ? `${p.source}(${p.selector})`
    : p.value
      ? `${p.source}:${p.value}`
      : p.source;

/**
 * Crea un snapshot del tool map. Si se pasa `page`, comprueba presencia y
 * huella de cada selector en la página real.
 * @param map Tool map.
 * @param opts Versión declarada, URL y página opcional.
 */
export async function createSnapshot(
  map: ToolMap,
  opts: { version?: string; url?: string; page?: Page | null } = {},
): Promise<Snapshot> {
  const tools: Snapshot['tools'] = {};
  const context: Snapshot['context'] = {};
  let title: string | undefined;
  let probe:
    | ((selector: string) => Promise<{
        present: boolean;
        tag?: string;
        text?: string;
        attrs?: Record<string, string>;
      }>)
    | null = null;
  if (opts.page) {
    const page = opts.page;
    title = await page.title().catch(() => undefined);
    probe = (selector) =>
      page.evaluate((s) => {
        let el: Element | null = null;
        try {
          el = document.querySelector(s);
        } catch {
          return { present: false };
        }
        if (!el) return { present: false };
        const attrs: Record<string, string> = {};
        for (const a of ['id', 'name', 'type', 'href', 'aria-label', 'data-tool']) {
          const v = el.getAttribute(a);
          if (v) attrs[a] = v.slice(0, 80);
        }
        return {
          present: true,
          tag: el.tagName.toLowerCase(),
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
          attrs,
        };
      }, selector);
  }
  for (const [name, t] of Object.entries(map.tools)) {
    const snap: ToolSnapshot = {
      selector: t.selector,
      description: t.description ?? '',
      params: { ...(t.params ?? {}) },
      confirmation: t.confirmation,
      trigger: t.trigger,
      meta: t.meta,
      hash: toolHash(t),
    };
    if (probe) {
      const r = await probe(t.selector);
      snap.present = r.present;
      if (r.present) snap.fingerprint = { tag: r.tag, text: r.text, attrs: r.attrs };
    }
    tools[name] = snap;
  }
  for (const [name, c] of Object.entries(map.context)) {
    const snap: Snapshot['context'][string] = {
      selector: c.selector,
      format: c.format,
      hash: ctxHash(c),
    };
    if (probe) snap.present = (await probe(c.selector)).present;
    context[name] = snap;
  }
  const hash = sha(
    JSON.stringify([
      Object.entries(tools).map(([n, t]) => [n, t.hash]),
      Object.entries(context).map(([n, c]) => [n, c.hash]),
    ]),
  );
  return {
    version: opts.version ?? '1.0.0',
    generatedBy: `webmcpcss@${VERSION}`,
    createdAt: new Date().toISOString(),
    url: opts.url,
    title,
    hash,
    tools,
    context,
  };
}

/**
 * Convierte un snapshot en tool map.
 * @param snap Snapshot.
 */
export function snapshotToToolMap(snap: Snapshot): ToolMap {
  const map: ToolMap = { tools: {}, context: {} };
  for (const [n, t] of Object.entries(snap.tools))
    map.tools[n] = {
      selector: t.selector,
      description: t.description,
      params: { ...t.params },
      confirmation: t.confirmation,
      trigger: t.trigger,
      meta: t.meta,
    };
  for (const [n, c] of Object.entries(snap.context))
    map.context[n] = { selector: c.selector, format: c.format };
  return map;
}

/** Similitud simple entre dos tools (para detectar renombres). */
function toolSimilarity(a: ToolSnapshot, b: ToolSnapshot): number {
  let score = 0;
  if (a.selector === b.selector) score += 0.6;
  if (a.description && a.description === b.description) score += 0.3;
  const pa = Object.values(a.params).map(paramText);
  const pb = Object.values(b.params).map(paramText);
  if (pa.length && pa.length === pb.length && pa.every((s) => pb.includes(s)))
    score += 0.2;
  if (a.fingerprint?.text && a.fingerprint.text === b.fingerprint?.text) score += 0.2;
  return Math.min(1, score);
}

/**
 * Sube una versión semver según el impacto.
 * @param version Versión actual.
 * @param impact Impacto.
 */
export function bumpVersion(version: string, impact: Impact): string {
  const [maj, min, pat] = version.split('.').map((n) => parseInt(n, 10) || 0);
  if (impact === 'major') return `${maj + 1}.0.0`;
  if (impact === 'minor') return `${maj}.${min + 1}.0`;
  if (impact === 'patch') return `${maj}.${min}.${pat + 1}`;
  return version;
}

const IMPACT_ORDER: Impact[] = ['none', 'patch', 'minor', 'major'];
const maxImpact = (a: Impact, b: Impact) =>
  IMPACT_ORDER.indexOf(a) >= IMPACT_ORDER.indexOf(b) ? a : b;

/**
 * Compara dos snapshots.
 * @param from Snapshot antiguo.
 * @param to Snapshot nuevo.
 */
export function diffSnapshots(from: Snapshot, to: Snapshot): SnapshotDiff {
  const changes: Change[] = [];
  const removed = Object.keys(from.tools).filter((n) => !(n in to.tools));
  const added = Object.keys(to.tools).filter((n) => !(n in from.tools));
  const renamed = new Map<string, string>();
  for (const r of removed) {
    let best: { name: string; score: number } | null = null;
    for (const a of added) {
      if ([...renamed.values()].includes(a)) continue;
      const score = toolSimilarity(from.tools[r], to.tools[a]);
      if (score >= 0.6 && (!best || score > best.score)) best = { name: a, score };
    }
    if (best) renamed.set(r, best.name);
  }
  for (const [oldName, newName] of renamed)
    changes.push({
      kind: 'tool-renamed',
      target: oldName,
      impact: 'major',
      from: oldName,
      to: newName,
      detail: 'misma acción con otro nombre: los agentes deben actualizar sus llamadas',
    });
  for (const r of removed)
    if (!renamed.has(r))
      changes.push({
        kind: 'tool-removed',
        target: r,
        impact: 'major',
        from: from.tools[r].selector,
      });
  for (const a of added)
    if (![...renamed.values()].includes(a))
      changes.push({
        kind: 'tool-added',
        target: a,
        impact: 'minor',
        to: to.tools[a].selector,
      });

  const pairs: Array<[string, ToolSnapshot, string, ToolSnapshot]> = [];
  for (const n of Object.keys(from.tools))
    if (n in to.tools) pairs.push([n, from.tools[n], n, to.tools[n]]);
  for (const [o, nn] of renamed) pairs.push([o, from.tools[o], nn, to.tools[nn]]);
  for (const [oldName, a, newName, b] of pairs) {
    const target = oldName === newName ? oldName : `${oldName}→${newName}`;
    if (a.selector !== b.selector) {
      const compatible = a.present === false && b.present !== false;
      changes.push({
        kind: 'selector-changed',
        target,
        impact: compatible ? 'patch' : 'minor',
        from: a.selector,
        to: b.selector,
        detail: compatible
          ? 'reparación: el selector antiguo ya no existía'
          : 'el selector cambió; los agentes que cacheen selectores deben refrescar',
      });
    }
    for (const p of Object.keys(a.params)) {
      if (!(p in b.params))
        changes.push({ kind: 'param-removed', target, impact: 'major', from: p });
      else if (paramText(a.params[p]) !== paramText(b.params[p]))
        changes.push({
          kind: 'param-selector-changed',
          target,
          impact: 'patch',
          from: `${p}: ${paramText(a.params[p])}`,
          to: `${p}: ${paramText(b.params[p])}`,
        });
    }
    for (const p of Object.keys(b.params))
      if (!(p in a.params))
        changes.push({ kind: 'param-added', target, impact: 'minor', to: p });
    if (a.description !== b.description)
      changes.push({
        kind: 'description-changed',
        target,
        impact: 'patch',
        from: a.description,
        to: b.description,
      });
    if ((a.confirmation ?? '') !== (b.confirmation ?? ''))
      changes.push({
        kind: 'confirmation-changed',
        target,
        impact: b.confirmation && !a.confirmation ? 'minor' : 'patch',
        from: a.confirmation,
        to: b.confirmation,
      });
    if (JSON.stringify(a.meta ?? {}) !== JSON.stringify(b.meta ?? {})) {
      const perm = (a.meta?.permissions ?? '') !== (b.meta?.permissions ?? '');
      const pay = (a.meta?.payment ?? '') !== (b.meta?.payment ?? '');
      changes.push({
        kind: 'meta-changed',
        target,
        impact: perm || pay ? 'major' : 'patch',
        from: JSON.stringify(a.meta ?? {}),
        to: JSON.stringify(b.meta ?? {}),
        detail: perm
          ? 'cambian los permisos'
          : pay
            ? 'cambia la política de pago'
            : undefined,
      });
    }
  }
  for (const n of Object.keys(from.context)) {
    if (!(n in to.context))
      changes.push({
        kind: 'context-removed',
        target: n,
        impact: 'minor',
        from: from.context[n].selector,
      });
    else if (from.context[n].hash !== to.context[n].hash)
      changes.push({
        kind: 'context-changed',
        target: n,
        impact:
          (from.context[n].format ?? 'text') !== (to.context[n].format ?? 'text')
            ? 'minor'
            : 'patch',
        from: `${from.context[n].selector} (${from.context[n].format ?? 'text'})`,
        to: `${to.context[n].selector} (${to.context[n].format ?? 'text'})`,
      });
  }
  for (const n of Object.keys(to.context))
    if (!(n in from.context))
      changes.push({
        kind: 'context-added',
        target: n,
        impact: 'minor',
        to: to.context[n].selector,
      });

  const impact = changes.reduce<Impact>((acc, c) => maxImpact(acc, c.impact), 'none');
  return {
    from: { version: from.version, hash: from.hash, createdAt: from.createdAt },
    to: { version: to.version, hash: to.hash, createdAt: to.createdAt },
    impact,
    suggestedVersion: bumpVersion(from.version, impact),
    changes,
    summary: {
      added: changes.filter((c) => c.kind.endsWith('-added')).length,
      removed: changes.filter((c) => c.kind.endsWith('-removed')).length,
      renamed: renamed.size,
      changed: changes.filter((c) => c.kind.endsWith('-changed')).length,
    },
  };
}

/**
 * Construye un plan de migración a partir de un diff.
 * @param diff Diff.
 */
export function buildMigration(diff: SnapshotDiff): MigrationPlan {
  const steps: MigrationStep[] = [];
  for (const c of diff.changes) {
    switch (c.kind) {
      case 'tool-renamed':
        steps.push({
          action: 'rename-tool',
          tool: c.from ?? c.target,
          from: c.from,
          to: c.to,
          note: `Llama a "${c.to}" en lugar de "${c.from}".`,
        });
        break;
      case 'tool-removed':
        steps.push({
          action: 'drop-tool',
          tool: c.target,
          note: `La tool "${c.target}" ya no existe; busca una alternativa en el nuevo contrato.`,
        });
        break;
      case 'selector-changed':
        steps.push({
          action: 'update-selector',
          tool: c.target,
          from: c.from,
          to: c.to,
          note: `Selector de "${c.target}": ${c.from} → ${c.to}.`,
        });
        break;
      case 'param-added':
        steps.push({
          action: 'add-param',
          tool: c.target,
          param: c.to,
          note: `Nuevo parámetro "${c.to}" en "${c.target}" (opcional salvo que la descripción diga lo contrario).`,
        });
        break;
      case 'param-removed':
        steps.push({
          action: 'drop-param',
          tool: c.target,
          param: c.from,
          note: `El parámetro "${c.from}" de "${c.target}" desapareció; deja de enviarlo.`,
        });
        break;
      case 'param-selector-changed':
        steps.push({
          action: 'update-param',
          tool: c.target,
          param: c.from?.split(':')[0],
          from: c.from,
          to: c.to,
          note: `Selector del parámetro actualizado en "${c.target}".`,
        });
        break;
      case 'meta-changed':
        if (c.detail)
          steps.push({
            action: 'note',
            tool: c.target,
            note: `${c.detail} en "${c.target}": revisa permisos/pagos antes de ejecutar.`,
          });
        break;
      default:
        break;
    }
  }
  const lines = [
    `# Migración WebMCP ${diff.from.version} → ${diff.to.version || diff.suggestedVersion}`,
    '',
    `Impacto: **${diff.impact}** · versión sugerida: **${diff.suggestedVersion}**`,
    '',
    ...(steps.length
      ? steps.map((s) => `- [${s.action}] ${s.note}`)
      : ['- Sin cambios que afecten a los agentes.']),
    '',
    diff.impact === 'major'
      ? '> ⚠️ Cambios incompatibles: los agentes con contratos cacheados deben volver a leer el `.webmcp.css` o `/.well-known/webmcp.json`.'
      : '> Cambios compatibles: los agentes pueden seguir usando el contrato anterior.',
    '',
  ];
  return {
    fromVersion: diff.from.version,
    toVersion: diff.to.version || diff.suggestedVersion,
    impact: diff.impact,
    steps,
    agentNotes: lines.join('\n'),
  };
}

/**
 * Aplica un plan de migración sobre un tool map (el antiguo), produciendo el
 * tool map migrado. Los pasos `drop-tool` eliminan; `rename-tool` renombran;
 * `update-selector`/`update-param` sustituyen selectores; `add-param` añade
 * el parámetro con el selector del snapshot destino si se proporciona.
 * @param map Tool map antiguo.
 * @param plan Plan.
 * @param target Snapshot destino (para selectores de parámetros nuevos).
 */
export function applyMigration(
  map: ToolMap,
  plan: MigrationPlan,
  target?: Snapshot,
): ToolMap {
  const out: ToolMap = { tools: { ...map.tools }, context: { ...map.context } };
  const resolve = (name: string) => name.split('→').pop() ?? name;
  for (const s of plan.steps) {
    const current = s.tool.includes('→')
      ? out.tools[resolve(s.tool)]
        ? resolve(s.tool)
        : s.tool.split('→')[0]
      : s.tool;
    switch (s.action) {
      case 'rename-tool':
        if (s.from && s.to && out.tools[s.from]) {
          out.tools[s.to] = out.tools[s.from];
          delete out.tools[s.from];
        }
        break;
      case 'drop-tool':
        delete out.tools[s.tool];
        break;
      case 'update-selector':
        if (out.tools[current] && s.to)
          out.tools[current] = { ...out.tools[current], selector: s.to };
        break;
      case 'drop-param':
        if (out.tools[current] && s.param) {
          const params = { ...(out.tools[current].params ?? {}) };
          delete params[s.param];
          out.tools[current] = { ...out.tools[current], params };
        }
        break;
      case 'update-param':
      case 'add-param':
        if (out.tools[current] && s.param) {
          const spec = target?.tools[resolve(s.tool)]?.params[s.param];
          if (spec)
            out.tools[current] = {
              ...out.tools[current],
              params: { ...(out.tools[current].params ?? {}), [s.param]: spec },
            };
        }
        break;
      default:
        break;
    }
  }
  if (target) {
    for (const [n, c] of Object.entries(target.context))
      out.context[n] = { selector: c.selector, format: c.format };
    for (const n of Object.keys(out.context))
      if (!(n in target.context)) delete out.context[n];
  }
  return out;
}

/**
 * Comprueba qué tools de un snapshot siguen presentes en una página real.
 * @param snap Snapshot.
 * @param page Página.
 */
export async function verifySnapshot(
  snap: Snapshot,
  page: Page,
): Promise<{ present: string[]; missing: string[] }> {
  const present: string[] = [];
  const missing: string[] = [];
  for (const [name, t] of Object.entries(snap.tools)) {
    const ok = await page.evaluate((s) => {
      try {
        return Boolean(document.querySelector(s));
      } catch {
        return false;
      }
    }, t.selector);
    (ok ? present : missing).push(name);
  }
  return { present, missing };
}
