/**
 * Ed25519 con la Web Crypto / `crypto` de Node (Node ≥ 18 lo soporta de forma
 * nativa) más utilidades Sui: direcciones (`blake2b256(flag || pubkey)`),
 * firmas de mensaje personal (intent `[3,0,0]` + BCS de vector<u8>) y
 * serialización `flag || sig || pubkey` en base64 que espera la red.
 */
import {
  createPrivateKey,
  createPublicKey,
  sign as nodeSign,
  verify as nodeVerify,
} from 'crypto';
import { blake2b } from './blake2b';

/** Prefijo DER de una clave pública Ed25519 (RFC 8410). */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
/** Prefijo DER (PKCS#8) de una clave privada Ed25519. */
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/** Flag de esquema de firma Sui para Ed25519. */
export const SUI_ED25519_FLAG = 0x00;
/** Intent scope `PersonalMessage` de Sui: `[scope=3, version=0, appId=0]`. */
export const SUI_PERSONAL_MESSAGE_INTENT = Buffer.from([3, 0, 0]);
/** Intent scope `TransactionData` de Sui. */
export const SUI_TRANSACTION_INTENT = Buffer.from([0, 0, 0]);

/** Deriva la clave pública (32 bytes) a partir de la semilla privada (32 bytes). */
export function ed25519PublicKey(seed: Uint8Array): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
  const spki = createPublicKey(key).export({ format: 'der', type: 'spki' }) as Buffer;
  return Buffer.from(spki.subarray(spki.length - 32));
}

/** Firma bytes con Ed25519 (64 bytes). */
export function ed25519Sign(message: Uint8Array, seed: Uint8Array): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]),
    format: 'der',
    type: 'pkcs8',
  });
  return nodeSign(null, Buffer.from(message), key);
}

/** Verifica una firma Ed25519. */
export function ed25519Verify(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKey)]),
      format: 'der',
      type: 'spki',
    });
    return nodeVerify(null, Buffer.from(message), key, Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Codifica un entero como ULEB128 (longitud de vectores BCS). */
export function uleb128(n: number): Buffer {
  const out: number[] = [];
  let v = n;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return Buffer.from(out);
}

/**
 * Dirección Sui de una clave pública Ed25519: `0x` + blake2b256(flag || pk).
 * @param publicKey 32 bytes.
 */
export function suiAddressFromPublicKey(publicKey: Uint8Array): string {
  return (
    '0x' +
    blake2b(
      Buffer.concat([Buffer.from([SUI_ED25519_FLAG]), Buffer.from(publicKey)]),
      32,
    ).toString('hex')
  );
}

/** ¿Es una dirección Sui sintácticamente válida (32 bytes hex)? */
export function isSuiAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Digest que firma una billetera Sui para un mensaje personal:
 * `blake2b256(intent || bcs(vector<u8> message))`.
 */
export function suiPersonalMessageDigest(message: Uint8Array | string): Buffer {
  const body =
    typeof message === 'string' ? Buffer.from(message, 'utf8') : Buffer.from(message);
  return blake2b(
    Buffer.concat([SUI_PERSONAL_MESSAGE_INTENT, uleb128(body.length), body]),
    32,
  );
}

/**
 * Firma un mensaje personal como lo haría `signPersonalMessage` del SDK de Sui.
 * @returns Firma serializada en base64 (`flag || sig || pubkey`).
 */
export function suiSignPersonalMessage(
  message: Uint8Array | string,
  seed: Uint8Array,
): string {
  const digest = suiPersonalMessageDigest(message);
  const sig = ed25519Sign(digest, seed);
  const pk = ed25519PublicKey(seed);
  return Buffer.concat([Buffer.from([SUI_ED25519_FLAG]), sig, pk]).toString('base64');
}

/** Resultado de verificar una firma Sui serializada. */
export interface SuiSignatureCheck {
  valid: boolean;
  /** Dirección derivada de la clave pública incluida en la firma. */
  address?: string;
  reason?: string;
}

/**
 * Verifica una firma Sui serializada (base64 `flag || sig || pubkey`) de un
 * mensaje personal. Solo soporta el esquema Ed25519 (flag 0x00).
 * @param message Mensaje original.
 * @param serialized Firma base64.
 * @param expectedAddress Dirección que debe haber firmado (opcional).
 */
export function suiVerifyPersonalMessage(
  message: Uint8Array | string,
  serialized: string,
  expectedAddress?: string,
): SuiSignatureCheck {
  let raw: Buffer;
  try {
    raw = Buffer.from(serialized, 'base64');
  } catch {
    return { valid: false, reason: 'firma no es base64' };
  }
  if (raw.length !== 97)
    return { valid: false, reason: `firma de ${raw.length} bytes (Ed25519 requiere 97)` };
  if (raw[0] !== SUI_ED25519_FLAG)
    return {
      valid: false,
      reason: `esquema de firma no soportado (flag ${raw[0]}); solo Ed25519`,
    };
  const sig = raw.subarray(1, 65);
  const pk = raw.subarray(65);
  const address = suiAddressFromPublicKey(pk);
  if (expectedAddress && address.toLowerCase() !== expectedAddress.toLowerCase())
    return {
      valid: false,
      address,
      reason: 'la clave pública no corresponde a la dirección',
    };
  const ok = ed25519Verify(suiPersonalMessageDigest(message), sig, pk);
  return ok
    ? { valid: true, address }
    : { valid: false, address, reason: 'firma inválida' };
}
