/**
 * Adaptador Sui sin dependencias: habla GraphQL con los fullnodes públicos
 * (JSON-RPC fue retirado de ellos en 2026), construye transferencias gasless de
 * stablecoins a nivel de protocolo (`balance::send_funds` con gas 0), firma con
 * Ed25519 nativo de Node y verifica firmas de mensajes personales (local y,
 * como segunda opinión, con `verifySignature` del nodo, que también cubre
 * zkLogin, passkeys y MultiSig).
 *
 * Identidad: Sui no tiene ERC-8004. El adaptador considera "registrada" una
 * dirección que (a) posee un objeto `AgentIdentity`/`AgentCap` del paquete
 * configurado en `WEBMCP_TRUST_SUI_REGISTRY`, o (b) si no hay registro,
 * demuestra control de la clave firmando la prueba de permiso.
 * Seal (MPC/threshold) se integra como *proveedor de firma* externo: si
 * `sealSigner` está definido, las transacciones se firman por el comité y no
 * por una clave única.
 */
import { keccak256Hex } from '../crypto/keccak';
import {
  ed25519PublicKey,
  ed25519Sign,
  isSuiAddress,
  suiAddressFromPublicKey,
  suiSignPersonalMessage,
  suiVerifyPersonalMessage,
} from '../crypto/ed25519';
import { hexToBytes } from '../crypto/secp256k1';
import type { TrustNetwork } from '../config/defaults';
import type {
  AgentIdentity,
  AuditAction,
  ChainType,
  PermissionProof,
  SessionDelegation,
  Transaction,
  TransactionResult,
} from '../types';
import {
  canonicalAudit,
  fromUnits,
  parseAgentId,
  postJson,
  RpcError,
  toUnits,
  type ChainAdapter,
  type ChainAdapterOptions,
  type ProofSignatureCheck,
} from './base-adapter';
import { buildGaslessTransfer, signingDigest, transactionDigest } from './sui-bcs';

/** Firmante externo (Seal MPC, KMS, hardware): recibe el digest y devuelve la firma serializada Sui (base64). */
export type ExternalSuiSigner = (
  txBytes: Uint8Array,
  digest: Uint8Array,
) => Promise<{ signature: string; address: string }>;

/** Opciones específicas Sui. */
export interface SuiAdapterOptions extends ChainAdapterOptions {
  /** Paquete Move del registro de identidad (`0x…`), opcional. */
  registryPackage?: string;
  /** Firmante externo (Seal/MPC). Tiene prioridad sobre `privateKey`. */
  sealSigner?: ExternalSuiSigner;
  /** Dirección del patrocinador de gas (para Move calls no gasless), opcional. */
  sponsor?: string;
  /** URL de una gas station (`POST { txBytes, sender }` → `{ signature, txBytes }`), opcional. */
  gasStationUrl?: string;
}

/** Mensaje canónico que firma una billetera Sui para una prueba de permiso. */
export function suiPermissionMessage(proof: PermissionProof): string {
  return [
    'WebMCPcss Trust Permission',
    `agentId: ${proof.agentId}`,
    `signer: ${proof.signer}`,
    `scope: ${proof.scope.join(',')}`,
    `nonce: ${proof.nonce}`,
    `issuedAt: ${proof.issuedAt ?? 0}`,
    `expiresAt: ${proof.expiresAt}`,
    `maxSpend: ${proof.maxSpend ?? ''}`,
    `allowedContracts: ${(proof.allowedContracts ?? []).join(',')}`,
    `origin: ${proof.origin ?? ''}`,
  ].join('\n');
}

/** Mensaje canónico de una delegación de clave de sesión en Sui. */
export function suiDelegationMessage(d: SessionDelegation): string {
  return [
    'WebMCPcss Trust Delegation',
    `delegate: ${d.delegate}`,
    `delegator: ${d.delegator}`,
    `expiresAt: ${d.expiresAt}`,
    `scope: ${(d.scope ?? []).join(',')}`,
  ].join('\n');
}

/** Adaptador Sui. */
export class SuiAdapter implements ChainAdapter {
  readonly chain: ChainType = 'sui';
  readonly network: TrustNetwork;
  private readonly opts: SuiAdapterOptions;

  constructor(opts: SuiAdapterOptions) {
    this.opts = opts;
    this.network = opts.network;
  }

  /** Consulta GraphQL. */
  async gql<T = Record<string, unknown>>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    const res = (await postJson(
      this.opts.fetch,
      this.network.rpc,
      { query, variables },
      this.opts.timeoutMs,
    )) as {
      data?: T;
      errors?: Array<{ message: string }>;
    };
    if (res.errors?.length)
      throw new RpcError(res.errors.map((e) => e.message).join('; '));
    if (!res.data) throw new RpcError('respuesta GraphQL sin datos');
    return res.data;
  }

  /** Semilla Ed25519 de la clave configurada (32 bytes). */
  private get seed(): Buffer | undefined {
    if (!this.opts.privateKey) return undefined;
    const key = this.opts.privateKey.trim();
    if (key.startsWith('suiprivkey'))
      throw new Error(
        'Usa la semilla hex de 32 bytes (no el formato bech32 suiprivkey).',
      );
    const bytes = hexToBytes(key);
    // Acepta 32 bytes (seed) o 33 con flag de esquema.
    return bytes.length === 33 && bytes[0] === 0
      ? Buffer.from(bytes.subarray(1))
      : Buffer.from(bytes);
  }

  /** Dirección derivada de la clave configurada. */
  get signerAddress(): string | undefined {
    const seed = this.seed;
    return seed ? suiAddressFromPublicKey(ed25519PublicKey(seed)) : undefined;
  }

  /** Identidad: existencia de la dirección y, si hay registro, objeto de identidad. */
  async verifyIdentity(agentId: string): Promise<AgentIdentity | null> {
    const parsed = parseAgentId(agentId);
    const address = parsed.address;
    const now = this.opts.now ? this.opts.now() : Date.now();
    if (!address || !isSuiAddress(address)) return null;
    const canonical = `sui:${this.network.suiNetwork ?? 'mainnet'}:${address}`;
    const registry = this.opts.registryPackage ?? process.env.WEBMCP_TRUST_SUI_REGISTRY;
    if (!registry) {
      // Sin registro: la identidad se acredita por control de clave (session-key).
      const data = await this.gql<{
        address: { address: string; balance: { totalBalance: string } | null } | null;
      }>(
        `query($a: SuiAddress!){ address(address:$a){ address balance(coinType:"0x2::sui::SUI"){ totalBalance } } }`,
        { a: address },
      ).catch(() => null);
      return {
        agentId: canonical,
        ownerAddress: address,
        verified: false,
        chain: 'sui',
        method: 'none',
        verifiedAt: now,
        reason: data?.address
          ? 'sin registro de identidad Sui configurado (WEBMCP_TRUST_SUI_REGISTRY); verifica por firma de sesión'
          : 'no se pudo consultar la dirección',
      };
    }
    const data = await this.gql<{
      address: {
        objects: {
          nodes: Array<{
            address: string;
            contents: { type: { repr: string }; json: unknown } | null;
          }>;
        };
      } | null;
    }>(
      `query($a: SuiAddress!, $t: String!){ address(address:$a){ objects(first: 5, filter:{ type: $t }){ nodes { address contents { type { repr } json } } } } }`,
      { a: address, t: `${registry}::identity::AgentIdentity` },
    );
    const node = data.address?.objects.nodes[0];
    if (!node) {
      return {
        agentId: canonical,
        ownerAddress: address,
        verified: false,
        chain: 'sui',
        method: 'sui-registry',
        verifiedAt: now,
        reason: `la dirección no posee un AgentIdentity del paquete ${registry}`,
      };
    }
    const json = (node.contents?.json ?? {}) as Record<string, unknown>;
    const rep = Number(json.reputation ?? json.score);
    return {
      agentId: canonical,
      ownerAddress: String(json.owner ?? address),
      agentWallet: typeof json.wallet === 'string' ? json.wallet : undefined,
      name: typeof json.name === 'string' ? json.name : undefined,
      agentURI: typeof json.uri === 'string' ? json.uri : undefined,
      reputation: Number.isFinite(rep) ? Math.max(0, Math.min(100, rep)) : undefined,
      verified: true,
      chain: 'sui',
      method: 'sui-registry',
      verifiedAt: now,
    };
  }

  /** Verifica la firma de un mensaje personal (Ed25519 local; otros esquemas vía nodo). */
  async verifyProofSignature(proof: PermissionProof): Promise<ProofSignatureCheck> {
    if (!isSuiAddress(proof.signer))
      return { valid: false, reason: 'signer no es una dirección Sui' };
    const sig = await this.verifyPersonal(
      suiPermissionMessage(proof),
      proof.signature,
      proof.signer,
    );
    if (!sig.valid) return sig;
    const d = proof.delegation;
    if (!d) return sig;
    if (
      !isSuiAddress(d.delegator) ||
      d.delegate.toLowerCase() !== proof.signer.toLowerCase()
    )
      return { valid: false, reason: 'la delegación no es para este signer' };
    const nowS = Math.floor((this.opts.now ? this.opts.now() : Date.now()) / 1000);
    if (d.expiresAt <= nowS) return { valid: false, reason: 'delegación expirada' };
    if (d.expiresAt < proof.expiresAt)
      return { valid: false, reason: 'la prueba expira después que la delegación' };
    if (d.scope?.length) {
      const allowed = new Set(d.scope.map((x) => x.toLowerCase()));
      const outside = proof.scope.filter(
        (x) => !allowed.has('*') && !allowed.has(x.toLowerCase()),
      );
      if (outside.length)
        return {
          valid: false,
          reason: `scope [${outside.join(', ')}] fuera de la delegación`,
        };
    }
    const dsig = await this.verifyPersonal(
      suiDelegationMessage(d),
      d.signature,
      d.delegator,
    );
    if (!dsig.valid)
      return { valid: false, reason: `delegación inválida: ${dsig.reason}` };
    return { ...sig, delegatedBy: d.delegator };
  }

  /** Verifica una firma de mensaje personal: Ed25519 en local; el resto (zkLogin, passkey, MultiSig) vía nodo. */
  private async verifyPersonal(
    message: string,
    signature: string,
    author: string,
  ): Promise<ProofSignatureCheck> {
    const local = suiVerifyPersonalMessage(message, signature, author);
    if (local.valid) return { valid: true, signer: local.address };
    if (local.reason && !/esquema de firma no soportado|97/.test(local.reason))
      return { valid: false, signer: local.address, reason: local.reason };
    try {
      const data = await this.gql<{ verifySignature: { success: boolean } | null }>(
        `query($m: Base64!, $s: Base64!, $a: SuiAddress!){ verifySignature(message:$m, signature:$s, intentScope: PERSONAL_MESSAGE, author:$a){ success } }`,
        { m: Buffer.from(message, 'utf8').toString('base64'), s: signature, a: author },
      );
      return data.verifySignature?.success
        ? { valid: true, signer: author }
        : { valid: false, reason: 'el nodo rechazó la firma' };
    } catch (err) {
      return {
        valid: false,
        reason: `verificación remota fallida: ${(err as Error).message}`,
      };
    }
  }

  /** Firma una delegación de clave de sesión con la clave configurada (owner → delegate). */
  signDelegation(
    d: Omit<SessionDelegation, 'signature' | 'delegator'>,
  ): SessionDelegation {
    const seed = this.seed;
    if (!seed)
      throw new Error('Se necesita la clave del owner para delegar (WEBMCP_TRUST_KEY).');
    const delegator = suiAddressFromPublicKey(ed25519PublicKey(seed));
    const full: SessionDelegation = { ...d, delegator, signature: '' };
    full.signature = suiSignPersonalMessage(suiDelegationMessage(full), seed);
    return full;
  }

  /** Firma una prueba de permiso con la clave configurada. */
  signProof(
    proof: Omit<PermissionProof, 'signature' | 'signer'> & { signer?: string },
  ): PermissionProof {
    const seed = this.seed;
    if (!seed)
      throw new Error('Se necesita una clave privada para firmar (WEBMCP_TRUST_KEY).');
    const signer = suiAddressFromPublicKey(ed25519PublicKey(seed));
    const full: PermissionProof = { ...proof, signer, signature: '', chain: 'sui' };
    full.signature = suiSignPersonalMessage(suiPermissionMessage(full), seed);
    return full;
  }

  /** Saldo (address balance + coins) de un tipo de moneda. */
  async getBalance(
    address: string,
    token?: string,
  ): Promise<{ amount: number; currency: string }> {
    const coinType = token === 'native' ? '0x2::sui::SUI' : (token ?? this.network.usdc);
    if (!coinType) throw new Error('indica el tipo de moneda');
    const data = await this.gql<{
      address: { balance: { totalBalance: string | null } | null } | null;
    }>(
      `query($a: SuiAddress!, $t: String!){ address(address:$a){ balance(coinType:$t){ totalBalance } } }`,
      { a: address, t: coinType },
    );
    const raw = data.address?.balance?.totalBalance ?? '0';
    const currency = coinType.endsWith('::sui::SUI')
      ? 'SUI'
      : (coinType.split('::').pop() ?? 'TOKEN').toUpperCase();
    return { amount: fromUnits(BigInt(raw), currency === 'SUI' ? 9 : 6), currency };
  }

  async getSpendingLimit(_address: string): Promise<string> {
    return 'sin contrato de políticas (límites locales)';
  }

  /** Época actual e identificador de cadena (para la ventana de validez). */
  async epochInfo(): Promise<{ epochId: number; chainIdentifier: string }> {
    const data = await this.gql<{ epoch: { epochId: number }; chainIdentifier: string }>(
      `{ epoch { epochId } chainIdentifier }`,
    );
    return { epochId: Number(data.epoch.epochId), chainIdentifier: data.chainIdentifier };
  }

  /**
   * Transferencia gasless de stablecoin (protocolo Sui, gas 0, sin SUI) o
   * ejecución de bytes ya construidos (`raw`). Las llamadas Move genéricas
   * requieren una gas station (`gasStationUrl`) porque no son gasless.
   */
  async executeGasless(tx: Transaction): Promise<TransactionResult> {
    const base = { chain: 'sui' as const, network: this.network.id };
    try {
      if (tx.kind === 'raw') return await this.executeRaw(tx, base);
      if (tx.kind === 'call') return await this.executeCall(tx, base);
      const coinType = tx.token ?? this.network.usdc;
      if (!coinType) throw new Error('la red no tiene USDC configurado; indica tx.token');
      if (!tx.to || !isSuiAddress(tx.to))
        throw new Error('tx.to debe ser una dirección Sui');
      const m = /^\s*([\d.]+)/.exec(tx.amount ?? '');
      if (!m) throw new Error('tx.amount inválido');
      const amountUnits = toUnits(m[1], 6);
      if (amountUnits < 10_000n)
        throw new Error('las transferencias gasless requieren un mínimo de 0.01');
      const sender = tx.from ?? this.signerAddress;
      if (!sender) throw new Error('tx.from o clave privada requeridos');
      const { epochId, chainIdentifier } = await this.epochInfo();
      const bytes = buildGaslessTransfer({
        sender,
        recipient: tx.to,
        coinType,
        amountUnits,
        minEpoch: epochId,
        maxEpoch: epochId + 1,
        chainIdentifier,
        nonce: Math.floor(Math.random() * 0xffffffff),
      });
      const digest = transactionDigest(bytes);
      const signature = await this.signBytes(bytes, sender);
      if (!signature) {
        return {
          ...base,
          ok: false,
          mode: 'dry-run',
          error:
            'Sin clave: firma txBytes (intent TransactionData) con la billetera del agente y reenvía con kind:"raw".',
          payload: { txBytes: bytes.toString('base64'), digest, sender, gasless: true },
        };
      }
      const result = await this.execute(bytes.toString('base64'), [signature]);
      return {
        ...base,
        ...result,
        mode: 'gasless',
        explorerUrl: this.explorerUrl(result.txHash ?? ''),
      };
    } catch (err) {
      return {
        ...base,
        ok: false,
        mode: 'dry-run',
        error: (err as Error).message,
        payload: tx,
      };
    }
  }

  private async signBytes(bytes: Buffer, sender: string): Promise<string | undefined> {
    if (this.opts.sealSigner) {
      const { signature, address } = await this.opts.sealSigner(
        bytes,
        signingDigest(bytes),
      );
      if (address.toLowerCase() !== sender.toLowerCase())
        throw new Error('el firmante Seal no coincide con el sender');
      return signature;
    }
    const seed = this.seed;
    if (!seed) return undefined;
    const pk = ed25519PublicKey(seed);
    if (suiAddressFromPublicKey(pk).toLowerCase() !== sender.toLowerCase())
      throw new Error('tx.from no coincide con la clave configurada');
    return Buffer.concat([
      Buffer.from([0]),
      ed25519Sign(signingDigest(bytes), seed),
      pk,
    ]).toString('base64');
  }

  private async executeRaw(
    tx: Transaction,
    base: { chain: ChainType; network: string },
  ): Promise<TransactionResult> {
    const bytes = Buffer.from(tx.raw as string, 'base64');
    let signatures = tx.signatures ?? [];
    if (!signatures.length) {
      const sig = await this.signBytes(bytes, tx.from ?? this.signerAddress ?? '');
      if (!sig) throw new Error('faltan firmas para la transacción raw');
      signatures = [sig];
    }
    const result = await this.execute(tx.raw as string, signatures);
    return {
      ...base,
      ...result,
      mode: 'paid',
      explorerUrl: this.explorerUrl(result.txHash ?? ''),
    };
  }

  /** Move call patrocinada por una gas station externa. */
  private async executeCall(
    tx: Transaction,
    base: { chain: ChainType; network: string },
  ): Promise<TransactionResult> {
    if (!this.opts.gasStationUrl) {
      return {
        ...base,
        ok: false,
        mode: 'dry-run',
        error:
          'Las llamadas Move no son gasless a nivel de protocolo: configura WEBMCP_TRUST_SUI_GAS_STATION (sponsored) o construye la tx con @mysten/sui y envíala como raw.',
        payload: tx,
      };
    }
    const res = (await postJson(
      this.opts.fetch,
      this.opts.gasStationUrl,
      {
        sender: tx.from ?? this.signerAddress,
        target: tx.data ?? tx.contract,
        args: tx.args ?? [],
        network: this.network.suiNetwork,
      },
      this.opts.timeoutMs,
    )) as { txBytes?: string; signature?: string; error?: string };
    if (res.error || !res.txBytes || !res.signature)
      throw new Error(`gas station: ${res.error ?? 'respuesta incompleta'}`);
    const bytes = Buffer.from(res.txBytes, 'base64');
    const userSig = await this.signBytes(bytes, tx.from ?? this.signerAddress ?? '');
    if (!userSig) {
      return {
        ...base,
        ok: false,
        mode: 'dry-run',
        error: 'Firma txBytes patrocinados y reenvía como raw con ambas firmas.',
        payload: { txBytes: res.txBytes, sponsorSignature: res.signature },
      };
    }
    const result = await this.execute(res.txBytes, [userSig, res.signature]);
    return {
      ...base,
      ...result,
      mode: 'sponsored',
      explorerUrl: this.explorerUrl(result.txHash ?? ''),
    };
  }

  /** `executeTransaction` GraphQL. */
  async execute(
    txBytesBase64: string,
    signatures: string[],
  ): Promise<{ ok: boolean; txHash?: string; error?: string }> {
    const data = await this.gql<{
      executeTransaction: {
        effects: {
          digest: string;
          status: 'SUCCESS' | 'FAILURE';
          executionError?: { message?: string } | null;
        } | null;
      };
    }>(
      `mutation($tx: Base64!, $sigs: [Base64!]!){ executeTransaction(transactionDataBcs:$tx, signatures:$sigs){ effects { digest status executionError { message } } } }`,
      { tx: txBytesBase64, sigs: signatures },
    );
    const eff = data.executeTransaction.effects;
    if (!eff) return { ok: false, error: 'sin efectos' };
    return eff.status === 'SUCCESS'
      ? { ok: true, txHash: eff.digest }
      : {
          ok: false,
          txHash: eff.digest,
          error: eff.executionError?.message ?? 'FAILURE',
        };
  }

  /** Estado de una transacción por digest. */
  async getTransaction(digest: string): Promise<{
    found: boolean;
    status?: string;
    timestamp?: string;
    checkpoint?: number;
  }> {
    const data = await this.gql<{
      transaction: {
        effects: {
          status: string;
          timestamp: string | null;
          checkpoint: { sequenceNumber: number } | null;
        } | null;
      } | null;
    }>(
      `query($d: String!){ transaction(digest:$d){ effects { status timestamp checkpoint { sequenceNumber } } } }`,
      { d: digest },
    );
    const eff = data.transaction?.effects;
    return eff
      ? {
          found: true,
          status: eff.status,
          timestamp: eff.timestamp ?? undefined,
          checkpoint: eff.checkpoint?.sequenceNumber,
        }
      : { found: false };
  }

  /** Ancla el hash de una acción: sin contrato de auditoría devuelve el hash local. */
  async registerAuditLog(action: AuditAction): Promise<string> {
    return keccak256Hex(canonicalAudit(action));
  }

  explorerUrl(txHash: string): string | undefined {
    return this.network.explorer && txHash
      ? `${this.network.explorer}/tx/${txHash}`
      : undefined;
  }
}
