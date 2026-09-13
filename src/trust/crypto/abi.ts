/**
 * Codificador/decodificador ABI mínimo (los tipos que usan ERC-721/ERC-8004,
 * ERC-20, EIP-3009 y ERC-4337): `uint*`, `int*`, `address`, `bool`, `bytes32`,
 * `bytes`, `string` y `address[]`/`uint256[]`. Suficiente para `eth_call`
 * sin `ethers`; los tipos anidados (tuplas) no están soportados.
 */
import { keccak256 } from './keccak';
import { hexToBytes, toChecksumAddress } from './secp256k1';

/** Valor ABI aceptado por el codificador. */
export type AbiValue = string | number | bigint | boolean | Uint8Array | AbiValue[];

function word(hex: string): Buffer {
  return Buffer.from(hex.replace(/^0x/, '').padStart(64, '0'), 'hex');
}

function encodeUint(value: string | number | bigint, bits: number): Buffer {
  let n = BigInt(value);
  if (n < 0n) n = (1n << 256n) + n; // complemento a dos (int*)
  if (n < 0n || n >= 1n << 256n) throw new Error(`valor fuera de rango para uint${bits}`);
  return word(n.toString(16));
}

function isDynamic(type: string): boolean {
  return type === 'bytes' || type === 'string' || type.endsWith('[]');
}

function encodeSingle(type: string, value: AbiValue): Buffer {
  if (type.endsWith('[]')) {
    const inner = type.slice(0, -2);
    const items = value as AbiValue[];
    if (!Array.isArray(items)) throw new Error(`se esperaba un array para ${type}`);
    return Buffer.concat([
      encodeUint(items.length, 256),
      encodeParams(
        items.map(() => inner),
        items,
      ),
    ]);
  }
  if (type === 'string' || type === 'bytes') {
    const bytes =
      type === 'string'
        ? Buffer.from(String(value), 'utf8')
        : typeof value === 'string'
          ? hexToBytes(value)
          : Buffer.from(value as Uint8Array);
    const padded = Buffer.alloc(Math.ceil(bytes.length / 32) * 32);
    bytes.copy(padded);
    return Buffer.concat([encodeUint(bytes.length, 256), padded]);
  }
  if (type === 'address') {
    if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value))
      throw new Error(`dirección inválida: ${String(value)}`);
    return word(value);
  }
  if (type === 'bool') return word(value ? '1' : '0');
  if (/^bytes\d+$/.test(type)) {
    const size = Number(type.slice(5));
    const bytes =
      typeof value === 'string' ? hexToBytes(value) : Buffer.from(value as Uint8Array);
    if (bytes.length !== size) throw new Error(`${type} requiere ${size} bytes`);
    const out = Buffer.alloc(32);
    bytes.copy(out);
    return out;
  }
  if (/^u?int\d*$/.test(type)) {
    const bits = Number(type.replace(/^u?int/, '') || 256);
    return encodeUint(value as string | number | bigint, bits);
  }
  throw new Error(`tipo ABI no soportado: ${type}`);
}

/**
 * Codifica parámetros ABI (cabecera + cola para tipos dinámicos).
 * @param types Tipos (`['uint256','address[]']`).
 * @param values Valores en el mismo orden.
 */
export function encodeParams(types: string[], values: AbiValue[]): Buffer {
  if (types.length !== values.length)
    throw new Error('types/values de distinta longitud');
  const heads: Buffer[] = [];
  const tails: Buffer[] = [];
  let tailOffset = types.length * 32;
  types.forEach((type, i) => {
    const enc = encodeSingle(type, values[i]);
    if (isDynamic(type)) {
      heads.push(encodeUint(tailOffset, 256));
      tails.push(enc);
      tailOffset += enc.length;
    } else {
      heads.push(enc);
    }
  });
  return Buffer.concat([...heads, ...tails]);
}

/**
 * Selector de función (4 bytes de keccak256 de la firma).
 * @param signature `ownerOf(uint256)`.
 */
export function selector(signature: string): string {
  return '0x' + keccak256(signature).subarray(0, 4).toString('hex');
}

/**
 * Codifica una llamada completa (`selector || params`) lista para `eth_call`.
 * @param signature Firma de la función, p. ej. `balanceOf(address)`.
 * @param values Argumentos.
 */
export function encodeCall(signature: string, values: AbiValue[] = []): string {
  const m = /^\w+\((.*)\)$/.exec(signature.trim());
  if (!m) throw new Error(`firma inválida: ${signature}`);
  const types = m[1] ? m[1].split(',').map((t) => t.trim()) : [];
  return selector(signature) + encodeParams(types, values).toString('hex');
}

/** Valor ABI decodificado. */
export type DecodedValue = string | bigint | boolean | DecodedValue[];

function readWord(data: Buffer, offset: number): Buffer {
  if (offset + 32 > data.length) throw new Error('datos ABI truncados');
  return data.subarray(offset, offset + 32);
}

function decodeSingle(type: string, data: Buffer, offset: number): DecodedValue {
  if (type.endsWith('[]')) {
    const inner = type.slice(0, -2);
    const start = Number(BigInt('0x' + readWord(data, offset).toString('hex')));
    const len = Number(BigInt('0x' + readWord(data, start).toString('hex')));
    const body = data.subarray(start + 32);
    return decodeParams(new Array<string>(len).fill(inner), body);
  }
  if (type === 'string' || type === 'bytes') {
    const start = Number(BigInt('0x' + readWord(data, offset).toString('hex')));
    const len = Number(BigInt('0x' + readWord(data, start).toString('hex')));
    const bytes = data.subarray(start + 32, start + 32 + len);
    return type === 'string' ? bytes.toString('utf8') : '0x' + bytes.toString('hex');
  }
  const w = readWord(data, offset);
  if (type === 'address') return toChecksumAddress('0x' + w.subarray(12).toString('hex'));
  if (type === 'bool') return w[31] === 1;
  if (/^bytes\d+$/.test(type))
    return '0x' + w.subarray(0, Number(type.slice(5))).toString('hex');
  if (/^int\d*$/.test(type)) {
    const n = BigInt('0x' + w.toString('hex'));
    return n >= 1n << 255n ? n - (1n << 256n) : n;
  }
  if (/^uint\d*$/.test(type)) return BigInt('0x' + w.toString('hex'));
  throw new Error(`tipo ABI no soportado: ${type}`);
}

/**
 * Decodifica el resultado de un `eth_call`.
 * @param types Tipos de salida.
 * @param data Hex (`0x…`) o Buffer.
 */
export function decodeParams(types: string[], data: string | Buffer): DecodedValue[] {
  const buf = typeof data === 'string' ? hexToBytes(data) : data;
  return types.map((type, i) => decodeSingle(type, buf, i * 32));
}

/** Convierte un `bytes32` hex a texto (recorta ceros finales). */
export function bytes32ToString(hex: string): string {
  return hexToBytes(hex).toString('utf8').replace(/\0+$/, '');
}
