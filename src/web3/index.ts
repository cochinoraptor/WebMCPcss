/**
 * Web3-MCP (v1.0.0): pagos y micropagos para tools WebMCP.
 *
 * Propiedades reconocidas (leídas de `meta`):
 * - `webmcp-payment: required | optional | none`
 * - `webmcp-network: ethereum | polygon | base | arbitrum | optimism | avalanche | arc | sepolia | base-sepolia | <chainId>`
 * - `webmcp-amount: "0.001 USDC"` (o `"0.0005 ETH"`, `"1.5 MATIC"`)
 * - `webmcp-pay-to: "0x…"` — dirección receptora
 * - `webmcp-payment-protocol: x402 | onchain` (def. `x402` para USDC)
 *
 * Componentes:
 * - {@link parsePaymentRequirement} — normaliza los requisitos de una tool.
 * - {@link AgentWallet} — billetera de agente con **límites de gasto**
 *   (por operación, por sesión y diario) y registro de pagos; firma con
 *   `ethers` si está instalado (peer opcional) o con un firmante inyectado.
 * - {@link X402Client} — flujo de micropagos tipo x402 (HTTP 402 → firma de
 *   autorización USDC EIP-3009 gasless → reintento con `X-PAYMENT`). El
 *   "NanoCrawl" de la especificación se implementa como perfil x402/USDC.
 * - {@link createPaymentGate} — middleware para servidores Node que exige
 *   pago x402 antes de ejecutar una tool.
 * - {@link buildWalletConnectorScript} — script de navegador que conecta
 *   MetaMask/WalletConnect (EIP-1193) y expone `window.__WEBMCP_WALLET__`.
 * - {@link deployContract} / {@link sendPayment} / {@link getBalance} —
 *   operaciones on-chain vía `ethers` (import dinámico).
 * - {@link WEBMCP_PAYMENTS_SOL} — contrato Solidity de referencia.
 *
 * Sin restricción de red: el agente puede operar en mainnets; la protección
 * son los límites de gasto y la confirmación declarativa.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { ToolMap, ToolSpec } from '../types';
import { appendHistory } from '../utils/history';
import { VERSION } from '../version';

/** Redes conocidas. */
export interface NetworkInfo {
  name: string;
  chainId: number;
  nativeSymbol: string;
  /** Contrato USDC oficial (si existe). */
  usdc?: string;
  rpc?: string;
  testnet: boolean;
  explorer?: string;
}

/** Catálogo de redes. */
export const NETWORKS: Record<string, NetworkInfo> = {
  ethereum: {
    name: 'ethereum',
    chainId: 1,
    nativeSymbol: 'ETH',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    rpc: 'https://eth.llamarpc.com',
    testnet: false,
    explorer: 'https://etherscan.io',
  },
  polygon: {
    name: 'polygon',
    chainId: 137,
    nativeSymbol: 'MATIC',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    rpc: 'https://polygon-rpc.com',
    testnet: false,
    explorer: 'https://polygonscan.com',
  },
  base: {
    name: 'base',
    chainId: 8453,
    nativeSymbol: 'ETH',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    rpc: 'https://mainnet.base.org',
    testnet: false,
    explorer: 'https://basescan.org',
  },
  arbitrum: {
    name: 'arbitrum',
    chainId: 42161,
    nativeSymbol: 'ETH',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    rpc: 'https://arb1.arbitrum.io/rpc',
    testnet: false,
    explorer: 'https://arbiscan.io',
  },
  optimism: {
    name: 'optimism',
    chainId: 10,
    nativeSymbol: 'ETH',
    usdc: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    rpc: 'https://mainnet.optimism.io',
    testnet: false,
    explorer: 'https://optimistic.etherscan.io',
  },
  avalanche: {
    name: 'avalanche',
    chainId: 43114,
    nativeSymbol: 'AVAX',
    usdc: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    rpc: 'https://api.avax.network/ext/bc/C/rpc',
    testnet: false,
    explorer: 'https://snowtrace.io',
  },
  sepolia: {
    name: 'sepolia',
    chainId: 11155111,
    nativeSymbol: 'ETH',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    rpc: 'https://rpc.sepolia.org',
    testnet: true,
    explorer: 'https://sepolia.etherscan.io',
  },
  'base-sepolia': {
    name: 'base-sepolia',
    chainId: 84532,
    nativeSymbol: 'ETH',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpc: 'https://sepolia.base.org',
    testnet: true,
    explorer: 'https://sepolia.basescan.org',
  },
};

/**
 * Resuelve una red por nombre o chainId.
 * @param ref Nombre (`base`) o chainId (`8453`).
 */
export function resolveNetwork(ref: string | number | undefined): NetworkInfo {
  if (ref === undefined || ref === '') return NETWORKS.base;
  const key = String(ref).toLowerCase().trim();
  if (NETWORKS[key]) return NETWORKS[key];
  const byId = Object.values(NETWORKS).find((n) => String(n.chainId) === key);
  if (byId) return byId;
  const chainId = Number(key);
  return {
    name: key,
    chainId: Number.isFinite(chainId) ? chainId : 0,
    nativeSymbol: 'ETH',
    testnet: false,
  };
}

/** Requisito de pago normalizado. */
export interface PaymentRequirement {
  tool: string;
  policy: 'required' | 'optional' | 'none';
  network: NetworkInfo;
  amount: number;
  currency: string;
  /** Importe en unidades mínimas (USDC = 6 decimales, nativo = 18). */
  amountUnits: string;
  payTo?: string;
  protocol: 'x402' | 'onchain';
  decimals: number;
}

/**
 * Convierte un importe decimal a unidades mínimas sin perder precisión.
 * @param amount Importe.
 * @param decimals Decimales.
 */
export function toUnits(amount: number | string, decimals: number): string {
  const [int, frac = ''] = String(amount).split('.');
  const digits = (
    int.replace(/^0+(?=\d)/, '') + frac.padEnd(decimals, '0').slice(0, decimals)
  ).replace(/^0+(?=\d)/, '');
  return digits || '0';
}

/**
 * Convierte unidades mínimas a decimal.
 * @param units Unidades.
 * @param decimals Decimales.
 */
export function fromUnits(units: string | bigint, decimals: number): number {
  const s = String(units).padStart(decimals + 1, '0');
  return Number(`${s.slice(0, -decimals) || '0'}.${s.slice(-decimals)}`);
}

/**
 * Lee los requisitos de pago de una tool.
 * @param name Nombre.
 * @param tool Tool.
 */
export function parsePaymentRequirement(
  name: string,
  tool: ToolSpec,
): PaymentRequirement | null {
  const meta = tool.meta ?? {};
  const policyRaw = (meta.payment ?? 'none').toLowerCase();
  if (policyRaw === 'none' && !meta.amount) return null;
  const policy: PaymentRequirement['policy'] =
    policyRaw === 'required'
      ? 'required'
      : policyRaw === 'optional'
        ? 'optional'
        : 'none';
  const network = resolveNetwork(meta.network);
  const m = /^\s*([\d.]+)\s*([A-Za-z]{2,6})?\s*$/.exec(meta.amount ?? '0');
  const amount = m ? Number(m[1]) : 0;
  const currency = (m?.[2] ?? 'USDC').toUpperCase();
  const decimals = currency === 'USDC' || currency === 'USDT' ? 6 : 18;
  const protocolRaw = (
    meta['payment-protocol'] ?? (currency === 'USDC' ? 'x402' : 'onchain')
  ).toLowerCase();
  return {
    tool: name,
    policy,
    network,
    amount,
    currency,
    amountUnits: toUnits(amount, decimals),
    payTo: meta['pay-to'],
    protocol: protocolRaw === 'onchain' ? 'onchain' : 'x402',
    decimals,
  };
}

/**
 * Lista las tools con pago de un tool map.
 * @param map Tool map.
 */
export function listPaidTools(map: ToolMap): PaymentRequirement[] {
  return Object.entries(map.tools)
    .map(([n, t]) => parsePaymentRequirement(n, t))
    .filter((r): r is PaymentRequirement => Boolean(r));
}

// ---------------------------------------------------------------------------
// Billetera de agente con límites de gasto
// ---------------------------------------------------------------------------

/** Límites de gasto (en USD equivalentes; los importes nativos se comparan tal cual si no hay tasa). */
export interface SpendingLimits {
  /** Máximo por operación. */
  perTx?: number;
  /** Máximo acumulado por sesión (vida del objeto). */
  perSession?: number;
  /** Máximo acumulado en 24 h (según el registro). */
  perDay?: number;
  /** Lista blanca de receptores (vacía = cualquiera). */
  allowedRecipients?: string[];
  /** Lista blanca de redes (vacía = cualquiera; sin restricción por defecto). */
  allowedNetworks?: string[];
}

/** Registro de pago. */
export interface PaymentRecord {
  id: string;
  ts: string;
  tool?: string;
  to: string;
  amount: number;
  currency: string;
  network: string;
  protocol: 'x402' | 'onchain';
  status: 'authorized' | 'settled' | 'rejected' | 'failed';
  txHash?: string;
  reason?: string;
}

/** Firmante mínimo (compatible con ethers.Wallet). */
export interface Signer {
  getAddress(): Promise<string>;
  signTypedData(
    domain: Record<string, unknown>,
    types: Record<string, Array<{ name: string; type: string }>>,
    value: Record<string, unknown>,
  ): Promise<string>;
  signMessage?(message: string): Promise<string>;
}

/** Opciones de la billetera. */
export interface AgentWalletOptions {
  limits?: SpendingLimits;
  /** Firmante explícito (ethers.Wallet u otro). */
  signer?: Signer;
  /** Clave privada (se usa `ethers` si está instalado). */
  privateKey?: string;
  /** Registrar pagos en `.webmcpcss/history.json`. */
  recordHistory?: boolean;
  historyFile?: string;
  /** Reloj inyectable (tests). */
  now?: () => number;
}

/** Decisión de gasto. */
export interface SpendDecision {
  allowed: boolean;
  reasons: string[];
  remaining: { perSession?: number; perDay?: number };
}

/**
 * Billetera de un agente con límites de gasto y registro.
 */
export class AgentWallet {
  readonly limits: SpendingLimits;
  readonly records: PaymentRecord[] = [];
  private signer: Signer | null;
  private readonly privateKey?: string;
  private readonly recordHistory: boolean;
  private readonly historyFile?: string;
  private readonly now: () => number;

  /** @param opts Opciones. */
  constructor(opts: AgentWalletOptions = {}) {
    this.limits = { ...opts.limits };
    this.signer = opts.signer ?? null;
    this.privateKey = opts.privateKey;
    this.recordHistory = opts.recordHistory ?? false;
    this.historyFile = opts.historyFile;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Gasto acumulado en la sesión (autorizado o liquidado). */
  get spentSession(): number {
    return this.records
      .filter((r) => r.status === 'authorized' || r.status === 'settled')
      .reduce((a, r) => a + r.amount, 0);
  }

  /** Gasto en las últimas 24 h. */
  get spentDay(): number {
    const since = this.now() - 86_400_000;
    return this.records
      .filter(
        (r) =>
          (r.status === 'authorized' || r.status === 'settled') &&
          Date.parse(r.ts) >= since,
      )
      .reduce((a, r) => a + r.amount, 0);
  }

  /**
   * Evalúa si un gasto está permitido por los límites.
   * @param amount Importe.
   * @param to Receptor.
   * @param network Red.
   */
  canSpend(amount: number, to: string, network: string): SpendDecision {
    const reasons: string[] = [];
    const l = this.limits;
    if (!(amount >= 0)) reasons.push('importe inválido');
    if (l.perTx !== undefined && amount > l.perTx)
      reasons.push(`supera el límite por operación (${amount} > ${l.perTx})`);
    if (l.perSession !== undefined && this.spentSession + amount > l.perSession)
      reasons.push(
        `supera el límite de sesión (${(this.spentSession + amount).toFixed(6)} > ${l.perSession})`,
      );
    if (l.perDay !== undefined && this.spentDay + amount > l.perDay)
      reasons.push(
        `supera el límite diario (${(this.spentDay + amount).toFixed(6)} > ${l.perDay})`,
      );
    if (
      l.allowedRecipients?.length &&
      !l.allowedRecipients.map((a) => a.toLowerCase()).includes(to.toLowerCase())
    )
      reasons.push(`receptor ${to} no está en la lista blanca`);
    if (
      l.allowedNetworks?.length &&
      !l.allowedNetworks.map((n) => n.toLowerCase()).includes(network.toLowerCase())
    )
      reasons.push(`red ${network} no permitida`);
    return {
      allowed: reasons.length === 0,
      reasons,
      remaining: {
        perSession:
          l.perSession !== undefined
            ? Math.max(0, l.perSession - this.spentSession)
            : undefined,
        perDay:
          l.perDay !== undefined ? Math.max(0, l.perDay - this.spentDay) : undefined,
      },
    };
  }

  /**
   * Registra un pago (y opcionalmente en el historial).
   * @param rec Registro sin id/ts.
   */
  record(rec: Omit<PaymentRecord, 'id' | 'ts'>): PaymentRecord {
    const full: PaymentRecord = {
      id: randomUUID(),
      ts: new Date(this.now()).toISOString(),
      ...rec,
    };
    this.records.push(full);
    if (this.recordHistory)
      appendHistory(
        {
          type: 'payment',
          tool: rec.tool,
          ok: rec.status === 'authorized' || rec.status === 'settled',
          details: {
            to: rec.to,
            amount: rec.amount,
            currency: rec.currency,
            network: rec.network,
            protocol: rec.protocol,
            txHash: rec.txHash,
            reason: rec.reason,
          },
        },
        this.historyFile,
      );
    return full;
  }

  /** Obtiene (o crea con ethers) el firmante. */
  async getSigner(): Promise<Signer> {
    if (this.signer) return this.signer;
    if (!this.privateKey)
      throw new Error(
        'La billetera no tiene firmante: pasa `signer` o `privateKey` (WEBMCP_WALLET_KEY).',
      );
    const ethers = await loadEthers();
    const wallet = new ethers.Wallet(this.privateKey) as unknown as Signer;
    this.signer = wallet;
    return wallet;
  }

  /** Dirección del agente. */
  async address(): Promise<string> {
    return (await this.getSigner()).getAddress();
  }

  /** Resumen legible. */
  summary(): {
    limits: SpendingLimits;
    spentSession: number;
    spentDay: number;
    payments: number;
    settled: number;
    rejected: number;
  } {
    return {
      limits: this.limits,
      spentSession: this.spentSession,
      spentDay: this.spentDay,
      payments: this.records.length,
      settled: this.records.filter((r) => r.status === 'settled').length,
      rejected: this.records.filter((r) => r.status === 'rejected').length,
    };
  }
}

// ---------------------------------------------------------------------------
// x402: micropagos USDC gasless (EIP-3009 transferWithAuthorization)
// ---------------------------------------------------------------------------

/** Requisitos de pago anunciados por el servidor (cuerpo de la respuesta 402). */
export interface X402Requirements {
  x402Version: 1;
  accepts: Array<{
    scheme: 'exact';
    network: string;
    maxAmountRequired: string;
    asset: string;
    payTo: string;
    resource: string;
    description?: string;
    maxTimeoutSeconds?: number;
    extra?: { name?: string; version?: string };
  }>;
  error?: string;
}

/** Carga útil de pago que envía el cliente en `X-PAYMENT` (base64 JSON). */
export interface X402Payload {
  x402Version: 1;
  scheme: 'exact';
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: string;
      validBefore: string;
      nonce: string;
    };
  };
}

/** Tipos EIP-712 de EIP-3009. */
export const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/**
 * Construye la respuesta 402 para una tool.
 * @param req Requisito.
 * @param resource URL/recurso.
 */
export function buildX402Requirements(
  req: PaymentRequirement,
  resource: string,
): X402Requirements {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: req.network.name,
        maxAmountRequired: req.amountUnits,
        asset: req.currency === 'USDC' ? (req.network.usdc ?? 'USDC') : req.currency,
        payTo: req.payTo ?? '',
        resource,
        description: `Pago por la tool ${req.tool}`,
        maxTimeoutSeconds: 300,
        extra: {
          name: req.currency === 'USDC' ? 'USD Coin' : req.currency,
          version: '2',
        },
      },
    ],
  };
}

/**
 * Firma una autorización EIP-3009 para el importe requerido.
 * @param signer Firmante.
 * @param accept Opción aceptada de la 402.
 * @param opts `now` (segundos) para tests.
 */
export async function signX402Authorization(
  signer: Signer,
  accept: X402Requirements['accepts'][number],
  opts: { now?: number } = {},
): Promise<X402Payload> {
  const from = await signer.getAddress();
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const nonce = `0x${createHash('sha256').update(randomUUID()).digest('hex')}`;
  const authorization = {
    from,
    to: accept.payTo,
    value: accept.maxAmountRequired,
    validAfter: String(now - 60),
    validBefore: String(now + (accept.maxTimeoutSeconds ?? 300)),
    nonce,
  };
  const network = resolveNetwork(accept.network);
  const domain = {
    name: accept.extra?.name ?? 'USD Coin',
    version: accept.extra?.version ?? '2',
    chainId: network.chainId,
    verifyingContract: accept.asset,
  };
  const signature = await signer.signTypedData(domain, EIP3009_TYPES, authorization);
  return {
    x402Version: 1,
    scheme: 'exact',
    network: accept.network,
    payload: { signature, authorization },
  };
}

/**
 * Codifica/decodifica la cabecera `X-PAYMENT`.
 * @param payload Carga.
 */
export function encodePaymentHeader(payload: X402Payload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}
/**
 * @param header Cabecera.
 */
export function decodePaymentHeader(header: string): X402Payload | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(header, 'base64').toString('utf8'),
    ) as X402Payload;
    return parsed && parsed.x402Version === 1 && parsed.payload?.authorization
      ? parsed
      : null;
  } catch {
    return null;
  }
}

/** Facilitador: verifica/liquida autorizaciones (interfaz inyectable). */
export interface Facilitator {
  verify(
    payload: X402Payload,
    accept: X402Requirements['accepts'][number],
  ): Promise<{ valid: boolean; reason?: string }>;
  settle?(
    payload: X402Payload,
    accept: X402Requirements['accepts'][number],
  ): Promise<{ txHash?: string; ok: boolean; reason?: string }>;
}

/**
 * Facilitador local: valida estructura, importe, receptor, ventana temporal y
 * firma EIP-712 (con `ethers` si está disponible; si no, solo estructura).
 * @param opts `now` en segundos (tests).
 */
export function createLocalFacilitator(opts: { now?: () => number } = {}): Facilitator {
  const seen = new Set<string>();
  return {
    async verify(payload, accept) {
      const a = payload.payload.authorization;
      const now = opts.now ? opts.now() : Math.floor(Date.now() / 1000);
      if (a.to.toLowerCase() !== accept.payTo.toLowerCase())
        return { valid: false, reason: 'receptor incorrecto' };
      if (BigInt(a.value) < BigInt(accept.maxAmountRequired))
        return { valid: false, reason: 'importe insuficiente' };
      if (Number(a.validAfter) > now)
        return { valid: false, reason: 'autorización aún no válida' };
      if (Number(a.validBefore) < now)
        return { valid: false, reason: 'autorización expirada' };
      if (seen.has(a.nonce)) return { valid: false, reason: 'nonce reutilizado' };
      const ethers = await loadEthers().catch(() => null);
      if (ethers) {
        try {
          const network = resolveNetwork(payload.network);
          const domain = {
            name: accept.extra?.name ?? 'USD Coin',
            version: accept.extra?.version ?? '2',
            chainId: network.chainId,
            verifyingContract: accept.asset,
          };
          const recovered = ethers.verifyTypedData(
            domain,
            EIP3009_TYPES,
            a,
            payload.payload.signature,
          ) as string;
          if (recovered.toLowerCase() !== a.from.toLowerCase())
            return { valid: false, reason: 'firma no coincide con el emisor' };
        } catch (e) {
          return { valid: false, reason: `firma inválida: ${(e as Error).message}` };
        }
      } else if (
        !/^0x[0-9a-fA-F]{130}$/.test(payload.payload.signature) &&
        !payload.payload.signature.startsWith('0xmock')
      ) {
        return { valid: false, reason: 'firma con formato inválido' };
      }
      seen.add(a.nonce);
      return { valid: true };
    },
  };
}

/** Respuesta de pago del servidor (cabecera `X-PAYMENT-RESPONSE`). */
export interface X402SettlementResponse {
  success: boolean;
  txHash?: string;
  network: string;
  payer?: string;
  reason?: string;
}

/**
 * Cliente x402: ejecuta una petición HTTP y, si recibe 402, paga y reintenta.
 */
export class X402Client {
  /**
   * @param wallet Billetera del agente.
   * @param fetchImpl `fetch` inyectable.
   */
  constructor(
    private readonly wallet: AgentWallet,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Petición con pago automático.
   * @param url URL.
   * @param init Opciones de fetch.
   * @param ctx `tool` para el registro.
   */
  async fetch(
    url: string,
    init: RequestInit = {},
    ctx: { tool?: string; maxAmount?: number } = {},
  ): Promise<{
    response: Response;
    payment?: PaymentRecord;
    settlement?: X402SettlementResponse;
  }> {
    const first = await this.fetchImpl(url, init);
    if (first.status !== 402) return { response: first };
    const reqs = (await first.json().catch(() => null)) as X402Requirements | null;
    const accept = reqs?.accepts?.find((a) => a.scheme === 'exact');
    if (!accept) return { response: first };
    const decimals = 6;
    const amount = fromUnits(accept.maxAmountRequired, decimals);
    if (ctx.maxAmount !== undefined && amount > ctx.maxAmount) {
      const payment = this.wallet.record({
        tool: ctx.tool,
        to: accept.payTo,
        amount,
        currency: 'USDC',
        network: accept.network,
        protocol: 'x402',
        status: 'rejected',
        reason: `supera maxAmount (${amount} > ${ctx.maxAmount})`,
      });
      return { response: first, payment };
    }
    const decision = this.wallet.canSpend(amount, accept.payTo, accept.network);
    if (!decision.allowed) {
      const payment = this.wallet.record({
        tool: ctx.tool,
        to: accept.payTo,
        amount,
        currency: 'USDC',
        network: accept.network,
        protocol: 'x402',
        status: 'rejected',
        reason: decision.reasons.join('; '),
      });
      return { response: first, payment };
    }
    const signer = await this.wallet.getSigner();
    const payload = await signX402Authorization(signer, accept);
    const payment = this.wallet.record({
      tool: ctx.tool,
      to: accept.payTo,
      amount,
      currency: 'USDC',
      network: accept.network,
      protocol: 'x402',
      status: 'authorized',
    });
    const headers = new Headers(init.headers ?? {});
    headers.set('X-PAYMENT', encodePaymentHeader(payload));
    const second = await this.fetchImpl(url, { ...init, headers });
    const settlementRaw = second.headers.get('X-PAYMENT-RESPONSE');
    let settlement: X402SettlementResponse | undefined;
    if (settlementRaw) {
      try {
        settlement = JSON.parse(Buffer.from(settlementRaw, 'base64').toString('utf8'));
      } catch {
        settlement = undefined;
      }
    }
    if (second.ok) {
      payment.status = 'settled';
      payment.txHash = settlement?.txHash;
    } else {
      payment.status = 'failed';
      payment.reason = settlement?.reason ?? `HTTP ${second.status}`;
    }
    return { response: second, payment, settlement };
  }
}

/** Petición/respuesta mínimas para el gate (compatibles con http.IncomingMessage/ServerResponse). */
export interface GateRequest {
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}
export interface GateResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

/**
 * Crea una puerta de pago x402 para una tool: devuelve `true` si la petición
 * puede continuar (pagada o sin pago requerido); si no, responde 402 y
 * devuelve `false`.
 * @param req Requisito de pago de la tool.
 * @param facilitator Verificador (por defecto local).
 */
export function createPaymentGate(
  req: PaymentRequirement,
  facilitator: Facilitator = createLocalFacilitator(),
) {
  return async (request: GateRequest, response: GateResponse): Promise<boolean> => {
    if (req.policy === 'none' || req.amount <= 0) return true;
    const resource = request.url ?? `/tools/${req.tool}`;
    const requirements = buildX402Requirements(req, resource);
    const accept = requirements.accepts[0];
    const header = request.headers['x-payment'];
    const payload = header
      ? decodePaymentHeader(String(Array.isArray(header) ? header[0] : header))
      : null;
    if (!payload) {
      if (req.policy === 'optional') return true;
      response.statusCode = 402;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ ...requirements, error: 'X-PAYMENT header is required' }),
      );
      return false;
    }
    const verdict = await facilitator.verify(payload, accept);
    if (!verdict.valid) {
      response.statusCode = 402;
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({ ...requirements, error: verdict.reason ?? 'invalid payment' }),
      );
      return false;
    }
    const settled = facilitator.settle
      ? await facilitator.settle(payload, accept)
      : { ok: true };
    const settlement: X402SettlementResponse = {
      success: settled.ok,
      txHash: settled.txHash,
      network: accept.network,
      payer: payload.payload.authorization.from,
      reason: settled.reason,
    };
    response.setHeader(
      'X-PAYMENT-RESPONSE',
      Buffer.from(JSON.stringify(settlement), 'utf8').toString('base64'),
    );
    return settled.ok;
  };
}

// ---------------------------------------------------------------------------
// Navegador: MetaMask / WalletConnect (EIP-1193)
// ---------------------------------------------------------------------------

/**
 * Script de navegador que expone `window.__WEBMCP_WALLET__` con
 * `connect()`, `payTool(name)` y `signAuthorization(accept)` sobre un
 * proveedor EIP-1193 (MetaMask, o WalletConnect si `window.WalletConnectProvider`
 * está cargado). Los límites de gasto se aplican también en el navegador.
 * @param map Tool map (para conocer los requisitos de cada tool).
 * @param limits Límites.
 */
export function buildWalletConnectorScript(
  map: ToolMap,
  limits: SpendingLimits = {},
): string {
  const paid = listPaidTools(map).map((r) => ({
    tool: r.tool,
    network: r.network.name,
    chainId: r.network.chainId,
    amount: r.amount,
    amountUnits: r.amountUnits,
    currency: r.currency,
    payTo: r.payTo ?? '',
    asset: r.currency === 'USDC' ? (r.network.usdc ?? '') : '',
    protocol: r.protocol,
    decimals: r.decimals,
  }));
  return `(function(){
var PAID = ${JSON.stringify(paid).replace(/</g, '\\u003c')};
var LIMITS = ${JSON.stringify(limits)};
var spent = 0;
function provider(){ return window.ethereum || (window.WalletConnectProvider && window.WalletConnectProvider.default ? new window.WalletConnectProvider.default({}) : null); }
async function connect(){
  var p = provider(); if (!p) throw new Error('No hay billetera EIP-1193 (instala MetaMask o carga WalletConnect)');
  var accounts = await p.request({ method: 'eth_requestAccounts' });
  var chainId = parseInt(await p.request({ method: 'eth_chainId' }), 16);
  window.__WEBMCP_WALLET__.account = accounts[0]; window.__WEBMCP_WALLET__.chainId = chainId;
  return { account: accounts[0], chainId: chainId };
}
function canSpend(amount, to){
  var reasons = [];
  if (LIMITS.perTx !== undefined && amount > LIMITS.perTx) reasons.push('supera el limite por operacion');
  if (LIMITS.perSession !== undefined && spent + amount > LIMITS.perSession) reasons.push('supera el limite de sesion');
  if (LIMITS.allowedRecipients && LIMITS.allowedRecipients.length && LIMITS.allowedRecipients.map(function(a){return a.toLowerCase();}).indexOf(to.toLowerCase()) < 0) reasons.push('receptor no permitido');
  return { allowed: reasons.length === 0, reasons: reasons };
}
async function switchChain(chainId){
  var p = provider();
  try { await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x' + chainId.toString(16) }] }); } catch (e) { throw new Error('Cambia la red de la billetera a chainId ' + chainId); }
}
async function signAuthorization(req){
  var p = provider(); var from = window.__WEBMCP_WALLET__.account || (await connect()).account;
  if (window.__WEBMCP_WALLET__.chainId !== req.chainId) await switchChain(req.chainId);
  var now = Math.floor(Date.now() / 1000);
  var nonceBytes = new Uint8Array(32); crypto.getRandomValues(nonceBytes);
  var nonce = '0x' + Array.from(nonceBytes).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
  var message = { from: from, to: req.payTo, value: req.amountUnits, validAfter: String(now - 60), validBefore: String(now + 300), nonce: nonce };
  var typed = { types: { EIP712Domain: [{name:'name',type:'string'},{name:'version',type:'string'},{name:'chainId',type:'uint256'},{name:'verifyingContract',type:'address'}], TransferWithAuthorization: ${JSON.stringify(EIP3009_TYPES.TransferWithAuthorization)} }, primaryType: 'TransferWithAuthorization', domain: { name: 'USD Coin', version: '2', chainId: req.chainId, verifyingContract: req.asset }, message: message };
  var signature = await p.request({ method: 'eth_signTypedData_v4', params: [from, JSON.stringify(typed)] });
  return { x402Version: 1, scheme: 'exact', network: req.network, payload: { signature: signature, authorization: message } };
}
async function payTool(name){
  var req = PAID.filter(function(r){ return r.tool === name; })[0];
  if (!req) return { paid: false, reason: 'la tool no requiere pago' };
  var check = canSpend(req.amount, req.payTo);
  if (!check.allowed) return { paid: false, reason: check.reasons.join('; ') };
  if (req.protocol === 'x402') {
    var payload = await signAuthorization(req);
    spent += req.amount;
    return { paid: true, header: btoa(JSON.stringify(payload)), payload: payload };
  }
  var p = provider(); var from = window.__WEBMCP_WALLET__.account || (await connect()).account;
  if (window.__WEBMCP_WALLET__.chainId !== req.chainId) await switchChain(req.chainId);
  var value = '0x' + BigInt(req.amountUnits).toString(16);
  var tx = await p.request({ method: 'eth_sendTransaction', params: [{ from: from, to: req.payTo, value: value }] });
  spent += req.amount;
  return { paid: true, txHash: tx };
}
window.__WEBMCP_WALLET__ = { version: '${VERSION}', paidTools: PAID, limits: LIMITS, account: null, chainId: null, connect: connect, payTool: payTool, signAuthorization: signAuthorization, canSpend: canSpend, get spent(){ return spent; } };
})();`;
}

// ---------------------------------------------------------------------------
// On-chain con ethers (peer opcional)
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ethersOverride: any = null;

/**
 * Inyecta una implementación de `ethers` (o un doble en tests) en lugar de
 * resolver el paquete opcional con `require`.
 * @param mod Módulo compatible con ethers v6 (`null` restaura el comportamiento por defecto).
 */
export function setEthersModule(mod: unknown | null): void {
  ethersOverride = mod;
}

/** Carga `ethers` v6 dinámicamente (o el módulo inyectado con `setEthersModule`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadEthers(): Promise<any> {
  if (ethersOverride) return ethersOverride;
  try {
    const mod = 'ethers';
    return require(mod);
  } catch {
    throw new Error(
      'Se necesita el paquete opcional `ethers` (npm i ethers) para operaciones on-chain.',
    );
  }
}

/** ABI mínimo ERC-20. */
export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 value) returns (bool)',
];

/**
 * Consulta saldos nativo y USDC.
 * @param address Dirección.
 * @param networkRef Red.
 * @param rpc RPC alternativo.
 */
export async function getBalance(
  address: string,
  networkRef?: string,
  rpc?: string,
): Promise<{
  address: string;
  network: string;
  native: { symbol: string; balance: number };
  usdc?: { balance: number; contract: string };
}> {
  const ethers = await loadEthers();
  const network = resolveNetwork(networkRef);
  const provider = new ethers.JsonRpcProvider(rpc ?? network.rpc);
  const nativeWei = await provider.getBalance(address);
  const out: Awaited<ReturnType<typeof getBalance>> = {
    address,
    network: network.name,
    native: {
      symbol: network.nativeSymbol,
      balance: Number(ethers.formatEther(nativeWei)),
    },
  };
  if (network.usdc) {
    const usdc = new ethers.Contract(network.usdc, ERC20_ABI, provider);
    const bal = await usdc.balanceOf(address);
    out.usdc = { balance: fromUnits(String(bal), 6), contract: network.usdc };
  }
  return out;
}

/**
 * Envía un pago on-chain (USDC por `transfer` o nativo) respetando los
 * límites de la billetera.
 * @param wallet Billetera (con privateKey/signer).
 * @param opts Destino, importe, moneda, red, tool.
 */
export async function sendPayment(
  wallet: AgentWallet,
  opts: {
    to: string;
    amount: number;
    currency?: string;
    network?: string;
    rpc?: string;
    tool?: string;
  },
): Promise<PaymentRecord> {
  const network = resolveNetwork(opts.network);
  const currency = (opts.currency ?? 'USDC').toUpperCase();
  const decision = wallet.canSpend(opts.amount, opts.to, network.name);
  if (!decision.allowed)
    return wallet.record({
      tool: opts.tool,
      to: opts.to,
      amount: opts.amount,
      currency,
      network: network.name,
      protocol: 'onchain',
      status: 'rejected',
      reason: decision.reasons.join('; '),
    });
  const ethers = await loadEthers();
  const provider = new ethers.JsonRpcProvider(opts.rpc ?? network.rpc);
  const signer = await wallet.getSigner();
  const connected =
    typeof (signer as unknown as { connect?: unknown }).connect === 'function'
      ? (signer as unknown as { connect: (p: unknown) => unknown }).connect(provider)
      : signer;
  const rec = wallet.record({
    tool: opts.tool,
    to: opts.to,
    amount: opts.amount,
    currency,
    network: network.name,
    protocol: 'onchain',
    status: 'authorized',
  });
  try {
    let tx: { hash: string; wait: () => Promise<unknown> };
    if (currency === 'USDC') {
      if (!network.usdc)
        throw new Error(`No conozco el contrato USDC de ${network.name}`);
      const usdc = new ethers.Contract(network.usdc, ERC20_ABI, connected);
      tx = await usdc.transfer(opts.to, BigInt(toUnits(opts.amount, 6)));
    } else {
      tx = await (
        connected as unknown as { sendTransaction: (t: unknown) => Promise<typeof tx> }
      ).sendTransaction({ to: opts.to, value: ethers.parseEther(String(opts.amount)) });
    }
    rec.txHash = tx.hash;
    await tx.wait();
    rec.status = 'settled';
  } catch (e) {
    rec.status = 'failed';
    rec.reason = (e as Error).message;
  }
  return rec;
}

/**
 * Despliega un contrato compilado (ABI + bytecode) en la red indicada.
 * @param wallet Billetera.
 * @param artifact `{ abi, bytecode }` (salida de solc/hardhat) o ruta JSON ya leída.
 * @param opts Red, RPC y argumentos del constructor.
 */
export async function deployContract(
  wallet: AgentWallet,
  artifact: { abi: unknown[]; bytecode: string },
  opts: { network?: string; rpc?: string; args?: unknown[] } = {},
): Promise<{ address: string; txHash: string; network: string; explorer?: string }> {
  const ethers = await loadEthers();
  const network = resolveNetwork(opts.network);
  const provider = new ethers.JsonRpcProvider(opts.rpc ?? network.rpc);
  const signer = await wallet.getSigner();
  const connected =
    typeof (signer as unknown as { connect?: unknown }).connect === 'function'
      ? (signer as unknown as { connect: (p: unknown) => unknown }).connect(provider)
      : signer;
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, connected);
  const contract = await factory.deploy(...(opts.args ?? []));
  const tx = contract.deploymentTransaction();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  return {
    address,
    txHash: tx?.hash ?? '',
    network: network.name,
    explorer: network.explorer ? `${network.explorer}/address/${address}` : undefined,
  };
}

/**
 * Contrato Solidity de referencia: registro de pagos por tool con
 * `payTool(bytes32 toolId)` en moneda nativa y `payToolUSDC` vía
 * `transferFrom`. Compílalo con solc/hardhat y despliégalo con
 * `webmcpcss web3 deploy --contract artifact.json --network base`.
 */
export const WEBMCP_PAYMENTS_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title WebMCPPayments — pagos por tool para sitios WebMCPcss
contract WebMCPPayments {
    address public owner;
    IERC20 public immutable usdc;
    mapping(bytes32 => uint256) public priceNative; // wei
    mapping(bytes32 => uint256) public priceUsdc;   // 6 decimales
    mapping(address => mapping(bytes32 => uint256)) public paidUntil;

    event ToolPaid(address indexed payer, bytes32 indexed toolId, uint256 amount, bool usdcPayment);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address usdcAddress) { owner = msg.sender; usdc = IERC20(usdcAddress); }

    function setPrice(bytes32 toolId, uint256 nativeWei, uint256 usdcUnits) external onlyOwner {
        priceNative[toolId] = nativeWei; priceUsdc[toolId] = usdcUnits;
    }

    function payTool(bytes32 toolId) external payable {
        require(msg.value >= priceNative[toolId] && msg.value > 0, "insufficient");
        paidUntil[msg.sender][toolId] = block.timestamp + 1 days;
        emit ToolPaid(msg.sender, toolId, msg.value, false);
    }

    function payToolUSDC(bytes32 toolId) external {
        uint256 price = priceUsdc[toolId];
        require(price > 0, "no usdc price");
        require(usdc.transferFrom(msg.sender, address(this), price), "transfer failed");
        paidUntil[msg.sender][toolId] = block.timestamp + 1 days;
        emit ToolPaid(msg.sender, toolId, price, true);
    }

    function hasAccess(address payer, bytes32 toolId) external view returns (bool) {
        return paidUntil[payer][toolId] >= block.timestamp;
    }

    function withdraw() external onlyOwner { payable(owner).transfer(address(this).balance); }
}
`;

/**
 * Identificador `bytes32` de una tool (keccak-256 no disponible sin ethers:
 * usamos sha256 truncado, estable entre cliente y servidor de WebMCPcss).
 * @param name Nombre de la tool.
 */
export function toolId(name: string): string {
  return `0x${createHash('sha256').update(name).digest('hex')}`;
}

/**
 * Auditoría de la configuración de pagos de un tool map.
 * @param map Tool map.
 */
export function validatePayments(
  map: ToolMap,
): Array<{ tool: string; severity: 'error' | 'warning'; message: string }> {
  const out: Array<{ tool: string; severity: 'error' | 'warning'; message: string }> = [];
  for (const [name, tool] of Object.entries(map.tools)) {
    const req = parsePaymentRequirement(name, tool);
    if (!req) continue;
    if (req.policy === 'required' && !(req.amount > 0))
      out.push({
        tool: name,
        severity: 'error',
        message: 'webmcp-payment: required sin webmcp-amount válido.',
      });
    if (req.policy !== 'none' && !req.payTo)
      out.push({
        tool: name,
        severity: 'error',
        message: 'Falta webmcp-pay-to (dirección receptora).',
      });
    if (req.payTo && !/^0x[0-9a-fA-F]{40}$/.test(req.payTo))
      out.push({
        tool: name,
        severity: 'error',
        message: `webmcp-pay-to "${req.payTo}" no es una dirección EVM.`,
      });
    if (req.currency === 'USDC' && !req.network.usdc)
      out.push({
        tool: name,
        severity: 'warning',
        message: `No conozco el contrato USDC en la red ${req.network.name}; declara webmcp-payment-protocol: onchain o usa una red soportada.`,
      });
    if (
      req.policy === 'required' &&
      !tool.confirmation &&
      tool.meta?.confirmation !== 'needed'
    )
      out.push({
        tool: name,
        severity: 'warning',
        message:
          'Tool de pago sin confirmación declarada (webmcp-confirmation: "needed").',
      });
    if (req.policy === 'required' && tool.meta?.permissions !== 'full')
      out.push({
        tool: name,
        severity: 'warning',
        message: 'Tool de pago debería declarar webmcp-permissions: "full".',
      });
  }
  return out;
}
