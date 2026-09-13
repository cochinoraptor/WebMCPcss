/**
 * Interfaz común de los adaptadores de cadena y utilidades compartidas
 * (cliente JSON-RPC/GraphQL con `fetch` nativo, reintentos y timeout).
 */
import { TRUST_DEFAULTS, type TrustNetwork } from '../config/defaults';
import type {
  AgentIdentity,
  AuditAction,
  ChainType,
  PermissionProof,
  Transaction,
  TransactionResult,
} from '../types';

/** Función `fetch` inyectable (tests). */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Opciones comunes de un adaptador. */
export interface ChainAdapterOptions {
  network: TrustNetwork;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Clave privada del agente/patrocinador (hex EVM o seed Ed25519 hex Sui). */
  privateKey?: string;
  /** Reloj inyectable (epoch ms). */
  now?: () => number;
}

/** Resultado de verificar una firma de permiso. */
export interface ProofSignatureCheck {
  valid: boolean;
  /** Dirección recuperada/derivada de la firma. */
  signer?: string;
  /** Owner/billetera que delegó en `signer` (si la prueba trae delegación válida). */
  delegatedBy?: string;
  reason?: string;
}

/** Contrato que cumplen todos los adaptadores. */
export interface ChainAdapter {
  readonly chain: ChainType;
  readonly network: TrustNetwork;
  /** Verifica la identidad de un agente en el registro de la cadena. */
  verifyIdentity(agentId: string): Promise<AgentIdentity | null>;
  /** Verifica la firma criptográfica de una prueba de permiso. */
  verifyProofSignature(proof: PermissionProof): Promise<ProofSignatureCheck>;
  /** Ejecuta una transacción sin gas (o en dry-run si no hay clave/firmas). */
  executeGasless(tx: Transaction): Promise<TransactionResult>;
  /** Saldo del token estable por defecto (o el indicado) en unidades legibles. */
  getBalance(
    address: string,
    token?: string,
  ): Promise<{ amount: number; currency: string }>;
  /** Límite de gasto on-chain (si la red tiene contrato de políticas), en texto legible. */
  getSpendingLimit(address: string): Promise<string>;
  /** Ancla una acción de auditoría en la cadena y devuelve su referencia. */
  registerAuditLog(action: AuditAction): Promise<string>;
  /** URL de explorador para un hash/digest. */
  explorerUrl(txHash: string): string | undefined;
}

/** Error de RPC con código. */
export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code?: number,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/**
 * POST JSON con timeout usando `fetch` (global en Node ≥ 18).
 * @param fetchImpl Implementación.
 * @param url URL.
 * @param body Cuerpo serializable.
 * @param timeoutMs Timeout.
 */
export async function postJson(
  fetchImpl: FetchLike | undefined,
  url: string,
  body: unknown,
  timeoutMs: number = TRUST_DEFAULTS.rpcTimeoutMs,
): Promise<unknown> {
  const f: FetchLike = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (!f) throw new Error('fetch no disponible: usa Node ≥ 18 o inyecta `fetch`.');
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : undefined;
  try {
    const res = await f(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl?.signal,
    });
    const text = await res.text();
    if (!res.ok)
      throw new RpcError(
        `HTTP ${res.status} de ${url}: ${text.slice(0, 200)}`,
        res.status,
      );
    try {
      return JSON.parse(text);
    } catch {
      throw new RpcError(`Respuesta no JSON de ${url}: ${text.slice(0, 120)}`);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Convierte unidades mínimas a número legible. */
export function fromUnits(units: bigint | string, decimals: number): number {
  const n = BigInt(units);
  const base = 10n ** BigInt(decimals);
  const whole = n / base;
  const frac = n % base;
  return Number(whole) + Number(frac) / Number(base);
}

/** Convierte un número legible a unidades mínimas (sin perder precisión decimal). */
export function toUnits(amount: number | string, decimals: number): bigint {
  const [w, f = ''] = String(amount).split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

/**
 * Parsea un `agentId`. Formatos aceptados:
 * - `eip155:<chainId>:<registry>#<tokenId>` (ERC-8004 completo)
 * - `<registry>#<tokenId>` o `#<tokenId>` / `<tokenId>` (registro de la red)
 * - `sui:<network>:<address>` o `<address Sui>` (32 bytes)
 */
export function parseAgentId(agentId: string): {
  namespace?: string;
  chainRef?: string;
  registry?: string;
  tokenId?: bigint;
  address?: string;
} {
  const s = agentId.trim();
  const full = /^(eip155|sui):([^:]+):(0x[0-9a-fA-F]+)(?:#(\d+))?$/.exec(s);
  if (full) {
    const out: ReturnType<typeof parseAgentId> = {
      namespace: full[1],
      chainRef: full[2],
    };
    if (full[1] === 'sui') out.address = full[3].toLowerCase();
    else {
      out.registry = full[3];
      if (full[4]) out.tokenId = BigInt(full[4]);
      else out.address = full[3];
    }
    return out;
  }
  const withRegistry = /^(0x[0-9a-fA-F]{40})#(\d+)$/.exec(s);
  if (withRegistry)
    return { registry: withRegistry[1], tokenId: BigInt(withRegistry[2]) };
  const onlyId = /^#?(\d+)$/.exec(s);
  if (onlyId) return { tokenId: BigInt(onlyId[1]) };
  if (/^0x[0-9a-fA-F]{64}$/.test(s))
    return { namespace: 'sui', address: s.toLowerCase() };
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { namespace: 'eip155', address: s };
  throw new Error(
    `agentId inválido: "${agentId}" (usa eip155:<chainId>:<registry>#<id>, <registry>#<id>, #<id> o una dirección Sui)`,
  );
}

/** Serializa una acción de auditoría de forma canónica (claves ordenadas). */
export function canonicalAudit(
  action: AuditAction & { prevHash?: string; id?: string },
): string {
  const keys = Object.keys(action).sort();
  const obj: Record<string, unknown> = {};
  for (const k of keys) {
    const v = (action as unknown as Record<string, unknown>)[k];
    if (v !== undefined) obj[k] = v;
  }
  return JSON.stringify(obj);
}
