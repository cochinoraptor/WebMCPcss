/**
 * BLAKE2b con salida configurable (por defecto 32 bytes) en TypeScript puro.
 * Sui deriva direcciones y digests de firma con BLAKE2b-256; el `blake2b512`
 * de Node no sirve porque la longitud de salida forma parte del bloque de
 * parámetros y cambia el resultado.
 */

const MASK64 = (1n << 64n) - 1n;

const IV: bigint[] = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];

const SIGMA: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
];

function rotr(v: bigint, n: bigint): bigint {
  return ((v >> n) | (v << (64n - n))) & MASK64;
}

function compress(h: bigint[], block: Buffer, t: bigint, last: boolean): void {
  const m = new Array<bigint>(16);
  for (let i = 0; i < 16; i++) m[i] = block.readBigUInt64LE(i * 8);
  const v = [...h, ...IV];
  v[12] ^= t & MASK64;
  v[13] ^= (t >> 64n) & MASK64;
  if (last) v[14] = ~v[14] & MASK64;
  const G = (a: number, b: number, c: number, d: number, x: bigint, y: bigint): void => {
    v[a] = (v[a] + v[b] + x) & MASK64;
    v[d] = rotr(v[d] ^ v[a], 32n);
    v[c] = (v[c] + v[d]) & MASK64;
    v[b] = rotr(v[b] ^ v[c], 24n);
    v[a] = (v[a] + v[b] + y) & MASK64;
    v[d] = rotr(v[d] ^ v[a], 16n);
    v[c] = (v[c] + v[d]) & MASK64;
    v[b] = rotr(v[b] ^ v[c], 63n);
  };
  for (let r = 0; r < 12; r++) {
    const s = SIGMA[r % 10];
    G(0, 4, 8, 12, m[s[0]], m[s[1]]);
    G(1, 5, 9, 13, m[s[2]], m[s[3]]);
    G(2, 6, 10, 14, m[s[4]], m[s[5]]);
    G(3, 7, 11, 15, m[s[6]], m[s[7]]);
    G(0, 5, 10, 15, m[s[8]], m[s[9]]);
    G(1, 6, 11, 12, m[s[10]], m[s[11]]);
    G(2, 7, 8, 13, m[s[12]], m[s[13]]);
    G(3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
}

/**
 * Calcula BLAKE2b sin clave.
 * @param data Datos (Buffer, Uint8Array o texto UTF-8).
 * @param outLen Longitud de salida en bytes (1–64, por defecto 32).
 */
export function blake2b(data: Uint8Array | string, outLen = 32): Buffer {
  if (outLen < 1 || outLen > 64)
    throw new Error('blake2b: outLen debe estar entre 1 y 64');
  const input = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const h = [...IV];
  h[0] ^= 0x01010000n ^ BigInt(outLen);
  const blocks = Math.max(1, Math.ceil(input.length / 128));
  for (let i = 0; i < blocks; i++) {
    const last = i === blocks - 1;
    const chunk = Buffer.alloc(128);
    input.copy(chunk, 0, i * 128, Math.min(input.length, (i + 1) * 128));
    const consumed = last ? input.length : (i + 1) * 128;
    compress(h, chunk, BigInt(consumed), last);
  }
  const out = Buffer.alloc(64);
  for (let i = 0; i < 8; i++) out.writeBigUInt64LE(h[i], i * 8);
  return out.subarray(0, outLen);
}

/** BLAKE2b-256 como hex con prefijo `0x`. */
export function blake2b256Hex(data: Uint8Array | string): string {
  return '0x' + blake2b(data, 32).toString('hex');
}
