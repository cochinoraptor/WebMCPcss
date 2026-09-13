/**
 * EIP-712 (typed structured data) mínimo: dominio, `hashStruct`, digest
 * final `\x19\x01 || domainSeparator || structHash`, y verificación de
 * firmas. Soporta tipos atómicos, `string`/`bytes` dinámicos y structs
 * anidados sin arrays de structs.
 */
import { encodeParams } from './abi';
import { keccak256 } from './keccak';
import { hexToBytes, recoverAddress, signHex } from './secp256k1';

/** Campo de un tipo EIP-712. */
export interface TypedField {
  name: string;
  type: string;
}
/** Diccionario de tipos EIP-712. */
export type TypedTypes = Record<string, TypedField[]>;
/** Dominio EIP-712. */
export interface TypedDomain {
  name?: string;
  version?: string;
  chainId?: number | bigint | string;
  verifyingContract?: string;
  salt?: string;
}

const DOMAIN_FIELDS: TypedField[] = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
  { name: 'salt', type: 'bytes32' },
];

/** Devuelve los tipos referenciados por `primary` (incluido) en orden EIP-712. */
function dependencies(
  primary: string,
  types: TypedTypes,
  found: string[] = [],
): string[] {
  if (found.includes(primary) || !types[primary]) return found;
  found.push(primary);
  for (const f of types[primary]) dependencies(f.type.replace(/\[\]$/, ''), types, found);
  return found;
}

/** Codifica el tipo (`Permission(string agentId,…)Sub(...)`). */
export function encodeType(primary: string, types: TypedTypes): string {
  const deps = dependencies(primary, types);
  const ordered = [primary, ...deps.filter((d) => d !== primary).sort()];
  return ordered
    .map((t) => `${t}(${types[t].map((f) => `${f.type} ${f.name}`).join(',')})`)
    .join('');
}

/** `typeHash = keccak256(encodeType)`. */
export function typeHash(primary: string, types: TypedTypes): Buffer {
  return keccak256(encodeType(primary, types));
}

function encodeValue(type: string, value: unknown, types: TypedTypes): Buffer {
  if (type === 'string') return keccak256(String(value));
  if (type === 'bytes')
    return keccak256(
      typeof value === 'string' ? hexToBytes(value) : (value as Uint8Array),
    );
  if (types[type]) return hashStruct(type, types, value as Record<string, unknown>);
  if (type.endsWith('[]')) {
    const inner = type.slice(0, -2);
    const items = (value as unknown[]).map((v) => encodeValue(inner, v, types));
    return keccak256(Buffer.concat(items));
  }
  return encodeParams([type], [value as string | number | bigint | boolean]);
}

/** `hashStruct(s) = keccak256(typeHash || encodeData(s))`. */
export function hashStruct(
  primary: string,
  types: TypedTypes,
  value: Record<string, unknown>,
): Buffer {
  const fields = types[primary];
  if (!fields) throw new Error(`tipo EIP-712 desconocido: ${primary}`);
  const parts = [typeHash(primary, types)];
  for (const f of fields) {
    if (value[f.name] === undefined)
      throw new Error(`falta el campo ${primary}.${f.name}`);
    parts.push(encodeValue(f.type, value[f.name], types));
  }
  return keccak256(Buffer.concat(parts));
}

/** Separador de dominio (solo con los campos presentes). */
export function domainSeparator(domain: TypedDomain): Buffer {
  const fields = DOMAIN_FIELDS.filter(
    (f) => domain[f.name as keyof TypedDomain] !== undefined,
  );
  const types: TypedTypes = { EIP712Domain: fields };
  return hashStruct('EIP712Domain', types, domain as unknown as Record<string, unknown>);
}

/**
 * Digest final que se firma: `keccak256(0x1901 || domainSeparator || hashStruct)`.
 * @param domain Dominio.
 * @param types Tipos (sin `EIP712Domain`).
 * @param value Mensaje.
 * @param primary Tipo primario (por defecto el único que no es referenciado por otros).
 */
export function typedDataHash(
  domain: TypedDomain,
  types: TypedTypes,
  value: Record<string, unknown>,
  primary = primaryType(types),
): Buffer {
  return keccak256(
    Buffer.concat([
      Buffer.from([0x19, 0x01]),
      domainSeparator(domain),
      hashStruct(primary, types, value),
    ]),
  );
}

/** Infiera el tipo primario: el que no aparece como campo de ningún otro. */
export function primaryType(types: TypedTypes): string {
  const names = Object.keys(types).filter((t) => t !== 'EIP712Domain');
  const referenced = new Set<string>();
  for (const t of names)
    for (const f of types[t]) referenced.add(f.type.replace(/\[\]$/, ''));
  const roots = names.filter((t) => !referenced.has(t));
  if (roots.length !== 1) throw new Error('no se puede inferir el tipo primario EIP-712');
  return roots[0];
}

/** Firma datos tipados con una clave privada secp256k1 (hex de 65 bytes). */
export function signTypedData(
  domain: TypedDomain,
  types: TypedTypes,
  value: Record<string, unknown>,
  privateKey: string,
): string {
  return signHex(typedDataHash(domain, types, value), privateKey);
}

/** Recupera la dirección que firmó datos tipados. */
export function verifyTypedData(
  domain: TypedDomain,
  types: TypedTypes,
  value: Record<string, unknown>,
  signature: string,
): string {
  return recoverAddress(typedDataHash(domain, types, value), signature);
}
