/** Fábrica de adaptadores de cadena. */
import { resolveTrustNetwork, type TrustNetwork } from '../config/defaults';
import type { ChainType } from '../types';
import type { ChainAdapter, ChainAdapterOptions } from './base-adapter';
import { EvmAdapter, type EvmAdapterOptions } from './evm-adapter';
import { SuiAdapter, type SuiAdapterOptions } from './sui-adapter';

export * from './base-adapter';
export {
  EvmAdapter,
  permissionDomain,
  permissionMessage,
  permissionDigest,
  delegationMessage,
  userOperationHash,
  rlpEncode,
} from './evm-adapter';
export type { EvmAdapterOptions } from './evm-adapter';
export { SuiAdapter, suiPermissionMessage, suiDelegationMessage } from './sui-adapter';
export type { SuiAdapterOptions, ExternalSuiSigner } from './sui-adapter';
export {
  buildGaslessTransfer,
  transactionDigest,
  signingDigest,
  base58Decode,
  base58Encode,
} from './sui-bcs';

/** Opciones de la fábrica (unión de las de cada adaptador, sin `network`). */
export type AdapterFactoryOptions = Omit<ChainAdapterOptions, 'network'> &
  Partial<Omit<EvmAdapterOptions, 'network'>> &
  Partial<Omit<SuiAdapterOptions, 'network'>>;

/**
 * Crea el adaptador adecuado para una cadena/red.
 * @param chain Familia (`sui`, `evm`, `base`, `skale`).
 * @param network Red concreta (opcional; por defecto la principal de la familia).
 * @param opts Opciones (clave, fetch, bundler, relayer…). Se completan con
 *   variables de entorno `WEBMCP_TRUST_*`.
 */
export function createChainAdapter(
  chain: ChainType,
  network?: string | TrustNetwork,
  opts: AdapterFactoryOptions = {},
): ChainAdapter {
  const net = typeof network === 'object' ? network : resolveTrustNetwork(network, chain);
  const env = process.env;
  const common = {
    network: net,
    fetch: opts.fetch,
    timeoutMs: opts.timeoutMs,
    privateKey: opts.privateKey ?? env.WEBMCP_TRUST_KEY,
    now: opts.now,
  };
  if (net.chain === 'sui') {
    return new SuiAdapter({
      ...common,
      registryPackage: opts.registryPackage ?? env.WEBMCP_TRUST_SUI_REGISTRY,
      sealSigner: opts.sealSigner,
      sponsor: opts.sponsor,
      gasStationUrl: opts.gasStationUrl ?? env.WEBMCP_TRUST_SUI_GAS_STATION,
    });
  }
  return new EvmAdapter({
    ...common,
    bundlerUrl: opts.bundlerUrl ?? env.WEBMCP_TRUST_BUNDLER,
    paymasterUrl: opts.paymasterUrl ?? env.WEBMCP_TRUST_PAYMASTER,
    smartAccount: opts.smartAccount ?? env.WEBMCP_TRUST_SMART_ACCOUNT,
    relayerUrl: opts.relayerUrl ?? env.WEBMCP_TRUST_RELAYER,
    policyContract: opts.policyContract ?? env.WEBMCP_TRUST_POLICY_CONTRACT,
    auditContract: opts.auditContract ?? env.WEBMCP_TRUST_AUDIT_CONTRACT,
  });
}
