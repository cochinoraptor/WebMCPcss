/**
 * Módulo de Confianza Blockchain Gasless (v1.3.0).
 *
 * Permite a los agentes operar en sitios con permisos verificables on-chain
 * (ERC-8004, claves de sesión, pruebas ZK), transacciones sin gas (Sui a nivel
 * de protocolo, EIP-3009/ERC-4337 en EVM, SKALE) y auditoría inmutable.
 * Sin dependencias: keccak, secp256k1, EIP-712, BLAKE2b, Ed25519 y BCS propios.
 */
export * from './types';
export * from './config/defaults';
export * from './parser/schema';
export * from './parser/trust-parser';
export * from './chains';
export * from './verifier';
export * from './executors';
export { TrustEngine } from './engine';
export type {
  TrustEngineOptions,
  TrustedExecutionResult,
  NormalExecutor,
} from './engine';
export { buildTrustBrowserScript } from './browser';
export type { TrustBrowserScriptOptions } from './browser';
export * from './mcp/trust-tools';
export { keccak256, keccak256Hex } from './crypto/keccak';
export { blake2b, blake2b256Hex } from './crypto/blake2b';
export * as secp256k1 from './crypto/secp256k1';
export * as eip712 from './crypto/eip712';
export * as abi from './crypto/abi';
export * as ed25519 from './crypto/ed25519';
