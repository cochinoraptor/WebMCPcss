/**
 * Verificador de identidad: ERC-8004 (EVM), registro Sui, pruebas ZK de
 * humanidad (World ID / Self.xyz vía verificador HTTP o inyectado) y caché
 * local con TTL para no golpear el RPC en cada acción.
 */
import {
  createChainAdapter,
  type AdapterFactoryOptions,
  type ChainAdapter,
} from '../chains';
import { TRUST_DEFAULTS } from '../config/defaults';
import type { AgentIdentity, ChainType, HumanProof } from '../types';

/** Verificador externo de pruebas de humanidad (inyectable). */
export type HumanProofVerifier = (
  proof: HumanProof,
) => Promise<{ valid: boolean; reason?: string }>;

/** Opciones del verificador. */
export interface IdentityVerifierOptions extends AdapterFactoryOptions {
  /** TTL de la caché (ms). */
  cacheTtlMs?: number;
  /** Reputación mínima aceptada (0–100) cuando hay feedback. */
  minReputation?: number;
  /** Fábrica de adaptadores (tests). */
  adapterFactory?: (chain: ChainType, network?: string) => ChainAdapter;
  /** Verificador de humanidad. Por defecto usa World ID Developer Portal si hay `WEBMCP_TRUST_WORLD_APP_ID`. */
  humanProofVerifier?: HumanProofVerifier;
  /** Reloj inyectable. */
  now?: () => number;
}

interface CacheEntry {
  identity: AgentIdentity;
  expiresAt: number;
}

/** Verificador de identidad con caché. */
export class IdentityVerifier {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly humanCache = new Map<string, number>();
  private readonly opts: IdentityVerifierOptions;

  constructor(opts: IdentityVerifierOptions = {}) {
    this.opts = opts;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Adaptador para una cadena/red. */
  adapter(chain: ChainType, network?: string): ChainAdapter {
    if (this.opts.adapterFactory) return this.opts.adapterFactory(chain, network);
    return createChainAdapter(chain, network, { ...this.opts, now: this.opts.now });
  }

  /**
   * Verifica la identidad on-chain de un agente.
   * @param agentId Identificador (`eip155:84532:0x…#12`, `#12`, dirección Sui…).
   * @param chain Familia de cadena.
   * @param options `network`, `skipCache`.
   */
  async verifyIdentity(
    agentId: string,
    chain: ChainType,
    options: { skipCache?: boolean; network?: string } = {},
  ): Promise<AgentIdentity | null> {
    const key = `${chain}:${options.network ?? ''}:${agentId.toLowerCase()}`;
    const ttl = this.opts.cacheTtlMs ?? TRUST_DEFAULTS.identityCacheTtlMs;
    if (!options.skipCache) {
      const hit = this.cache.get(key);
      if (hit && hit.expiresAt > this.now())
        return { ...hit.identity, method: hit.identity.method ?? 'cache' };
    }
    const identity = await this.adapter(chain, options.network).verifyIdentity(agentId);
    if (!identity) return null;
    const min = this.opts.minReputation ?? TRUST_DEFAULTS.minReputation;
    if (
      identity.verified &&
      identity.reputation !== undefined &&
      identity.feedbackCount &&
      identity.reputation < min
    ) {
      identity.verified = false;
      identity.reason = `reputación ${identity.reputation} por debajo del mínimo ${min}`;
    }
    if (ttl > 0) this.cache.set(key, { identity, expiresAt: this.now() + ttl });
    return identity;
  }

  /** Invalida la caché (toda o una entrada). */
  invalidate(agentId?: string): void {
    if (!agentId) {
      this.cache.clear();
      return;
    }
    for (const k of [...this.cache.keys()])
      if (k.endsWith(`:${agentId.toLowerCase()}`)) this.cache.delete(k);
  }

  /** Tamaño de la caché (tests/diagnóstico). */
  get cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Verifica una prueba de humanidad ZK. Cada `nullifierHash` válido se
   * recuerda hasta su expiración para no reverificar en cada acción.
   */
  async verifyHumanProof(
    proof: HumanProof,
  ): Promise<{ valid: boolean; reason?: string }> {
    const cached = this.humanCache.get(proof.nullifierHash);
    if (cached && cached > this.now()) return { valid: true };
    const verifier = this.opts.humanProofVerifier ?? defaultHumanProofVerifier();
    if (!verifier) {
      return {
        valid: false,
        reason:
          'sin verificador de humanidad configurado (define WEBMCP_TRUST_WORLD_APP_ID o inyecta humanProofVerifier)',
      };
    }
    const res = await verifier(proof);
    if (res.valid) {
      const ttl = proof.expiresAt ? proof.expiresAt * 1000 - this.now() : 24 * 3_600_000;
      this.humanCache.set(proof.nullifierHash, this.now() + Math.max(60_000, ttl));
    }
    return res;
  }
}

/**
 * Verificador de World ID (Developer Portal `POST /api/v2/verify/{app_id}`) si
 * hay `WEBMCP_TRUST_WORLD_APP_ID`; Self.xyz vía `WEBMCP_TRUST_SELF_VERIFIER_URL`.
 * Devuelve `null` si no hay ninguno configurado.
 */
export function defaultHumanProofVerifier(): HumanProofVerifier | null {
  const appId = process.env.WEBMCP_TRUST_WORLD_APP_ID;
  const selfUrl = process.env.WEBMCP_TRUST_SELF_VERIFIER_URL;
  if (!appId && !selfUrl) return null;
  return async (proof) => {
    const f = globalThis.fetch;
    if (!f) return { valid: false, reason: 'fetch no disponible' };
    try {
      if (proof.provider === 'self' || (!appId && selfUrl)) {
        const res = await f(selfUrl as string, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(proof),
        });
        const body = (await res.json()) as {
          status?: string;
          result?: boolean;
          valid?: boolean;
          message?: string;
        };
        const ok =
          body.valid === true || body.result === true || body.status === 'success';
        return ok
          ? { valid: true }
          : { valid: false, reason: body.message ?? `Self.xyz HTTP ${res.status}` };
      }
      let parsed: Record<string, unknown> = {};
      try {
        parsed = proof.proof ? (JSON.parse(proof.proof) as Record<string, unknown>) : {};
      } catch {
        parsed = { proof: proof.proof };
      }
      const res = await f(`https://developer.worldcoin.org/api/v2/verify/${appId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          nullifier_hash: proof.nullifierHash,
          merkle_root: proof.merkleRoot,
          proof: parsed.proof ?? proof.proof,
          verification_level: proof.level ?? 'orb',
          action: proof.action ?? process.env.WEBMCP_TRUST_WORLD_ACTION ?? 'webmcpcss',
          signal_hash: parsed.signal_hash,
        }),
      });
      if (res.ok) return { valid: true };
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        code?: string;
      };
      return {
        valid: false,
        reason: body.detail ?? body.code ?? `World ID HTTP ${res.status}`,
      };
    } catch (err) {
      return {
        valid: false,
        reason: `verificador de humanidad: ${(err as Error).message}`,
      };
    }
  };
}

/** Instancia compartida por defecto. */
let shared: IdentityVerifier | null = null;

/**
 * API funcional: verifica identidad con el verificador compartido.
 * @param agentId Identificador del agente.
 * @param chain Cadena.
 * @param options `skipCache`, `network`.
 */
export async function verifyIdentity(
  agentId: string,
  chain: ChainType,
  options?: { skipCache?: boolean; network?: string },
): Promise<AgentIdentity | null> {
  shared ??= new IdentityVerifier();
  return shared.verifyIdentity(agentId, chain, options);
}

/** Sustituye el verificador compartido (tests). */
export function setSharedIdentityVerifier(v: IdentityVerifier | null): void {
  shared = v;
}
