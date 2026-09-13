/**
 * Keccak-256 (variante Ethereum, padding 0x01) en TypeScript puro sobre BigInt.
 * Node no incluye Keccak (solo SHA3 NIST, que usa otro padding), y la capa de
 * confianza necesita keccak para selectores ABI, direcciones EVM, EIP-191 y
 * EIP-712 sin depender de `ethers`.
 */

const MASK64 = (1n << 64n) - 1n;

/** Constantes de ronda (iota). */
const RC: bigint[] = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

/** Desplazamientos rho: ROT[x][y]. */
const ROT: number[][] = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

/** Rotación a la izquierda de 64 bits. */
function rotl(v: bigint, n: number): bigint {
  if (n === 0) return v;
  const b = BigInt(n);
  return ((v << b) | (v >> (64n - b))) & MASK64;
}

/** Permutación Keccak-f[1600] sobre el estado (25 carriles, índice x + 5y). */
function keccakF(A: bigint[]): void {
  const C = new Array<bigint>(5);
  const D = new Array<bigint>(5);
  const B = new Array<bigint>(25);
  for (let round = 0; round < 24; round++) {
    // theta
    for (let x = 0; x < 5; x++)
      C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let i = 0; i < 25; i++) A[i] ^= D[i % 5];
    // rho + pi
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++)
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x][y]);
    // chi
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < 5; x++)
        A[x + 5 * y] =
          B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & MASK64 & B[((x + 2) % 5) + 5 * y]);
    // iota
    A[0] ^= RC[round];
  }
}

/**
 * Calcula Keccak-256 de un buffer.
 * @param data Datos (Buffer, Uint8Array o texto UTF-8).
 * @returns Digest de 32 bytes.
 */
export function keccak256(data: Uint8Array | string): Buffer {
  const input = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const rate = 136;
  const A = new Array<bigint>(25).fill(0n);
  // Padding pad10*1 con byte de dominio 0x01 (Keccak original, el que usa Ethereum).
  const padLen = rate - (input.length % rate);
  const padded = Buffer.alloc(input.length + padLen);
  input.copy(padded);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      A[i] ^= padded.readBigUInt64LE(off + i * 8);
    }
    keccakF(A);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i], i * 8);
  return out;
}

/**
 * Keccak-256 como cadena hex con prefijo `0x`.
 * @param data Datos.
 */
export function keccak256Hex(data: Uint8Array | string): string {
  return '0x' + keccak256(data).toString('hex');
}
