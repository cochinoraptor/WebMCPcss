/**
 * Tests de Recommender-MCP (v1.0.0): tokens/sinónimos, extracción de
 * parámetros, puntuación, historial, plan heurístico, refinado con LLM y
 * registro de resultados.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { parseWebMCP } from '../src/parser';
import type { LlmClient, LlmRequest } from '../src/prompt/types';
import {
  expandTokens,
  extractParams,
  historyByTool,
  recommend,
  recordOutcome,
  refineWithLlm,
  scoreTool,
} from '../src/recommender';
import {
  appendHistory,
  computeStats,
  readHistory,
  type HistoryEvent,
} from '../src/utils/history';

const map = parseWebMCP(`
#search-btn { webmcp-tool: "buscarProductos"; webmcp-description: "Busca productos en el catálogo"; webmcp-param-query: value(#q); }
#add { webmcp-tool: "anadirAlCarrito"; webmcp-description: "Añade el producto al carrito"; webmcp-param-cantidad: value(#qty); }
#checkout { webmcp-tool: "pagarPedido"; webmcp-description: "Paga el pedido del carrito"; webmcp-permissions: "full"; webmcp-confirmation: "#ok"; }
#login { webmcp-tool: "iniciarSesion"; webmcp-description: "Inicia sesión con email y contraseña"; webmcp-param-email: value(#email); webmcp-param-password: value(#pass); }
#contact { webmcp-tool: "enviarConsulta"; webmcp-description: "Envía un mensaje al soporte"; webmcp-param-mensaje: value(#msg); webmcp-param-email: value(#cemail); }
#del { webmcp-tool: "eliminarCuenta"; webmcp-description: "Elimina la cuenta de usuario"; }
.price { webmcp-context: "precioProducto"; webmcp-format: "currency"; }
.cart-count { webmcp-context: "articulosCarrito"; webmcp-format: "number"; }
`);

const llmReturning = (answer: string): LlmClient & { calls: LlmRequest[] } => {
  const calls: LlmRequest[] = [];
  return {
    provider: 'mock',
    model: 'mock',
    calls,
    complete: async (req: LlmRequest) => {
      calls.push(req);
      return answer;
    },
  } as LlmClient & { calls: LlmRequest[] };
};

describe('recommender · tokens, parámetros y puntuación', () => {
  it('expandTokens pliega acentos, quita stopwords y añade sinónimos ES/EN y raíces', () => {
    const t = expandTokens('Quiero comprar unas zapatillas rojas');
    expect(t.has('comprar')).toBe(true);
    expect(t.has('buy')).toBe(true);
    expect(t.has('zapat')).toBe(true); // raíz
    expect(t.has('quiero')).toBe(false); // stopword
    expect(t.has('unas')).toBe(false);
    // Raíces compartidas activan sinónimos ("paga" → grupo comprar) y las frases respetan límites de palabra.
    expect(expandTokens('paga el pedido').has('checkout')).toBe(true);
    expect(expandTokens('añadir al carrito').has('navegar')).toBe(false); // "ir a" ya no casa dentro de "añadir al"
    expect(expandTokens('completar el formulario').has('comprar')).toBe(false);
    expect(expandTokens('search for shoes').has('buscar')).toBe(true);
    expect(expandTokens('Añadir al carrito').has('anadir')).toBe(true);
  });

  it('extractParams saca comillas, emails, números y texto tras verbos', () => {
    expect(
      extractParams('busca "botas de agua" en la tienda', map.tools.buscarProductos),
    ).toEqual({ query: 'botas de agua' });
    expect(extractParams('buscar botas de agua', map.tools.buscarProductos)).toEqual({
      query: 'botas de agua',
    });
    expect(
      extractParams('inicia sesión con ana@test.com', map.tools.iniciarSesion),
    ).toEqual({ email: 'ana@test.com' });
    expect(
      extractParams('añade 3 unidades al carrito', map.tools.anadirAlCarrito),
    ).toEqual({ cantidad: '3' });
    const c = extractParams(
      'envía "hola, ¿tienen stock?" desde juan@x.io',
      map.tools.enviarConsulta,
    );
    expect(c).toEqual({ mensaje: 'hola, ¿tienen stock?', email: 'juan@x.io' });
    expect(extractParams('paga el pedido', map.tools.pagarPedido)).toEqual({});
  });

  it('scoreTool puntúa nombre > descripción > parámetros con motivos', () => {
    const goal = expandTokens('buscar zapatillas');
    const s = scoreTool('buscarProductos', map.tools.buscarProductos, goal);
    expect(s.score).toBeGreaterThan(0.3);
    expect(s.reasons[0]).toMatch(/el nombre coincide/);
    expect(scoreTool('eliminarCuenta', map.tools.eliminarCuenta, goal).score).toBe(0);
    const byParam = scoreTool(
      'x',
      { selector: '#x', params: { query: { source: 'value', selector: '#q' } } },
      goal,
    );
    expect(byParam.score).toBeGreaterThan(0);
    expect(byParam.reasons[0]).toMatch(/parámetros relacionados/);
  });

  it('historyByTool agrega ejecuciones/prompts y recomendaciones, filtrando por host', () => {
    const events: HistoryEvent[] = [
      { ts: '1', type: 'execute', url: 'https://a.test/x', tool: 't', ok: true },
      { ts: '2', type: 'prompt', url: 'https://a.test/y', tool: 't', ok: false },
      { ts: '3', type: 'execute', url: 'https://b.test', tool: 't', ok: false },
      { ts: '4', type: 'recommend', url: 'https://a.test', tool: 't', ok: true },
      { ts: '5', type: 'validate', url: 'https://a.test', ok: true },
    ];
    expect(historyByTool(events, 'https://a.test').get('t')).toEqual({
      runs: 2,
      ok: 1,
      failed: 1,
      successRate: 0.5,
      recommendedOk: 1,
    });
    expect(historyByTool(events).get('t')?.runs).toBe(3);
    expect(historyByTool(events, 'no-es-url').get('t')).toBeUndefined();
  });
});

describe('recommender · plan heurístico', () => {
  it('recomienda la tool correcta con parámetros y contexto útil, y penaliza acciones sensibles', async () => {
    const plan = await recommend('buscar "zapatillas rojas" y ver su precio', map, {
      history: [],
    });
    expect(plan.steps[0].tool).toBe('buscarProductos');
    expect(plan.steps[0].params).toEqual({ query: 'zapatillas rojas' });
    expect(plan.steps[0].missingParams).toEqual([]);
    expect(plan.steps.map((s) => s.tool)).not.toContain('eliminarCuenta');
    expect(plan.source).toBe('heuristic');
    expect(plan.confidence).toBeGreaterThan(0.3);
    expect(plan.explanation).toContain('buscarProductos');
    expect(plan.explanation).toContain('query="zapatillas rojas"');
    expect(plan.context[0].name).toBe('precioProducto');
    expect(plan.generatedBy).toMatch(/^webmcpcss@/);
  });

  it('un objetivo de compra prioriza carrito/pago, exige confirmación y antepone el login', async () => {
    const plan = await recommend(
      'inicia sesión y compra 2 unidades y paga el pedido',
      map,
      { history: [], maxSteps: 3 },
    );
    const names = plan.steps.map((s) => s.tool);
    expect(names[0]).toBe('iniciarSesion');
    expect(names).toContain('pagarPedido');
    expect(plan.steps.find((s) => s.tool === 'pagarPedido')?.requiresConfirmation).toBe(
      true,
    );
    expect(plan.steps.find((s) => s.tool === 'iniciarSesion')?.missingParams).toEqual([
      'email',
      'password',
    ]);
    expect(plan.explanation).toMatch(/faltan: email, password/);
    expect(plan.steps.length).toBeLessThanOrEqual(3);
  });

  it('sin coincidencias devuelve plan vacío con explicación y alternativas vacías', async () => {
    const plan = await recommend('xyzzy plugh', map, { history: [] });
    expect(plan.steps).toEqual([]);
    expect(plan.alternatives).toEqual([]);
    expect(plan.confidence).toBe(0);
    expect(plan.explanation).toMatch(/No encontré tools adecuadas/);
  });

  it('el historial ajusta la puntuación (éxitos suben, fallos bajan) por host', async () => {
    const bad: HistoryEvent[] = [1, 2, 3, 4].map((i) => ({
      ts: String(i),
      type: 'execute',
      url: 'https://shop.test',
      tool: 'buscarProductos',
      ok: false,
    }));
    const good: HistoryEvent[] = [1, 2, 3, 4].map((i) => ({
      ts: String(i),
      type: 'execute',
      url: 'https://shop.test',
      tool: 'buscarProductos',
      ok: true,
    }));
    const base = await recommend('buscar botas', map, { history: [] });
    const worse = await recommend('buscar botas', map, {
      history: bad,
      url: 'https://shop.test',
    });
    const better = await recommend('buscar botas', map, {
      history: good,
      url: 'https://shop.test',
    });
    const other = await recommend('buscar botas', map, {
      history: bad,
      url: 'https://other.test',
    });
    expect(worse.steps[0].score).toBeLessThan(base.steps[0].score);
    expect(better.steps[0].score).toBeGreaterThan(worse.steps[0].score);
    expect(better.steps[0].history).toEqual({
      runs: 4,
      ok: 4,
      failed: 0,
      successRate: 1,
    });
    expect(better.steps[0].reasons.join(' ')).toMatch(/historial: 4\/4/);
    expect(other.steps[0].score).toBe(base.steps[0].score);
  });
});

describe('recommender · LLM, registro e historial', () => {
  it('refineWithLlm reordena/filtra pasos válidos, completa parámetros y marca la fuente', async () => {
    const llm = llmReturning(
      '{"steps":[{"tool":"anadirAlCarrito","params":{"cantidad":"2"},"why":"primero al carrito"},{"tool":"pagarPedido"},{"tool":"noExiste"}],"confidence":0.9}',
    );
    const plan = await recommend('compra 2 botas', map, { history: [], llm });
    expect(plan.source).toBe('llm');
    expect(plan.confidence).toBe(0.9);
    expect(plan.steps.map((s) => s.tool)).toEqual(['anadirAlCarrito', 'pagarPedido']);
    expect(plan.steps[0].params).toEqual({ cantidad: '2' });
    expect(plan.steps[0].reasons.at(-1)).toBe('LLM: primero al carrito');
    expect(plan.steps.every((s) => s.score >= 0.6)).toBe(true);
    expect(plan.alternatives.map((a) => a.tool)).not.toContain('pagarPedido');
    expect(llm.calls[0].json).toBe(true);
    expect(
      JSON.parse(llm.calls[0].user).tools.map((t: { name: string }) => t.name),
    ).toContain('buscarProductos');
  });

  it('con respuesta inválida, tools desconocidas o error el plan heurístico se conserva', async () => {
    const heuristic = await recommend('buscar botas', map, { history: [] });
    for (const answer of ['no es json', '{"steps":[{"tool":"nada"}]}', '{"steps":[]}']) {
      const plan = await refineWithLlm(heuristic, map, llmReturning(answer));
      expect(plan.source).toBe('heuristic');
      expect(plan.steps).toEqual(heuristic.steps);
    }
    const failing: LlmClient = {
      provider: 'mock',
      model: 'mock',
      complete: async () => {
        throw new Error('boom');
      },
    };
    expect((await refineWithLlm(heuristic, map, failing)).source).toBe('heuristic');
  });

  it('record/recordOutcome escriben en el historial y computeStats los agrega', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-rec-'));
    const file = path.join(dir, 'nested', 'history.json');
    expect(readHistory(file)).toEqual([]);
    const plan = await recommend('buscar botas', map, {
      history: [],
      record: true,
      historyFile: file,
      url: 'https://shop.test',
    });
    const events = readHistory(file);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'recommend',
      tool: 'buscarProductos',
      ok: true,
      url: 'https://shop.test',
    });
    expect(events[0].ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    recordOutcome(plan, false, file);
    expect(readHistory(file)).toHaveLength(1 + plan.steps.length);
    expect(plan.steps.map((s) => s.tool)).toEqual(['buscarProductos']); // "enviarConsulta" no se cuela por "consulta"≈"consultar"
    appendHistory({ type: 'execute', tool: 'buscarProductos', ok: true }, file);
    appendHistory({ type: 'payment', tool: 'pagarPedido', ok: true }, file);
    const stats = computeStats(readHistory(file));
    expect(stats.total).toBe(4);
    expect(stats.executions).toEqual({ total: 1, ok: 1, failed: 0 });
    expect(stats.recommendations).toEqual({ total: 2, ok: 1, failed: 1 });
    expect(stats.payments).toEqual({ total: 1, ok: 1, failed: 0 });
    // Las recomendaciones exitosas previas suben la puntuación (bonus).
    const again = await recommend('buscar botas', map, {
      historyFile: file,
      url: 'https://shop.test',
    });
    expect(again.steps[0].reasons.join(' ')).toMatch(/recomendada con éxito/);
    // Un archivo corrupto se trata como vacío.
    fs.writeFileSync(file, '{corrupto');
    expect(readHistory(file)).toEqual([]);
  });
});
