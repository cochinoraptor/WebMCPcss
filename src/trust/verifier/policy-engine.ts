/**
 * Motor de políticas: rate limiting, límites de gasto por ventana, listas
 * blancas de contratos y reglas horarias. El estado vive en un `PolicyStore`
 * (memoria por defecto, archivo JSON opcional o Redis si se inyecta un
 * cliente compatible con `ioredis`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { TRUST_DEFAULTS } from '../config/defaults';
import {
  formatLimit,
  parseAmount,
  parseRateLimit,
  parseSpendingLimit,
} from '../parser/schema';
import type { RateLimit, SpendingLimit, TrustCheck, TrustPolicy } from '../types';

/** Evento registrado (acción o gasto). */
interface Hit {
  t: number;
  amount?: number;
  currency?: string;
}

/** Almacén de contadores. */
export interface PolicyStore {
  /** Devuelve los eventos de una clave posteriores a `since`. */
  get(key: string, since: number): Promise<Hit[]>;
  /** Añade un evento y purga los anteriores a `keepSince`. */
  add(key: string, hit: Hit, keepSince: number): Promise<void>;
  /** Elimina todo el estado (tests). */
  clear(): Promise<void>;
}

/** Almacén en memoria. */
export class MemoryPolicyStore implements PolicyStore {
  protected data = new Map<string, Hit[]>();
  async get(key: string, since: number): Promise<Hit[]> {
    return (this.data.get(key) ?? []).filter((h) => h.t >= since);
  }
  async add(key: string, hit: Hit, keepSince: number): Promise<void> {
    const list = (this.data.get(key) ?? []).filter((h) => h.t >= keepSince);
    list.push(hit);
    this.data.set(key, list);
  }
  async clear(): Promise<void> {
    this.data.clear();
  }
}

/** Almacén persistido en un archivo JSON (procesos CLI de corta vida). */
export class FilePolicyStore extends MemoryPolicyStore {
  constructor(private readonly file: string) {
    super();
    try {
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Hit[]>;
        this.data = new Map(Object.entries(raw));
      }
    } catch {
      this.data = new Map();
    }
  }
  private flush(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.data)), 'utf8');
  }
  async add(key: string, hit: Hit, keepSince: number): Promise<void> {
    await super.add(key, hit, keepSince);
    this.flush();
  }
  async clear(): Promise<void> {
    await super.clear();
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
  }
}

/** Cliente Redis mínimo (subconjunto de ioredis). */
export interface RedisLike {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<string[]>;
  zremrangebyscore(
    key: string,
    min: number | string,
    max: number | string,
  ): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  keys?(pattern: string): Promise<string[]>;
}

/** Almacén sobre Redis (sorted sets por clave; score = timestamp). */
export class RedisPolicyStore implements PolicyStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = 'webmcpcss:trust:',
  ) {}
  async get(key: string, since: number): Promise<Hit[]> {
    const members = await this.redis.zrangebyscore(this.prefix + key, since, '+inf');
    return members.map((m) => JSON.parse(m) as Hit);
  }
  async add(key: string, hit: Hit, keepSince: number): Promise<void> {
    const k = this.prefix + key;
    await this.redis.zremrangebyscore(k, '-inf', keepSince - 1);
    await this.redis.zadd(k, hit.t, JSON.stringify({ ...hit, _: Math.random() }));
  }
  async clear(): Promise<void> {
    if (!this.redis.keys) return;
    const keys = await this.redis.keys(this.prefix + '*');
    if (keys.length) await this.redis.del(...keys);
  }
}

/** Regla personalizada. */
export type CustomRule = (
  input: PolicyInput,
) => Promise<TrustCheck | null> | TrustCheck | null;

/** Entrada de una evaluación. */
export interface PolicyInput {
  agentId: string;
  tool: string;
  policy: TrustPolicy;
  /** Importe que se pretende gastar (`"1.5 USDC"`). */
  amount?: string;
  /** Contrato/paquete destino. */
  target?: string;
  /** Límite adicional de la sesión (`proof.maxSpend`). */
  sessionMaxSpend?: string;
  /** Contratos permitidos por la sesión. */
  sessionContracts?: string[];
  now?: number;
}

/** Resultado de la evaluación. */
export interface PolicyDecision {
  allowed: boolean;
  checks: TrustCheck[];
  code?: string;
  reason?: string;
  remainingLimit?: string;
  /** Llama a esto tras ejecutar con éxito para consumir cuota/gasto. */
  commit: () => Promise<void>;
}

/** Opciones del motor. */
export interface PolicyEngineOptions {
  store?: PolicyStore;
  rules?: CustomRule[];
  now?: () => number;
  /** Rate limit por defecto si la política no lo declara. */
  defaultRateLimit?: string;
}

/** Motor de políticas. */
export class PolicyEngine {
  readonly store: PolicyStore;
  private readonly rules: CustomRule[];
  private readonly opts: PolicyEngineOptions;

  constructor(opts: PolicyEngineOptions = {}) {
    this.opts = opts;
    this.store = opts.store ?? new MemoryPolicyStore();
    this.rules = opts.rules ?? [];
  }

  /** Añade una regla personalizada. */
  addRule(rule: CustomRule): void {
    this.rules.push(rule);
  }

  private now(input?: PolicyInput): number {
    return input?.now ?? (this.opts.now ? this.opts.now() : Date.now());
  }

  /** Evalúa todas las reglas. No consume cuota hasta `commit()`. */
  async evaluate(input: PolicyInput): Promise<PolicyDecision> {
    const now = this.now(input);
    const checks: TrustCheck[] = [];
    const commits: Array<() => Promise<void>> = [];
    let remainingLimit: string | undefined;

    // 1. Rate limit
    const rl: RateLimit | undefined = parseRateLimit(
      input.policy.rateLimit ??
        this.opts.defaultRateLimit ??
        TRUST_DEFAULTS.defaultRateLimit,
    );
    if (rl) {
      const key = `rate:${input.agentId}:${input.tool}`;
      const hits = await this.store.get(key, now - rl.windowMs);
      const ok = hits.length < rl.count;
      checks.push({
        name: 'rate-limit',
        passed: ok,
        detail: `${hits.length + 1}/${rl.count} por ${rl.per}${ok ? '' : ' (excedido)'}`,
      });
      if (ok) commits.push(() => this.store.add(key, { t: now }, now - rl.windowMs));
    }

    // 2. Spending limit (política) + límite de sesión
    const amount = parseAmount(input.amount);
    const limits: Array<{ limit: SpendingLimit; label: string }> = [];
    const policyLimit = parseSpendingLimit(input.policy.spendingLimit);
    if (policyLimit) limits.push({ limit: policyLimit, label: 'spending-limit' });
    const sessionLimit = parseSpendingLimit(input.sessionMaxSpend);
    if (sessionLimit) limits.push({ limit: sessionLimit, label: 'session-max-spend' });
    for (const { limit, label } of limits) {
      if (!amount) {
        checks.push({ name: label, passed: true, detail: 'sin importe en esta acción' });
        continue;
      }
      if (amount.currency !== limit.currency) {
        checks.push({
          name: label,
          passed: false,
          detail: `moneda ${amount.currency} distinta del límite (${limit.currency})`,
        });
        continue;
      }
      if (limit.per === 'tx') {
        const ok = amount.amount <= limit.amount;
        checks.push({
          name: label,
          passed: ok,
          detail: `${amount.amount} ≤ ${limit.amount} ${limit.currency} por tx${ok ? '' : ' ✗'}`,
        });
        continue;
      }
      const key = `spend:${input.agentId}:${label === 'session-max-spend' ? 'session:' + (input.sessionMaxSpend ?? '') : input.tool}`;
      const since = limit.windowMs ? now - limit.windowMs : 0;
      const spent = (await this.store.get(key, since))
        .filter((h) => h.currency === limit.currency)
        .reduce((a, h) => a + (h.amount ?? 0), 0);
      const remaining = Math.max(0, limit.amount - spent);
      const ok = amount.amount <= remaining + 1e-9;
      remainingLimit = formatLimit(
        Math.max(0, remaining - (ok ? amount.amount : 0)),
        limit.currency,
        limit.per,
      );
      checks.push({
        name: label,
        passed: ok,
        detail: `gastado ${spent} + ${amount.amount} de ${limit.amount} ${limit.currency}/${limit.per}${ok ? '' : ' (excedido)'}`,
      });
      if (ok)
        commits.push(() =>
          this.store.add(
            key,
            { t: now, amount: amount.amount, currency: amount.currency },
            since,
          ),
        );
    }

    // 3. Lista blanca de contratos (política ∩ sesión)
    const allowed = input.policy.allowedContracts;
    const sessionAllowed = input.sessionContracts;
    if (input.target && (allowed || sessionAllowed)) {
      const t = input.target.toLowerCase();
      const okPolicy = !allowed || allowed.some((c) => t === c || t.startsWith(c + '::'));
      const okSession =
        !sessionAllowed || sessionAllowed.some((c) => t === c || t.startsWith(c + '::'));
      checks.push({
        name: 'allowed-contracts',
        passed: okPolicy && okSession,
        detail:
          okPolicy && okSession
            ? `${input.target} permitido`
            : `${input.target} no está en la lista blanca${okPolicy ? ' de la sesión' : ''}`,
      });
    } else if (allowed && !input.target) {
      checks.push({
        name: 'allowed-contracts',
        passed: true,
        detail: 'sin contrato destino en esta acción',
      });
    }

    // 4. Ventana horaria (UTC)
    if (input.policy.allowedHours) {
      const [from, to] = input.policy.allowedHours.split('-').map(toMinutes);
      const d = new Date(now);
      const cur = d.getUTCHours() * 60 + d.getUTCMinutes();
      const ok = from <= to ? cur >= from && cur < to : cur >= from || cur < to;
      checks.push({
        name: 'allowed-hours',
        passed: ok,
        detail: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC ${ok ? 'dentro de' : 'fuera de'} ${input.policy.allowedHours}`,
      });
    }

    // 5. Reglas personalizadas
    for (const rule of this.rules) {
      const res = await rule(input);
      if (res) checks.push(res);
    }

    const failed = checks.find((c) => !c.passed);
    return {
      allowed: !failed,
      checks,
      code: failed ? failed.name : undefined,
      reason: failed ? `${failed.name}: ${failed.detail ?? 'denegado'}` : undefined,
      remainingLimit,
      commit: async () => {
        for (const c of commits) await c();
      },
    };
  }

  /** Gasto acumulado de un agente en una herramienta dentro de la ventana de su política. */
  async spent(
    agentId: string,
    tool: string,
    policy: TrustPolicy,
  ): Promise<{ spent: number; remaining?: string }> {
    const limit = parseSpendingLimit(policy.spendingLimit);
    if (!limit) return { spent: 0 };
    const now = this.now();
    const since = limit.windowMs ? now - limit.windowMs : 0;
    const spent = (await this.store.get(`spend:${agentId}:${tool}`, since))
      .filter((h) => h.currency === limit.currency)
      .reduce((a, h) => a + (h.amount ?? 0), 0);
    return {
      spent,
      remaining: formatLimit(
        Math.max(0, limit.amount - spent),
        limit.currency,
        limit.per,
      ),
    };
  }
}

function toMinutes(hhmm: string): number {
  const [h, m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
