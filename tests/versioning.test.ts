/**
 * Tests de Version-MCP (v1.0.0): snapshots (con página simulada), diff
 * semántico con detección de renombres, versión sugerida y migración.
 */
import { describe, expect, it } from 'vitest';
import { parseWebMCP, serializeToolMap } from '../src/parser';
import {
  applyMigration,
  buildMigration,
  bumpVersion,
  createSnapshot,
  diffSnapshots,
  snapshotToToolMap,
  verifySnapshot,
} from '../src/versioning';

const v1 = parseWebMCP(`
#search-btn { webmcp-tool: "buscar"; webmcp-description: "Busca productos"; webmcp-param-query: value(#q); }
#pay { webmcp-tool: "pagar"; webmcp-description: "Paga el pedido"; webmcp-confirmation: "#confirm"; webmcp-permissions: "restricted"; }
#help { webmcp-tool: "ayuda"; webmcp-description: "Abre la ayuda"; }
.price { webmcp-context: "precio"; webmcp-format: "currency"; }
.list { webmcp-context: "lista"; webmcp-format: "list"; }
`);

const v2 = parseWebMCP(`
#search-btn { webmcp-tool: "buscarProductos"; webmcp-description: "Busca productos"; webmcp-param-query: value(#q); webmcp-param-categoria: value(#cat); }
#pay-now { webmcp-tool: "pagar"; webmcp-description: "Paga el pedido actual"; webmcp-confirmation: "#confirm"; webmcp-permissions: "full"; }
.price { webmcp-context: "precio"; webmcp-format: "number"; }
.total { webmcp-context: "total"; webmcp-format: "currency"; }
`);

/** Página simulada (API mínima de Puppeteer usada por el módulo). */
const fakePage = (present: Record<string, { tag: string; text: string }>) =>
  ({
    title: async () => 'Página',
    evaluate: async (fn: (s: string) => unknown, selector: string) => {
      const doc = {
        querySelector: (s: string) => {
          const hit = present[s];
          if (!hit) return null;
          return {
            tagName: hit.tag.toUpperCase(),
            textContent: hit.text,
            getAttribute: (a: string) => (a === 'id' ? s.replace('#', '') : null),
          };
        },
      };
      const g = globalThis as unknown as { document?: unknown };
      const prev = g.document;
      g.document = doc;
      try {
        return fn(selector);
      } finally {
        if (prev === undefined) delete g.document;
        else g.document = prev;
      }
    },
  }) as unknown as import('puppeteer').Page;

describe('versioning · snapshot', () => {
  it('crea un snapshot determinista con hash por tool y total', async () => {
    const a = await createSnapshot(v1, { version: '1.2.3', url: 'https://shop.test' });
    const b = await createSnapshot(v1, { version: '1.2.3', url: 'https://shop.test' });
    expect(a.hash).toBe(b.hash);
    expect(a.tools.buscar.hash).toBe(b.tools.buscar.hash);
    expect(a.tools.buscar.hash).not.toBe(a.tools.pagar.hash);
    expect(a.version).toBe('1.2.3');
    expect(Object.keys(a.context)).toEqual(['precio', 'lista']);
    expect(a.tools.buscar.present).toBeUndefined();
    const map = snapshotToToolMap(a);
    expect(serializeToolMap(map)).toBe(serializeToolMap(v1));
  });

  it('con página comprueba presencia y huella', async () => {
    const page = fakePage({
      '#search-btn': { tag: 'button', text: 'Buscar' },
      '#pay': { tag: 'button', text: 'Pagar' },
      '.price': { tag: 'span', text: '10 €' },
    });
    const snap = await createSnapshot(v1, { page, url: 'https://shop.test' });
    expect(snap.title).toBe('Página');
    expect(snap.tools.buscar.present).toBe(true);
    expect(snap.tools.buscar.fingerprint).toMatchObject({
      tag: 'button',
      text: 'Buscar',
    });
    expect(snap.tools.ayuda.present).toBe(false);
    expect(snap.context.precio.present).toBe(true);
    expect(snap.context.lista.present).toBe(false);
    const verified = await verifySnapshot(snap, page);
    expect(verified).toEqual({ present: ['buscar', 'pagar'], missing: ['ayuda'] });
  });
});

describe('versioning · diff', () => {
  it('detecta renombres, selectores, params, permisos y contexto y sugiere major', async () => {
    const a = await createSnapshot(v1, { version: '1.2.3' });
    const b = await createSnapshot(v2, { version: '' });
    const diff = diffSnapshots(a, b);
    const kinds = diff.changes.map((c) => `${c.kind}:${c.target}`);
    expect(kinds).toContain('tool-renamed:buscar');
    expect(diff.changes.find((c) => c.kind === 'tool-renamed')).toMatchObject({
      from: 'buscar',
      to: 'buscarProductos',
      impact: 'major',
    });
    expect(kinds).toContain('param-added:buscar→buscarProductos');
    expect(kinds).toContain('tool-removed:ayuda');
    expect(kinds).toContain('selector-changed:pagar');
    expect(kinds).toContain('description-changed:pagar');
    expect(
      diff.changes.find((c) => c.kind === 'meta-changed' && c.target === 'pagar'),
    ).toMatchObject({ impact: 'major', detail: 'cambian los permisos' });
    expect(kinds).toContain('context-removed:lista');
    expect(kinds).toContain('context-added:total');
    expect(
      diff.changes.find((c) => c.kind === 'context-changed' && c.target === 'precio')
        ?.impact,
    ).toBe('minor');
    expect(diff.impact).toBe('major');
    expect(diff.suggestedVersion).toBe('2.0.0');
    expect(diff.summary).toMatchObject({ renamed: 1, removed: 2, added: 2 });
  });

  it('clasifica minor (tool nueva) y patch (descripción) y none', async () => {
    const base = await createSnapshot(v1, { version: '1.0.0' });
    const plusTool = await createSnapshot(
      parseWebMCP(
        serializeToolMap(v1) +
          '\n#x { webmcp-tool: "extra"; webmcp-description: "Extra"; }',
      ),
      { version: '' },
    );
    expect(diffSnapshots(base, plusTool)).toMatchObject({
      impact: 'minor',
      suggestedVersion: '1.1.0',
    });
    const desc = await createSnapshot(
      parseWebMCP(
        serializeToolMap(v1).replace('Abre la ayuda', 'Abre el centro de ayuda'),
      ),
      { version: '' },
    );
    expect(diffSnapshots(base, desc)).toMatchObject({
      impact: 'patch',
      suggestedVersion: '1.0.1',
    });
    expect(diffSnapshots(base, base)).toMatchObject({
      impact: 'none',
      suggestedVersion: '1.0.0',
      changes: [],
    });
  });

  it('un selector reparado (el antiguo ya no existía) es patch', async () => {
    const pageOld = fakePage({});
    const pageNew = fakePage({ '#pay-now': { tag: 'button', text: 'Pagar' } });
    const a = await createSnapshot(parseWebMCP('#pay { webmcp-tool: "pagar"; }'), {
      page: pageOld,
      version: '1.0.0',
    });
    const b = await createSnapshot(parseWebMCP('#pay-now { webmcp-tool: "pagar"; }'), {
      page: pageNew,
      version: '',
    });
    const diff = diffSnapshots(a, b);
    expect(diff.changes[0]).toMatchObject({ kind: 'selector-changed', impact: 'patch' });
    expect(diff.suggestedVersion).toBe('1.0.1');
  });

  it('bumpVersion sube según el impacto', () => {
    expect(bumpVersion('1.2.3', 'major')).toBe('2.0.0');
    expect(bumpVersion('1.2.3', 'minor')).toBe('1.3.0');
    expect(bumpVersion('1.2.3', 'patch')).toBe('1.2.4');
    expect(bumpVersion('1.2.3', 'none')).toBe('1.2.3');
  });
});

describe('versioning · migración', () => {
  it('genera pasos y notas para agentes y aplica la migración al contrato antiguo', async () => {
    const a = await createSnapshot(v1, { version: '1.2.3' });
    const b = await createSnapshot(v2, { version: '2.0.0' });
    const plan = buildMigration(diffSnapshots(a, b));
    expect(plan.impact).toBe('major');
    expect(plan.steps.map((s) => s.action)).toEqual(
      expect.arrayContaining([
        'rename-tool',
        'drop-tool',
        'update-selector',
        'add-param',
        'note',
      ]),
    );
    expect(plan.agentNotes).toContain('# Migración WebMCP 1.2.3 → 2.0.0');
    expect(plan.agentNotes).toContain('"buscarProductos" en lugar de "buscar"');
    expect(plan.agentNotes).toMatch(/incompatibles/);
    const migrated = applyMigration(v1, plan, b);
    expect(Object.keys(migrated.tools).sort()).toEqual(['buscarProductos', 'pagar']);
    expect(migrated.tools.buscarProductos.selector).toBe('#search-btn');
    expect(migrated.tools.buscarProductos.params.categoria).toEqual({
      source: 'value',
      selector: '#cat',
    });
    expect(migrated.tools.pagar.selector).toBe('#pay-now');
    expect(Object.keys(migrated.context).sort()).toEqual(['precio', 'total']);
    expect(migrated.context.precio.format).toBe('number');
    // El contrato migrado coincide con el nuevo en tools y selectores.
    const again = diffSnapshots(await createSnapshot(migrated, { version: '2.0.0' }), b);
    expect(
      again.changes.filter(
        (c) => c.kind !== 'description-changed' && c.kind !== 'meta-changed',
      ),
    ).toEqual([]);
  });

  it('sin cambios, el plan indica que no hay nada que migrar', async () => {
    const a = await createSnapshot(v1, { version: '1.0.0' });
    const plan = buildMigration(diffSnapshots(a, a));
    expect(plan.steps).toEqual([]);
    expect(plan.agentNotes).toContain('Sin cambios');
    expect(serializeToolMap(applyMigration(v1, plan))).toBe(serializeToolMap(v1));
  });
});
