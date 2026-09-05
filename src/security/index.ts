/**
 * Security-MCP (v1.0.0): permisos granulares por tool, autenticación de
 * agentes y auditoría de seguridad de un `.webmcp.css`.
 *
 * Propiedades reconocidas (se leen de `meta`):
 * - `webmcp-permissions: read-only | restricted | full` — nivel requerido.
 * - `webmcp-requires: auth | oauth | jwt | session | none` — mecanismo.
 * - `webmcp-scope: "orders:write products:read"` — scopes OAuth/JWT.
 * - `webmcp-risk: low | medium | high` — riesgo declarado (se infiere si falta).
 * - `webmcp-rate-limit: "10/min"` — límite de invocaciones.
 *
 * Un agente se describe con {@link AgentIdentity} (nivel concedido, scopes,
 * credenciales). `authorizeTool()` decide si puede invocar cada tool y
 * `validateSecurity()` audita el contrato completo (tools peligrosas sin
 * confirmación, permisos incoherentes, pagos sin autenticación…).
 *
 * `verifyJwt()` valida tokens HS256 con `node:crypto` (sin dependencias) y
 * `createAgentToken()` emite tokens para agentes registrados.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ToolMap, ToolSpec } from '../types';
import { VERSION } from '../version';

/** Nivel de permisos. */
export type PermissionLevel = 'read-only' | 'restricted' | 'full';

/** Mecanismo de autenticación requerido. */
export type AuthMechanism = 'none' | 'auth' | 'oauth' | 'jwt' | 'session';

/** Riesgo. */
export type RiskLevel = 'low' | 'medium' | 'high';

/** Identidad de un agente. */
export interface AgentIdentity {
  id: string;
  /** Nivel concedido. */
  level: PermissionLevel;
  /** Scopes concedidos (OAuth/JWT). */
  scopes?: string[];
  /** Cómo se autenticó. */
  authenticatedBy?: AuthMechanism;
  /** Metadatos libres (proveedor, versión…). */
  meta?: Record<string, string>;
}

/** Política de seguridad de una tool (normalizada). */
export interface ToolPolicy {
  tool: string;
  permissions: PermissionLevel;
  requires: AuthMechanism;
  scopes: string[];
  risk: RiskLevel;
  rateLimit?: { count: number; per: 'sec' | 'min' | 'hour' | 'day' };
  /** Si el nivel se infirió (no estaba declarado). */
  inferred: boolean;
}

/** Decisión de autorización. */
export interface AuthDecision {
  allowed: boolean;
  tool: string;
  reasons: string[];
  policy: ToolPolicy;
  /** Si se requiere confirmación humana antes de ejecutar. */
  requiresConfirmation: boolean;
}

/** Hallazgo de la auditoría. */
export interface SecurityFinding {
  severity: 'error' | 'warning' | 'info';
  tool?: string;
  code: string;
  message: string;
  fix?: string;
}

/** Informe de auditoría. */
export interface SecurityReport {
  generatedBy: string;
  policies: ToolPolicy[];
  findings: SecurityFinding[];
  /** Resumen por nivel. */
  byLevel: Record<PermissionLevel, number>;
  /** Puntuación 0-100. */
  score: number;
  /** Decisiones por tool si se pasó un agente. */
  agent?: { id: string; decisions: AuthDecision[] };
}

const LEVEL_ORDER: PermissionLevel[] = ['read-only', 'restricted', 'full'];
const DESTRUCTIVE =
  /eliminar|delete|borrar|remove|cancelar|cancel|pagar|pay|checkout|comprar|buy|transfer|enviar dinero|withdraw|retirar|cerrar cuenta|close account|desactivar|deactivate/i;
const WRITE =
  /\b(enviar|send|submit|guardar|save|crear|create|publicar|publish|actualizar|update|editar|edit|registrar|register|iniciar sesion|login|suscrib\w*|subscribe|anadir|agregar|add|reservar|book|modificar|subir|upload)\b/i;
const READ_ONLY =
  /\b(buscar|busca|search|find|filtrar|filter|ordenar|sort|ver|view|mostrar|show|navegar|navigate|ir a|go to|go|abrir|open|leer|read|consultar|listar|list|descargar|download)\b/i;

/**
 * Infiere el nivel de permisos de una tool por su nombre/descripción/
 * confirmación/pago cuando no está declarado.
 * @param name Nombre.
 * @param tool Tool.
 */
export function inferPermissionLevel(name: string, tool: ToolSpec): PermissionLevel {
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  const text = `${spaced} ${tool.description ?? ''}`
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (tool.meta?.payment === 'required' || DESTRUCTIVE.test(text)) return 'full';
  const needsConfirmation = tool.meta?.confirmation === 'needed';
  // Búsquedas, filtros y navegación son lecturas aunque rellenen un campo o
  // envíen un formulario (el selector de confirmación es una post-condición).
  if (!needsConfirmation && READ_ONLY.test(text) && !WRITE.test(text)) {
    return 'read-only';
  }
  if (
    needsConfirmation ||
    WRITE.test(text) ||
    tool.trigger?.event === 'submit' ||
    Object.values(tool.params ?? {}).some((p) => p.source === 'value')
  ) {
    return 'restricted';
  }
  return 'read-only';
}

/**
 * Normaliza la política de una tool.
 * @param name Nombre.
 * @param tool Tool.
 */
export function policyFor(name: string, tool: ToolSpec): ToolPolicy {
  const declared = tool.meta?.permissions as PermissionLevel | undefined;
  const permissions =
    declared && LEVEL_ORDER.includes(declared)
      ? declared
      : inferPermissionLevel(name, tool);
  const requiresRaw = (tool.meta?.requires ??
    (permissions === 'read-only' ? 'none' : 'auth')) as AuthMechanism;
  const requires: AuthMechanism = ['none', 'auth', 'oauth', 'jwt', 'session'].includes(
    requiresRaw,
  )
    ? requiresRaw
    : 'auth';
  const scopes = (tool.meta?.scope ?? tool.meta?.scopes ?? '')
    .split(/[\s,]+/)
    .filter(Boolean);
  const riskRaw = tool.meta?.risk as RiskLevel | undefined;
  const risk: RiskLevel =
    riskRaw && ['low', 'medium', 'high'].includes(riskRaw)
      ? riskRaw
      : permissions === 'full'
        ? 'high'
        : permissions === 'restricted'
          ? 'medium'
          : 'low';
  const rl = /^(\d+)\s*\/\s*(sec|s|min|m|hour|h|day|d)/i.exec(
    tool.meta?.['rate-limit'] ?? '',
  );
  const unitMap: Record<
    string,
    ToolPolicy['rateLimit'] extends infer R
      ? R extends { per: infer P }
        ? P
        : never
      : never
  > = {
    sec: 'sec',
    s: 'sec',
    min: 'min',
    m: 'min',
    hour: 'hour',
    h: 'hour',
    day: 'day',
    d: 'day',
  };
  return {
    tool: name,
    permissions,
    requires,
    scopes,
    risk,
    rateLimit: rl
      ? { count: Number(rl[1]), per: unitMap[rl[2].toLowerCase()] }
      : undefined,
    inferred: !declared,
  };
}

/**
 * Decide si un agente puede invocar una tool.
 * @param name Nombre de la tool.
 * @param tool Tool.
 * @param agent Agente (si es `null`, se evalúa como anónimo read-only).
 */
export function authorizeTool(
  name: string,
  tool: ToolSpec,
  agent: AgentIdentity | null,
): AuthDecision {
  const policy = policyFor(name, tool);
  const reasons: string[] = [];
  const who: AgentIdentity = agent ?? {
    id: 'anonymous',
    level: 'read-only',
    authenticatedBy: 'none',
  };
  if (LEVEL_ORDER.indexOf(who.level) < LEVEL_ORDER.indexOf(policy.permissions))
    reasons.push(`requiere nivel ${policy.permissions}; el agente tiene ${who.level}`);
  if (policy.requires !== 'none') {
    const by = who.authenticatedBy ?? 'none';
    if (by === 'none') reasons.push(`requiere autenticación (${policy.requires})`);
    else if (policy.requires !== 'auth' && by !== policy.requires)
      reasons.push(`requiere ${policy.requires}; el agente se autenticó con ${by}`);
  }
  const missing = policy.scopes.filter(
    (s) => !(who.scopes ?? []).includes(s) && !(who.scopes ?? []).includes('*'),
  );
  if (missing.length) reasons.push(`faltan scopes: ${missing.join(', ')}`);
  return {
    allowed: reasons.length === 0,
    tool: name,
    reasons,
    policy,
    requiresConfirmation:
      policy.permissions === 'full' ||
      tool.meta?.confirmation === 'needed' ||
      policy.risk === 'high',
  };
}

/**
 * Audita un tool map completo.
 * @param map Tool map.
 * @param agent Agente opcional para incluir decisiones.
 */
export function validateSecurity(
  map: ToolMap,
  agent?: AgentIdentity | null,
): SecurityReport {
  const policies: ToolPolicy[] = [];
  const findings: SecurityFinding[] = [];
  const byLevel: Record<PermissionLevel, number> = {
    'read-only': 0,
    restricted: 0,
    full: 0,
  };
  const decisions: AuthDecision[] = [];
  for (const [name, tool] of Object.entries(map.tools)) {
    const policy = policyFor(name, tool);
    policies.push(policy);
    byLevel[policy.permissions]++;
    const inferred = inferPermissionLevel(name, tool);
    const declared = tool.meta?.permissions;
    if (declared && !LEVEL_ORDER.includes(declared as PermissionLevel))
      findings.push({
        severity: 'error',
        tool: name,
        code: 'invalid-permissions',
        message: `webmcp-permissions: "${declared}" no es válido (read-only|restricted|full).`,
        fix: `webmcp-permissions: "${inferred}";`,
      });
    if (!declared && inferred !== 'read-only')
      findings.push({
        severity: 'warning',
        tool: name,
        code: 'missing-permissions',
        message: `"${name}" parece ${inferred} pero no declara webmcp-permissions.`,
        fix: `webmcp-permissions: "${inferred}";`,
      });
    if (declared === 'read-only' && inferred === 'full')
      findings.push({
        severity: 'error',
        tool: name,
        code: 'underdeclared',
        message: `"${name}" se declara read-only pero parece una acción destructiva o de pago.`,
        fix: 'webmcp-permissions: "full";',
      });
    if (
      policy.permissions === 'full' &&
      !tool.confirmation &&
      tool.meta?.confirmation !== 'needed'
    )
      findings.push({
        severity: 'warning',
        tool: name,
        code: 'full-without-confirmation',
        message: `"${name}" es full pero no declara confirmación.`,
        fix: 'webmcp-confirmation: "needed";',
      });
    if (tool.meta?.payment === 'required' && policy.requires === 'none')
      findings.push({
        severity: 'error',
        tool: name,
        code: 'payment-without-auth',
        message: `"${name}" exige pago pero no autenticación.`,
        fix: 'webmcp-requires: "jwt";',
      });
    if (policy.requires === 'none' && policy.permissions !== 'read-only')
      findings.push({
        severity: 'warning',
        tool: name,
        code: 'write-without-auth',
        message: `"${name}" (${policy.permissions}) no requiere autenticación.`,
        fix: 'webmcp-requires: "auth";',
      });
    if (
      (policy.requires === 'oauth' || policy.requires === 'jwt') &&
      policy.scopes.length === 0
    )
      findings.push({
        severity: 'info',
        tool: name,
        code: 'no-scopes',
        message: `"${name}" usa ${policy.requires} sin scopes declarados.`,
        fix: 'webmcp-scope: "recurso:accion";',
      });
    if (policy.permissions === 'full' && !policy.rateLimit)
      findings.push({
        severity: 'info',
        tool: name,
        code: 'no-rate-limit',
        message: `"${name}" (full) sin webmcp-rate-limit.`,
        fix: 'webmcp-rate-limit: "5/min";',
      });
    if (/\bon\w+=|javascript:/i.test(tool.selector))
      findings.push({
        severity: 'warning',
        tool: name,
        code: 'selector-inline-handler',
        message: `El selector de "${name}" depende de un manejador inline (frágil y difícil de auditar).`,
      });
    if (agent !== undefined) decisions.push(authorizeTool(name, tool, agent));
  }
  if (
    Object.keys(map.tools).length &&
    byLevel.full === 0 &&
    byLevel.restricted === 0 &&
    policies.every((p) => p.inferred)
  )
    findings.push({
      severity: 'info',
      code: 'all-inferred',
      message: 'Ninguna tool declara permisos; se infieren todos como read-only.',
    });
  const penalty = findings.reduce(
    (acc, f) => acc + (f.severity === 'error' ? 15 : f.severity === 'warning' ? 6 : 1),
    0,
  );
  const score = Math.max(0, 100 - Math.min(100, penalty));
  return {
    generatedBy: `webmcpcss@${VERSION}`,
    policies,
    findings,
    byLevel,
    score,
    agent: agent ? { id: agent.id, decisions } : undefined,
  };
}

/**
 * Filtra un tool map dejando solo las tools autorizadas para un agente
 * (para exponer un contrato reducido por sesión/rol).
 * @param map Tool map.
 * @param agent Agente.
 */
export function filterToolMapForAgent(
  map: ToolMap,
  agent: AgentIdentity | null,
): ToolMap {
  const out: ToolMap = { tools: {}, context: { ...map.context } };
  for (const [name, tool] of Object.entries(map.tools))
    if (authorizeTool(name, tool, agent).allowed) out.tools[name] = tool;
  return out;
}

// ---------------------------------------------------------------------------
// JWT HS256 sin dependencias
// ---------------------------------------------------------------------------

const b64url = (buf: Buffer | string) =>
  Buffer.from(buf)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
const fromB64url = (s: string) =>
  Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Claims de un token de agente. */
export interface AgentTokenClaims {
  sub: string;
  level: PermissionLevel;
  scopes?: string[];
  iss?: string;
  aud?: string;
  iat: number;
  exp: number;
  [k: string]: unknown;
}

/**
 * Emite un JWT HS256 para un agente.
 * @param agent Identidad.
 * @param secret Secreto compartido.
 * @param opts `ttlSeconds` (def. 3600), `issuer`, `audience`.
 */
export function createAgentToken(
  agent: AgentIdentity,
  secret: string,
  opts: { ttlSeconds?: number; issuer?: string; audience?: string } = {},
): string {
  const now = Math.floor(Date.now() / 1000);
  const claims: AgentTokenClaims = {
    sub: agent.id,
    level: agent.level,
    scopes: agent.scopes ?? [],
    iss: opts.issuer ?? 'webmcpcss',
    aud: opts.audience,
    iat: now,
    exp: now + (opts.ttlSeconds ?? 3600),
    jti: randomBytes(8).toString('hex'),
  };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = b64url(
    createHmac('sha256', secret).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${sig}`;
}

/**
 * Verifica un JWT HS256 y devuelve la identidad del agente.
 * @param token Token.
 * @param secret Secreto.
 * @param opts `issuer`/`audience` esperados, `now` (segundos) para tests.
 */
export function verifyJwt(
  token: string,
  secret: string,
  opts: { issuer?: string; audience?: string; now?: number } = {},
):
  | { ok: true; agent: AgentIdentity; claims: AgentTokenClaims }
  | { ok: false; error: string } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'formato inválido' };
  const [h, p, s] = parts;
  let header: { alg?: string };
  let claims: AgentTokenClaims;
  try {
    header = JSON.parse(fromB64url(h).toString('utf8'));
    claims = JSON.parse(fromB64url(p).toString('utf8'));
  } catch {
    return { ok: false, error: 'cabecera o payload ilegibles' };
  }
  if (header.alg !== 'HS256')
    return { ok: false, error: `algoritmo no soportado: ${header.alg}` };
  const expected = createHmac('sha256', secret).update(`${h}.${p}`).digest();
  const given = fromB64url(s);
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    return { ok: false, error: 'firma inválida' };
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp === 'number' && claims.exp < now)
    return { ok: false, error: 'token expirado' };
  if (opts.issuer && claims.iss !== opts.issuer)
    return { ok: false, error: 'emisor inesperado' };
  if (opts.audience && claims.aud !== opts.audience)
    return { ok: false, error: 'audiencia inesperada' };
  const level = LEVEL_ORDER.includes(claims.level) ? claims.level : 'read-only';
  return {
    ok: true,
    agent: {
      id: String(claims.sub),
      level,
      scopes: Array.isArray(claims.scopes) ? claims.scopes.map(String) : [],
      authenticatedBy: 'jwt',
    },
    claims,
  };
}

/**
 * Extrae la identidad de un agente de cabeceras HTTP: `Authorization: Bearer
 * <jwt>` (verificado con `secret`), `X-WebMCP-Agent` (id) y
 * `X-WebMCP-Level` (solo si hay `trustHeaders`, p. ej. tras un proxy OAuth).
 * @param headers Cabeceras (minúsculas).
 * @param opts Secreto JWT y confianza en cabeceras.
 */
export function agentFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  opts: {
    secret?: string;
    trustHeaders?: boolean;
    sessionResolver?: (cookie: string) => AgentIdentity | null;
  } = {},
): AgentIdentity | null {
  const auth = String(headers.authorization ?? '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m && opts.secret) {
    const v = verifyJwt(m[1].trim(), opts.secret);
    if (v.ok) return v.agent;
  }
  const cookie = String(headers.cookie ?? '');
  if (cookie && opts.sessionResolver) {
    const a = opts.sessionResolver(cookie);
    if (a) return { ...a, authenticatedBy: a.authenticatedBy ?? 'session' };
  }
  if (opts.trustHeaders) {
    const id = String(headers['x-webmcp-agent'] ?? '');
    const level = String(headers['x-webmcp-level'] ?? 'read-only') as PermissionLevel;
    if (id)
      return {
        id,
        level: LEVEL_ORDER.includes(level) ? level : 'read-only',
        scopes: String(headers['x-webmcp-scopes'] ?? '')
          .split(/[\s,]+/)
          .filter(Boolean),
        authenticatedBy: 'oauth',
      };
  }
  return null;
}

/**
 * Genera un `.webmcp.css` parcial con las políticas recomendadas (para
 * copiar/pegar) a partir de la auditoría.
 * @param map Tool map.
 */
export function suggestPolicies(map: ToolMap): string {
  const lines: string[] = [
    `/* Políticas de seguridad sugeridas por webmcpcss security (v${VERSION}) */`,
    '',
  ];
  for (const [name, tool] of Object.entries(map.tools)) {
    const p = policyFor(name, tool);
    // Si lo declarado es más laxo que lo inferido, se sugiere lo inferido.
    const inferred = inferPermissionLevel(name, tool);
    const permissions =
      LEVEL_ORDER.indexOf(inferred) > LEVEL_ORDER.indexOf(p.permissions)
        ? inferred
        : p.permissions;
    const paid = tool.meta?.payment === 'required';
    const requires: AuthMechanism =
      permissions === 'read-only' && !paid
        ? p.requires
        : p.requires === 'none'
          ? paid
            ? 'oauth'
            : 'auth'
          : p.requires;
    const risk: RiskLevel =
      permissions === 'full' ? 'high' : permissions === 'restricted' ? 'medium' : p.risk;
    lines.push(
      `${tool.selector} {`,
      `  webmcp-tool: "${name}";`,
      ...(tool.description
        ? [`  webmcp-description: "${tool.description.replace(/"/g, "'")}";`]
        : []),
      `  webmcp-permissions: "${permissions}";`,
      `  webmcp-requires: "${requires}";`,
    );
    if (permissions !== 'read-only')
      lines.push(
        `  webmcp-scope: "${p.scopes[0] ?? `${name.toLowerCase()}:${permissions === 'full' ? 'execute' : 'write'}`}";`,
      );
    if (permissions === 'full')
      lines.push(
        `  webmcp-confirmation: "needed";`,
        `  webmcp-rate-limit: "${p.rateLimit ? `${p.rateLimit.count}/${p.rateLimit.per}` : '5/min'}";`,
      );
    lines.push(`  webmcp-risk: "${risk}";`, '}', '');
  }
  return lines.join('\n');
}
