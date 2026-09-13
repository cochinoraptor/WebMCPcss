/**
 * Validación de esquemas de confianza sin dependencias: normaliza y valida
 * `TrustPolicy`, `PermissionProof`, `HumanProof` y `Transaction` que llegan
 * desde CSS, JSON (MCP/REST) o CLI. Cada función devuelve el valor normalizado
 * o lanza `TrustSchemaError` con la ruta del campo problemático.
 */
import type {
  AuthType,
  ChainType,
  HumanProof,
  PaymentType,
  PermissionProof,
  RateLimit,
  SpendingLimit,
  Transaction,
  TrustPolicy,
} from '../types';

/** Error de validación con la ruta del campo. */
export class TrustSchemaError extends Error {
  constructor(
    public readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'TrustSchemaError';
  }
}

export const AUTH_TYPES: AuthType[] = ['erc8004', 'zk-proof', 'session-key', 'none'];
export const PAYMENT_TYPES: PaymentType[] = ['x402', 'eip3009', 'sponsored', 'none'];
export const CHAIN_TYPES: ChainType[] = ['sui', 'evm', 'base', 'skale'];

const WINDOW_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

const WINDOW_ALIASES: Record<string, string> = {
  s: 'second',
  sec: 'second',
  second: 'second',
  seconds: 'second',
  m: 'minute',
  min: 'minute',
  minute: 'minute',
  minutes: 'minute',
  minuto: 'minute',
  minutos: 'minute',
  h: 'hour',
  hr: 'hour',
  hour: 'hour',
  hours: 'hour',
  hora: 'hour',
  horas: 'hour',
  d: 'day',
  day: 'day',
  days: 'day',
  daily: 'day',
  dia: 'day',
  día: 'day',
  dias: 'day',
  días: 'day',
  w: 'week',
  week: 'week',
  weekly: 'week',
  semana: 'week',
  month: 'month',
  monthly: 'month',
  mes: 'month',
  tx: 'tx',
  transaction: 'tx',
  action: 'tx',
  total: 'total',
  session: 'total',
};

/**
 * Parsea un límite de gasto: `"100 USDC/day"`, `"0.5 USDC per tx"`, `"20 USDC"` (= total).
 * @param raw Texto.
 */
export function parseSpendingLimit(raw: string | undefined): SpendingLimit | undefined {
  if (!raw) return undefined;
  const m =
    /^\s*([\d.]+)\s*([A-Za-z]{2,8})?\s*(?:\/|per|por|cada)?\s*([A-Za-zíá]+)?\s*$/i.exec(
      raw,
    );
  if (!m || !Number.isFinite(Number(m[1])))
    throw new TrustSchemaError(
      'spendingLimit',
      `formato inválido: "${raw}" (ej. "100 USDC/day")`,
    );
  const perRaw = (m[3] ?? 'total').toLowerCase();
  const per = WINDOW_ALIASES[perRaw];
  if (!per) throw new TrustSchemaError('spendingLimit', `ventana desconocida: "${m[3]}"`);
  return {
    amount: Number(m[1]),
    currency: (m[2] ?? 'USDC').toUpperCase(),
    per: per as SpendingLimit['per'],
    windowMs: WINDOW_MS[per] ?? 0,
  };
}

/**
 * Parsea un límite de frecuencia: `"5 actions/minute"`, `"10/min"`, `"100 per hour"`.
 * @param raw Texto.
 */
export function parseRateLimit(raw: string | undefined): RateLimit | undefined {
  if (!raw) return undefined;
  const m =
    /^\s*(\d+)\s*(?:actions?|acciones|calls?|req(?:uests)?)?\s*(?:\/|per|por|cada)\s*(\d+)?\s*([A-Za-z]+)\s*$/i.exec(
      raw,
    );
  if (!m)
    throw new TrustSchemaError(
      'rateLimit',
      `formato inválido: "${raw}" (ej. "5 actions/minute")`,
    );
  const per = WINDOW_ALIASES[m[3].toLowerCase()];
  if (!per || !WINDOW_MS[per] || per === 'week' || per === 'month')
    throw new TrustSchemaError('rateLimit', `ventana no soportada: "${m[3]}"`);
  const mult = m[2] ? Number(m[2]) : 1;
  return {
    count: Number(m[1]),
    per: per as RateLimit['per'],
    windowMs: WINDOW_MS[per] * mult,
  };
}

/** Parsea una lista separada por comas/espacios (minúsculas, sin vacíos). */
export function parseList(raw: string | string[] | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const items = (Array.isArray(raw) ? raw : raw.split(/[\s,]+/))
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return items.length ? items : undefined;
}

/** Parsea un booleano CSS/JSON (`true`, `"yes"`, `1`, `"required"`). */
export function parseBool(raw: unknown): boolean | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw === 'boolean') return raw;
  const s = String(raw).trim().toLowerCase();
  if (['true', 'yes', 'si', 'sí', '1', 'required', 'needed', 'on'].includes(s))
    return true;
  if (['false', 'no', '0', 'none', 'off'].includes(s)) return false;
  throw new TrustSchemaError('boolean', `valor booleano inválido: "${String(raw)}"`);
}

function oneOf<T extends string>(
  path: string,
  value: unknown,
  allowed: T[],
  fallback: T,
): T {
  if (value === undefined || value === null || value === '') return fallback;
  const v = String(value).trim().toLowerCase() as T;
  if (!allowed.includes(v))
    throw new TrustSchemaError(
      path,
      `"${String(value)}" no es válido (${allowed.join(' | ')})`,
    );
  return v;
}

/**
 * Valida y normaliza una política de confianza parcial.
 * @param input Objeto con claves de `TrustPolicy` (valores como texto o tipados).
 */
export function validateTrustPolicy(input: Record<string, unknown>): TrustPolicy {
  const chain = oneOf<ChainType>('chain', input.chain, CHAIN_TYPES, 'sui');
  const policy: TrustPolicy = {
    auth: oneOf<AuthType>('auth', input.auth, AUTH_TYPES, 'none'),
    payment: oneOf<PaymentType>('payment', input.payment, PAYMENT_TYPES, 'none'),
    chain,
  };
  if (input.network) policy.network = String(input.network).trim().toLowerCase();
  if (input.spendingLimit) {
    parseSpendingLimit(String(input.spendingLimit));
    policy.spendingLimit = String(input.spendingLimit).trim();
  }
  if (input.rateLimit) {
    parseRateLimit(String(input.rateLimit));
    policy.rateLimit = String(input.rateLimit).trim();
  }
  const contracts = parseList(input.allowedContracts as string | string[] | undefined);
  if (contracts) {
    for (const c of contracts) {
      const okEvm = /^0x[0-9a-f]{40}$/.test(c);
      const okSui = /^0x[0-9a-f]{1,64}(::[a-z_][a-z0-9_]*){0,2}$/.test(c);
      if (!okEvm && !okSui)
        throw new TrustSchemaError(
          'allowedContracts',
          `"${c}" no es una dirección EVM ni un paquete Sui`,
        );
    }
    policy.allowedContracts = contracts;
  }
  const human = parseBool(input.requiresHumanProof);
  if (human !== undefined) policy.requiresHumanProof = human;
  if (input.allowedHours) {
    const s = String(input.allowedHours).trim();
    if (!/^\d{1,2}(:\d{2})?\s*-\s*\d{1,2}(:\d{2})?$/.test(s))
      throw new TrustSchemaError(
        'allowedHours',
        `formato inválido: "${s}" (ej. "09:00-18:00")`,
      );
    policy.allowedHours = s.replace(/\s+/g, '');
  }
  if (input.identityRegistry) {
    const r = String(input.identityRegistry).trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(r))
      throw new TrustSchemaError('identityRegistry', `dirección inválida: "${r}"`);
    policy.identityRegistry = r;
  }
  if (input.payTo) policy.payTo = String(input.payTo).trim();
  if (input.amount) policy.amount = String(input.amount).trim();
  return policy;
}

/**
 * Valida una prueba de permiso recibida como JSON.
 * @param input Objeto.
 */
export function validatePermissionProof(input: unknown): PermissionProof {
  if (!input || typeof input !== 'object')
    throw new TrustSchemaError('proof', 'debe ser un objeto');
  const p = input as Record<string, unknown>;
  const req = (k: string): string => {
    if (typeof p[k] !== 'string' || !(p[k] as string).trim())
      throw new TrustSchemaError(`proof.${k}`, 'requerido');
    return (p[k] as string).trim();
  };
  const expiresAt = Number(p.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0)
    throw new TrustSchemaError('proof.expiresAt', 'debe ser un timestamp (segundos)');
  const scope = parseList(p.scope as string | string[] | undefined);
  if (!scope)
    throw new TrustSchemaError('proof.scope', 'requerido (lista de herramientas o "*")');
  const proof: PermissionProof = {
    signature: req('signature'),
    nonce: req('nonce'),
    expiresAt: Math.floor(expiresAt),
    scope,
    agentId: req('agentId'),
    signer: req('signer'),
  };
  if (p.issuedAt !== undefined) proof.issuedAt = Math.floor(Number(p.issuedAt));
  if (p.maxSpend) {
    parseSpendingLimit(String(p.maxSpend));
    proof.maxSpend = String(p.maxSpend);
  }
  const contracts = parseList(p.allowedContracts as string | string[] | undefined);
  if (contracts) proof.allowedContracts = contracts;
  if (p.origin) proof.origin = String(p.origin);
  if (p.chain) proof.chain = oneOf<ChainType>('proof.chain', p.chain, CHAIN_TYPES, 'evm');
  if (p.chainId !== undefined) proof.chainId = Number(p.chainId);
  if (p.delegation) {
    const d = p.delegation as Record<string, unknown>;
    const reqD = (k: string): string => {
      if (typeof d[k] !== 'string' || !(d[k] as string).trim())
        throw new TrustSchemaError(`proof.delegation.${k}`, 'requerido');
      return (d[k] as string).trim();
    };
    const dExp = Number(d.expiresAt);
    if (!Number.isFinite(dExp) || dExp <= 0)
      throw new TrustSchemaError(
        'proof.delegation.expiresAt',
        'debe ser un timestamp (segundos)',
      );
    proof.delegation = {
      delegate: reqD('delegate'),
      delegator: reqD('delegator'),
      expiresAt: Math.floor(dExp),
      scope: parseList(d.scope as string | string[] | undefined),
      signature: reqD('signature'),
    };
    if (proof.delegation.delegate.toLowerCase() !== proof.signer.toLowerCase())
      throw new TrustSchemaError(
        'proof.delegation.delegate',
        'debe coincidir con proof.signer',
      );
  }
  return proof;
}

/** Valida una prueba de humanidad. */
export function validateHumanProof(input: unknown): HumanProof {
  if (!input || typeof input !== 'object')
    throw new TrustSchemaError('humanProof', 'debe ser un objeto');
  const p = input as Record<string, unknown>;
  const provider = oneOf<HumanProof['provider']>(
    'humanProof.provider',
    p.provider,
    ['worldid', 'self', 'custom'],
    'custom',
  );
  const nullifierHash = String(p.nullifierHash ?? p.nullifier_hash ?? '').trim();
  if (!nullifierHash) throw new TrustSchemaError('humanProof.nullifierHash', 'requerido');
  const out: HumanProof = { provider, nullifierHash };
  if (p.proof)
    out.proof = typeof p.proof === 'string' ? p.proof : JSON.stringify(p.proof);
  if (p.merkleRoot ?? p.merkle_root)
    out.merkleRoot = String(p.merkleRoot ?? p.merkle_root);
  if (p.level ?? p.verification_level)
    out.level = String(p.level ?? p.verification_level);
  if (p.action) out.action = String(p.action);
  if (p.expiresAt !== undefined) out.expiresAt = Number(p.expiresAt);
  return out;
}

/** Valida una transacción abstracta. */
export function validateTransaction(input: unknown): Transaction {
  if (!input || typeof input !== 'object')
    throw new TrustSchemaError('tx', 'debe ser un objeto');
  const t = input as Record<string, unknown>;
  const chain = oneOf<ChainType>('tx.chain', t.chain, CHAIN_TYPES, 'sui');
  const kind = oneOf<Transaction['kind']>(
    'tx.kind',
    t.kind,
    ['transfer', 'call', 'raw'],
    'transfer',
  );
  const tx: Transaction = { chain, kind };
  for (const k of [
    'network',
    'from',
    'to',
    'amount',
    'token',
    'contract',
    'data',
    'raw',
    'memo',
  ] as const) {
    if (t[k] !== undefined && t[k] !== null) tx[k] = String(t[k]);
  }
  if (Array.isArray(t.args)) tx.args = t.args;
  if (Array.isArray(t.signatures)) tx.signatures = t.signatures.map(String);
  if (kind === 'transfer') {
    if (!tx.to) throw new TrustSchemaError('tx.to', 'requerido en una transferencia');
    if (!tx.amount) throw new TrustSchemaError('tx.amount', 'requerido (ej. "1.5 USDC")');
    parseSpendingLimit(tx.amount);
  }
  if (kind === 'call' && !tx.contract && !tx.data)
    throw new TrustSchemaError('tx.contract', 'requerido en una llamada');
  if (kind === 'raw' && !tx.raw) throw new TrustSchemaError('tx.raw', 'requerido');
  return tx;
}

/** Convierte un importe legible (`"1.5 USDC"`) a `{ amount, currency }`. */
export function parseAmount(
  raw: string | undefined,
): { amount: number; currency: string } | undefined {
  if (!raw) return undefined;
  const m = /^\s*([\d.]+)\s*([A-Za-z]{2,8})?\s*$/.exec(raw);
  if (!m || !Number.isFinite(Number(m[1])))
    throw new TrustSchemaError('amount', `importe inválido: "${raw}" (ej. "1.5 USDC")`);
  return { amount: Number(m[1]), currency: (m[2] ?? 'USDC').toUpperCase() };
}

/** Formatea un límite normalizado de vuelta a texto (`"75 USDC/day"`). */
export function formatLimit(
  amount: number,
  currency: string,
  per: SpendingLimit['per'],
): string {
  const n = Number.isInteger(amount)
    ? String(amount)
    : amount.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return per === 'total' ? `${n} ${currency}` : `${n} ${currency}/${per}`;
}
