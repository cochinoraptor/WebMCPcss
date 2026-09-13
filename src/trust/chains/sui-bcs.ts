/**
 * Codificador BCS mínimo para construir una transferencia gasless de
 * stablecoins en Sui (TransactionData v2) sin `@mysten/sui`:
 *
 * ```
 * PTB: inputs  = [Pure(recipient), FundsWithdrawal(MaxAmountU64(amount), Balance<T>, Sender)]
 *      commands = [MoveCall 0x2::balance::redeem_funds<T>(Input 1),
 *                  MoveCall 0x2::balance::send_funds<T>(NestedResult(0,0), Input 0)]
 * gas: price 0, budget 0, payment [], owner = sender
 * expiration: ValidDuring { minEpoch, maxEpoch, chain, nonce }
 * ```
 * Los bytes producidos son idénticos a los de `Transaction.build()` del SDK
 * (verificado con vectores) y la red los acepta como transferencia gasless.
 */
import { blake2b } from '../crypto/blake2b';

/** Codifica un entero sin signo ULEB128. */
export function uleb(n: number): Buffer {
  const out: number[] = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

function u64(n: bigint | number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function str(s: string): Buffer {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([uleb(b.length), b]);
}

function addr(hex: string): Buffer {
  const clean = hex.replace(/^0x/, '').padStart(64, '0');
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new Error(`dirección Sui inválida: ${hex}`);
  return Buffer.from(clean, 'hex');
}

function option<T>(v: T | null | undefined, enc: (x: T) => Buffer): Buffer {
  return v === null || v === undefined
    ? Buffer.from([0])
    : Buffer.concat([Buffer.from([1]), enc(v)]);
}

/** Decodifica base58 (digests/chain identifiers de Sui). */
export function base58Decode(s: string): Buffer {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = 0n;
  for (const ch of s) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error(`base58 inválido: ${s}`);
    n = n * 58n + BigInt(i);
  }
  let hex = n === 0n ? '' : n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let bytes = Buffer.from(hex, 'hex');
  let leading = 0;
  for (const ch of s) {
    if (ch !== '1') break;
    leading++;
  }
  if (leading) bytes = Buffer.concat([Buffer.alloc(leading), bytes]);
  return bytes;
}

/** Codifica base58. */
export function base58Encode(buf: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt('0x' + (Buffer.from(buf).toString('hex') || '0'));
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of buf) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out || '1';
}

/** Tipo Move `package::module::Name` → StructTag BCS (sin parámetros de tipo). */
function structTag(type: string): Buffer {
  const m = /^(0x[0-9a-fA-F]+)::([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    type.trim(),
  );
  if (!m) throw new Error(`tipo Move inválido: ${type}`);
  return Buffer.concat([addr(m[1]), str(m[2]), str(m[3]), uleb(0)]);
}

/** TypeTag::Struct. */
function typeTagStruct(type: string): Buffer {
  return Buffer.concat([Buffer.from([7]), structTag(type)]);
}

/** Parámetros de una transferencia gasless. */
export interface GaslessTransferParams {
  sender: string;
  recipient: string;
  /** Tipo Move del stablecoin (`0x…::usdc::USDC`). */
  coinType: string;
  /** Importe en unidades mínimas. */
  amountUnits: bigint;
  /** Ventana de validez: la tx solo es válida entre estas épocas. */
  minEpoch: number;
  maxEpoch: number;
  /** Chain identifier en base58 (`chainIdentifier` de GraphQL). */
  chainIdentifier: string;
  /** Nonce u32 (anti-replay dentro de la ventana). */
  nonce: number;
}

/**
 * Construye los bytes BCS de `TransactionData::V2` para una transferencia
 * gasless de stablecoin (`balance::redeem_funds` + `balance::send_funds`).
 * @returns Bytes listos para firmar y ejecutar.
 */
export function buildGaslessTransfer(p: GaslessTransferParams): Buffer {
  const coin = typeTagStruct(p.coinType);
  const sui2 = addr('0x2');
  // ---- inputs
  const pureRecipient = Buffer.concat([Buffer.from([0]), uleb(32), addr(p.recipient)]); // CallArg::Pure
  const fundsWithdrawal = Buffer.concat([
    Buffer.from([2]), // CallArg::FundsWithdrawal
    Buffer.from([0]), // Reservation::MaxAmountU64
    u64(p.amountUnits),
    Buffer.from([0]), // WithdrawalTypeArg::Balance
    coin,
    Buffer.from([0]), // WithdrawFrom::Sender
  ]);
  const inputs = Buffer.concat([uleb(2), pureRecipient, fundsWithdrawal]);
  // ---- commands
  const redeem = Buffer.concat([
    Buffer.from([0]), // Command::MoveCall
    sui2,
    str('balance'),
    str('redeem_funds'),
    uleb(1),
    coin,
    uleb(1),
    Buffer.from([1]),
    Buffer.from([1, 0]), // Argument::Input(1)
  ]);
  const send = Buffer.concat([
    Buffer.from([0]),
    sui2,
    str('balance'),
    str('send_funds'),
    uleb(1),
    coin,
    uleb(2),
    Buffer.from([3]),
    Buffer.from([0, 0, 0, 0]), // Argument::NestedResult(0,0)
    Buffer.from([1]),
    Buffer.from([0, 0]), // Argument::Input(0)
  ]);
  const commands = Buffer.concat([uleb(2), redeem, send]);
  const ptb = Buffer.concat([Buffer.from([0]), inputs, commands]); // TransactionKind::ProgrammableTransaction
  // ---- gas data: payment [], owner = sender, price 0, budget 0
  const gas = Buffer.concat([uleb(0), addr(p.sender), u64(0), u64(0)]);
  // ---- expiration ValidDuring
  const expiration = Buffer.concat([
    Buffer.from([2]), // TransactionExpiration::ValidDuring
    option(p.minEpoch, (n) => u64(n)),
    option(p.maxEpoch, (n) => u64(n)),
    Buffer.from([0]), // minTimestamp None
    Buffer.from([0]), // maxTimestamp None
    (() => {
      const d = base58Decode(p.chainIdentifier);
      return Buffer.concat([uleb(d.length), d]);
    })(),
    u32(p.nonce),
  ]);
  const v1 = Buffer.concat([ptb, addr(p.sender), gas, expiration]);
  // El SDK 2.x serializa esta forma (gas sin coins + ValidDuring) con el índice 0 de
  // la enum `TransactionData`; verificado byte a byte contra `Transaction.build()`.
  return Buffer.concat([Buffer.from([0]), v1]);
}

/**
 * Digest de una transacción Sui: base58(blake2b256("TransactionData::" || bytes)).
 * @param txBytes Bytes BCS.
 */
export function transactionDigest(txBytes: Uint8Array): string {
  return base58Encode(
    blake2b(
      Buffer.concat([Buffer.from('TransactionData::', 'utf8'), Buffer.from(txBytes)]),
      32,
    ),
  );
}

/**
 * Digest que firma la billetera: blake2b256(intent(0,0,0) || bytes).
 * @param txBytes Bytes BCS.
 */
export function signingDigest(txBytes: Uint8Array): Buffer {
  return blake2b(Buffer.concat([Buffer.from([0, 0, 0]), Buffer.from(txBytes)]), 32);
}
