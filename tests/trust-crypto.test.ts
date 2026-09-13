/**
 * Tests de las primitivas criptográficas del módulo de confianza (v1.3.0):
 * keccak-256, BLAKE2b, secp256k1 (firma/recuperación), ABI, EIP-712, Ed25519
 * (Sui) y BCS de transferencias gasless, comparadas con vectores generados con
 * `ethers` 6 y `@mysten/sui` 2 (tests/fixtures/trust-vectors.json).
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { keccak256Hex } from '../src/trust/crypto/keccak';
import { blake2b, blake2b256Hex } from '../src/trust/crypto/blake2b';
import {
  getPublicKey,
  hashMessage,
  isAddress,
  parseSignature,
  privateKeyToAddress,
  recoverAddress,
  serializeSignature,
  sign,
  signHex,
  toChecksumAddress,
  verify,
} from '../src/trust/crypto/secp256k1';
import {
  bytes32ToString,
  decodeParams,
  encodeCall,
  encodeParams,
  selector,
} from '../src/trust/crypto/abi';
import {
  domainSeparator,
  encodeType,
  hashStruct,
  primaryType,
  signTypedData,
  typedDataHash,
  verifyTypedData,
} from '../src/trust/crypto/eip712';
import {
  ed25519PublicKey,
  ed25519Sign,
  ed25519Verify,
  isSuiAddress,
  suiAddressFromPublicKey,
  suiSignPersonalMessage,
  suiVerifyPersonalMessage,
  uleb128,
} from '../src/trust/crypto/ed25519';
import {
  base58Decode,
  base58Encode,
  buildGaslessTransfer,
  signingDigest,
  transactionDigest,
} from '../src/trust/chains/sui-bcs';
import { rlpEncode, userOperationHash } from '../src/trust/chains/evm-adapter';

const v = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'trust-vectors.json'), 'utf8'),
);

describe('keccak-256', () => {
  it('coincide con ethers en cadenas de distinta longitud (incluye >1 bloque)', () => {
    for (const [s, h] of v.keccak) expect(keccak256Hex(s)).toBe(h);
  });
  it('selectores ABI de ERC-721/ERC-8004/EIP-3009', () => {
    for (const [sig, sel] of v.selectors) expect(selector(sig)).toBe(sel);
  });
});

describe('blake2b', () => {
  it('coincide con @noble/hashes para salida de 32 bytes', () => {
    for (const [s, h] of v.blake2b) expect(blake2b(s, 32).toString('hex')).toBe(h);
    expect(blake2b256Hex('abc')).toBe('0x' + v.blake2b[1][1]);
  });
  it('rechaza longitudes inválidas y soporta entradas largas', () => {
    expect(() => blake2b('x', 0)).toThrow();
    expect(blake2b('a'.repeat(300), 64).length).toBe(64);
  });
});

describe('secp256k1', () => {
  it('deriva dirección y clave pública', () => {
    expect(privateKeyToAddress(v.evm.privateKey)).toBe(v.evm.address);
    expect('0x' + getPublicKey(v.evm.privateKey).toString('hex')).toBe(v.evm.publicKey);
    expect(isAddress(v.evm.address)).toBe(true);
    expect(isAddress('0x123')).toBe(false);
    expect(toChecksumAddress(v.evm.address.toLowerCase())).toBe(v.evm.address);
  });
  it('EIP-191: hash, firma determinista y recuperación idénticas a ethers', () => {
    const h = hashMessage(v.evm.personal.message);
    expect('0x' + h.toString('hex')).toBe(v.evm.personal.hash);
    expect(signHex(h, v.evm.privateKey)).toBe(v.evm.personal.signature);
    expect(recoverAddress(h, v.evm.personal.signature)).toBe(v.evm.address);
    expect(
      verify(h, parseSignature(v.evm.personal.signature), getPublicKey(v.evm.privateKey)),
    ).toBe(true);
    expect(
      verify(
        hashMessage('otro'),
        v.evm.personal.signature,
        getPublicKey(v.evm.privateKey),
      ),
    ).toBe(false);
  });
  it('serializa/parsea firmas con v=27/28 y rechaza basura', () => {
    const s = sign(hashMessage('x'), v.evm.privateKey);
    expect(parseSignature(serializeSignature(s))).toEqual(s);
    expect(() => parseSignature('0x1234')).toThrow(/65/);
    expect(() => privateKeyToAddress('0x' + '00'.repeat(32))).toThrow(/rango/);
  });
});

describe('abi', () => {
  it('codifica llamadas como ethers (estáticos, string, address[])', () => {
    expect(encodeCall('ownerOf(uint256)', [1])).toBe(v.abi.ownerOf1);
    expect(encodeCall('getMetadata(uint256,string)', [7, 'agentWallet'])).toBe(
      v.abi.getMetadata,
    );
    expect(
      encodeCall('getSummary(uint256,address[],string,string)', [
        7,
        [v.evm.address, '0x000000000000000000000000000000000000dEaD'],
        'starred',
        '',
      ]),
    ).toBe(v.abi.getSummary);
  });
  it('decodifica string, bytes, enteros con signo y arrays', () => {
    expect(decodeParams(['string'], v.abi.stringDecode)).toEqual([
      'ipfs://bafyexample/agent.json',
    ]);
    expect(decodeParams(['uint64', 'int128', 'uint8'], v.abi.summaryDecode)).toEqual([
      3n,
      -25n,
      1n,
    ]);
    const enc = encodeParams(
      ['address[]', 'bool', 'bytes32'],
      [[v.evm.address], true, '0x' + 'ab'.repeat(32)],
    );
    expect(decodeParams(['address[]', 'bool', 'bytes32'], enc)).toEqual([
      [v.evm.address],
      true,
      '0x' + 'ab'.repeat(32),
    ]);
    expect(
      bytes32ToString('0x' + Buffer.from('starred').toString('hex').padEnd(64, '0')),
    ).toBe('starred');
  });
  it('rechaza tipos no soportados y direcciones inválidas', () => {
    expect(() => encodeParams(['tuple(uint256)'], [1])).toThrow(/no soportado/);
    expect(() => encodeCall('f(address)', ['0x12'])).toThrow(/dirección/);
    expect(() => encodeParams(['uint256'], [-1, 2])).toThrow(/longitud/);
  });
});

describe('eip712', () => {
  const t = v.evm.typed;
  it('domainSeparator, hashStruct y digest idénticos a ethers', () => {
    expect('0x' + domainSeparator(t.domain).toString('hex')).toBe(t.domainSeparator);
    expect('0x' + hashStruct('Permission', t.types, t.value).toString('hex')).toBe(
      t.structHash,
    );
    expect('0x' + typedDataHash(t.domain, t.types, t.value).toString('hex')).toBe(t.hash);
    expect(primaryType(t.types)).toBe('Permission');
    expect(encodeType('Permission', t.types)).toMatch(
      /^Permission\(string agentId,address signer/,
    );
  });
  it('firma y verifica como ethers (Permission y EIP-3009)', () => {
    expect(signTypedData(t.domain, t.types, t.value, v.evm.privateKey)).toBe(t.signature);
    expect(verifyTypedData(t.domain, t.types, t.value, t.signature)).toBe(v.evm.address);
    const e = v.evm.eip3009;
    expect('0x' + typedDataHash(e.domain, e.types, e.value).toString('hex')).toBe(e.hash);
    expect(verifyTypedData(e.domain, e.types, e.value, e.signature)).toBe(v.evm.address);
  });
  it('soporta structs anidados y falla con campos ausentes', () => {
    const types = {
      Outer: [
        { name: 'inner', type: 'Inner' },
        { name: 'n', type: 'uint256' },
      ],
      Inner: [{ name: 'a', type: 'string' }],
    };
    const h = typedDataHash({ name: 'x' }, types, { inner: { a: 'hola' }, n: 1 });
    expect(h.length).toBe(32);
    expect(() => hashStruct('Outer', types, { n: 1 })).toThrow(/falta el campo/);
    expect(() => primaryType({ A: [], B: [] })).toThrow(/primario/);
  });
});

describe('ed25519 / Sui', () => {
  const seed = Buffer.from('22'.repeat(32), 'hex');
  it('deriva la misma clave pública y dirección que @mysten/sui', () => {
    expect(ed25519PublicKey(seed).toString('base64')).toBe(v.sui.publicKeyBase64);
    expect(suiAddressFromPublicKey(ed25519PublicKey(seed))).toBe(v.sui.address);
    expect(isSuiAddress(v.sui.address)).toBe(true);
    expect(isSuiAddress(v.evm.address)).toBe(false);
  });
  it('firma mensajes personales byte a byte como el SDK y los verifica', () => {
    expect(suiSignPersonalMessage(v.sui.message, seed)).toBe(v.sui.signature);
    expect(
      suiVerifyPersonalMessage(v.sui.message, v.sui.signature, v.sui.address),
    ).toEqual({ valid: true, address: v.sui.address });
    expect(suiVerifyPersonalMessage('otro', v.sui.signature).valid).toBe(false);
    expect(
      suiVerifyPersonalMessage(v.sui.message, v.sui.signature, '0x' + '11'.repeat(32))
        .reason,
    ).toMatch(/no corresponde/);
    expect(suiVerifyPersonalMessage(v.sui.message, 'AQID').reason).toMatch(/97/);
    expect(
      suiVerifyPersonalMessage(
        v.sui.message,
        Buffer.concat([Buffer.from([1]), Buffer.alloc(96)]).toString('base64'),
      ).reason,
    ).toMatch(/no soportado/);
  });
  it('ed25519 crudo y ULEB128', () => {
    const sig = ed25519Sign(Buffer.from('m'), seed);
    expect(ed25519Verify(Buffer.from('m'), sig, ed25519PublicKey(seed))).toBe(true);
    expect(ed25519Verify(Buffer.from('n'), sig, ed25519PublicKey(seed))).toBe(false);
    expect(ed25519Verify(Buffer.from('m'), sig, Buffer.alloc(5))).toBe(false);
    expect(uleb128(0)).toEqual(Buffer.from([0]));
    expect(uleb128(300)).toEqual(Buffer.from([0xac, 0x02]));
  });
});

describe('sui-bcs (transferencia gasless)', () => {
  const t = v.suiTx;
  it('produce los mismos bytes, digest y firma que Transaction.build() del SDK', () => {
    const bytes = buildGaslessTransfer({
      sender: t.sender,
      recipient: t.recipient,
      coinType: t.usdc,
      amountUnits: BigInt(t.amountUnits),
      minEpoch: t.minEpoch,
      maxEpoch: t.maxEpoch,
      chainIdentifier: t.chainIdentifier,
      nonce: t.nonce,
    });
    expect(bytes.toString('hex')).toBe(t.hex);
    expect(transactionDigest(bytes)).toBe(t.digest);
    const seed = Buffer.from('22'.repeat(32), 'hex');
    const sig = Buffer.concat([
      Buffer.from([0]),
      ed25519Sign(signingDigest(bytes), seed),
      ed25519PublicKey(seed),
    ]).toString('base64');
    expect(sig).toBe(t.signature);
  });
  it('base58 ida y vuelta, y validación de tipos/direcciones', () => {
    expect(base58Encode(base58Decode(t.chainIdentifier))).toBe(t.chainIdentifier);
    expect(base58Decode('11')).toEqual(Buffer.from([0, 0]));
    expect(() => base58Decode('0OIl')).toThrow(/base58/);
    const base = {
      sender: t.sender,
      recipient: t.recipient,
      coinType: t.usdc,
      amountUnits: 1n,
      minEpoch: 1,
      maxEpoch: 2,
      chainIdentifier: t.chainIdentifier,
      nonce: 0,
    };
    expect(() => buildGaslessTransfer({ ...base, coinType: 'usdc' })).toThrow(
      /tipo Move/,
    );
    expect(() => buildGaslessTransfer({ ...base, recipient: '0xzz' })).toThrow(
      /dirección Sui/,
    );
  });
});

describe('rlp / userOperationHash', () => {
  it('RLP: casos canónicos', () => {
    expect(rlpEncode(0n).toString('hex')).toBe('80');
    expect(rlpEncode(15n).toString('hex')).toBe('0f');
    expect(rlpEncode(1024n).toString('hex')).toBe('820400');
    expect(rlpEncode('dog').toString('hex')).toBe('83646f67');
    expect(rlpEncode(['cat', 'dog']).toString('hex')).toBe('c88363617483646f67');
    expect(rlpEncode([]).toString('hex')).toBe('c0');
    expect(rlpEncode('0x' + 'ab'.repeat(60)).length).toBe(62);
  });
  it('userOperationHash es determinista y sensible a cada campo', () => {
    const op = {
      sender: v.evm.address,
      nonce: '0x1',
      callData: '0x1234',
      callGasLimit: '0x5208',
      verificationGasLimit: '0x5208',
      preVerificationGas: '0x5208',
      maxFeePerGas: '0x1',
      maxPriorityFeePerGas: '0x1',
      signature: '0x',
    };
    const ep = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
    const h1 = userOperationHash(op, ep, 84532);
    expect(h1).toMatch(/^0x[0-9a-f]{64}$/);
    expect(userOperationHash({ ...op, nonce: '0x2' }, ep, 84532)).not.toBe(h1);
    expect(userOperationHash(op, ep, 8453)).not.toBe(h1);
    expect(
      userOperationHash(
        {
          ...op,
          paymaster: v.evm.address,
          paymasterVerificationGasLimit: '0x1',
          paymasterPostOpGasLimit: '0x1',
          paymasterData: '0x',
        },
        ep,
        84532,
      ),
    ).not.toBe(h1);
  });
});
