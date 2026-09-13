/**
 * Ejecutor gasless: elige la vía sin gas para el agente según la cadena
 * (Sui: transferencia de stablecoin a nivel de protocolo; EVM: EIP-3009 vía
 * relayer o ERC-4337 con paymaster; SKALE: gas gratuito), y devuelve un
 * `TransactionResult` homogéneo.
 */
import {
  createChainAdapter,
  type AdapterFactoryOptions,
  type ChainAdapter,
} from '../chains';
import type { ChainType, Transaction, TransactionResult } from '../types';

/** Opciones. */
export interface GaslessExecutorOptions extends AdapterFactoryOptions {
  adapterFactory?: (chain: ChainType, network?: string) => ChainAdapter;
  /** Si `true`, nunca envía: devuelve la carga útil a firmar. */
  dryRun?: boolean;
}

/** Ejecutor gasless. */
export class GaslessExecutor {
  constructor(private readonly opts: GaslessExecutorOptions = {}) {}

  adapter(chain: ChainType, network?: string): ChainAdapter {
    if (this.opts.adapterFactory) return this.opts.adapterFactory(chain, network);
    return createChainAdapter(chain, network, this.opts);
  }

  /**
   * Ejecuta una transacción sin gas.
   * @param tx Transacción abstracta.
   */
  async execute(tx: Transaction): Promise<TransactionResult> {
    const adapter = this.adapter(tx.chain, tx.network);
    if (this.opts.dryRun) {
      return {
        ok: false,
        mode: 'dry-run',
        chain: tx.chain,
        network: adapter.network.id,
        payload: tx,
        error: 'dry-run: no se envió nada',
      };
    }
    return adapter.executeGasless(tx);
  }
}

/** API funcional. */
export async function executeGasless(
  tx: Transaction,
  opts?: GaslessExecutorOptions,
): Promise<TransactionResult> {
  return new GaslessExecutor(opts).execute(tx);
}
