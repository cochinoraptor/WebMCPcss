/**
 * Ejecutor patrocinado: el sitio (o un servicio externo) paga el gas.
 * - EVM: fuerza la vía ERC-4337 con paymaster (`bundlerUrl`/`paymasterUrl`)
 *   o, si no hay bundler, envía con la clave del patrocinador en redes con gas
 *   gratuito.
 * - Sui: usa la gas station (`gasStationUrl`) para Move calls; las
 *   transferencias de stablecoin siguen siendo gasless (no hace falta patrocinio).
 */
import {
  createChainAdapter,
  type AdapterFactoryOptions,
  type ChainAdapter,
} from '../chains';
import type { ChainType, Transaction, TransactionResult } from '../types';

/** Opciones. */
export interface SponsoredExecutorOptions extends AdapterFactoryOptions {
  adapterFactory?: (chain: ChainType, network?: string) => ChainAdapter;
  /** Clave del patrocinador (EVM/Sui) si difiere de la del agente. */
  sponsorKey?: string;
}

/** Ejecutor patrocinado. */
export class SponsoredExecutor {
  constructor(private readonly opts: SponsoredExecutorOptions = {}) {}

  adapter(chain: ChainType, network?: string): ChainAdapter {
    if (this.opts.adapterFactory) return this.opts.adapterFactory(chain, network);
    const { sponsorKey, ...rest } = this.opts;
    return createChainAdapter(chain, network, {
      ...rest,
      privateKey:
        sponsorKey ??
        rest.privateKey ??
        process.env.WEBMCP_TRUST_SPONSOR_KEY ??
        process.env.WEBMCP_TRUST_KEY,
    });
  }

  /** Ejecuta con patrocinio de gas. */
  async execute(tx: Transaction): Promise<TransactionResult> {
    const adapter = this.adapter(tx.chain, tx.network);
    const hasSponsorRoute =
      tx.chain === 'sui'
        ? Boolean(this.opts.gasStationUrl ?? process.env.WEBMCP_TRUST_SUI_GAS_STATION) ||
          tx.kind === 'transfer'
        : Boolean(this.opts.bundlerUrl ?? process.env.WEBMCP_TRUST_BUNDLER) ||
          adapter.network.nativeGasless;
    if (!hasSponsorRoute) {
      return {
        ok: false,
        mode: 'dry-run',
        chain: tx.chain,
        network: adapter.network.id,
        payload: tx,
        error:
          tx.chain === 'sui'
            ? 'Configura WEBMCP_TRUST_SUI_GAS_STATION para patrocinar Move calls en Sui.'
            : 'Configura WEBMCP_TRUST_BUNDLER (+ WEBMCP_TRUST_PAYMASTER) para patrocinar con ERC-4337.',
      };
    }
    const result = await adapter.executeGasless(tx);
    return result.ok && result.mode === 'paid'
      ? { ...result, mode: 'sponsored' }
      : result;
  }
}

/** API funcional. */
export async function executeSponsored(
  tx: Transaction,
  opts?: SponsoredExecutorOptions,
): Promise<TransactionResult> {
  return new SponsoredExecutor(opts).execute(tx);
}
