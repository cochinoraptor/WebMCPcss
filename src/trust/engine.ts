/**
 * `TrustEngine`: orquesta el flujo completo de confianza para una herramienta:
 *
 * 1. Identidad (`IdentityVerifier`) según `policy.auth`.
 * 2. Prueba de humanidad si `policy.requiresHumanProof`.
 * 3. Permiso (`PermissionVerifier`): firma, scope, límites, lista blanca.
 * 4. Pago (`PaymentVerifier`) si `policy.payment !== 'none'`.
 * 5. Ejecución (gasless / sponsored) si el contexto trae `tx`, o la acción
 *    normal (`execute`) si no.
 * 6. Auditoría encadenada (`AuditLogger`).
 *
 * También emite/valida *tokens de confianza* (HMAC) para agentes REST que
 * verifican una vez y reutilizan el token en acciones siguientes.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import type { ToolMap } from '../types';
import {
  createChainAdapter,
  type AdapterFactoryOptions,
  type ChainAdapter,
} from './chains';
import { TRUST_DEFAULTS } from './config/defaults';
import { AuditLogger, GaslessExecutor, SponsoredExecutor } from './executors';
import { extractTrustPolicies, type TrustPolicyMap } from './parser/trust-parser';
import type {
  AgentIdentity,
  AuditEntry,
  ChainType,
  ExecutionContext,
  TransactionResult,
  TrustCheck,
  TrustPolicy,
  TrustToken,
  TrustVerificationResult,
} from './types';
import {
  IdentityVerifier,
  PaymentVerifier,
  PermissionVerifier,
  PolicyEngine,
  proofHash,
} from './verifier';

/** Ejecutor normal de una herramienta (Puppeteer u otro). */
export type NormalExecutor = (
  toolName: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

/** Opciones del engine. */
export interface TrustEngineOptions extends AdapterFactoryOptions {
  /** Políticas por herramienta (o un `ToolMap` del que extraerlas). */
  policies?: TrustPolicyMap | ToolMap;
  identity?: IdentityVerifier;
  permission?: PermissionVerifier;
  payment?: PaymentVerifier;
  audit?: AuditLogger;
  policyEngine?: PolicyEngine;
  gasless?: GaslessExecutor;
  sponsored?: SponsoredExecutor;
  /** Secreto para tokens de confianza (por defecto `WEBMCP_TRUST_SECRET` o aleatorio por proceso). */
  tokenSecret?: string;
  tokenTtlSeconds?: number;
  now?: () => number;
  adapterFactory?: (chain: ChainType, network?: string) => ChainAdapter;
}

/** Resultado de `executeTool`. */
export interface TrustedExecutionResult {
  ok: boolean;
  tool: string;
  /** `trusted` si pasó por la capa de confianza; `plain` si la tool no tiene política. */
  mode: 'trusted' | 'plain';
  verification?: TrustVerificationResult;
  transaction?: TransactionResult;
  result?: unknown;
  audit?: AuditEntry;
  error?: string;
}

/** Motor de confianza. */
export class TrustEngine {
  readonly policies: TrustPolicyMap;
  readonly identity: IdentityVerifier;
  readonly permission: PermissionVerifier;
  readonly payment: PaymentVerifier;
  readonly audit: AuditLogger;
  readonly policyEngine: PolicyEngine;
  readonly gasless: GaslessExecutor;
  readonly sponsored: SponsoredExecutor;
  private readonly opts: TrustEngineOptions;
  private readonly tokenSecret: string;

  constructor(opts: TrustEngineOptions = {}) {
    this.opts = opts;
    this.policies = isToolMap(opts.policies)
      ? extractTrustPolicies(opts.policies)
      : (opts.policies ?? {});
    const now = opts.now;
    const factory =
      opts.adapterFactory ??
      ((chain: ChainType, network?: string) =>
        createChainAdapter(chain, network, { ...opts, now }));
    this.policyEngine = opts.policyEngine ?? new PolicyEngine({ now });
    this.identity =
      opts.identity ?? new IdentityVerifier({ ...opts, adapterFactory: factory, now });
    this.permission =
      opts.permission ?? new PermissionVerifier({ engine: this.policyEngine, now });
    this.payment = opts.payment ?? new PaymentVerifier({ now });
    this.audit = opts.audit ?? new AuditLogger({ now });
    this.gasless =
      opts.gasless ?? new GaslessExecutor({ ...opts, adapterFactory: factory });
    this.sponsored =
      opts.sponsored ?? new SponsoredExecutor({ ...opts, adapterFactory: factory });
    this.tokenSecret =
      opts.tokenSecret ??
      process.env.WEBMCP_TRUST_SECRET ??
      randomBytes(32).toString('hex');
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Política de una herramienta (o `undefined`). */
  getTrustPolicy(tool: string): TrustPolicy | undefined {
    return this.policies[tool];
  }

  /** Adaptador para una política. */
  adapterFor(policy: TrustPolicy): ChainAdapter {
    return this.opts.adapterFactory
      ? this.opts.adapterFactory(policy.chain, policy.network)
      : createChainAdapter(policy.chain, policy.network, {
          ...this.opts,
          now: this.opts.now,
        });
  }

  /**
   * Verifica todo lo que exige la política de una herramienta SIN ejecutarla.
   * Devuelve el resultado y una función `commit` para consumir cuotas.
   */
  async verify(
    tool: string,
    ctx: ExecutionContext,
  ): Promise<
    TrustVerificationResult & { commit?: () => Promise<void>; paymentAmount?: string }
  > {
    const policy = this.getTrustPolicy(tool);
    if (!policy)
      return {
        allowed: true,
        code: 'no-policy',
        checks: [
          { name: 'policy', passed: true, detail: 'la herramienta no declara confianza' },
        ],
      };
    const checks: TrustCheck[] = [];
    const adapter = this.adapterFor(policy);
    let identity: AgentIdentity | null | undefined;

    // 0. Token de confianza previo (identidad + permiso ya verificados en esta sesión)
    if (ctx.trustToken && !ctx.proof) {
      const tk = this.verifyToken(ctx.trustToken, tool);
      if (!tk.valid)
        return {
          allowed: false,
          code: 'trust-token-invalid',
          reason: `token de confianza: ${tk.reason}`,
          checks,
        };
      checks.push({
        name: 'trust-token',
        passed: true,
        detail: `${tk.agentId} · scope [${(tk.scope ?? []).join(', ')}]`,
      });
      const decision = await this.policyEngine.evaluate({
        agentId: tk.agentId ?? 'anonymous',
        tool,
        policy,
        amount: ctx.amount ?? ctx.tx?.amount,
        target: ctx.target ?? ctx.tx?.contract ?? ctx.tx?.to,
        now: this.now(),
      });
      checks.push(...decision.checks);
      if (!decision.allowed)
        return { allowed: false, code: decision.code, reason: decision.reason, checks };
      let paymentAmount: string | undefined;
      if (policy.payment !== 'none') {
        const pay = await this.payment.verifyPayment(ctx.paymentProof, policy);
        checks.push(...pay.checks);
        if (!pay.valid)
          return { allowed: false, code: pay.code, reason: pay.reason, checks };
        paymentAmount = pay.amount;
      }
      return {
        allowed: true,
        remainingLimit: decision.remainingLimit,
        checks,
        commit: decision.commit,
        paymentAmount,
      };
    }

    // 1. Identidad
    const agentId = ctx.agentId ?? ctx.proof?.agentId;
    if (policy.auth !== 'none') {
      if (!agentId)
        return {
          allowed: false,
          code: 'agent-required',
          reason: 'falta agentId',
          checks,
        };
      if (policy.auth === 'erc8004') {
        identity = await this.identity.verifyIdentity(agentId, policy.chain, {
          network: policy.network,
        });
        if (!identity?.verified)
          return {
            allowed: false,
            code: 'identity-unverified',
            reason: identity?.reason ?? 'identidad del agente no verificada',
            identity: identity ?? undefined,
            checks,
          };
        checks.push({
          name: 'identity',
          passed: true,
          detail: `${identity.agentId} · owner ${identity.ownerAddress}${identity.reputation !== undefined ? ` · reputación ${identity.reputation}` : ''}`,
        });
      } else if (policy.auth === 'session-key') {
        // La identidad se acredita con la firma de la sesión (paso 3); resolvemos datos si existen.
        identity = await this.identity
          .verifyIdentity(agentId, policy.chain, { network: policy.network })
          .catch(() => null);
        checks.push({
          name: 'identity',
          passed: true,
          detail: 'session-key: se acredita por firma',
        });
      } else if (policy.auth === 'zk-proof') {
        if (!ctx.humanProof)
          return {
            allowed: false,
            code: 'human-proof-required',
            reason: 'la política exige una prueba ZK de humanidad',
            checks,
          };
        const hp = await this.identity.verifyHumanProof(ctx.humanProof);
        if (!hp.valid)
          return {
            allowed: false,
            code: 'human-proof-invalid',
            reason: hp.reason,
            checks,
          };
        checks.push({
          name: 'zk-proof',
          passed: true,
          detail: `${ctx.humanProof.provider} · ${ctx.humanProof.nullifierHash.slice(0, 10)}…`,
        });
      }
    }
    // 2. Humanidad adicional
    if (policy.requiresHumanProof && policy.auth !== 'zk-proof') {
      if (!ctx.humanProof)
        return {
          allowed: false,
          code: 'human-proof-required',
          reason: 'la política exige prueba de humanidad',
          identity: identity ?? undefined,
          checks,
        };
      const hp = await this.identity.verifyHumanProof(ctx.humanProof);
      if (!hp.valid)
        return {
          allowed: false,
          code: 'human-proof-invalid',
          reason: hp.reason,
          identity: identity ?? undefined,
          checks,
        };
      checks.push({ name: 'human-proof', passed: true });
    }
    // 3. Permiso (+ políticas)
    let commit: (() => Promise<void>) | undefined;
    let remainingLimit: string | undefined;
    // erc8004/session-key exigen prueba de permiso firmada; zk-proof se autentica
    // con la prueba de humanidad y solo aplica políticas (rate limit, gasto…).
    const needsProof = policy.auth === 'erc8004' || policy.auth === 'session-key';
    if (ctx.proof) {
      const res = await this.permission.verifyPermission(ctx.proof, {
        tool,
        policy,
        adapter,
        identity,
        amount: ctx.amount ?? ctx.tx?.amount,
        target: ctx.target ?? ctx.tx?.contract ?? ctx.tx?.to,
        origin: ctx.origin,
      });
      checks.push(...(res.checks ?? []));
      if (!res.allowed) return { ...res, checks, identity: identity ?? undefined };
      commit = res.decision?.commit;
      remainingLimit = res.remainingLimit;
      if (policy.auth === 'session-key' && !identity?.verified && identity) {
        identity = {
          ...identity,
          verified: true,
          method: 'session-key',
          reason: undefined,
        };
      }
    } else if (needsProof) {
      return {
        allowed: false,
        code: 'proof-required',
        reason: 'la herramienta exige una prueba de permiso firmada',
        identity: identity ?? undefined,
        checks,
      };
    } else {
      // Sin prueba: solo políticas (rate limit, gasto, horario) con el agentId o "anonymous".
      const decision = await this.policyEngine.evaluate({
        agentId: agentId ?? ctx.humanProof?.nullifierHash ?? 'anonymous',
        tool,
        policy,
        amount: ctx.amount ?? ctx.tx?.amount,
        target: ctx.target ?? ctx.tx?.contract ?? ctx.tx?.to,
        now: this.now(),
      });
      checks.push(...decision.checks);
      if (!decision.allowed)
        return { allowed: false, code: decision.code, reason: decision.reason, checks };
      commit = decision.commit;
      remainingLimit = decision.remainingLimit;
    }
    // 4. Pago
    let paymentAmount: string | undefined;
    if (policy.payment !== 'none') {
      const pay = await this.payment.verifyPayment(ctx.paymentProof, policy);
      checks.push(...pay.checks);
      if (!pay.valid)
        return {
          allowed: false,
          code: pay.code,
          reason: pay.reason,
          identity: identity ?? undefined,
          checks,
        };
      paymentAmount = pay.amount;
    }
    return {
      allowed: true,
      identity: identity ?? undefined,
      remainingLimit,
      checks,
      commit,
      paymentAmount,
    };
  }

  /**
   * Flujo completo: verifica, ejecuta (gasless/sponsored o normal) y audita.
   * @param tool Herramienta.
   * @param params Parámetros de la herramienta.
   * @param ctx Contexto de confianza.
   * @param execute Ejecutor normal (opcional).
   */
  async executeTool(
    tool: string,
    params: Record<string, unknown>,
    ctx: ExecutionContext = {},
    execute?: NormalExecutor,
  ): Promise<TrustedExecutionResult> {
    const policy = this.getTrustPolicy(tool);
    if (!policy) {
      if (!execute) return { ok: false, tool, mode: 'plain', error: 'sin ejecutor' };
      try {
        return { ok: true, tool, mode: 'plain', result: await execute(tool, params) };
      } catch (err) {
        return { ok: false, tool, mode: 'plain', error: (err as Error).message };
      }
    }
    const agentId =
      ctx.agentId ??
      ctx.proof?.agentId ??
      (ctx.trustToken ? this.verifyToken(ctx.trustToken).agentId : undefined) ??
      'anonymous';
    const verification = await this.verify(tool, ctx);
    if (!verification.allowed) {
      const audit = await this.audit.log({
        agentId,
        action: tool,
        result: 'denied',
        reason: verification.reason,
        chain: policy.chain,
        network: policy.network,
        proofHash: ctx.proof ? proofHash(ctx.proof) : undefined,
      });
      return {
        ok: false,
        tool,
        mode: 'trusted',
        verification,
        audit,
        error: `Permiso denegado: ${verification.reason}`,
      };
    }
    let transaction: TransactionResult | undefined;
    let result: unknown;
    let error: string | undefined;
    try {
      if (ctx.tx) {
        const tx = {
          ...ctx.tx,
          chain: ctx.tx.chain ?? policy.chain,
          network: ctx.tx.network ?? policy.network,
        };
        transaction =
          policy.payment === 'sponsored'
            ? await this.sponsored.execute(tx)
            : await this.gasless.execute(tx);
        if (!transaction.ok && transaction.mode !== 'dry-run') error = transaction.error;
      }
      if (execute && !error) result = await execute(tool, params);
    } catch (err) {
      error = (err as Error).message;
    }
    const ok = !error;
    if (ok && verification.commit) await verification.commit();
    const audit = await this.audit.log({
      agentId,
      action: tool,
      result: ok ? 'ok' : 'failed',
      reason: error,
      txHash: transaction?.txHash,
      amount: verification.paymentAmount ?? ctx.amount ?? ctx.tx?.amount,
      chain: policy.chain,
      network: transaction?.network ?? policy.network,
      proofHash: ctx.proof ? proofHash(ctx.proof) : undefined,
      meta: transaction?.mode ? { txMode: transaction.mode } : undefined,
    });
    return { ok, tool, mode: 'trusted', verification, transaction, result, audit, error };
  }

  /** Emite un token de confianza HMAC tras una verificación exitosa. */
  issueToken(
    agentId: string,
    scope: string[],
    ttlSeconds = this.opts.tokenTtlSeconds ?? TRUST_DEFAULTS.trustTokenTtlSeconds,
  ): TrustToken {
    const expiresAt = Math.floor(this.now() / 1000) + ttlSeconds;
    const payload = Buffer.from(JSON.stringify({ agentId, scope, expiresAt })).toString(
      'base64url',
    );
    const sig = createHmac('sha256', this.tokenSecret)
      .update(payload)
      .digest('base64url');
    return { token: `${payload}.${sig}`, agentId, scope, expiresAt };
  }

  /** Valida un token de confianza y comprueba que cubre la herramienta. */
  verifyToken(
    token: string,
    tool?: string,
  ): { valid: boolean; agentId?: string; scope?: string[]; reason?: string } {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return { valid: false, reason: 'formato inválido' };
    const expected = createHmac('sha256', this.tokenSecret)
      .update(payload)
      .digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return { valid: false, reason: 'firma inválida' };
    let data: TrustToken;
    try {
      data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TrustToken;
    } catch {
      return { valid: false, reason: 'carga inválida' };
    }
    if (data.expiresAt * 1000 < this.now())
      return { valid: false, reason: 'token expirado' };
    if (tool && !data.scope.includes('*') && !data.scope.includes(tool))
      return {
        valid: false,
        reason: `fuera de scope (${tool})`,
        agentId: data.agentId,
        scope: data.scope,
      };
    return { valid: true, agentId: data.agentId, scope: data.scope };
  }

  /** Resumen serializable de las políticas (para agentes y el script inyectado). */
  describePolicies(): Array<TrustPolicy & { tool: string }> {
    return Object.entries(this.policies).map(([tool, p]) => ({ tool, ...p }));
  }
}

function isToolMap(v: unknown): v is ToolMap {
  return Boolean(
    v &&
    typeof v === 'object' &&
    'tools' in (v as Record<string, unknown>) &&
    'context' in (v as Record<string, unknown>),
  );
}
