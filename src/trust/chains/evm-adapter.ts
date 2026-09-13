/**
 * Adaptador EVM (Ethereum, Base, SKALE y cualquier red `eip155`) sin
 * dependencias: JSON-RPC con `fetch`, ABI propio, ERC-8004 (identidad +
 * reputación), EIP-712 para pruebas de permiso, EIP-3009 para pagos gasless
 * de USDC y ERC-4337 v0.7 (UserOperation + paymaster) a través de un bundler.
 *
 * Si `ethers` está instalado se puede inyectar con `setEthersModule` del
 * módulo web3, pero no es necesario para ninguna operación de este adaptador.
 */
import { decodeParams, encodeCall, encodeParams } from '../crypto/abi';
import {
  signTypedData,
  typedDataHash,
  verifyTypedData,
  type TypedDomain,
} from '../crypto/eip712';
import { keccak256, keccak256Hex } from '../crypto/keccak';
import {
  hashMessage,
  isAddress,
  privateKeyToAddress,
  recoverAddress,
  signHex,
  toChecksumAddress,
} from '../crypto/secp256k1';
import {
  DELEGATION_TYPES,
  PERMISSION_TYPES,
  TRUST_DEFAULTS,
  type TrustNetwork,
} from '../config/defaults';
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

/** Opciones específicas EVM. */
export interface EvmAdapterOptions extends ChainAdapterOptions {
  /** URL del bundler ERC-4337 (`eth_sendUserOperation`). */
  bundlerUrl?: string;
  /** URL del servicio paymaster (`pm_sponsorUserOperation`) si es distinto del bundler. */
  paymasterUrl?: string;
  /** Dirección de la smart account del agente (ERC-4337). */
  smartAccount?: string;
  /** URL de un relayer de meta-transacciones EIP-3009 (`POST { authorization, signature }`). */
  relayerUrl?: string;
  /** Contrato de políticas de gasto (opcional; expone `remaining(address) → uint256`). */
  policyContract?: string;
  /** Contrato de auditoría (opcional; `anchor(bytes32,uint256)` sin retorno). */
  auditContract?: string;
}

/** Dominio EIP-712 de las pruebas de permiso en una red. */
export function permissionDomain(chainId: number): TypedDomain {
  return {
    name: TRUST_DEFAULTS.eip712Name,
    version: TRUST_DEFAULTS.eip712Version,
    chainId,
  };
}

/** Mensaje EIP-712 a partir de una prueba (campos canónicos). */
export function permissionMessage(proof: PermissionProof): Record<string, unknown> {
  return {
    agentId: proof.agentId,
    signer: proof.signer,
    scope: proof.scope.join(','),
    nonce: proof.nonce,
    issuedAt: proof.issuedAt ?? 0,
    expiresAt: proof.expiresAt,
    maxSpend: proof.maxSpend ?? '',
    allowedContracts: (proof.allowedContracts ?? []).join(','),
    origin: proof.origin ?? '',
  };
}

/** Adaptador EVM. */
export class EvmAdapter implements ChainAdapter {
  readonly chain: ChainType;
  readonly network: TrustNetwork;
  private readonly opts: EvmAdapterOptions;
  private rpcId = 0;

  constructor(opts: EvmAdapterOptions) {
    this.opts = opts;
    this.network = opts.network;
    this.chain = opts.network.chain;
  }

  /** Llamada JSON-RPC genérica. */
  async rpc<T = unknown>(
    method: string,
    params: unknown[] = [],
    url = this.network.rpc,
  ): Promise<T> {
    const res = (await postJson(
      this.opts.fetch,
      url,
      { jsonrpc: '2.0', id: ++this.rpcId, method, params },
      this.opts.timeoutMs,
    )) as { result?: T; error?: { code: number; message: string; data?: unknown } };
    if (res.error) throw new RpcError(res.error.message, res.error.code, res.error.data);
    return res.result as T;
  }

  /** `eth_call` con firma y decodificación ABI. */
  async call(
    to: string,
    signature: string,
    args: unknown[],
    outputs: string[],
  ): Promise<unknown[]> {
    const data = encodeCall(signature, args as Parameters<typeof encodeCall>[1]);
    const raw = await this.rpc<string>('eth_call', [{ to, data }, 'latest']);
    if (!raw || raw === '0x')
      throw new RpcError(`sin datos al llamar ${signature} en ${to}`);
    return decodeParams(outputs, raw);
  }

  /** Dirección derivada de la clave configurada (si existe). */
  get signerAddress(): string | undefined {
    return this.opts.privateKey ? privateKeyToAddress(this.opts.privateKey) : undefined;
  }

  /** Resuelve registro + tokenId de un agentId. */
  private resolveRegistry(agentId: string): { registry: string; tokenId: bigint } | null {
    const parsed = parseAgentId(agentId);
    if (parsed.tokenId === undefined) return null;
    const registry = parsed.registry ?? this.network.identityRegistry;
    if (!registry) return null;
    if (
      parsed.chainRef &&
      this.network.chainId &&
      parsed.chainRef !== String(this.network.chainId)
    )
      throw new Error(
        `El agentId es de la cadena ${parsed.chainRef} pero la red configurada es ${this.network.id} (${this.network.chainId})`,
      );
    return { registry, tokenId: parsed.tokenId };
  }

  /**
   * Verifica una identidad ERC-8004: owner (ERC-721), `agentWallet`, `agentURI`
   * y resumen de reputación (filtrado por los clientes que han opinado).
   */
  async verifyIdentity(agentId: string): Promise<AgentIdentity | null> {
    const target = this.resolveRegistry(agentId);
    const now = this.opts.now ? this.opts.now() : Date.now();
    if (!target) {
      // Dirección suelta: identidad no registrada (verificable solo por firma).
      const parsed = parseAgentId(agentId);
      if (parsed.address && isAddress(parsed.address)) {
        return {
          agentId,
          ownerAddress: toChecksumAddress(parsed.address),
          verified: false,
          chain: this.chain,
          method: 'none',
          verifiedAt: now,
          reason:
            'la dirección no está registrada en ERC-8004 (sin registro configurado o sin #tokenId)',
        };
      }
      return null;
    }
    const { registry, tokenId } = target;
    const canonical = `eip155:${this.network.chainId}:${registry}#${tokenId}`;
    let owner: string;
    try {
      [owner] = (await this.call(
        registry,
        'ownerOf(uint256)',
        [tokenId],
        ['address'],
      )) as [string];
    } catch (err) {
      const msg = (err as Error).message;
      if (/revert|nonexistent|invalid token|sin datos/i.test(msg)) {
        return {
          agentId: canonical,
          ownerAddress: '0x0000000000000000000000000000000000000000',
          verified: false,
          chain: this.chain,
          method: 'erc8004',
          verifiedAt: now,
          reason: `agentId ${tokenId} no existe en ${registry}`,
        };
      }
      throw err;
    }
    const identity: AgentIdentity = {
      agentId: canonical,
      ownerAddress: owner,
      verified: true,
      chain: this.chain,
      method: 'erc8004',
      verifiedAt: now,
    };
    await Promise.all([
      this.call(registry, 'getAgentWallet(uint256)', [tokenId], ['address'])
        .then(([w]) => {
          const wallet = w as string;
          if (wallet && !/^0x0{40}$/.test(wallet)) identity.agentWallet = wallet;
        })
        .catch(() => undefined),
      this.call(registry, 'tokenURI(uint256)', [tokenId], ['string'])
        .then(([uri]) => {
          identity.agentURI = uri as string;
          const name = registrationName(uri as string);
          if (name) identity.name = name;
        })
        .catch(() => undefined),
      this.reputation(tokenId)
        .then((rep) => {
          if (rep) {
            identity.reputation = rep.score;
            identity.feedbackCount = rep.count;
          }
        })
        .catch(() => undefined),
    ]);
    return identity;
  }

  /** Resumen de reputación ERC-8004 (`getClients` + `getSummary`). */
  async reputation(tokenId: bigint): Promise<{ score: number; count: number } | null> {
    const rep = this.network.reputationRegistry;
    if (!rep) return null;
    const [clients] = (await this.call(
      rep,
      'getClients(uint256)',
      [tokenId],
      ['address[]'],
    )) as [string[]];
    if (!clients.length) return { score: 0, count: 0 };
    const [count, value, decimals] = (await this.call(
      rep,
      'getSummary(uint256,address[],string,string)',
      [tokenId, clients.slice(0, 64), '', ''],
      ['uint64', 'int128', 'uint8'],
    )) as [bigint, bigint, bigint];
    const score = Number(value) / 10 ** Number(decimals);
    return { score: Math.max(0, Math.min(100, Math.round(score))), count: Number(count) };
  }

  /** Verifica la firma EIP-712 (o EIP-191 como respaldo) de una prueba de permiso. */
  async verifyProofSignature(proof: PermissionProof): Promise<ProofSignatureCheck> {
    if (!isAddress(proof.signer))
      return { valid: false, reason: 'signer no es una dirección EVM' };
    const chainId = proof.chainId ?? this.network.chainId ?? 1;
    const message = permissionMessage(proof);
    try {
      const recovered = verifyTypedData(
        permissionDomain(chainId),
        PERMISSION_TYPES,
        message,
        proof.signature,
      );
      if (recovered.toLowerCase() === proof.signer.toLowerCase())
        return this.withDelegation(proof, { valid: true, signer: recovered }, chainId);
      // Respaldo: firma EIP-191 del JSON canónico (billeteras sin signTypedData).
      const personal = recoverAddress(
        hashMessage(JSON.stringify(message)),
        proof.signature,
      );
      if (personal.toLowerCase() === proof.signer.toLowerCase())
        return this.withDelegation(proof, { valid: true, signer: personal }, chainId);
      return {
        valid: false,
        signer: recovered,
        reason: 'la firma no corresponde al signer declarado',
      };
    } catch (err) {
      return { valid: false, reason: `firma inválida: ${(err as Error).message}` };
    }
  }

  /** Comprueba la delegación de clave de sesión (EIP-712 `Delegation`) si la prueba la incluye. */
  private withDelegation(
    proof: PermissionProof,
    ok: ProofSignatureCheck,
    chainId: number,
  ): ProofSignatureCheck {
    const d = proof.delegation;
    if (!d) return ok;
    if (!isAddress(d.delegator) || !isAddress(d.delegate))
      return { valid: false, reason: 'delegación con direcciones inválidas' };
    if (d.delegate.toLowerCase() !== proof.signer.toLowerCase())
      return { valid: false, reason: 'la delegación no es para este signer' };
    const nowS = Math.floor((this.opts.now ? this.opts.now() : Date.now()) / 1000);
    if (d.expiresAt <= nowS) return { valid: false, reason: 'delegación expirada' };
    if (d.expiresAt < proof.expiresAt)
      return { valid: false, reason: 'la prueba expira después que la delegación' };
    if (d.scope?.length) {
      const allowed = new Set(d.scope.map((s) => s.toLowerCase()));
      const outside = proof.scope.filter(
        (s) => !allowed.has('*') && !allowed.has(s.toLowerCase()),
      );
      if (outside.length)
        return {
          valid: false,
          reason: `scope [${outside.join(', ')}] fuera de la delegación`,
        };
    }
    try {
      const recovered = verifyTypedData(
        permissionDomain(chainId),
        DELEGATION_TYPES,
        delegationMessage(d),
        d.signature,
      );
      if (recovered.toLowerCase() !== d.delegator.toLowerCase())
        return {
          valid: false,
          reason: 'la firma de la delegación no corresponde al delegador',
        };
      return { ...ok, delegatedBy: recovered };
    } catch (err) {
      return { valid: false, reason: `delegación inválida: ${(err as Error).message}` };
    }
  }

  /**
   * Firma una delegación de clave de sesión con la clave configurada (el owner
   * delega en `delegate`).
   */
  signDelegation(
    d: Omit<SessionDelegation, 'signature' | 'delegator'>,
    chainId = this.network.chainId ?? 1,
  ): SessionDelegation {
    if (!this.opts.privateKey)
      throw new Error('Se necesita la clave del owner para delegar (WEBMCP_TRUST_KEY).');
    const delegator = privateKeyToAddress(this.opts.privateKey);
    const full: SessionDelegation = { ...d, delegator, signature: '' };
    full.signature = signTypedData(
      permissionDomain(chainId),
      DELEGATION_TYPES,
      delegationMessage(full),
      this.opts.privateKey,
    );
    return full;
  }

  /**
   * Firma una prueba de permiso con la clave configurada (EIP-712).
   * @param proof Prueba sin `signature` (el `signer` se rellena con la clave).
   */
  signProof(
    proof: Omit<PermissionProof, 'signature' | 'signer'> & { signer?: string },
  ): PermissionProof {
    if (!this.opts.privateKey)
      throw new Error('Se necesita una clave privada para firmar (WEBMCP_TRUST_KEY).');
    const signer = privateKeyToAddress(this.opts.privateKey);
    const chainId = proof.chainId ?? this.network.chainId ?? 1;
    const full: PermissionProof = { ...proof, signer, signature: '', chainId };
    full.signature = signTypedData(
      permissionDomain(chainId),
      PERMISSION_TYPES,
      permissionMessage(full),
      this.opts.privateKey,
    );
    return full;
  }

  /** Saldo ERC-20 (USDC por defecto) o nativo si `token === 'native'`. */
  async getBalance(
    address: string,
    token?: string,
  ): Promise<{ amount: number; currency: string }> {
    if (token === 'native') {
      const hex = await this.rpc<string>('eth_getBalance', [address, 'latest']);
      return {
        amount: fromUnits(BigInt(hex), 18),
        currency: this.network.chain === 'skale' ? 'sFUEL' : 'ETH',
      };
    }
    const contract = token ?? this.network.usdc;
    if (!contract)
      throw new Error(
        `La red ${this.network.id} no tiene USDC configurado; indica el token.`,
      );
    const [raw] = (await this.call(
      contract,
      'balanceOf(address)',
      [address],
      ['uint256'],
    )) as [bigint];
    let decimals = 6;
    let symbol = 'USDC';
    try {
      [decimals] = (await this.call(contract, 'decimals()', [], ['uint8'])).map(
        Number,
      ) as [number];
      [symbol] = (await this.call(contract, 'symbol()', [], ['string'])) as [string];
    } catch {
      /* tokens sin metadatos: se asume USDC */
    }
    return { amount: fromUnits(raw, decimals), currency: symbol };
  }

  /** Límite restante en el contrato de políticas (si está configurado). */
  async getSpendingLimit(address: string): Promise<string> {
    if (!this.opts.policyContract) return 'sin contrato de políticas (límites locales)';
    const [remaining] = (await this.call(
      this.opts.policyContract,
      'remaining(address)',
      [address],
      ['uint256'],
    )) as [bigint];
    return `${fromUnits(remaining, 6)} USDC`;
  }

  /**
   * Ejecuta sin gas para el agente:
   * 1. `transfer` de USDC → autorización EIP-3009 firmada off-chain; la envía
   *    un relayer (`relayerUrl`) o, si no hay, se devuelve la autorización para
   *    que la liquide un facilitador x402.
   * 2. `call`/`transfer` con `bundlerUrl` → UserOperation ERC-4337 v0.7 con
   *    paymaster (patrocinado).
   * 3. En SKALE (gas gratuito) → transacción normal firmada si hay clave.
   * Sin clave privada → `dry-run` con la carga útil a firmar.
   */
  async executeGasless(tx: Transaction): Promise<TransactionResult> {
    const base = { chain: this.chain, network: this.network.id } as const;
    try {
      if (tx.kind === 'raw') return await this.sendRaw(tx, base);
      // Redes con gas gratuito (SKALE): transacción normal firmada por el agente.
      if (this.network.nativeGasless && this.opts.privateKey && !this.opts.bundlerUrl)
        return await this.sendLegacy(tx, base);
      if (tx.kind === 'transfer' && !this.opts.bundlerUrl)
        return await this.transferEip3009(tx, base);
      if (this.opts.bundlerUrl) return await this.sendUserOperation(tx, base);
      return {
        ...base,
        ok: false,
        mode: 'dry-run',
        error:
          'No hay vía gasless configurada: define WEBMCP_TRUST_BUNDLER (ERC-4337) o WEBMCP_TRUST_RELAYER (EIP-3009), o usa una red con gas gratuito (SKALE).',
        payload: tx,
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

  private async sendRaw(
    tx: Transaction,
    base: { chain: ChainType; network: string },
  ): Promise<TransactionResult> {
    const hash = await this.rpc<string>('eth_sendRawTransaction', [tx.raw]);
    return {
      ...base,
      ok: true,
      mode: 'paid',
      txHash: hash,
      explorerUrl: this.explorerUrl(hash),
    };
  }

  /** Transferencia USDC vía EIP-3009 `transferWithAuthorization`. */
  private async transferEip3009(
    tx: Transaction,
    base: { chain: ChainType; network: string },
  ): Promise<TransactionResult> {
    const token = tx.token ?? this.network.usdc;
    if (!token)
      throw new Error(`La red ${this.network.id} no tiene USDC; indica tx.token.`);
    if (!tx.to || !isAddress(tx.to)) throw new Error('tx.to debe ser una dirección EVM');
    const m = /^\s*([\d.]+)/.exec(tx.amount ?? '');
    if (!m) throw new Error('tx.amount inválido');
    const from = tx.from ?? this.signerAddress;
    if (!from) throw new Error('tx.from o clave privada requeridos');
    const nowS = Math.floor((this.opts.now ? this.opts.now() : Date.now()) / 1000);
    const authorization = {
      from,
      to: tx.to,
      value: toUnits(m[1], 6).toString(),
      validAfter: '0',
      validBefore: String(nowS + 3600),
      nonce: keccak256Hex(`${from}:${tx.to}:${m[1]}:${nowS}:${Math.random()}`),
    };
    const domain: TypedDomain = {
      name: 'USD Coin',
      version: '2',
      chainId: this.network.chainId,
      verifyingContract: token,
    };
    const types = {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    };
    if (!this.opts.privateKey) {
      return {
        ...base,
        ok: false,
        mode: 'dry-run',
        error:
          'Sin clave privada: firma esta autorización EIP-3009 con la billetera del agente.',
        payload: {
          typedData: {
            domain,
            types,
            primaryType: 'TransferWithAuthorization',
            message: authorization,
          },
        },
      };
    }
    if (privateKeyToAddress(this.opts.privateKey).toLowerCase() !== from.toLowerCase())
      throw new Error('tx.from no coincide con la clave configurada');
    const signature = signTypedData(domain, types, authorization, this.opts.privateKey);
    if (this.opts.relayerUrl) {
      const res = (await postJson(
        this.opts.fetch,
        this.opts.relayerUrl,
        { network: this.network.id, token, authorization, signature },
        this.opts.timeoutMs,
      )) as { txHash?: string; hash?: string; error?: string };
      if (res.error) throw new Error(`relayer: ${res.error}`);
      const hash = res.txHash ?? res.hash ?? '';
      return {
        ...base,
        ok: true,
        mode: 'gasless',
        txHash: hash,
        explorerUrl: this.explorerUrl(hash),
      };
    }
    // Sin relayer: devolvemos la autorización firmada (X-PAYMENT compatible x402).
    const payload = {
      x402Version: 1,
      scheme: 'exact',
      network: this.network.id,
      payload: { signature, authorization },
    };
    return {
      ...base,
      ok: true,
      mode: 'gasless',
      pending: true,
      payload: {
        xPayment: Buffer.from(JSON.stringify(payload)).toString('base64'),
        ...payload,
      },
    };
  }

  /** Construye, patrocina y envía una UserOperation ERC-4337 v0.7. */
  private async sendUserOperation(
    tx: Transaction,
    base: { chain: ChainType; network: string },
  ): Promise<TransactionResult> {
    const bundler = this.opts.bundlerUrl as string;
    const sender = this.opts.smartAccount ?? tx.from;
    if (!sender || !isAddress(sender))
      throw new Error(
        'Se necesita la smart account (WEBMCP_TRUST_SMART_ACCOUNT o tx.from)',
      );
    const entryPoint =
      this.network.entryPoint ?? '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
    // callData = execute(dest, value, func) (formato SimpleAccount/Kernel/Safe-4337 compatible).
    let dest: string;
    let func: string;
    if (tx.kind === 'transfer') {
      const token = tx.token ?? this.network.usdc;
      if (!token || !tx.to) throw new Error('transfer requiere token y destino');
      const m = /^\s*([\d.]+)/.exec(tx.amount ?? '');
      if (!m) throw new Error('tx.amount inválido');
      dest = token;
      func = encodeCall('transfer(address,uint256)', [tx.to, toUnits(m[1], 6)]);
    } else {
      dest = tx.contract ?? tx.to ?? '';
      func = tx.data ?? '0x';
    }
    if (!isAddress(dest)) throw new Error('destino inválido para la UserOperation');
    const callData = encodeCall('execute(address,uint256,bytes)', [dest, 0, func]);
    const nonceHex = await this.rpc<string>('eth_call', [
      { to: entryPoint, data: encodeCall('getNonce(address,uint192)', [sender, 0]) },
      'latest',
    ]).catch(() => '0x0');
    const userOp: Record<string, string> = {
      sender,
      nonce: nonceHex && nonceHex !== '0x' ? '0x' + BigInt(nonceHex).toString(16) : '0x0',
      callData,
      callGasLimit: '0x0',
      verificationGasLimit: '0x0',
      preVerificationGas: '0x0',
      maxFeePerGas: '0x0',
      maxPriorityFeePerGas: '0x0',
      signature: '0x' + 'ff'.repeat(65),
    };
    // Patrocinio: pm_sponsorUserOperation (Pimlico/Alchemy/Coinbase devuelven campos v0.7).
    const pmUrl = this.opts.paymasterUrl ?? bundler;
    const sponsored = (await this.rpc<Record<string, string>>(
      'pm_sponsorUserOperation',
      [userOp, entryPoint],
      pmUrl,
    ).catch(() => null)) as Record<string, string> | null;
    if (sponsored) Object.assign(userOp, sponsored);
    if (!sponsored) {
      const gas = (await this.rpc<Record<string, string>>(
        'eth_estimateUserOperationGas',
        [userOp, entryPoint],
        bundler,
      ).catch(() => null)) as Record<string, string> | null;
      if (gas) Object.assign(userOp, gas);
      const fee = await this.rpc<string>('eth_gasPrice', []).catch(() => '0x0');
      userOp.maxFeePerGas = fee;
      userOp.maxPriorityFeePerGas = fee;
    }
    const userOpHash = userOperationHash(userOp, entryPoint, this.network.chainId ?? 1);
    if (!this.opts.privateKey) {
      return {
        ...base,
        ok: false,
        mode: 'dry-run',
        error:
          'Sin clave: firma userOpHash con el owner de la smart account y reenvía con kind:"raw".',
        payload: { userOp, entryPoint, userOpHash },
      };
    }
    userOp.signature = signHex(
      hashMessage(Buffer.from(userOpHash.slice(2), 'hex')),
      this.opts.privateKey,
    );
    const hash = await this.rpc<string>(
      'eth_sendUserOperation',
      [userOp, entryPoint],
      bundler,
    );
    return {
      ...base,
      ok: true,
      mode: sponsored ? 'sponsored' : 'paid',
      txHash: hash,
      explorerUrl: this.explorerUrl(hash),
      payload: { userOpHash: hash },
    };
  }

  /** Transacción legacy (tipo 0) firmada localmente: solo para redes con gas gratuito. */
  private async sendLegacy(
    tx: Transaction,
    base: { chain: ChainType; network: string },
  ): Promise<TransactionResult> {
    const key = this.opts.privateKey as string;
    const from = privateKeyToAddress(key);
    let to: string;
    let data: string;
    if (tx.kind === 'transfer') {
      const token = tx.token ?? this.network.usdc;
      const m = /^\s*([\d.]+)/.exec(tx.amount ?? '');
      if (!token || !tx.to || !m)
        throw new Error('transfer requiere token, destino e importe');
      to = token;
      data = encodeCall('transfer(address,uint256)', [tx.to, toUnits(m[1], 6)]);
    } else {
      to = tx.contract ?? tx.to ?? '';
      data = tx.data ?? '0x';
    }
    const [nonceHex, gasPriceHex] = await Promise.all([
      this.rpc<string>('eth_getTransactionCount', [from, 'pending']),
      this.rpc<string>('eth_gasPrice', []),
    ]);
    const gasHex = await this.rpc<string>('eth_estimateGas', [{ from, to, data }]).catch(
      () => '0x30d40',
    );
    const chainId = BigInt(this.network.chainId ?? 1);
    const fields = [BigInt(nonceHex), BigInt(gasPriceHex), BigInt(gasHex), to, 0n, data];
    const unsigned = rlpEncode([...fields, chainId, 0n, 0n]);
    const sig = signHex(keccak256(unsigned), key);
    const r = BigInt('0x' + sig.slice(2, 66));
    const s = BigInt('0x' + sig.slice(66, 130));
    const v = BigInt(parseInt(sig.slice(130), 16) - 27) + chainId * 2n + 35n;
    const raw = '0x' + rlpEncode([...fields, v, r, s]).toString('hex');
    const hash = await this.rpc<string>('eth_sendRawTransaction', [raw]);
    return {
      ...base,
      ok: true,
      mode: 'gasless',
      txHash: hash,
      explorerUrl: this.explorerUrl(hash),
    };
  }

  /** Ancla el hash de una acción en el contrato de auditoría (si existe) o devuelve el hash local. */
  async registerAuditLog(action: AuditAction): Promise<string> {
    const digest = keccak256Hex(canonicalAudit(action));
    if (!this.opts.auditContract || !this.opts.privateKey) return digest;
    const res = await this.sendLegacy(
      {
        chain: this.chain,
        kind: 'call',
        contract: this.opts.auditContract,
        data: encodeCall('anchor(bytes32,uint256)', [
          digest,
          action.timestamp ?? Date.now(),
        ]),
      },
      { chain: this.chain, network: this.network.id },
    );
    return res.txHash ?? digest;
  }

  explorerUrl(txHash: string): string | undefined {
    return this.network.explorer && txHash
      ? `${this.network.explorer}/tx/${txHash}`
      : undefined;
  }
}

/** Mensaje EIP-712 de una delegación. */
export function delegationMessage(d: SessionDelegation): Record<string, unknown> {
  return {
    delegate: d.delegate,
    delegator: d.delegator,
    expiresAt: d.expiresAt,
    scope: (d.scope ?? []).join(','),
  };
}

/** Nombre del archivo de registro ERC-8004 si el URI es `data:application/json;base64,…`. */
export function registrationName(uri: string): string | undefined {
  const m = /^data:application\/json;base64,(.+)$/.exec(uri.trim());
  if (!m) return undefined;
  try {
    const json = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')) as {
      name?: string;
    };
    return typeof json.name === 'string' ? json.name : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Hash de una UserOperation v0.7 (packed) tal como lo calcula el EntryPoint.
 * @param op UserOperation en formato JSON (hex).
 * @param entryPoint Dirección del EntryPoint.
 * @param chainId chainId.
 */
export function userOperationHash(
  op: Record<string, string>,
  entryPoint: string,
  chainId: number,
): string {
  const pad16 = (v: string | undefined): string =>
    BigInt(v ?? '0x0')
      .toString(16)
      .padStart(32, '0');
  const accountGasLimits = '0x' + pad16(op.verificationGasLimit) + pad16(op.callGasLimit);
  const gasFees = '0x' + pad16(op.maxPriorityFeePerGas) + pad16(op.maxFeePerGas);
  const initCode = op.factory
    ? op.factory + (op.factoryData ?? '0x').slice(2)
    : (op.initCode ?? '0x');
  const paymasterAndData = op.paymaster
    ? op.paymaster +
      pad16(op.paymasterVerificationGasLimit) +
      pad16(op.paymasterPostOpGasLimit) +
      (op.paymasterData ?? '0x').slice(2)
    : (op.paymasterAndData ?? '0x');
  const packed = encodeParams(
    [
      'address',
      'uint256',
      'bytes32',
      'bytes32',
      'bytes32',
      'uint256',
      'bytes32',
      'bytes32',
    ],
    [
      op.sender,
      BigInt(op.nonce ?? '0x0'),
      keccak256Hex(Buffer.from(initCode.slice(2), 'hex')),
      keccak256Hex(Buffer.from((op.callData ?? '0x').slice(2), 'hex')),
      accountGasLimits,
      BigInt(op.preVerificationGas ?? '0x0'),
      gasFees,
      keccak256Hex(Buffer.from(paymasterAndData.slice(2), 'hex')),
    ],
  );
  return keccak256Hex(
    encodeParams(
      ['bytes32', 'address', 'uint256'],
      [keccak256Hex(packed), entryPoint, chainId],
    ),
  );
}

/** Codificación RLP mínima (enteros, hex strings y listas). */
export function rlpEncode(
  item: bigint | string | Uint8Array | Array<bigint | string | Uint8Array | unknown[]>,
): Buffer {
  const encodeLength = (len: number, offset: number): Buffer => {
    if (len < 56) return Buffer.from([len + offset]);
    const hex = len.toString(16);
    const lenBytes = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
    return Buffer.concat([Buffer.from([lenBytes.length + offset + 55]), lenBytes]);
  };
  if (Array.isArray(item)) {
    const body = Buffer.concat(item.map((i) => rlpEncode(i as bigint)));
    return Buffer.concat([encodeLength(body.length, 0xc0), body]);
  }
  let bytes: Buffer;
  if (typeof item === 'bigint') {
    if (item === 0n) bytes = Buffer.alloc(0);
    else {
      const hex = item.toString(16);
      bytes = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
    }
  } else if (typeof item === 'string') {
    const hex = item.startsWith('0x')
      ? item.slice(2)
      : Buffer.from(item, 'utf8').toString('hex');
    bytes = Buffer.from(hex.length % 2 ? '0' + hex : hex, 'hex');
  } else bytes = Buffer.from(item);
  if (bytes.length === 1 && bytes[0] < 0x80) return bytes;
  return Buffer.concat([encodeLength(bytes.length, 0x80), bytes]);
}

/** Verifica el hash EIP-712 de una prueba (utilidad para tests/documentación). */
export function permissionDigest(proof: PermissionProof, chainId: number): string {
  return (
    '0x' +
    typedDataHash(
      permissionDomain(chainId),
      PERMISSION_TYPES,
      permissionMessage(proof),
    ).toString('hex')
  );
}
