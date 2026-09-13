/**
 * Verificador de pagos: x402 (cabecera `X-PAYMENT` con autorización
 * EIP-3009), autorizaciones EIP-3009 directas y pagos patrocinados
 * (`sponsored`, sin prueba previa). Reutiliza el facilitador local del módulo
 * web3 y añade verificación de firma sin `ethers`.
 */
import { decodePaymentHeader, type X402Payload } from '../../web3';
import { resolveTrustNetwork } from '../config/defaults';
import { verifyTypedData } from '../crypto/eip712';
import { parseAmount } from '../parser/schema';
import type { PaymentType, TrustCheck, TrustPolicy } from '../types';

/** Resultado de verificar un pago. */
export interface PaymentCheckResult {
  valid: boolean;
  reason?: string;
  code?: string;
  /** Importe legible acreditado (`"1.5 USDC"`). */
  amount?: string;
  payer?: string;
  payee?: string;
  checks: TrustCheck[];
}

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/** Opciones. */
export interface PaymentVerifierOptions {
  now?: () => number;
  /** Nombre/versión del dominio EIP-712 del token (USDC: `USD Coin` / `2`). */
  tokenName?: string;
  tokenVersion?: string;
}

/** Verificador de pagos. */
export class PaymentVerifier {
  private readonly seen = new Set<string>();
  constructor(private readonly opts: PaymentVerifierOptions = {}) {}

  private nowS(): number {
    return Math.floor((this.opts.now ? this.opts.now() : Date.now()) / 1000);
  }

  /**
   * Verifica la prueba de pago que exige la política.
   * @param proof Cabecera `X-PAYMENT` (base64), objeto `X402Payload` o `{ authorization, signature }`.
   * @param policy Política (usa `payment`, `network`, `payTo`, `amount`).
   */
  async verifyPayment(
    proof: string | Record<string, unknown> | undefined,
    policy: TrustPolicy,
  ): Promise<PaymentCheckResult> {
    const type: PaymentType = policy.payment;
    const checks: TrustCheck[] = [];
    if (type === 'none')
      return {
        valid: true,
        checks: [{ name: 'payment', passed: true, detail: 'no requerido' }],
      };
    if (type === 'sponsored')
      return {
        valid: true,
        checks: [
          {
            name: 'payment',
            passed: true,
            detail: 'patrocinado por el sitio (sin prueba previa)',
          },
        ],
      };
    if (!proof)
      return {
        valid: false,
        code: 'payment-required',
        reason: `la herramienta exige pago ${type}`,
        checks,
      };

    const payload = normalizePayload(proof);
    if (!payload)
      return {
        valid: false,
        code: 'payment-malformed',
        reason: 'prueba de pago ilegible',
        checks,
      };
    const a = payload.payload.authorization;
    const now = this.nowS();
    if (Number(a.validAfter) > now)
      return {
        valid: false,
        code: 'payment-not-yet-valid',
        reason: 'autorización aún no válida',
        checks,
      };
    if (Number(a.validBefore) < now)
      return {
        valid: false,
        code: 'payment-expired',
        reason: 'autorización expirada',
        checks,
      };
    checks.push({ name: 'payment-window', passed: true });
    if (this.seen.has(a.nonce.toLowerCase()))
      return {
        valid: false,
        code: 'payment-replay',
        reason: 'nonce de pago reutilizado',
        checks,
      };

    if (policy.payTo && a.to.toLowerCase() !== policy.payTo.toLowerCase())
      return {
        valid: false,
        code: 'payment-wrong-payee',
        reason: `el pago va a ${a.to}, no a ${policy.payTo}`,
        checks,
      };
    checks.push({ name: 'payment-payee', passed: true, detail: a.to });

    const required = parseAmount(policy.amount);
    const valueUnits = BigInt(a.value);
    const amount = Number(valueUnits) / 1e6;
    if (required && amount + 1e-9 < required.amount)
      return {
        valid: false,
        code: 'payment-insufficient',
        reason: `pago ${amount} < ${required.amount} ${required.currency}`,
        checks,
      };
    checks.push({ name: 'payment-amount', passed: true, detail: `${amount} USDC` });

    // Firma EIP-712 (EIP-3009) si la red y el token son conocidos.
    let net;
    try {
      net = resolveTrustNetwork(policy.network ?? payload.network, policy.chain);
    } catch {
      net = undefined;
    }
    if (net?.chainId && net.usdc) {
      try {
        const signer = verifyTypedData(
          {
            name: this.opts.tokenName ?? 'USD Coin',
            version: this.opts.tokenVersion ?? '2',
            chainId: net.chainId,
            verifyingContract: net.usdc,
          },
          EIP3009_TYPES,
          a as unknown as Record<string, unknown>,
          payload.payload.signature,
        );
        if (signer.toLowerCase() !== a.from.toLowerCase())
          return {
            valid: false,
            code: 'payment-bad-signature',
            reason: 'la firma EIP-3009 no corresponde al pagador',
            checks,
          };
        checks.push({
          name: 'payment-signature',
          passed: true,
          detail: `firmada por ${signer}`,
        });
      } catch (err) {
        return {
          valid: false,
          code: 'payment-bad-signature',
          reason: `firma inválida: ${(err as Error).message}`,
          checks,
        };
      }
    } else {
      checks.push({
        name: 'payment-signature',
        passed: true,
        detail: 'no verificada (red sin USDC conocido)',
      });
    }
    this.seen.add(a.nonce.toLowerCase());
    return { valid: true, amount: `${amount} USDC`, payer: a.from, payee: a.to, checks };
  }
}

function normalizePayload(proof: string | Record<string, unknown>): X402Payload | null {
  if (typeof proof === 'string') {
    const decoded = decodePaymentHeader(proof);
    if (decoded) return decoded;
    try {
      return normalizePayload(JSON.parse(proof) as Record<string, unknown>);
    } catch {
      return null;
    }
  }
  if (proof.x402Version === 1 && proof.payload) return proof as unknown as X402Payload;
  if (proof.authorization && proof.signature) {
    return {
      x402Version: 1,
      scheme: 'exact',
      network: String(proof.network ?? ''),
      payload: {
        signature: String(proof.signature),
        authorization: proof.authorization as X402Payload['payload']['authorization'],
      },
    };
  }
  return null;
}
