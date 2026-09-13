/**
 * Configuración por defecto de la capa de confianza: redes, registros
 * ERC-8004 canónicos, tokens estables, límites y TTLs. Todo es sobrescribible
 * por variables de entorno (`WEBMCP_TRUST_*`) o por las opciones del engine.
 */
import type { ChainType } from '../types';

/** Descripción de una red soportada. */
export interface TrustNetwork {
  /** Identificador estable (`base-sepolia`). */
  id: string;
  chain: ChainType;
  /** Nombre legible. */
  name: string;
  testnet: boolean;
  /** JSON-RPC (EVM) o GraphQL (Sui). */
  rpc: string;
  /** chainId EVM (ausente en Sui). */
  chainId?: number;
  /** Identificador de cadena Sui (`mainnet`, `testnet`). */
  suiNetwork?: 'mainnet' | 'testnet' | 'devnet' | 'localnet';
  /** Contrato/tipo USDC nativo. */
  usdc?: string;
  /** Otros stablecoins aptos para transferencias gasless (Sui) o EIP-3009 (EVM). */
  stablecoins?: Record<string, string>;
  /** Registro de identidad ERC-8004 (EVM). */
  identityRegistry?: string;
  /** Registro de reputación ERC-8004 (EVM). */
  reputationRegistry?: string;
  /** EntryPoint ERC-4337 v0.7 (EVM). */
  entryPoint?: string;
  /** ¿La red es gasless de forma nativa (SKALE = sFUEL gratuito; Sui = stablecoins)? */
  nativeGasless: boolean;
  explorer?: string;
  /** Nombre CAIP-2 (`eip155:84532`, `sui:testnet`). */
  caip2: string;
}

/** Registros ERC-8004 canónicos (misma dirección en mainnets y testnets, vía CREATE2). */
export const ERC8004_MAINNET_IDENTITY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
export const ERC8004_MAINNET_REPUTATION = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
export const ERC8004_TESTNET_IDENTITY = '0x8004A818BFB912233c491871b3d84c89A494BD9e';
export const ERC8004_TESTNET_REPUTATION = '0x8004B663056A597Dffe9eCcC1965A193B7388713';
/** EntryPoint ERC-4337 v0.7 (misma dirección en todas las EVM). */
export const ENTRYPOINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';

/** Catálogo de redes. */
export const TRUST_NETWORKS: Record<string, TrustNetwork> = {
  'sui-mainnet': {
    id: 'sui-mainnet',
    chain: 'sui',
    name: 'Sui Mainnet',
    testnet: false,
    rpc: 'https://graphql.mainnet.sui.io/graphql',
    suiNetwork: 'mainnet',
    usdc: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    stablecoins: {
      USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    },
    nativeGasless: true,
    explorer: 'https://suiscan.xyz/mainnet',
    caip2: 'sui:mainnet',
  },
  'sui-testnet': {
    id: 'sui-testnet',
    chain: 'sui',
    name: 'Sui Testnet',
    testnet: true,
    rpc: 'https://graphql.testnet.sui.io/graphql',
    suiNetwork: 'testnet',
    usdc: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    stablecoins: {
      USDC: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
    },
    nativeGasless: true,
    explorer: 'https://suiscan.xyz/testnet',
    caip2: 'sui:testnet',
  },
  base: {
    id: 'base',
    chain: 'base',
    name: 'Base',
    testnet: false,
    rpc: 'https://mainnet.base.org',
    chainId: 8453,
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    identityRegistry: ERC8004_MAINNET_IDENTITY,
    reputationRegistry: ERC8004_MAINNET_REPUTATION,
    entryPoint: ENTRYPOINT_V07,
    nativeGasless: false,
    explorer: 'https://basescan.org',
    caip2: 'eip155:8453',
  },
  'base-sepolia': {
    id: 'base-sepolia',
    chain: 'base',
    name: 'Base Sepolia',
    testnet: true,
    rpc: 'https://sepolia.base.org',
    chainId: 84532,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    identityRegistry: ERC8004_TESTNET_IDENTITY,
    reputationRegistry: ERC8004_TESTNET_REPUTATION,
    entryPoint: ENTRYPOINT_V07,
    nativeGasless: false,
    explorer: 'https://sepolia.basescan.org',
    caip2: 'eip155:84532',
  },
  ethereum: {
    id: 'ethereum',
    chain: 'evm',
    name: 'Ethereum',
    testnet: false,
    rpc: 'https://eth.llamarpc.com',
    chainId: 1,
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    identityRegistry: ERC8004_MAINNET_IDENTITY,
    reputationRegistry: ERC8004_MAINNET_REPUTATION,
    entryPoint: ENTRYPOINT_V07,
    nativeGasless: false,
    explorer: 'https://etherscan.io',
    caip2: 'eip155:1',
  },
  sepolia: {
    id: 'sepolia',
    chain: 'evm',
    name: 'Ethereum Sepolia',
    testnet: true,
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    chainId: 11155111,
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    identityRegistry: ERC8004_TESTNET_IDENTITY,
    reputationRegistry: ERC8004_TESTNET_REPUTATION,
    entryPoint: ENTRYPOINT_V07,
    nativeGasless: false,
    explorer: 'https://sepolia.etherscan.io',
    caip2: 'eip155:11155111',
  },
  'skale-europa': {
    id: 'skale-europa',
    chain: 'skale',
    name: 'SKALE Europa Hub',
    testnet: false,
    rpc: 'https://mainnet.skalenodes.com/v1/elated-tan-skat',
    chainId: 2046399126,
    usdc: '0x5F795bb52dAC3085f578f4877D450e2929D2F13d',
    entryPoint: ENTRYPOINT_V07,
    nativeGasless: true,
    explorer: 'https://elated-tan-skat.explorer.mainnet.skalenodes.com',
    caip2: 'eip155:2046399126',
  },
  'skale-europa-testnet': {
    id: 'skale-europa-testnet',
    chain: 'skale',
    name: 'SKALE Europa Testnet',
    testnet: true,
    rpc: 'https://testnet.skalenodes.com/v1/juicy-low-small-testnet',
    chainId: 1444673419,
    entryPoint: ENTRYPOINT_V07,
    nativeGasless: true,
    explorer: 'https://juicy-low-small-testnet.explorer.testnet.skalenodes.com',
    caip2: 'eip155:1444673419',
  },
};

/** Red por defecto de cada familia. */
export const DEFAULT_NETWORK: Record<ChainType, string> = {
  sui: 'sui-mainnet',
  base: 'base',
  evm: 'ethereum',
  skale: 'skale-europa',
};

/** Valores por defecto del engine. */
export const TRUST_DEFAULTS = {
  /** TTL de la caché de identidades (ms). */
  identityCacheTtlMs: 5 * 60_000,
  /** Reputación mínima (0–100) para aceptar una identidad con feedback. */
  minReputation: 0,
  /** Tiempo máximo de espera de una petición RPC (ms). */
  rpcTimeoutMs: 15_000,
  /** Límite de frecuencia si la política no lo declara. */
  defaultRateLimit: '60 actions/minute',
  /** Duración máxima de una prueba de permiso (s). */
  maxProofTtlSeconds: 24 * 3600,
  /** Duración por defecto de un token de confianza (s). */
  trustTokenTtlSeconds: 15 * 60,
  /** Archivo de auditoría local. */
  auditFile: '.webmcpcss/trust-audit.jsonl',
  /** Archivo de estado del motor de políticas (contadores). */
  stateFile: '.webmcpcss/trust-state.json',
  /** Nombre del dominio EIP-712 para pruebas de permiso. */
  eip712Name: 'WebMCPcss Trust',
  eip712Version: '1',
} as const;

/** Tipos EIP-712 de una prueba de permiso (`PermissionProof`). */
export const PERMISSION_TYPES = {
  Permission: [
    { name: 'agentId', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'scope', type: 'string' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint256' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'maxSpend', type: 'string' },
    { name: 'allowedContracts', type: 'string' },
    { name: 'origin', type: 'string' },
  ],
};

/** Tipos EIP-712 de una delegación de clave de sesión (`SessionDelegation`). */
export const DELEGATION_TYPES = {
  Delegation: [
    { name: 'delegate', type: 'address' },
    { name: 'delegator', type: 'address' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'scope', type: 'string' },
  ],
};

/**
 * Resuelve una red por id, alias (`base`, `sui`, `skale`), CAIP-2 o chainId.
 * @param ref Referencia.
 * @param chain Familia por defecto si `ref` está vacío.
 */
export function resolveTrustNetwork(
  ref: string | number | undefined,
  chain?: ChainType,
): TrustNetwork {
  const envRpc = process.env.WEBMCP_TRUST_RPC;
  if (ref === undefined || ref === '') {
    const id = DEFAULT_NETWORK[chain ?? 'sui'];
    return withEnvRpc(TRUST_NETWORKS[id], envRpc);
  }
  const key = String(ref).toLowerCase().trim();
  if (TRUST_NETWORKS[key]) return withEnvRpc(TRUST_NETWORKS[key], envRpc);
  if (key === 'sui') return withEnvRpc(TRUST_NETWORKS['sui-mainnet'], envRpc);
  if (key === 'skale') return withEnvRpc(TRUST_NETWORKS['skale-europa'], envRpc);
  if (key === 'evm' || key === 'mainnet')
    return withEnvRpc(TRUST_NETWORKS.ethereum, envRpc);
  const byCaip = Object.values(TRUST_NETWORKS).find((n) => n.caip2 === key);
  if (byCaip) return withEnvRpc(byCaip, envRpc);
  const asNum = Number(key);
  if (Number.isFinite(asNum)) {
    const byId = Object.values(TRUST_NETWORKS).find((n) => n.chainId === asNum);
    if (byId) return withEnvRpc(byId, envRpc);
  }
  throw new Error(
    `Red desconocida: ${ref}. Disponibles: ${Object.keys(TRUST_NETWORKS).join(', ')}`,
  );
}

function withEnvRpc(net: TrustNetwork, envRpc: string | undefined): TrustNetwork {
  const specific =
    process.env[`WEBMCP_TRUST_RPC_${net.id.toUpperCase().replace(/-/g, '_')}`];
  const rpc = specific ?? envRpc;
  return rpc ? { ...net, rpc } : net;
}

/** ¿La familia es EVM (incluye base y skale)? */
export function isEvmChain(chain: ChainType): boolean {
  return chain !== 'sui';
}
