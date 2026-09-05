/**
 * Tests de Security-MCP (v1.0.0): inferencia de permisos, políticas,
 * autorización de agentes, auditoría, JWT HS256 sin dependencias y
 * resolución de identidad desde cabeceras.
 */
import { describe, expect, it } from 'vitest';
import { parseWebMCP } from '../src/parser';
import {
  agentFromHeaders,
  authorizeTool,
  createAgentToken,
  filterToolMapForAgent,
  inferPermissionLevel,
  policyFor,
  suggestPolicies,
  validateSecurity,
  verifyJwt,
  type AgentIdentity,
} from '../src/security';

const map = parseWebMCP(`
#search-btn { webmcp-tool: "buscar"; webmcp-description: "Busca productos"; webmcp-param-query: value(#q); }
#save { webmcp-tool: "guardarPerfil"; webmcp-description: "Guarda los cambios del perfil"; webmcp-param-nombre: value(#n); }
#pay { webmcp-tool: "pagarPedido"; webmcp-description: "Paga el pedido"; webmcp-permissions: "full"; webmcp-requires: "oauth"; webmcp-scope: "orders:pay"; webmcp-confirmation: "needed"; webmcp-rate-limit: "5/min"; }
#del { webmcp-tool: "eliminarCuenta"; webmcp-description: "Elimina la cuenta"; }
#sub { webmcp-tool: "suscribirse"; webmcp-description: "Alta en el boletín"; webmcp-payment: "required"; webmcp-permissions: "full"; webmcp-requires: "none"; }
#bad { webmcp-tool: "rara"; webmcp-description: "Permisos inválidos"; webmcp-permissions: "admin"; }
#low { webmcp-tool: "borrarTodo"; webmcp-description: "Borra todo"; webmcp-permissions: "read-only"; }
a[onclick="go()"] { webmcp-tool: "irInicio"; webmcp-description: "Ir a inicio"; }
`);

describe('security · inferencia y políticas', () => {
  it('inferPermissionLevel clasifica lectura, escritura y acciones destructivas', () => {
    expect(inferPermissionLevel('buscar', map.tools.buscar)).toBe('read-only');
    expect(inferPermissionLevel('irInicio', map.tools.irInicio)).toBe('read-only');
    expect(inferPermissionLevel('guardarPerfil', map.tools.guardarPerfil)).toBe(
      'restricted',
    );
    expect(inferPermissionLevel('eliminarCuenta', map.tools.eliminarCuenta)).toBe('full');
    expect(inferPermissionLevel('suscribirse', map.tools.suscribirse)).toBe('full'); // pago
    // Un campo rellenable sin verbo conocido es restricted; confirmación needed también.
    expect(
      inferPermissionLevel('x', {
        selector: '#x',
        params: { a: { source: 'value', selector: '#a' } },
      }),
    ).toBe('restricted');
    expect(
      inferPermissionLevel('x', {
        selector: '#x',
        params: {},
        meta: { confirmation: 'needed' },
      }),
    ).toBe('restricted');
    expect(inferPermissionLevel('x', { selector: '#x', params: {} })).toBe('read-only');
    // Nombres camelCase con acentos en la descripción.
    expect(
      inferPermissionLevel('verCatálogo', {
        selector: '#c',
        params: {},
        description: 'Ver el catálogo',
      }),
    ).toBe('read-only');
  });

  it('policyFor respeta lo declarado y normaliza requires/scopes/risk/rate-limit', () => {
    const pay = policyFor('pagarPedido', map.tools.pagarPedido);
    expect(pay).toMatchObject({
      permissions: 'full',
      requires: 'oauth',
      scopes: ['orders:pay'],
      risk: 'high',
      rateLimit: { count: 5, per: 'min' },
      inferred: false,
    });
    const search = policyFor('buscar', map.tools.buscar);
    expect(search).toMatchObject({
      permissions: 'read-only',
      requires: 'none',
      scopes: [],
      risk: 'low',
      inferred: true,
      rateLimit: undefined,
    });
    expect(policyFor('guardarPerfil', map.tools.guardarPerfil)).toMatchObject({
      requires: 'auth',
      risk: 'medium',
    });
    expect(policyFor('rara', map.tools.rara).permissions).toBe('read-only'); // inválido → inferido
    expect(
      policyFor('x', {
        selector: '#x',
        params: {},
        meta: { requires: 'magic', risk: 'extreme', 'rate-limit': '100/h' },
      }),
    ).toMatchObject({
      requires: 'auth',
      risk: 'low',
      rateLimit: { count: 100, per: 'hour' },
    });
  });
});

describe('security · autorización', () => {
  const anon = null;
  const reader: AgentIdentity = {
    id: 'r',
    level: 'read-only',
    authenticatedBy: 'session',
  };
  const writer: AgentIdentity = {
    id: 'w',
    level: 'restricted',
    authenticatedBy: 'jwt',
    scopes: ['profile:write'],
  };
  const admin: AgentIdentity = {
    id: 'a',
    level: 'full',
    authenticatedBy: 'oauth',
    scopes: ['orders:pay'],
  };
  const star: AgentIdentity = {
    id: 's',
    level: 'full',
    authenticatedBy: 'oauth',
    scopes: ['*'],
  };

  it('aplica nivel, mecanismo de autenticación y scopes', () => {
    expect(authorizeTool('buscar', map.tools.buscar, anon).allowed).toBe(true);
    const d1 = authorizeTool('guardarPerfil', map.tools.guardarPerfil, anon);
    expect(d1.allowed).toBe(false);
    expect(d1.reasons.join(' ')).toMatch(/requiere nivel restricted/);
    expect(d1.reasons.join(' ')).toMatch(/requiere autenticación/);
    expect(authorizeTool('guardarPerfil', map.tools.guardarPerfil, reader).allowed).toBe(
      false,
    );
    expect(authorizeTool('guardarPerfil', map.tools.guardarPerfil, writer).allowed).toBe(
      true,
    );
    const d2 = authorizeTool('pagarPedido', map.tools.pagarPedido, {
      ...admin,
      authenticatedBy: 'jwt',
    });
    expect(d2.allowed).toBe(false);
    expect(d2.reasons[0]).toMatch(/requiere oauth; el agente se autenticó con jwt/);
    const d3 = authorizeTool('pagarPedido', map.tools.pagarPedido, {
      ...admin,
      scopes: [],
    });
    expect(d3.reasons[0]).toMatch(/faltan scopes: orders:pay/);
    expect(authorizeTool('pagarPedido', map.tools.pagarPedido, admin)).toMatchObject({
      allowed: true,
      requiresConfirmation: true,
    });
    expect(authorizeTool('pagarPedido', map.tools.pagarPedido, star).allowed).toBe(true);
    expect(authorizeTool('buscar', map.tools.buscar, reader).requiresConfirmation).toBe(
      false,
    );
  });

  it('filterToolMapForAgent deja solo lo autorizado y conserva el contexto', () => {
    const withCtx = parseWebMCP('.p { webmcp-context: "precio"; }');
    const full = { tools: map.tools, context: withCtx.context };
    // La declaración del sitio manda (borrarTodo se declara read-only; la auditoría lo marca como subdeclarado).
    expect(Object.keys(filterToolMapForAgent(full, anon).tools).sort()).toEqual([
      'borrarTodo',
      'buscar',
      'irInicio',
      'rara',
    ]);
    expect(Object.keys(filterToolMapForAgent(full, anon).tools)).not.toContain(
      'suscribirse',
    ); // pago sin auth: requiere full
    expect(Object.keys(filterToolMapForAgent(full, writer).tools)).toContain(
      'guardarPerfil',
    );
    expect(Object.keys(filterToolMapForAgent(full, star).tools).length).toBe(
      Object.keys(map.tools).length,
    );
    expect(filterToolMapForAgent(full, anon).context.precio).toBeDefined();
  });
});

describe('security · auditoría', () => {
  it('validateSecurity detecta permisos inválidos, subdeclarados, sin confirmación, pago sin auth y handlers inline', () => {
    const report = validateSecurity(map);
    const codes = report.findings.map((f) => `${f.code}:${f.tool ?? ''}`);
    expect(codes).toContain('invalid-permissions:rara');
    expect(codes).toContain('underdeclared:borrarTodo');
    expect(codes).toContain('missing-permissions:guardarPerfil');
    expect(codes).toContain('missing-permissions:eliminarCuenta');
    expect(codes).not.toContain('missing-permissions:buscar'); // read-only inferido no se avisa
    expect(codes).toContain('full-without-confirmation:suscribirse');
    expect(codes).toContain('payment-without-auth:suscribirse');
    expect(codes).toContain('selector-inline-handler:irInicio');
    expect(codes).toContain('write-without-auth:suscribirse');
    expect(
      report.findings.filter((f) => f.severity === 'error').length,
    ).toBeGreaterThanOrEqual(3);
    expect(report.byLevel.full).toBeGreaterThanOrEqual(3);
    expect(report.score).toBeLessThan(60);
    expect(report.agent).toBeUndefined();
    expect(report.generatedBy).toMatch(/^webmcpcss@/);
  });

  it('un contrato bien declarado puntúa alto y con agente incluye decisiones', () => {
    // Las políticas sugeridas son un overlay completo y parseable.
    const good = parseWebMCP(suggestPolicies(map));
    for (const [name, tool] of Object.entries(good.tools))
      good.tools[name] = { ...tool, params: map.tools[name].params };
    const agent: AgentIdentity = {
      id: 'bot',
      level: 'full',
      authenticatedBy: 'oauth',
      scopes: ['*'],
    };
    const report = validateSecurity(good, agent);
    expect(
      report.findings.filter((f) => f.severity === 'error').map((f) => f.code),
    ).toEqual([]);
    expect(report.score).toBeGreaterThan(validateSecurity(map).score);
    expect(report.agent?.id).toBe('bot');
    expect(report.agent?.decisions.every((d) => d.allowed)).toBe(true);
    expect(
      report.agent?.decisions.find((d) => d.tool === 'pagarPedido')?.requiresConfirmation,
    ).toBe(true);
  });

  it('suggestPolicies genera CSS parseable con permisos, scopes y límites', () => {
    const css = suggestPolicies(map);
    expect(css).toContain('webmcpcss security');
    const parsed = parseWebMCP(css);
    expect(Object.keys(parsed.tools).sort()).toEqual(Object.keys(map.tools).sort());
    expect(parsed.tools.buscar.meta?.permissions).toBe('read-only');
    expect(parsed.tools.eliminarCuenta.meta).toMatchObject({
      permissions: 'full',
      confirmation: 'needed',
      'rate-limit': '5/min',
      risk: 'high',
    });
    expect(parsed.tools.eliminarCuenta.meta?.scope).toBe('eliminarcuenta:execute');
    expect(parsed.tools.guardarPerfil.meta?.scope).toBe('guardarperfil:write');
    // Corrige lo subdeclarado y el pago sin autenticación; respeta scopes/rate-limit declarados.
    expect(parsed.tools.borrarTodo.meta?.permissions).toBe('full');
    expect(parsed.tools.suscribirse.meta?.requires).toBe('oauth');
    expect(parsed.tools.pagarPedido.meta).toMatchObject({
      scope: 'orders:pay',
      'rate-limit': '5/min',
      requires: 'oauth',
    });
    expect(parsed.tools.rara.meta?.permissions).toBe('read-only');
    expect(parsed.tools.pagarPedido.description).toBe('Paga el pedido');
  });
});

describe('security · JWT y cabeceras', () => {
  const agent: AgentIdentity = {
    id: 'agent-7',
    level: 'restricted',
    scopes: ['profile:write'],
  };

  it('createAgentToken/verifyJwt firman y verifican HS256 con exp/iss/aud', () => {
    const token = createAgentToken(agent, 'secreto', {
      ttlSeconds: 60,
      issuer: 'tienda',
      audience: 'webmcp',
    });
    expect(token.split('.')).toHaveLength(3);
    expect(token.split('.')[0]).toBe(
      Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    );
    const ok = verifyJwt(token, 'secreto', { issuer: 'tienda', audience: 'webmcp' });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.agent).toEqual({
        id: 'agent-7',
        level: 'restricted',
        scopes: ['profile:write'],
        authenticatedBy: 'jwt',
      });
      expect(ok.claims.exp - ok.claims.iat).toBe(60);
      expect(ok.claims.jti).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(verifyJwt(token, 'otro')).toEqual({ ok: false, error: 'firma inválida' });
    expect(verifyJwt(token, 'secreto', { issuer: 'x' })).toEqual({
      ok: false,
      error: 'emisor inesperado',
    });
    expect(verifyJwt(token, 'secreto', { audience: 'x' })).toEqual({
      ok: false,
      error: 'audiencia inesperada',
    });
    expect(
      verifyJwt(token, 'secreto', { now: Math.floor(Date.now() / 1000) + 120 }),
    ).toEqual({ ok: false, error: 'token expirado' });
    expect(verifyJwt('a.b', 'secreto')).toEqual({ ok: false, error: 'formato inválido' });
    expect(verifyJwt('!!.!!.!!', 'secreto').ok).toBe(false);
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${token.split('.')[1]}.`;
    expect(verifyJwt(none, 'secreto')).toEqual({
      ok: false,
      error: 'algoritmo no soportado: none',
    });
    // Un nivel desconocido en las claims se degrada a read-only.
    const weird = createAgentToken(
      { id: 'z', level: 'god' as AgentIdentity['level'] },
      's',
    );
    const w = verifyJwt(weird, 's');
    expect(w.ok && w.agent.level).toBe('read-only');
  });

  it('agentFromHeaders resuelve Bearer JWT, cookie de sesión y cabeceras confiables (en ese orden)', () => {
    const token = createAgentToken(agent, 'secreto');
    expect(
      agentFromHeaders({ authorization: `Bearer ${token}` }, { secret: 'secreto' })?.id,
    ).toBe('agent-7');
    expect(
      agentFromHeaders({ authorization: `Bearer ${token}` }, { secret: 'otro' }),
    ).toBeNull();
    expect(agentFromHeaders({ authorization: `Bearer ${token}` })).toBeNull(); // sin secreto no se confía
    const bySession = agentFromHeaders(
      { cookie: 'sid=abc' },
      {
        sessionResolver: (c) =>
          c.includes('sid=abc') ? { id: 'u1', level: 'full' } : null,
      },
    );
    expect(bySession).toEqual({ id: 'u1', level: 'full', authenticatedBy: 'session' });
    expect(
      agentFromHeaders({ cookie: 'sid=zzz' }, { sessionResolver: () => null }),
    ).toBeNull();
    const trusted = agentFromHeaders(
      {
        'x-webmcp-agent': 'gw',
        'x-webmcp-level': 'restricted',
        'x-webmcp-scopes': 'a:b, c:d',
      },
      { trustHeaders: true },
    );
    expect(trusted).toEqual({
      id: 'gw',
      level: 'restricted',
      scopes: ['a:b', 'c:d'],
      authenticatedBy: 'oauth',
    });
    expect(
      agentFromHeaders(
        { 'x-webmcp-agent': 'gw', 'x-webmcp-level': 'root' },
        { trustHeaders: true },
      )?.level,
    ).toBe('read-only');
    expect(agentFromHeaders({ 'x-webmcp-agent': 'gw' })).toBeNull(); // sin trustHeaders se ignoran
    expect(agentFromHeaders({})).toBeNull();
  });
});
