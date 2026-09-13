/**
 * secp256k1 mínimo en TypeScript puro (BigInt): verificación, recuperación de
 * clave pública (ecrecover) y firma determinista RFC 6979. Suficiente para
 * validar firmas EIP-191/EIP-712/EIP-3009 de agentes y firmar permisos o
 * UserOperations sin `ethers`. No es de tiempo constante: úsalo para
 * verificar y para firmar con claves de sesión de bajo valor.
 */
import { createHmac } from 'crypto';
import { keccak256 } from './keccak';

/** Módulo del cuerpo primo. */
export const P = 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn;
/** Orden del grupo. */
export const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const GX = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const GY = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;

/** Punto afín (null = punto en el infinito). */
type Point = { x: bigint; y: bigint } | null;

function mod(a: bigint, m: bigint = P): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

/** Inverso modular por Euclides extendido. */
export function modInv(a: bigint, m: bigint = P): bigint {
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error('secp256k1: sin inverso modular');
  return mod(old_s, m);
}

function modPow(b: bigint, e: bigint, m: bigint): bigint {
  let result = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) result = (result * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return result;
}

function add(a: Point, b: Point): Point {
  if (!a) return b;
  if (!b) return a;
  if (a.x === b.x) {
    if (mod(a.y + b.y) === 0n) return null;
    return double(a);
  }
  const l = mod((b.y - a.y) * modInv(b.x - a.x));
  const x = mod(l * l - a.x - b.x);
  return { x, y: mod(l * (a.x - x) - a.y) };
}

function double(a: Point): Point {
  if (!a) return null;
  const l = mod(3n * a.x * a.x * modInv(2n * a.y));
  const x = mod(l * l - 2n * a.x);
  return { x, y: mod(l * (a.x - x) - a.y) };
}

function mul(p: Point, k: bigint): Point {
  let result: Point = null;
  let addend = p;
  let n = mod(k, N);
  while (n > 0n) {
    if (n & 1n) result = add(result, addend);
    addend = double(addend);
    n >>= 1n;
  }
  return result;
}

const G: Point = { x: GX, y: GY };

function bytesToBigInt(b: Uint8Array): bigint {
  return BigInt('0x' + (Buffer.from(b).toString('hex') || '0'));
}

function bigIntTo32(n: bigint): Buffer {
  return Buffer.from(
    mod(n, 1n << 256n)
      .toString(16)
      .padStart(64, '0'),
    'hex',
  );
}

/** Normaliza una cadena hex (con o sin `0x`) a Buffer. */
export function hexToBytes(hex: string): Buffer {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean))
    throw new Error(`hex inválido: ${hex.slice(0, 20)}…`);
  return Buffer.from(clean, 'hex');
}

/** Firma compacta. */
export interface Signature {
  r: bigint;
  s: bigint;
  /** Identificador de recuperación (0 o 1). */
  recovery: number;
}

/**
 * Parsea una firma de 65 bytes `r||s||v` (v = 0/1 o 27/28).
 * @param sig Hex o bytes.
 */
export function parseSignature(sig: string | Uint8Array): Signature {
  const bytes = typeof sig === 'string' ? hexToBytes(sig) : Buffer.from(sig);
  if (bytes.length !== 65)
    throw new Error(`firma de ${bytes.length} bytes (se esperaban 65)`);
  const r = bytesToBigInt(bytes.subarray(0, 32));
  const s = bytesToBigInt(bytes.subarray(32, 64));
  let v = bytes[64];
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error(`recovery id inválido: ${bytes[64]}`);
  if (r <= 0n || r >= N || s <= 0n || s >= N) throw new Error('firma fuera de rango');
  return { r, s, recovery: v };
}

/** Serializa una firma como hex de 65 bytes con v = 27/28. */
export function serializeSignature(sig: Signature): string {
  return (
    '0x' +
    bigIntTo32(sig.r).toString('hex') +
    bigIntTo32(sig.s).toString('hex') +
    (27 + sig.recovery).toString(16).padStart(2, '0')
  );
}

/** Clave pública descomprimida (65 bytes, prefijo 0x04) a partir de la privada. */
export function getPublicKey(privateKey: string | Uint8Array): Buffer {
  const d = bytesToBigInt(
    typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey,
  );
  if (d <= 0n || d >= N) throw new Error('clave privada fuera de rango');
  const q = mul(G, d);
  if (!q) throw new Error('clave privada inválida');
  return Buffer.concat([Buffer.from([4]), bigIntTo32(q.x), bigIntTo32(q.y)]);
}

/** Dirección EVM (checksum EIP-55) de una clave pública descomprimida. */
export function publicKeyToAddress(pub: Uint8Array): string {
  const raw = pub.length === 65 ? pub.subarray(1) : pub;
  if (raw.length !== 64) throw new Error('clave pública inválida');
  return toChecksumAddress('0x' + keccak256(raw).subarray(12).toString('hex'));
}

/** Dirección EVM de una clave privada. */
export function privateKeyToAddress(privateKey: string | Uint8Array): string {
  return publicKeyToAddress(getPublicKey(privateKey));
}

/** Checksum EIP-55. */
export function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(addr)) throw new Error(`dirección inválida: ${address}`);
  const hash = keccak256(addr).toString('hex');
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    out += parseInt(hash[i], 16) >= 8 ? addr[i].toUpperCase() : addr[i];
  }
  return out;
}

/** ¿Es una dirección EVM sintácticamente válida? */
export function isAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Recupera la clave pública (65 bytes) que firmó `msgHash`.
 * @param msgHash Digest de 32 bytes.
 * @param sig Firma.
 */
export function recoverPublicKey(msgHash: Uint8Array, sig: Signature | string): Buffer {
  const { r, s, recovery } = typeof sig === 'string' ? parseSignature(sig) : sig;
  const z = bytesToBigInt(msgHash);
  const x = r;
  const alpha = mod(x * x * x + 7n);
  let y = modPow(alpha, (P + 1n) / 4n, P);
  if (mod(y * y) !== alpha) throw new Error('firma no recuperable (x sin raíz)');
  if ((y & 1n) !== BigInt(recovery)) y = P - y;
  const R: Point = { x, y };
  const rInv = modInv(r, N);
  const u1 = mod(-z * rInv, N);
  const u2 = mod(s * rInv, N);
  const Q = add(mul(G, u1), mul(R, u2));
  if (!Q) throw new Error('firma no recuperable');
  return Buffer.concat([Buffer.from([4]), bigIntTo32(Q.x), bigIntTo32(Q.y)]);
}

/** Recupera la dirección EVM que firmó `msgHash`. */
export function recoverAddress(msgHash: Uint8Array, sig: Signature | string): string {
  return publicKeyToAddress(recoverPublicKey(msgHash, sig));
}

/**
 * Verifica una firma frente a una clave pública descomprimida.
 * @param msgHash Digest de 32 bytes.
 * @param sig Firma.
 * @param pub Clave pública (65 bytes).
 */
export function verify(
  msgHash: Uint8Array,
  sig: Signature | string,
  pub: Uint8Array,
): boolean {
  try {
    const { r, s } = typeof sig === 'string' ? parseSignature(sig) : sig;
    const raw = pub.length === 65 ? pub.subarray(1) : pub;
    const Q: Point = {
      x: bytesToBigInt(raw.subarray(0, 32)),
      y: bytesToBigInt(raw.subarray(32)),
    };
    const z = bytesToBigInt(msgHash);
    const sInv = modInv(s, N);
    const u1 = mod(z * sInv, N);
    const u2 = mod(r * sInv, N);
    const X = add(mul(G, u1), mul(Q, u2));
    return X !== null && mod(X.x, N) === r;
  } catch {
    return false;
  }
}

/** k determinista según RFC 6979 (HMAC-SHA256). */
function rfc6979(privateKey: Buffer, msgHash: Buffer): bigint {
  let v: Buffer = Buffer.alloc(32, 0x01);
  let k: Buffer = Buffer.alloc(32, 0x00);
  const h = (key: Buffer, ...parts: Buffer[]): Buffer =>
    Buffer.from(createHmac('sha256', key).update(Buffer.concat(parts)).digest());
  k = h(k, v, Buffer.from([0]), privateKey, msgHash);
  v = h(k, v);
  k = h(k, v, Buffer.from([1]), privateKey, msgHash);
  v = h(k, v);
  for (;;) {
    v = h(k, v);
    const candidate = bytesToBigInt(v);
    if (candidate > 0n && candidate < N) return candidate;
    k = h(k, v, Buffer.from([0]));
    v = h(k, v);
  }
}

/**
 * Firma un digest de 32 bytes (determinista, `s` bajo como exige Ethereum).
 * @param msgHash Digest.
 * @param privateKey Clave privada (hex o 32 bytes).
 */
export function sign(msgHash: Uint8Array, privateKey: string | Uint8Array): Signature {
  const dBytes =
    typeof privateKey === 'string' ? hexToBytes(privateKey) : Buffer.from(privateKey);
  const d = bytesToBigInt(dBytes);
  if (d <= 0n || d >= N) throw new Error('clave privada fuera de rango');
  const z = bytesToBigInt(msgHash);
  const hash = Buffer.from(msgHash);
  let k = rfc6979(dBytes, hash);
  for (;;) {
    const R = mul(G, k);
    if (!R) {
      k = mod(k + 1n, N);
      continue;
    }
    const r = mod(R.x, N);
    let s = mod(modInv(k, N) * (z + r * d), N);
    if (r === 0n || s === 0n) {
      k = mod(k + 1n, N);
      continue;
    }
    let recovery = Number(R.y & 1n);
    if (s > N / 2n) {
      s = N - s;
      recovery ^= 1;
    }
    return { r, s, recovery };
  }
}

/** Firma y devuelve hex de 65 bytes. */
export function signHex(msgHash: Uint8Array, privateKey: string | Uint8Array): string {
  return serializeSignature(sign(msgHash, privateKey));
}

/** Hash EIP-191 (`personal_sign`) de un mensaje. */
export function hashMessage(message: string | Uint8Array): Buffer {
  const body =
    typeof message === 'string' ? Buffer.from(message, 'utf8') : Buffer.from(message);
  return keccak256(
    Buffer.concat([
      Buffer.from(`\x19Ethereum Signed Message:\n${body.length}`, 'utf8'),
      body,
    ]),
  );
}
