/**
 * Tests de los adaptadores de cadena (v1.3.0) con nodos simulados: EVM
 * (ERC-8004, USDC, EIP-712/delegación, EIP-3009, ERC-4337, SKALE legacy, RLP)
 * y Sui (GraphQL, registro, Ed25519, transferencia gasless BCS, gas station,
 * Seal) más la configuración de redes y el parseo de agentIds.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EvmAdapter,
  SuiAdapter,
  TRUST_NETWORKS,
  createChainAdapter,
  isEvmChain,
  parseAgentId,
  resolveTrustNetwork,
  sameAgent,
} from '../src/trust';
import {
  DEAD,
  OWNER,
  OWNER_KEY,
  REGISTRY,
  SESSION,
  SESSION_KEY,
  STRANGER_KEY,
  SUI_ADDR,
  SUI_RECIPIENT,
  SUI_SEED,
  USDC,
  evm,
  evmState,
  fakeFetch,
  now,
  nowS,
  resetNodes,
  sel,
  signWith,
  sui,
  suiState,
} from './trust-fixtures';

beforeEach(resetNodes);

describe('config', () => {
  it('resuelve redes por id, alias, CAIP-2 y chainId; respeta WEBMCP_TRUST_RPC_*', () => {
    expect(resolveTrustNetwork('base-sepolia').chainId).toBe(84532);
    expect(resolveTrustNetwork('sui').id).toBe('sui-mainnet');
    expect(resolveTrustNetwork(undefined, 'skale').id).toBe('skale-europa');
    expect(resolveTrustNetwork('eip155:8453').id).toBe('base');
    expect(resolveTrustNetwork(2046399126).chain).toBe('skale');
    expect(resolveTrustNetwork('evm').id).toBe('ethereum');
    expect(() => resolveTrustNetwork('marte')).toThrow(/Red desconocida/);
    process.env.WEBMCP_TRUST_RPC_BASE_SEPOLIA = 'http://localhost:1/rpc';
    expect(resolveTrustNetwork('base-sepolia').rpc).toBe('http://localhost:1/rpc');
    delete process.env.WEBMCP_TRUST_RPC_BASE_SEPOLIA;
    expect(isEvmChain('sui')).toBe(false);
    expect(isEvmChain('skale')).toBe(true);
    expect(createChainAdapter('sui').chain).toBe('sui');
    expect(createChainAdapter('base', 'base-sepolia').network.id).toBe('base-sepolia');
    expect(createChainAdapter('evm', TRUST_NETWORKS.sepolia).network.id).toBe('sepolia');
  });
  it('parseAgentId y sameAgent', () => {
    expect(parseAgentId(`eip155:84532:${REGISTRY}#12`)).toMatchObject({
      namespace: 'eip155',
      chainRef: '84532',
      registry: REGISTRY,
      tokenId: 12n,
    });
    expect(parseAgentId('#3')).toEqual({ tokenId: 3n });
    expect(parseAgentId('3')).toEqual({ tokenId: 3n });
    expect(parseAgentId(`${REGISTRY}#4`)).toMatchObject({ tokenId: 4n });
    expect(parseAgentId(SUI_ADDR)).toEqual({ namespace: 'sui', address: SUI_ADDR });
    expect(parseAgentId(`sui:testnet:${SUI_ADDR}`)).toMatchObject({
      namespace: 'sui',
      chainRef: 'testnet',
      address: SUI_ADDR,
    });
    expect(parseAgentId(OWNER)).toMatchObject({ namespace: 'eip155', address: OWNER });
    expect(parseAgentId(`eip155:1:${OWNER}`)).toMatchObject({
      namespace: 'eip155',
      address: OWNER,
    });
    expect(() => parseAgentId('nope')).toThrow(/agentId inválido/);
    expect(sameAgent(`eip155:84532:${REGISTRY}#7`, '#7')).toBe(true);
    expect(sameAgent(`eip155:84532:${REGISTRY}#7`, `${DEAD}#7`)).toBe(false);
    expect(sameAgent('#7', '#8')).toBe(false);
    expect(sameAgent(`sui:testnet:${SUI_ADDR}`, SUI_ADDR.toUpperCase())).toBe(true);
  });
});

describe('EvmAdapter (ERC-8004 + USDC + gasless)', () => {
  it('verifica identidad ERC-8004 con owner, nombre y reputación', async () => {
    const id = await evm().verifyIdentity('#7');
    expect(id).toMatchObject({
      verified: true,
      ownerAddress: OWNER,
      name: 'Shopper Bot',
      reputation: 85,
      feedbackCount: 2,
      method: 'erc8004',
      agentId: `eip155:84532:${REGISTRY}#7`,
    });
    expect(id?.agentWallet).toBeUndefined();
    evmState.agents.set(9n, { owner: OWNER, wallet: DEAD, clients: [] });
    const withWallet = await evm().verifyIdentity(`${REGISTRY}#9`);
    expect(withWallet).toMatchObject({
      verified: true,
      agentWallet: DEAD,
      reputation: 0,
      feedbackCount: 0,
    });
  });
  it('agente inexistente → no verificado; dirección suelta → no registrada; otra cadena → error', async () => {
    const missing = await evm().verifyIdentity('#99');
    expect(missing).toMatchObject({ verified: false });
    expect(missing?.reason).toMatch(/no existe/);
    const loose = await evm().verifyIdentity(OWNER);
    expect(loose).toMatchObject({ verified: false, ownerAddress: OWNER, method: 'none' });
    await expect(evm().verifyIdentity(`eip155:1:${REGISTRY}#7`)).rejects.toThrow(
      /cadena 1/,
    );
    expect(await evm().verifyIdentity(SUI_ADDR)).toBeNull();
    const noRegistry = new EvmAdapter({
      network: TRUST_NETWORKS['skale-europa'],
      fetch: fakeFetch,
    });
    expect(await noRegistry.verifyIdentity('#7')).toBeNull();
  });
  it('firma y verifica pruebas EIP-712; rechaza firmante distinto y firmas rotas', async () => {
    const proof = signWith(OWNER_KEY);
    expect(proof.signer).toBe(OWNER);
    expect(await evm().verifyProofSignature(proof)).toEqual({
      valid: true,
      signer: OWNER,
    });
    expect((await evm().verifyProofSignature({ ...proof, signer: DEAD })).valid).toBe(
      false,
    );
    expect((await evm().verifyProofSignature({ ...proof, scope: ['otro'] })).valid).toBe(
      false,
    );
    expect(
      (await evm().verifyProofSignature({ ...proof, signature: '0x12' })).reason,
    ).toMatch(/firma inválida/);
    expect(
      (await evm().verifyProofSignature({ ...proof, signer: 'abc' })).reason,
    ).toMatch(/dirección/);
    expect(() =>
      new EvmAdapter({ network: TRUST_NETWORKS.base, fetch: fakeFetch }).signProof(proof),
    ).toThrow(/clave privada/);
  });
  it('delegación: owner delega en clave de sesión (válida, expirada, scope, firmante)', async () => {
    const owner = evm();
    const delegation = owner.signDelegation({
      delegate: SESSION,
      expiresAt: nowS() + 3600,
      scope: ['purchase'],
    });
    expect(delegation.delegator).toBe(OWNER);
    expect(
      await owner.verifyProofSignature(signWith(SESSION_KEY, { delegation })),
    ).toEqual({
      valid: true,
      signer: SESSION,
      delegatedBy: OWNER,
    });
    const check = (d: Partial<typeof delegation>, over = {}) =>
      owner.verifyProofSignature(
        signWith(SESSION_KEY, { delegation: { ...delegation, ...d }, ...over }),
      );
    expect((await check({ expiresAt: nowS() - 1 })).reason).toMatch(/expirada/);
    expect((await check({}, { expiresAt: nowS() + 7200 })).reason).toMatch(
      /expira después/,
    );
    expect((await check({}, { scope: ['purchase', 'refund'] })).reason).toMatch(
      /fuera de la delegación/,
    );
    expect((await check({ delegate: DEAD })).reason).toMatch(/no es para este signer/);
    expect((await check({ delegator: 'zz' })).reason).toMatch(/inválidas/);
    const forged = new EvmAdapter({
      network: TRUST_NETWORKS['base-sepolia'],
      fetch: fakeFetch,
      now,
      privateKey: STRANGER_KEY,
    }).signDelegation({ delegate: SESSION, expiresAt: nowS() + 3600 });
    expect((await check({ ...forged, delegator: OWNER })).reason).toMatch(
      /no corresponde al delegador/,
    );
    expect((await check({ signature: '0x00' })).reason).toMatch(/delegación inválida/);
    const wildcard = owner.signDelegation({
      delegate: SESSION,
      expiresAt: nowS() + 3600,
      scope: ['*'],
    });
    expect(
      (
        await owner.verifyProofSignature(
          signWith(SESSION_KEY, { delegation: wildcard, scope: ['a', 'b'] }),
        )
      ).valid,
    ).toBe(true);
  });
  it('saldos USDC/nativo y límite on-chain', async () => {
    expect(await evm().getBalance(OWNER)).toEqual({ amount: 12.5, currency: 'USDC' });
    expect(await evm().getBalance(OWNER, 'native')).toEqual({
      amount: 1,
      currency: 'ETH',
    });
    const sk = new EvmAdapter({
      network: TRUST_NETWORKS['skale-europa-testnet'],
      fetch: fakeFetch,
    });
    expect((await sk.getBalance(OWNER, 'native')).currency).toBe('sFUEL');
    await expect(sk.getBalance(OWNER)).rejects.toThrow(/USDC/);
    expect(await evm().getSpendingLimit(OWNER)).toMatch(/límites locales/);
    const withPolicy = new EvmAdapter({
      network: TRUST_NETWORKS['base-sepolia'],
      fetch: fakeFetch,
      policyContract: DEAD,
    });
    expect(await withPolicy.getSpendingLimit(OWNER)).toBe('42 USDC');
  });
  it('transfer EIP-3009 sin relayer → autorización firmada (X-PAYMENT, pending); con relayer → txHash', async () => {
    const r = await evm().executeGasless({
      chain: 'base',
      kind: 'transfer',
      to: DEAD,
      amount: '0.5 USDC',
    });
    expect(r).toMatchObject({ ok: true, mode: 'gasless', pending: true });
    const p = r.payload as {
      xPayment: string;
      payload: { authorization: { from: string; to: string; value: string } };
    };
    expect(p.payload.authorization).toMatchObject({
      from: OWNER,
      to: DEAD,
      value: '500000',
    });
    expect(JSON.parse(Buffer.from(p.xPayment, 'base64').toString()).x402Version).toBe(1);
    const relay = new EvmAdapter({
      network: TRUST_NETWORKS['base-sepolia'],
      fetch: fakeFetch,
      privateKey: OWNER_KEY,
      relayerUrl: 'http://x/relayer',
    });
    const r2 = await relay.executeGasless({
      chain: 'base',
      kind: 'transfer',
      to: DEAD,
      amount: '1 USDC',
    });
    expect(r2.ok).toBe(true);
    expect(r2.txHash).toMatch(/^0x/);
    expect(r2.explorerUrl).toContain('sepolia.basescan.org/tx/');
    const noKey = new EvmAdapter({
      network: TRUST_NETWORKS['base-sepolia'],
      fetch: fakeFetch,
    });
    const dry = await noKey.executeGasless({
      chain: 'base',
      kind: 'transfer',
      from: OWNER,
      to: DEAD,
      amount: '1 USDC',
    });
    expect(dry.mode).toBe('dry-run');
    expect(
      (dry.payload as { typedData: { primaryType: string } }).typedData.primaryType,
    ).toBe('TransferWithAuthorization');
    expect(
      (
        await evm().executeGasless({
          chain: 'base',
          kind: 'transfer',
          to: 'bad',
          amount: '1',
        })
      ).error,
    ).toMatch(/dirección/);
    expect(
      (
        await evm().executeGasless({
          chain: 'base',
          kind: 'transfer',
          to: DEAD,
          amount: 'x',
        })
      ).error,
    ).toMatch(/amount/);
    expect(
      (
        await evm().executeGasless({
          chain: 'base',
          kind: 'transfer',
          from: DEAD,
          to: DEAD,
          amount: '1',
        })
      ).error,
    ).toMatch(/no coincide/);
    expect(
      (
        await noKey.executeGasless({
          chain: 'base',
          kind: 'transfer',
          to: DEAD,
          amount: '1',
        })
      ).error,
    ).toMatch(/tx.from/);
  });
  it('ERC-4337: UserOperation patrocinada por paymaster; sin paymaster estima gas; sin clave dry-run', async () => {
    const aa = new EvmAdapter({
      network: TRUST_NETWORKS['base-sepolia'],
      fetch: fakeFetch,
      privateKey: OWNER_KEY,
      bundlerUrl: 'http://x/bundler',
      smartAccount: DEAD,
    });
    const r = await aa.executeGasless({
      chain: 'base',
      kind: 'call',
      contract: USDC,
      data: '0xdeadbeef',
    });
    expect(r).toMatchObject({
      ok: true,
      mode: 'sponsored',
      txHash: '0x' + 'ab'.repeat(32),
    });
    const op = evmState.userOps[0] as Record<string, string>;
    expect(op.sender).toBe(DEAD);
    expect(op.paymaster).toBe(DEAD);
    expect(op.nonce).toBe('0x5');
    expect(op.callData.startsWith(sel('execute(address,uint256,bytes)'))).toBe(true);
    expect(op.signature).toMatch(/^0x[0-9a-f]{130}$/);
    evmState.sponsor = false;
    const r2 = await aa.executeGasless({
      chain: 'base',
      kind: 'transfer',
      to: OWNER,
      amount: '2 USDC',
    });
    expect(r2.mode).toBe('paid');
    const noKey = new EvmAdapter({
      network: TRUST_NETWORKS['base-sepolia'],
      fetch: fakeFetch,
      bundlerUrl: 'http://x/bundler',
      smartAccount: DEAD,
    });
    const dry = await noKey.executeGasless({
      chain: 'base',
      kind: 'call',
      contract: USDC,
      data: '0x',
    });
    expect(dry.mode).toBe('dry-run');
    expect((dry.payload as { userOpHash: string }).userOpHash).toMatch(/^0x/);
    expect(
      (await aa.executeGasless({ chain: 'base', kind: 'call', contract: 'zz' })).error,
    ).toMatch(/destino inválido/);
    const noAccount = new EvmAdapter({
      network: TRUST_NETWORKS['base-sepolia'],
      fetch: fakeFetch,
      bundlerUrl: 'http://x/bundler',
    });
    expect(
      (await noAccount.executeGasless({ chain: 'base', kind: 'call', contract: USDC }))
        .error,
    ).toMatch(/smart account/);
    expect(
      (
        await aa.executeGasless({
          chain: 'base',
          kind: 'transfer',
          to: OWNER,
          amount: 'bad',
        })
      ).error,
    ).toMatch(/amount/);
  });
  it('SKALE (gas gratuito): transacción legacy firmada localmente; raw; sin vía → error explicativo', async () => {
    const sk = new EvmAdapter({
      network: TRUST_NETWORKS['skale-europa'],
      fetch: fakeFetch,
      privateKey: OWNER_KEY,
    });
    const r = await sk.executeGasless({
      chain: 'skale',
      kind: 'call',
      contract: DEAD,
      data: '0x01',
    });
    expect(r).toMatchObject({ ok: true, mode: 'gasless' });
    expect(evmState.rawTxs[0]).toMatch(/^0xf8/);
    const t = await sk.executeGasless({
      chain: 'skale',
      kind: 'transfer',
      to: DEAD,
      amount: '1 USDC',
    });
    expect(t).toMatchObject({ ok: true, mode: 'gasless' });
    expect(evmState.rawTxs.length).toBe(2);
    expect(
      (
        await sk.executeGasless({
          chain: 'skale',
          kind: 'transfer',
          to: DEAD,
          amount: 'x',
        })
      ).error,
    ).toMatch(/transfer requiere/);
    expect(
      (await evm().executeGasless({ chain: 'base', kind: 'raw', raw: '0x02f8' })).ok,
    ).toBe(true);
    const none = new EvmAdapter({
      network: TRUST_NETWORKS['base-sepolia'],
      fetch: fakeFetch,
      privateKey: OWNER_KEY,
    });
    expect(
      (await none.executeGasless({ chain: 'base', kind: 'call', contract: DEAD })).error,
    ).toMatch(/WEBMCP_TRUST_BUNDLER/);
  });
  it('registerAuditLog: hash local sin contrato; ancla on-chain con contrato', async () => {
    const h = await evm().registerAuditLog({
      agentId: '#7',
      action: 'purchase',
      result: 'ok',
    });
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    const anchored = new EvmAdapter({
      network: TRUST_NETWORKS['skale-europa'],
      fetch: fakeFetch,
      privateKey: OWNER_KEY,
      auditContract: DEAD,
    });
    expect(
      await anchored.registerAuditLog({
        agentId: '#7',
        action: 'purchase',
        result: 'ok',
        timestamp: 1,
      }),
    ).not.toBe(h);
    expect(evmState.rawTxs.length).toBe(1);
    expect(evm().explorerUrl('')).toBeUndefined();
  });
  it('errores RPC y HTTP se propagan con mensaje', async () => {
    const broken = new EvmAdapter({
      network: { ...TRUST_NETWORKS['base-sepolia'], rpc: 'http://x/broken' },
      fetch: fakeFetch,
    });
    await expect(broken.rpc('eth_chainId')).rejects.toThrow(/HTTP 500/);
    await expect(evm().rpc('eth_nope')).rejects.toThrow(/Method not found/);
    await expect(evm().call(DEAD, 'nothing()', [], ['uint256'])).rejects.toThrow(
      /sin datos/,
    );
    const notJson = new EvmAdapter({
      network: { ...TRUST_NETWORKS.base, rpc: 'http://x/text' },
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => 'hola',
      }),
    });
    await expect(notJson.rpc('eth_chainId')).rejects.toThrow(/no JSON/);
  });
});

describe('SuiAdapter (GraphQL + gasless nativo)', () => {
  it('identidad sin registro → no verificada con motivo; con registro → objeto AgentIdentity', async () => {
    const plain = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
    });
    const id = await plain.verifyIdentity(SUI_ADDR);
    expect(id).toMatchObject({
      verified: false,
      chain: 'sui',
      agentId: `sui:testnet:${SUI_ADDR}`,
    });
    expect(id?.reason).toMatch(/WEBMCP_TRUST_SUI_REGISTRY/);
    const reg = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
      registryPackage: '0xabc',
    });
    expect((await reg.verifyIdentity(SUI_ADDR))?.reason).toMatch(/no posee/);
    suiState.identities.set(SUI_ADDR, {
      owner: SUI_ADDR,
      name: 'Sui Bot',
      reputation: 92,
      wallet: '0x' + 'cc'.repeat(32),
      uri: 'https://bot',
    });
    expect(await reg.verifyIdentity(SUI_ADDR)).toMatchObject({
      verified: true,
      name: 'Sui Bot',
      reputation: 92,
      method: 'sui-registry',
      agentWallet: '0x' + 'cc'.repeat(32),
      agentURI: 'https://bot',
    });
    expect(await reg.verifyIdentity('#7')).toBeNull();
    const offline = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: async () => {
        throw new Error('down');
      },
    });
    expect((await offline.verifyIdentity(SUI_ADDR))?.reason).toMatch(
      /no se pudo consultar/,
    );
  });
  it('firma/verifica pruebas y delegaciones con Ed25519; delega en el nodo esquemas desconocidos', async () => {
    const a = sui();
    const proof = a.signProof({
      agentId: SUI_ADDR,
      scope: ['tip'],
      nonce: 'n1',
      expiresAt: nowS() + 100,
    });
    expect(proof.signer).toBe(SUI_ADDR);
    expect(await a.verifyProofSignature(proof)).toEqual({
      valid: true,
      signer: SUI_ADDR,
    });
    expect((await a.verifyProofSignature({ ...proof, nonce: 'n2' })).valid).toBe(false);
    expect((await a.verifyProofSignature({ ...proof, signer: OWNER })).reason).toMatch(
      /dirección Sui/,
    );
    const foreign = Buffer.concat([Buffer.from([1]), Buffer.alloc(96)]).toString(
      'base64',
    );
    expect((await a.verifyProofSignature({ ...proof, signature: foreign })).valid).toBe(
      true,
    );
    const rejected = Buffer.concat([Buffer.from([2]), Buffer.alloc(96)]).toString(
      'base64',
    );
    expect(
      (await a.verifyProofSignature({ ...proof, signature: rejected })).reason,
    ).toMatch(/nodo rechazó/);
    const offline = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: async () => {
        throw new Error('down');
      },
    });
    expect(
      (await offline.verifyProofSignature({ ...proof, signature: foreign })).reason,
    ).toMatch(/remota/);
    const other = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
      privateKey: '55'.repeat(32),
    });
    const otherAddr = other.signerAddress as string;
    const delegation = a.signDelegation({
      delegate: otherAddr,
      expiresAt: nowS() + 1000,
      scope: ['tip'],
    });
    const delegated = other.signProof({
      agentId: SUI_ADDR,
      scope: ['tip'],
      nonce: 'n3',
      expiresAt: nowS() + 100,
      delegation,
    });
    expect(await a.verifyProofSignature(delegated)).toEqual({
      valid: true,
      signer: otherAddr,
      delegatedBy: SUI_ADDR,
    });
    expect(
      (
        await a.verifyProofSignature({
          ...delegated,
          delegation: { ...delegation, signature: proof.signature },
        })
      ).reason,
    ).toMatch(/delegación inválida/);
    expect(
      (
        await a.verifyProofSignature({
          ...delegated,
          delegation: { ...delegation, expiresAt: nowS() - 5 },
        })
      ).reason,
    ).toMatch(/expirada/);
    expect(
      (
        await a.verifyProofSignature({
          ...delegated,
          delegation: { ...delegation, delegate: SUI_ADDR },
        })
      ).reason,
    ).toMatch(/no es para este signer/);
    expect(
      (await a.verifyProofSignature({ ...delegated, expiresAt: nowS() + 5000 })).valid,
    ).toBe(false);
    expect(
      (
        await a.verifyProofSignature(
          other.signProof({ ...delegated, scope: ['tip', 'x'] }),
        )
      ).reason,
    ).toMatch(/fuera de la delegación/);
    expect(() =>
      new SuiAdapter({ network: TRUST_NETWORKS['sui-testnet'] }).signDelegation({
        delegate: otherAddr,
        expiresAt: 1,
      }),
    ).toThrow(/clave/);
  });
  it('transferencia gasless: construye, firma y ejecuta; errores de red; dry-run sin clave; mínimo 0.01', async () => {
    const r = await sui().executeGasless({
      chain: 'sui',
      kind: 'transfer',
      to: SUI_RECIPIENT,
      amount: '1 USDC',
    });
    expect(r).toMatchObject({ ok: true, mode: 'gasless', txHash: 'OKDIGEST' });
    expect(r.explorerUrl).toBe('https://suiscan.xyz/testnet/tx/OKDIGEST');
    const bytes = Buffer.from(suiState.executed[0].tx, 'base64');
    expect(bytes[0]).toBe(0);
    expect(bytes.includes(Buffer.from('send_funds'))).toBe(true);
    expect(Buffer.from(suiState.executed[0].sigs[0], 'base64')[0]).toBe(0);
    expect(Buffer.from(suiState.executed[0].sigs[0], 'base64').length).toBe(97);
    suiState.failNext = true;
    const f = await sui().executeGasless({
      chain: 'sui',
      kind: 'transfer',
      to: SUI_RECIPIENT,
      amount: '1 USDC',
    });
    expect(f).toMatchObject({
      ok: false,
      txHash: 'FAILDIGEST',
      error: 'InsufficientBalance',
    });
    const noKey = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
    });
    const dry = await noKey.executeGasless({
      chain: 'sui',
      kind: 'transfer',
      from: SUI_ADDR,
      to: SUI_RECIPIENT,
      amount: '1 USDC',
    });
    expect(dry.mode).toBe('dry-run');
    expect((dry.payload as { gasless: boolean }).gasless).toBe(true);
    expect(
      (
        await noKey.executeGasless({
          chain: 'sui',
          kind: 'transfer',
          to: SUI_RECIPIENT,
          amount: '1 USDC',
        })
      ).error,
    ).toMatch(/tx.from/);
    expect(
      (
        await sui().executeGasless({
          chain: 'sui',
          kind: 'transfer',
          to: SUI_RECIPIENT,
          amount: '0.001 USDC',
        })
      ).error,
    ).toMatch(/mínimo/);
    expect(
      (
        await sui().executeGasless({
          chain: 'sui',
          kind: 'transfer',
          to: SUI_RECIPIENT,
          amount: 'x',
        })
      ).error,
    ).toMatch(/amount/);
    expect(
      (
        await sui().executeGasless({
          chain: 'sui',
          kind: 'transfer',
          to: OWNER,
          amount: '1 USDC',
        })
      ).error,
    ).toMatch(/dirección Sui/);
    expect(
      (
        await sui().executeGasless({
          chain: 'sui',
          kind: 'transfer',
          from: '0x' + '99'.repeat(32),
          to: SUI_RECIPIENT,
          amount: '1 USDC',
        })
      ).error,
    ).toMatch(/no coincide/);
  });
  it('Move call requiere gas station (sponsored); raw con firmas; firmante externo (Seal)', async () => {
    expect(
      (await sui().executeGasless({ chain: 'sui', kind: 'call', contract: '0x2::x::y' }))
        .error,
    ).toMatch(/GAS_STATION/);
    const gs = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
      privateKey: SUI_SEED,
      gasStationUrl: 'http://x/gas-station',
    });
    const r = await gs.executeGasless({
      chain: 'sui',
      kind: 'call',
      data: '0x2::x::y',
      args: [1],
    });
    expect(r).toMatchObject({ ok: true, mode: 'sponsored', txHash: 'OKDIGEST' });
    expect(suiState.executed[0].sigs.length).toBe(2);
    const gsNoKey = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
      gasStationUrl: 'http://x/gas-station',
    });
    expect(
      (await gsNoKey.executeGasless({ chain: 'sui', kind: 'call', data: '0x2::x::y' }))
        .mode,
    ).toBe('dry-run');
    const gsBroken = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
      privateKey: SUI_SEED,
      gasStationUrl: 'http://x/broken',
    });
    expect(
      (await gsBroken.executeGasless({ chain: 'sui', kind: 'call', data: '0x2::x::y' }))
        .error,
    ).toMatch(/HTTP 500/);
    const raw = await sui().executeGasless({
      chain: 'sui',
      kind: 'raw',
      raw: 'AAEC',
      signatures: ['AA=='],
    });
    expect(raw).toMatchObject({ ok: true, mode: 'paid' });
    expect(
      (await sui().executeGasless({ chain: 'sui', kind: 'raw', raw: 'AAEC' })).ok,
    ).toBe(true);
    const noKey = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
    });
    expect(
      (await noKey.executeGasless({ chain: 'sui', kind: 'raw', raw: 'AAEC' })).error,
    ).toMatch(/faltan firmas/);
    let sealCalls = 0;
    const seal = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
      sealSigner: async () => {
        sealCalls++;
        return { signature: 'AA==', address: SUI_ADDR };
      },
    });
    expect(
      (
        await seal.executeGasless({
          chain: 'sui',
          kind: 'transfer',
          from: SUI_ADDR,
          to: SUI_RECIPIENT,
          amount: '1 USDC',
        })
      ).ok,
    ).toBe(true);
    expect(sealCalls).toBe(1);
    const badSeal = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: fakeFetch,
      sealSigner: async () => ({ signature: 'AA==', address: '0x' + '99'.repeat(32) }),
    });
    expect(
      (
        await badSeal.executeGasless({
          chain: 'sui',
          kind: 'transfer',
          from: SUI_ADDR,
          to: SUI_RECIPIENT,
          amount: '1 USDC',
        })
      ).error,
    ).toMatch(/Seal/);
  });
  it('saldos, estado de transacción y utilidades', async () => {
    expect(await sui().getBalance(SUI_ADDR)).toEqual({ amount: 3, currency: 'USDC' });
    expect(await sui().getBalance(SUI_ADDR, 'native')).toEqual({
      amount: 0,
      currency: 'SUI',
    });
    await expect(
      new SuiAdapter({
        network: { ...TRUST_NETWORKS['sui-testnet'], usdc: undefined },
        fetch: fakeFetch,
      }).getBalance(SUI_ADDR),
    ).rejects.toThrow(/tipo de moneda/);
    expect(await sui().getTransaction('OKDIGEST')).toMatchObject({
      found: true,
      status: 'SUCCESS',
      checkpoint: 9,
    });
    expect(await sui().getTransaction('nope')).toEqual({ found: false });
    expect(await sui().getSpendingLimit(SUI_ADDR)).toMatch(/locales/);
    expect(
      await sui().registerAuditLog({ agentId: 'a', action: 'b', result: 'ok' }),
    ).toMatch(/^0x/);
    expect(
      () =>
        new SuiAdapter({
          network: TRUST_NETWORKS['sui-testnet'],
          privateKey: 'suiprivkey1abc',
        }).signerAddress,
    ).toThrow(/bech32/);
    expect(
      new SuiAdapter({
        network: TRUST_NETWORKS['sui-testnet'],
        privateKey: '00' + SUI_SEED,
      }).signerAddress,
    ).toBe(SUI_ADDR);
    await expect(sui().gql('{ nada }')).rejects.toThrow(/no simulada/);
    const noData = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      fetch: async () => ({
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      }),
    });
    await expect(noData.gql('{ x }')).rejects.toThrow(/sin datos/);
  });
});
