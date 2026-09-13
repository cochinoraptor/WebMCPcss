/**
 * Verificador de permisos: comprueba la firma de la clave de sesión, su
 * vigencia y anti-replay, que el firmante sea el dueño/operador/billetera del
 * agente (identidad), que la herramienta esté en el `scope`, y delega límites
 * de gasto y listas blancas en el motor de políticas.
 */
import type { ChainAdapter } from '../chains';
import { TRUST_DEFAULTS } from '../config/defaults';
import { keccak256Hex } from '../crypto/keccak';
import type {
  AgentIdentity,
  PermissionProof,
  TrustCheck,
  TrustPolicy,
  TrustVerificationResult,
} from '../types';
import { PolicyEngine, type PolicyDecision } from './policy-engine';

/** Registro de nonces usados (anti-replay). */
export interface NonceStore {
  has(nonce: string): Promise<boolean>;
  add(nonce: string, expiresAt: number): Promise<void>;
}

/** Nonces en memoria con purga por expiración. */
export class MemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  async has(nonce: string): Promise<boolean> {
    this.purge();
    return this.seen.has(nonce);
  }
  async add(nonce: string, expiresAt: number): Promise<void> {
    this.seen.set(nonce, expiresAt);
  }
  private purge(): void {
    const t = this.now();
    for (const [k, exp] of this.seen) if (exp * 1000 < t) this.seen.delete(k);
  }
}

/** Opciones del verificador. */
export interface PermissionVerifierOptions {
  engine?: PolicyEngine;
  nonces?: NonceStore;
  now?: () => number;
  /** Duración máxima aceptada de una prueba (s). */
  maxTtlSeconds?: number;
  /** Si `true`, cada nonce solo puede usarse una vez (por defecto la prueba es reutilizable hasta expirar). */
  singleUse?: boolean;
}

/** Contexto de una verificación. */
export interface PermissionContext {
  tool: string;
  policy: TrustPolicy;
  adapter: ChainAdapter;
  identity?: AgentIdentity | null;
  amount?: string;
  target?: string;
  origin?: string;
}

/** Hash estable de una prueba (para auditoría). */
export function proofHash(proof: PermissionProof): string {
  return keccak256Hex(
    `${proof.agentId}|${proof.signer}|${proof.nonce}|${proof.expiresAt}|${proof.signature}`,
  );
}

/** Verificador de permisos. */
export class PermissionVerifier {
  readonly engine: PolicyEngine;
  private readonly nonces: NonceStore;
  private readonly opts: PermissionVerifierOptions;

  constructor(opts: PermissionVerifierOptions = {}) {
    this.opts = opts;
    this.engine = opts.engine ?? new PolicyEngine({ now: opts.now });
    this.nonces = opts.nonces ?? new MemoryNonceStore(opts.now ?? (() => Date.now()));
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /**
   * Verifica una prueba frente a una política.
   * @returns Resultado con `checks` detallados y `commit` (vía `decision`) para consumir cuota.
   */
  async verifyPermission(
    proof: PermissionProof,
    ctx: PermissionContext,
  ): Promise<TrustVerificationResult & { decision?: PolicyDecision }> {
    const checks: TrustCheck[] = [];
    const nowS = Math.floor(this.now() / 1000);
    const deny = (code: string, reason: string): TrustVerificationResult => ({
      allowed: false,
      code,
      reason,
      identity: ctx.identity ?? undefined,
      checks: [...checks, { name: code, passed: false, detail: reason }],
    });

    // Vigencia
    if (proof.expiresAt <= nowS)
      return deny(
        'proof-expired',
        `la prueba expiró (${new Date(proof.expiresAt * 1000).toISOString()})`,
      );
    const maxTtl = this.opts.maxTtlSeconds ?? TRUST_DEFAULTS.maxProofTtlSeconds;
    if (proof.issuedAt && proof.issuedAt > nowS + 300)
      return deny('proof-not-yet-valid', 'issuedAt está en el futuro');
    if (proof.expiresAt - (proof.issuedAt ?? nowS) > maxTtl)
      return deny('proof-ttl-too-long', `la prueba dura más de ${maxTtl}s`);
    checks.push({
      name: 'expiry',
      passed: true,
      detail: `válida hasta ${new Date(proof.expiresAt * 1000).toISOString()}`,
    });

    // Anti-replay
    if (await this.nonces.has(proof.nonce))
      return deny('nonce-reused', 'nonce ya utilizado');
    checks.push({ name: 'nonce', passed: true });

    // Agente
    if (
      ctx.identity &&
      ctx.identity.agentId.toLowerCase() !== proof.agentId.toLowerCase() &&
      !sameAgent(ctx.identity.agentId, proof.agentId)
    )
      return deny(
        'agent-mismatch',
        `la prueba es del agente ${proof.agentId}, no de ${ctx.identity.agentId}`,
      );

    // Origen
    if (proof.origin && ctx.origin && !sameOrigin(proof.origin, ctx.origin))
      return deny('origin-mismatch', `la prueba está limitada a ${proof.origin}`);

    // Firma
    const sig = await ctx.adapter.verifyProofSignature(proof);
    if (!sig.valid) return deny('invalid-signature', sig.reason ?? 'firma inválida');
    checks.push({ name: 'signature', passed: true, detail: `firmada por ${sig.signer}` });

    // Firmante autorizado: owner, agentWallet, o una clave de sesión delegada por ellos.
    if (ctx.identity?.verified) {
      const allowedSigners = [ctx.identity.ownerAddress, ctx.identity.agentWallet]
        .filter(Boolean)
        .map((a) => (a as string).toLowerCase());
      const direct = allowedSigners.includes(proof.signer.toLowerCase());
      const delegated =
        sig.delegatedBy && allowedSigners.includes(sig.delegatedBy.toLowerCase());
      if (!direct && !delegated)
        return deny(
          'unauthorized-signer',
          sig.delegatedBy
            ? `${sig.delegatedBy} (delegador) no es el owner ni la billetera del agente`
            : `${proof.signer} no es el owner ni la billetera del agente (añade una delegación firmada por el owner)`,
        );
      checks.push({
        name: 'signer-authorized',
        passed: true,
        detail: delegated
          ? `clave de sesión delegada por ${sig.delegatedBy}`
          : 'owner/billetera del agente',
      });
    }

    // Scope
    const inScope =
      proof.scope.includes('*') ||
      proof.scope.map((s) => s.toLowerCase()).includes(ctx.tool.toLowerCase());
    if (!inScope)
      return deny(
        'out-of-scope',
        `la herramienta "${ctx.tool}" no está en el scope [${proof.scope.join(', ')}]`,
      );
    checks.push({ name: 'scope', passed: true });

    // Políticas (rate limit, gasto, lista blanca, horario)
    const decision = await this.engine.evaluate({
      agentId: proof.agentId,
      tool: ctx.tool,
      policy: ctx.policy,
      amount: ctx.amount,
      target: ctx.target,
      sessionMaxSpend: proof.maxSpend,
      sessionContracts: proof.allowedContracts,
      now: this.now(),
    });
    checks.push(...decision.checks);
    if (!decision.allowed)
      return {
        ...deny(decision.code ?? 'policy', decision.reason ?? 'política denegada'),
        checks,
        decision,
      };

    const commit = decision.commit;
    const wrapped: PolicyDecision = {
      ...decision,
      commit: async () => {
        await commit();
        if (this.opts.singleUse) await this.nonces.add(proof.nonce, proof.expiresAt);
      },
    };
    return {
      allowed: true,
      identity: ctx.identity ?? undefined,
      remainingLimit: decision.remainingLimit,
      checks,
      decision: wrapped,
    };
  }
}

/** ¿Dos identificadores apuntan al mismo agente (mismo registro y tokenId, o misma dirección)? */
export function sameAgent(a: string, b: string): boolean {
  const norm = (s: string): { reg: string; id: string } => {
    const m = /#(\d+)$/.exec(s.trim());
    if (m) {
      const reg = /(0x[0-9a-fA-F]{40})#/.exec(s)?.[1]?.toLowerCase() ?? '';
      return { reg, id: m[1] };
    }
    const bare = /^(\d+)$/.exec(s.trim());
    if (bare) return { reg: '', id: bare[1] };
    return {
      reg: '',
      id: s
        .toLowerCase()
        .replace(/^sui:[^:]+:/, '')
        .replace(/^eip155:[^:]+:/, ''),
    };
  };
  const x = norm(a);
  const y = norm(b);
  if (x.id !== y.id) return false;
  // Un identificador sin registro (`#12`) casa con cualquier registro del mismo tokenId.
  return !x.reg || !y.reg || x.reg === y.reg;
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
  }
}
