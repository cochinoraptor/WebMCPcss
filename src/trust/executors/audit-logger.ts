/**
 * Registro de auditoría inmutable: cada entrada se encadena con el hash de la
 * anterior (keccak256 del JSON canónico) y se escribe en un archivo JSONL
 * append-only. Opcionalmente cada entrada se ancla on-chain a través del
 * adaptador (`registerAuditLog`) y guarda la referencia (`anchor`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { canonicalAudit, type ChainAdapter } from '../chains';
import { TRUST_DEFAULTS } from '../config/defaults';
import { keccak256Hex } from '../crypto/keccak';
import type { AuditAction, AuditEntry } from '../types';

/** Hash génesis de la cadena. */
export const AUDIT_GENESIS = '0x' + '0'.repeat(64);

/** Opciones. */
export interface AuditLoggerOptions {
  /** Archivo JSONL (por defecto `.webmcpcss/trust-audit.jsonl`). `null` = solo memoria. */
  file?: string | null;
  /** Adaptador para anclar on-chain (opcional). */
  anchor?: ChainAdapter;
  /** Anclar cada entrada (`always`), nunca (`never`) o solo las exitosas con tx (`tx`). */
  anchorMode?: 'always' | 'never' | 'tx';
  now?: () => number;
}

/** Registro de auditoría. */
export class AuditLogger {
  private entries: AuditEntry[] = [];
  private readonly file: string | null;
  private readonly opts: AuditLoggerOptions;
  private loaded = false;

  constructor(opts: AuditLoggerOptions = {}) {
    this.opts = opts;
    this.file = opts.file === null ? null : (opts.file ?? TRUST_DEFAULTS.auditFile);
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.file || !fs.existsSync(this.file)) return;
    const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean);
    this.entries = lines.map((l) => JSON.parse(l) as AuditEntry);
  }

  /** Último hash de la cadena. */
  get head(): string {
    this.load();
    return this.entries.length
      ? this.entries[this.entries.length - 1].hash
      : AUDIT_GENESIS;
  }

  /**
   * Registra una acción. Devuelve la entrada con `hash`, `prevHash` y `anchor`.
   * @param action Acción.
   */
  async log(action: AuditAction): Promise<AuditEntry> {
    this.load();
    const timestamp = action.timestamp ?? (this.opts.now ? this.opts.now() : Date.now());
    const prevHash = this.head;
    const id = `${timestamp.toString(36)}-${this.entries.length + 1}`;
    const body = { ...action, timestamp, id, prevHash };
    const hash = keccak256Hex(canonicalAudit(body));
    const entry: AuditEntry = { ...body, hash };
    const mode = this.opts.anchorMode ?? (this.opts.anchor ? 'tx' : 'never');
    if (this.opts.anchor && mode !== 'never' && (mode === 'always' || action.txHash)) {
      try {
        entry.anchor = await this.opts.anchor.registerAuditLog(entry);
      } catch (err) {
        entry.meta = { ...entry.meta, anchorError: (err as Error).message.slice(0, 200) };
      }
    }
    this.entries.push(entry);
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.appendFileSync(this.file, JSON.stringify(entry) + '\n', 'utf8');
    }
    return entry;
  }

  /**
   * Consulta el historial (más reciente primero).
   * @param filter `agentId`, `action`, `result`, `since` (ms), `limit`.
   */
  query(
    filter: {
      agentId?: string;
      action?: string;
      result?: AuditEntry['result'];
      since?: number;
      limit?: number;
    } = {},
  ): AuditEntry[] {
    this.load();
    let list = this.entries;
    if (filter.agentId)
      list = list.filter(
        (e) => e.agentId.toLowerCase() === filter.agentId!.toLowerCase(),
      );
    if (filter.action) list = list.filter((e) => e.action === filter.action);
    if (filter.result) list = list.filter((e) => e.result === filter.result);
    if (filter.since) list = list.filter((e) => e.timestamp >= filter.since!);
    const out = [...list].reverse();
    return filter.limit ? out.slice(0, filter.limit) : out;
  }

  /** Verifica la integridad de toda la cadena. */
  verify(): { ok: boolean; entries: number; brokenAt?: number; reason?: string } {
    this.load();
    let prev = AUDIT_GENESIS;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.prevHash !== prev)
        return {
          ok: false,
          entries: this.entries.length,
          brokenAt: i,
          reason: 'prevHash no coincide',
        };
      const { hash, anchor: _anchor, meta, ...rest } = e;
      // `meta.anchorError` se añade después del hash; se excluye del cálculo.
      const cleanMeta = meta
        ? Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'anchorError'))
        : undefined;
      const recomputed = keccak256Hex(
        canonicalAudit({
          ...rest,
          ...(cleanMeta && Object.keys(cleanMeta).length ? { meta: cleanMeta } : {}),
        }),
      );
      if (recomputed !== hash)
        return {
          ok: false,
          entries: this.entries.length,
          brokenAt: i,
          reason: 'hash alterado',
        };
      prev = hash;
    }
    return { ok: true, entries: this.entries.length };
  }

  /** Número de entradas. */
  get size(): number {
    this.load();
    return this.entries.length;
  }
}
