/**
 * Tests del motor de confianza (v1.3.0): motor de políticas (rate limit,
 * gasto por ventana, listas blancas, horario, reglas, stores), verificadores
 * de identidad/permisos/pagos con firmas reales, audit log encadenado,
 * ejecutores, `TrustEngine` (flujo verify → execute → audit, tokens),
 * herramientas MCP, integración con `McpCore`, API REST, script de navegador
 * y CLI (`dist/`).
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { McpCore, createMcpHttpServer } from '../src/exporters/mcp-server';
import { parseWebMCP } from '../src/parser';
import {
  AuditLogger,
  EvmAdapter,
  FilePolicyStore,
  GaslessExecutor,
  IdentityVerifier,
  MemoryNonceStore,
  MemoryPolicyStore,
  PaymentVerifier,
  PermissionVerifier,
  PolicyEngine,
  RedisPolicyStore,
  SponsoredExecutor,
  TRUST_NETWORKS,
  TRUST_TOOL_NAMES,
  TRUST_TOOL_SCHEMAS,
  TrustEngine,
  buildTrustBrowserScript,
  callTrustTool,
  isTrustTool,
  resolveTrustNetwork,
  setSharedIdentityVerifier,
  suiPermissionMessage,
  verifyIdentity,
  type ChainAdapter,
  type PermissionProof,
} from '../src/trust';
import { signTypedData } from '../src/trust/crypto/eip712';
import { keccak256Hex } from '../src/trust/crypto/keccak';
import { privateKeyToAddress } from '../src/trust/crypto/secp256k1';
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
  clock,
  evm,
  evmState,
  factory,
  fakeFetch,
  now,
  nowS,
  resetNodes,
  signWith,
  sui,
  suiState,
} from './trust-fixtures';

beforeEach(resetNodes);

const EIP3009 = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/** Autorización EIP-3009 firmada (x402) hacia DEAD. */
function x402(over: Record<string, unknown> = {}, key = OWNER_KEY) {
  const a = {
    from: privateKeyToAddress(key),
    to: DEAD,
    value: '500000',
    validAfter: '0',
    validBefore: String(nowS() + 600),
    nonce: keccak256Hex(String(Math.random())),
    ...over,
  };
  const signature = signTypedData(
    { name: 'USD Coin', version: '2', chainId: 84532, verifyingContract: USDC },
    EIP3009,
    a,
    key,
  );
  return { authorization: a, signature };
}

describe('PolicyEngine', () => {
  const policy = {
    auth: 'none' as const,
    payment: 'none' as const,
    chain: 'sui' as const,
    spendingLimit: '10 USDC/day',
    rateLimit: '3 actions/minute',
    allowedContracts: ['0xaaa0000000000000000000000000000000000001', '0x2::coin'],
    allowedHours: '09:00-18:00',
  };
  it('rate limit por ventana deslizante; commit consume cuota', async () => {
    const e = new PolicyEngine({ now });
    for (let i = 0; i < 3; i++) {
      const d = await e.evaluate({ agentId: 'a', tool: 't', policy });
      expect(d.allowed).toBe(true);
      await d.commit();
    }
    const denied = await e.evaluate({ agentId: 'a', tool: 't', policy });
    expect(denied).toMatchObject({ allowed: false, code: 'rate-limit' });
    expect((await e.evaluate({ agentId: 'b', tool: 't', policy })).allowed).toBe(true);
    clock.value += 61_000;
    expect((await e.evaluate({ agentId: 'a', tool: 't', policy })).allowed).toBe(true);
  });
  it('límite de gasto acumulado por día con restante; moneda distinta; por tx; sesión', async () => {
    const e = new PolicyEngine({ now });
    const d1 = await e.evaluate({ agentId: 'a', tool: 't', policy, amount: '6 USDC' });
    expect(d1.allowed).toBe(true);
    expect(d1.remainingLimit).toBe('4 USDC/day');
    await d1.commit();
    expect(
      await e.evaluate({ agentId: 'a', tool: 't', policy, amount: '5 USDC' }),
    ).toMatchObject({ allowed: false, code: 'spending-limit' });
    expect(await e.spent('a', 't', policy)).toEqual({
      spent: 6,
      remaining: '4 USDC/day',
    });
    expect(await e.spent('a', 't', { ...policy, spendingLimit: undefined })).toEqual({
      spent: 0,
    });
    clock.value += 24 * 3_600_000 + 1;
    expect(
      (await e.evaluate({ agentId: 'a', tool: 't', policy, amount: '9 USDC' })).allowed,
    ).toBe(true);
    expect(
      (await e.evaluate({ agentId: 'a', tool: 't', policy, amount: '1 ETH' })).reason,
    ).toMatch(/moneda/);
    const perTx = { ...policy, spendingLimit: '2 USDC/tx' };
    expect(
      (await e.evaluate({ agentId: 'c', tool: 't', policy: perTx, amount: '2 USDC' }))
        .allowed,
    ).toBe(true);
    expect(
      (await e.evaluate({ agentId: 'c', tool: 't', policy: perTx, amount: '2.5 USDC' }))
        .allowed,
    ).toBe(false);
    const s1 = await e.evaluate({
      agentId: 'd',
      tool: 't',
      policy,
      amount: '3 USDC',
      sessionMaxSpend: '4 USDC',
    });
    expect(s1.allowed).toBe(true);
    await s1.commit();
    expect(
      (
        await e.evaluate({
          agentId: 'd',
          tool: 't',
          policy,
          amount: '2 USDC',
          sessionMaxSpend: '4 USDC',
        })
      ).code,
    ).toBe('session-max-spend');
    expect(
      (await e.evaluate({ agentId: 'd', tool: 't', policy })).checks.find(
        (c) => c.name === 'spending-limit',
      )?.detail,
    ).toMatch(/sin importe/);
  });
  it('lista blanca (política ∩ sesión), horario UTC y reglas personalizadas', async () => {
    const e = new PolicyEngine({ now });
    expect(
      (
        await e.evaluate({
          agentId: 'a',
          tool: 't',
          policy,
          target: '0xAAA0000000000000000000000000000000000001',
        })
      ).allowed,
    ).toBe(true);
    expect(
      (
        await e.evaluate({
          agentId: 'a',
          tool: 't',
          policy,
          target: '0x2::coin::transfer',
        })
      ).allowed,
    ).toBe(true);
    expect(
      (await e.evaluate({ agentId: 'a', tool: 't', policy, target: DEAD })).code,
    ).toBe('allowed-contracts');
    expect(
      (
        await e.evaluate({
          agentId: 'a',
          tool: 't',
          policy,
          target: '0xaaa0000000000000000000000000000000000001',
          sessionContracts: ['0x2::coin'],
        })
      ).reason,
    ).toMatch(/sesión/);
    expect(
      (await e.evaluate({ agentId: 'a', tool: 't', policy })).checks.find(
        (c) => c.name === 'allowed-contracts',
      )?.detail,
    ).toMatch(/sin contrato/);
    clock.value = Date.UTC(2026, 8, 13, 20, 30);
    expect((await e.evaluate({ agentId: 'a', tool: 't', policy })).code).toBe(
      'allowed-hours',
    );
    clock.value = Date.UTC(2026, 8, 13, 2, 0);
    expect(
      (
        await e.evaluate({
          agentId: 'a',
          tool: 't',
          policy: { ...policy, allowedHours: '22:00-06:00' },
        })
      ).allowed,
    ).toBe(true);
    clock.value = Date.UTC(2026, 8, 13, 12, 0);
    e.addRule((input) =>
      input.tool === 'forbidden'
        ? { name: 'custom', passed: false, detail: 'prohibida' }
        : null,
    );
    expect(
      (await e.evaluate({ agentId: 'a', tool: 'forbidden', policy })).reason,
    ).toMatch(/custom: prohibida/);
    expect(
      (
        await e.evaluate({
          agentId: 'a',
          tool: 't',
          policy: { auth: 'none', payment: 'none', chain: 'sui' },
        })
      ).checks.map((c) => c.name),
    ).toEqual(['rate-limit']);
  });
  it('stores: archivo persistente y Redis simulado', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-store-'));
    const file = path.join(dir, 'state.json');
    const e1 = new PolicyEngine({ now, store: new FilePolicyStore(file) });
    await (
      await e1.evaluate({ agentId: 'a', tool: 't', policy, amount: '7 USDC' })
    ).commit();
    const e2 = new PolicyEngine({ now, store: new FilePolicyStore(file) });
    expect((await e2.spent('a', 't', policy)).spent).toBe(7);
    await e2.store.clear();
    expect(fs.existsSync(file)).toBe(false);
    fs.writeFileSync(file, 'no json');
    expect(
      (
        await new PolicyEngine({ now, store: new FilePolicyStore(file) }).spent(
          'a',
          't',
          policy,
        )
      ).spent,
    ).toBe(0);
    const zsets = new Map<string, Array<[number, string]>>();
    const redis = {
      async zadd(k: string, s: number, m: string) {
        if (!zsets.has(k)) zsets.set(k, []);
        zsets.get(k)!.push([s, m]);
      },
      async zrangebyscore(k: string, min: number | string) {
        return (zsets.get(k) ?? []).filter(([s]) => s >= Number(min)).map(([, m]) => m);
      },
      async zremrangebyscore(k: string, _min: number | string, max: number | string) {
        zsets.set(
          k,
          (zsets.get(k) ?? []).filter(([s]) => s > Number(max)),
        );
      },
      async del(...keys: string[]) {
        keys.forEach((k) => zsets.delete(k));
      },
      async keys(p: string) {
        return [...zsets.keys()].filter((k) => k.startsWith(p.replace('*', '')));
      },
    };
    const e3 = new PolicyEngine({ now, store: new RedisPolicyStore(redis) });
    for (let i = 0; i < 3; i++)
      await (await e3.evaluate({ agentId: 'r', tool: 't', policy })).commit();
    expect((await e3.evaluate({ agentId: 'r', tool: 't', policy })).allowed).toBe(false);
    await e3.store.clear();
    expect(zsets.size).toBe(0);
    await new RedisPolicyStore({ ...redis, keys: undefined }).clear();
    const mem = new MemoryPolicyStore();
    await mem.add('k', { t: 1 }, 0);
    expect((await mem.get('k', 0)).length).toBe(1);
    await mem.clear();
    expect((await mem.get('k', 0)).length).toBe(0);
  });
});

describe('IdentityVerifier', () => {
  it('cachea identidades con TTL, invalida y aplica reputación mínima', async () => {
    const v = new IdentityVerifier({ adapterFactory: factory, now, cacheTtlMs: 1000 });
    expect(
      (await v.verifyIdentity('#7', 'base', { network: 'base-sepolia' }))?.verified,
    ).toBe(true);
    const callsBefore = evmState.calls.length;
    expect(
      (await v.verifyIdentity('#7', 'base', { network: 'base-sepolia' }))?.verified,
    ).toBe(true);
    expect(evmState.calls.length).toBe(callsBefore);
    expect(v.cacheSize).toBe(1);
    clock.value += 1001;
    await v.verifyIdentity('#7', 'base', { network: 'base-sepolia' });
    expect(evmState.calls.length).toBeGreaterThan(callsBefore);
    await v.verifyIdentity('#7', 'base', { network: 'base-sepolia', skipCache: true });
    v.invalidate('#7');
    expect(v.cacheSize).toBe(0);
    v.invalidate();
    const strict = new IdentityVerifier({
      adapterFactory: factory,
      now,
      minReputation: 90,
    });
    const low = await strict.verifyIdentity('#7', 'base', { network: 'base-sepolia' });
    expect(low?.verified).toBe(false);
    expect(low?.reason).toMatch(/reputación 85/);
    expect(
      await v.verifyIdentity(SUI_ADDR, 'base', { network: 'base-sepolia' }),
    ).toBeNull();
    const real = new IdentityVerifier({ fetch: fakeFetch, now });
    expect(real.adapter('sui').chain).toBe('sui');
  });
  it('pruebas de humanidad: sin verificador, con verificador inyectado y caché por nullifier', async () => {
    const none = new IdentityVerifier({ adapterFactory: factory, now });
    expect(
      (await none.verifyHumanProof({ provider: 'worldid', nullifierHash: '0x1' })).reason,
    ).toMatch(/WEBMCP_TRUST_WORLD_APP_ID/);
    let calls = 0;
    const v = new IdentityVerifier({
      adapterFactory: factory,
      now,
      humanProofVerifier: async (p) => {
        calls++;
        return p.nullifierHash === '0xok'
          ? { valid: true }
          : { valid: false, reason: 'nope' };
      },
    });
    expect(
      await v.verifyHumanProof({
        provider: 'worldid',
        nullifierHash: '0xok',
        expiresAt: nowS() + 30,
      }),
    ).toEqual({ valid: true });
    expect(
      await v.verifyHumanProof({ provider: 'worldid', nullifierHash: '0xok' }),
    ).toEqual({ valid: true });
    expect(calls).toBe(1);
    expect(
      (await v.verifyHumanProof({ provider: 'self', nullifierHash: '0xbad' })).valid,
    ).toBe(false);
    setSharedIdentityVerifier(v);
    expect(
      (await verifyIdentity('#7', 'base', { network: 'base-sepolia' }))?.verified,
    ).toBe(true);
    setSharedIdentityVerifier(null);
  });
  it('verificador World ID / Self.xyz por HTTP (fetch global simulado)', async () => {
    const { defaultHumanProofVerifier } =
      await import('../src/trust/verifier/identity-verifier');
    expect(defaultHumanProofVerifier()).toBeNull();
    const original = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string, init?: { body?: string }) => {
      seen.push(url);
      const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
      if (url.includes('worldcoin'))
        return {
          ok: body.nullifier_hash === '0xok',
          status: body.nullifier_hash === '0xok' ? 200 : 400,
          json: async () => ({ detail: 'invalid proof' }),
        };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: body.nullifierHash === '0xok' ? 'success' : 'error',
          message: 'self says no',
        }),
      };
    }) as unknown as typeof fetch;
    try {
      process.env.WEBMCP_TRUST_WORLD_APP_ID = 'app_test';
      const world = defaultHumanProofVerifier()!;
      expect(
        await world({
          provider: 'worldid',
          nullifierHash: '0xok',
          proof: '{"proof":"0x1"}',
        }),
      ).toEqual({ valid: true });
      expect(
        (await world({ provider: 'worldid', nullifierHash: '0xbad', proof: 'raw' }))
          .reason,
      ).toBe('invalid proof');
      process.env.WEBMCP_TRUST_SELF_VERIFIER_URL = 'http://self/verify';
      const self = defaultHumanProofVerifier()!;
      expect(await self({ provider: 'self', nullifierHash: '0xok' })).toEqual({
        valid: true,
      });
      expect((await self({ provider: 'self', nullifierHash: '0xno' })).reason).toBe(
        'self says no',
      );
      globalThis.fetch = (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch;
      expect((await self({ provider: 'self', nullifierHash: '0xok' })).reason).toMatch(
        /offline/,
      );
    } finally {
      globalThis.fetch = original;
      delete process.env.WEBMCP_TRUST_WORLD_APP_ID;
      delete process.env.WEBMCP_TRUST_SELF_VERIFIER_URL;
    }
    expect(seen.length).toBe(4);
  });
});

describe('PermissionVerifier', () => {
  const policy = {
    auth: 'erc8004' as const,
    payment: 'none' as const,
    chain: 'base' as const,
    network: 'base-sepolia',
    spendingLimit: '10 USDC/day',
    rateLimit: '5 actions/minute',
    allowedContracts: [USDC.toLowerCase()],
  };
  const identity = {
    agentId: `eip155:84532:${REGISTRY}#7`,
    ownerAddress: OWNER,
    verified: true,
    chain: 'base' as const,
  };
  it('acepta una prueba válida del owner y devuelve restante + commit', async () => {
    const pv = new PermissionVerifier({ now });
    const res = await pv.verifyPermission(signWith(OWNER_KEY), {
      tool: 'purchase',
      policy,
      adapter: evm(),
      identity,
      amount: '4 USDC',
      target: USDC,
    });
    expect(res.allowed).toBe(true);
    expect(res.remainingLimit).toBe('6 USDC/day');
    expect(res.checks?.map((c) => c.name)).toEqual([
      'expiry',
      'nonce',
      'signature',
      'signer-authorized',
      'scope',
      'rate-limit',
      'spending-limit',
      'allowed-contracts',
    ]);
    await res.decision?.commit();
  });
  it('rechaza expirada, TTL excesivo, futura, replay (singleUse), agente distinto, origen, scope, firmante', async () => {
    const pv = new PermissionVerifier({
      now,
      singleUse: true,
      nonces: new MemoryNonceStore(now),
    });
    const ctx = { tool: 'purchase', policy, adapter: evm(), identity };
    expect(
      (await pv.verifyPermission(signWith(OWNER_KEY, { expiresAt: nowS() - 1 }), ctx))
        .code,
    ).toBe('proof-expired');
    expect(
      (
        await pv.verifyPermission(
          signWith(OWNER_KEY, { issuedAt: nowS(), expiresAt: nowS() + 99 * 3600 }),
          ctx,
        )
      ).code,
    ).toBe('proof-ttl-too-long');
    expect(
      (
        await pv.verifyPermission(
          signWith(OWNER_KEY, { issuedAt: nowS() + 1000, expiresAt: nowS() + 2000 }),
          ctx,
        )
      ).code,
    ).toBe('proof-not-yet-valid');
    expect(
      (await pv.verifyPermission(signWith(OWNER_KEY, { agentId: '#8' }), ctx)).code,
    ).toBe('agent-mismatch');
    expect(
      (
        await pv.verifyPermission(signWith(OWNER_KEY, { origin: 'https://a.example' }), {
          ...ctx,
          origin: 'https://b.example/x',
        })
      ).code,
    ).toBe('origin-mismatch');
    expect(
      (
        await pv.verifyPermission(signWith(OWNER_KEY, { origin: 'https://a.example' }), {
          ...ctx,
          origin: 'https://a.example/checkout',
        })
      ).allowed,
    ).toBe(true);
    expect(
      (
        await pv.verifyPermission(signWith(OWNER_KEY, { origin: 'shop' }), {
          ...ctx,
          origin: 'shop/',
        })
      ).allowed,
    ).toBe(true);
    expect(
      (await pv.verifyPermission(signWith(OWNER_KEY, { scope: ['tip'] }), ctx)).code,
    ).toBe('out-of-scope');
    expect(
      (await pv.verifyPermission(signWith(OWNER_KEY, { scope: ['*'] }), ctx)).allowed,
    ).toBe(true);
    expect((await pv.verifyPermission(signWith(STRANGER_KEY), ctx)).code).toBe(
      'unauthorized-signer',
    );
    const p = signWith(OWNER_KEY);
    const corrupted =
      p.signature.slice(0, 10) +
      (p.signature[10] === 'a' ? 'b' : 'a') +
      p.signature.slice(11);
    expect((await pv.verifyPermission({ ...p, signature: corrupted }, ctx)).code).toBe(
      'invalid-signature',
    );
    expect((await pv.verifyPermission({ ...p, signature: '0x1234' }, ctx)).code).toBe(
      'invalid-signature',
    );
    const ok = await pv.verifyPermission(p, ctx);
    expect(ok.allowed).toBe(true);
    await ok.decision?.commit();
    expect((await pv.verifyPermission(p, ctx)).code).toBe('nonce-reused');
    clock.value += 700_000;
    const nonces = new MemoryNonceStore(now);
    await nonces.add('old', nowS() - 10);
    expect(await nonces.has('old')).toBe(false);
  });
  it('acepta clave de sesión delegada por el owner y la billetera del agente', async () => {
    const pv = new PermissionVerifier({ now });
    const delegation = evm().signDelegation({
      delegate: SESSION,
      expiresAt: nowS() + 3600,
    });
    const res = await pv.verifyPermission(signWith(SESSION_KEY, { delegation }), {
      tool: 'purchase',
      policy,
      adapter: evm(),
      identity,
    });
    expect(res.allowed).toBe(true);
    expect(res.checks?.find((c) => c.name === 'signer-authorized')?.detail).toMatch(
      /delegada por/,
    );
    const walletIdentity = { ...identity, ownerAddress: DEAD, agentWallet: OWNER };
    expect(
      (
        await pv.verifyPermission(signWith(OWNER_KEY), {
          tool: 'purchase',
          policy,
          adapter: evm(),
          identity: walletIdentity,
        })
      ).allowed,
    ).toBe(true);
    const strangerDelegation = new EvmAdapter({
      network: TRUST_NETWORKS['base-sepolia'],
      fetch: fakeFetch,
      privateKey: STRANGER_KEY,
    }).signDelegation({ delegate: SESSION, expiresAt: nowS() + 3600 });
    expect(
      (
        await pv.verifyPermission(
          signWith(SESSION_KEY, { delegation: strangerDelegation }),
          { tool: 'purchase', policy, adapter: evm(), identity },
        )
      ).reason,
    ).toMatch(/delegador/);
  });
  it('sin identidad verificada (session-key) el propio firmante se acredita; políticas denegando', async () => {
    const pv = new PermissionVerifier({ now });
    const res = await pv.verifyPermission(signWith(STRANGER_KEY), {
      tool: 'purchase',
      policy: { ...policy, auth: 'session-key' },
      adapter: evm(),
      identity: null,
      amount: '11 USDC',
    });
    expect(res.code).toBe('spending-limit');
    expect(res.decision).toBeDefined();
  });
});

describe('PaymentVerifier', () => {
  const policy = {
    auth: 'none' as const,
    payment: 'x402' as const,
    chain: 'base' as const,
    network: 'base-sepolia',
    payTo: DEAD,
    amount: '0.5 USDC',
  };
  it('none/sponsored pasan; x402 exige prueba; acepta X-PAYMENT base64, objeto x402 y {authorization,signature}', async () => {
    const pv = new PaymentVerifier({ now });
    expect(
      (await pv.verifyPayment(undefined, { ...policy, payment: 'none' })).valid,
    ).toBe(true);
    expect(
      (await pv.verifyPayment(undefined, { ...policy, payment: 'sponsored' })).checks[0]
        .detail,
    ).toMatch(/patrocinado/);
    expect((await pv.verifyPayment(undefined, policy)).code).toBe('payment-required');
    expect(await pv.verifyPayment(x402(), policy)).toMatchObject({
      valid: true,
      amount: '0.5 USDC',
      payer: OWNER,
      payee: DEAD,
    });
    const header = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: 'exact',
        network: 'base-sepolia',
        payload: x402(),
      }),
    ).toString('base64');
    expect((await pv.verifyPayment(header, policy)).valid).toBe(true);
    expect(
      (
        await pv.verifyPayment(
          JSON.stringify({
            x402Version: 1,
            scheme: 'exact',
            network: 'base-sepolia',
            payload: x402(),
          }),
          policy,
        )
      ).valid,
    ).toBe(true);
    expect((await pv.verifyPayment('%%%', policy)).code).toBe('payment-malformed');
    expect((await pv.verifyPayment({ foo: 1 }, policy)).code).toBe('payment-malformed');
  });
  it('rechaza replay, ventana, receptor, importe y firma incorrecta', async () => {
    const pv = new PaymentVerifier({ now });
    const p = x402();
    expect((await pv.verifyPayment(p, policy)).valid).toBe(true);
    expect((await pv.verifyPayment(p, policy)).code).toBe('payment-replay');
    expect(
      (await pv.verifyPayment(x402({ validBefore: String(nowS() - 1) }), policy)).code,
    ).toBe('payment-expired');
    expect(
      (await pv.verifyPayment(x402({ validAfter: String(nowS() + 100) }), policy)).code,
    ).toBe('payment-not-yet-valid');
    expect((await pv.verifyPayment(x402({ to: OWNER }), policy)).code).toBe(
      'payment-wrong-payee',
    );
    expect((await pv.verifyPayment(x402({ value: '100' }), policy)).code).toBe(
      'payment-insufficient',
    );
    const forged = x402({}, STRANGER_KEY);
    forged.authorization.from = OWNER;
    expect((await pv.verifyPayment(forged, policy)).code).toBe('payment-bad-signature');
    expect((await pv.verifyPayment({ ...x402(), signature: '0x00' }, policy)).code).toBe(
      'payment-bad-signature',
    );
    const unknownNet = await pv.verifyPayment(x402(), {
      ...policy,
      network: 'skale-europa-testnet',
      chain: 'skale',
    });
    expect(unknownNet.valid).toBe(true);
    expect(unknownNet.checks.find((c) => c.name === 'payment-signature')?.detail).toMatch(
      /no verificada/,
    );
    expect(
      (await pv.verifyPayment(x402(), { ...policy, network: 'marte' })).checks.find(
        (c) => c.name === 'payment-signature',
      )?.detail,
    ).toMatch(/no verificada/);
  });
});

describe('AuditLogger', () => {
  it('encadena hashes, persiste en JSONL, consulta y verifica integridad (detecta manipulación)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-audit-'));
    const file = path.join(dir, 'audit.jsonl');
    const log = new AuditLogger({ file, now });
    const e1 = await log.log({
      agentId: '#7',
      action: 'purchase',
      result: 'ok',
      amount: '1 USDC',
      txHash: '0x1',
    });
    const e2 = await log.log({
      agentId: '#7',
      action: 'purchase',
      result: 'denied',
      reason: 'rate',
    });
    await log.log({ agentId: '#8', action: 'tip', result: 'failed' });
    expect(e1.prevHash).toBe('0x' + '0'.repeat(64));
    expect(e2.prevHash).toBe(e1.hash);
    expect(log.head).not.toBe(e1.hash);
    expect(log.size).toBe(3);
    expect(log.query({ agentId: '#7' }).map((e) => e.result)).toEqual(['denied', 'ok']);
    expect(log.query({ result: 'failed' }).length).toBe(1);
    expect(log.query({ action: 'purchase', limit: 1 }).length).toBe(1);
    expect(log.query({ since: clock.value + 1 }).length).toBe(0);
    expect(new AuditLogger({ file, now }).verify()).toEqual({ ok: true, entries: 3 });
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    const tampered = JSON.parse(lines[1]);
    tampered.result = 'ok';
    lines[1] = JSON.stringify(tampered);
    fs.writeFileSync(file, lines.join('\n') + '\n');
    expect(new AuditLogger({ file }).verify()).toMatchObject({
      ok: false,
      brokenAt: 1,
      reason: 'hash alterado',
    });
    lines[2] = JSON.stringify({ ...JSON.parse(lines[2]), prevHash: '0xbad' });
    fs.writeFileSync(file, lines.join('\n') + '\n');
    expect(new AuditLogger({ file }).verify()).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/prevHash|hash/),
    });
    const memOnly = new AuditLogger({ file: null, now });
    await memOnly.log({ agentId: 'x', action: 'y', result: 'ok' });
    expect(memOnly.verify().ok).toBe(true);
  });
  it('ancla on-chain según anchorMode y tolera fallos del ancla', async () => {
    const anchor = {
      ...evm(),
      registerAuditLog: async () => 'anchor-ref',
    } as unknown as ChainAdapter;
    const log = new AuditLogger({ file: null, now, anchor });
    expect(
      (await log.log({ agentId: 'a', action: 'b', result: 'ok' })).anchor,
    ).toBeUndefined();
    expect(
      (await log.log({ agentId: 'a', action: 'b', result: 'ok', txHash: '0x1' })).anchor,
    ).toBe('anchor-ref');
    const always = new AuditLogger({ file: null, now, anchor, anchorMode: 'always' });
    expect(
      (await always.log({ agentId: 'a', action: 'b', result: 'denied' })).anchor,
    ).toBe('anchor-ref');
    const failing = new AuditLogger({
      file: null,
      now,
      anchor: {
        ...anchor,
        registerAuditLog: async () => {
          throw new Error('rpc down');
        },
      } as ChainAdapter,
      anchorMode: 'always',
    });
    const e = await failing.log({
      agentId: 'a',
      action: 'b',
      result: 'ok',
      meta: { k: 'v' },
    });
    expect(e.meta?.anchorError).toMatch(/rpc down/);
    expect(failing.verify().ok).toBe(true);
  });
});

describe('Executors', () => {
  it('GaslessExecutor delega en el adaptador; dryRun no envía', async () => {
    const g = new GaslessExecutor({ adapterFactory: factory });
    expect(
      (
        await g.execute({
          chain: 'sui',
          network: 'sui-testnet',
          kind: 'transfer',
          to: SUI_RECIPIENT,
          amount: '1 USDC',
        })
      ).ok,
    ).toBe(true);
    const dry = new GaslessExecutor({ adapterFactory: factory, dryRun: true });
    expect(
      (await dry.execute({ chain: 'base', kind: 'transfer', to: DEAD, amount: '1 USDC' }))
        .mode,
    ).toBe('dry-run');
    expect(suiState.executed.length).toBe(1);
    expect(new GaslessExecutor({ fetch: fakeFetch }).adapter('base').network.id).toBe(
      'base',
    );
    const { executeGasless } = await import('../src/trust');
    expect(
      (
        await executeGasless(
          {
            chain: 'sui',
            network: 'sui-testnet',
            kind: 'transfer',
            to: SUI_RECIPIENT,
            amount: '1 USDC',
          },
          { adapterFactory: factory },
        )
      ).ok,
    ).toBe(true);
  });
  it('SponsoredExecutor exige vía de patrocinio y marca sponsored', async () => {
    const s = new SponsoredExecutor({ adapterFactory: factory });
    expect(
      (
        await s.execute({
          chain: 'base',
          network: 'base-sepolia',
          kind: 'call',
          contract: DEAD,
        })
      ).error,
    ).toMatch(/WEBMCP_TRUST_BUNDLER/);
    expect(
      (
        await s.execute({
          chain: 'sui',
          network: 'sui-testnet',
          kind: 'call',
          contract: '0x2::a::b',
        })
      ).error,
    ).toMatch(/GAS_STATION/);
    const skale = new SponsoredExecutor({
      adapterFactory: (c, n) =>
        new EvmAdapter({
          network: resolveTrustNetwork(n ?? 'skale-europa', c),
          fetch: fakeFetch,
          privateKey: OWNER_KEY,
        }),
    });
    expect(
      (await skale.execute({ chain: 'skale', kind: 'call', contract: DEAD, data: '0x' }))
        .ok,
    ).toBe(true);
    const viaBundler = new SponsoredExecutor({
      adapterFactory: (c, n) =>
        new EvmAdapter({
          network: resolveTrustNetwork(n, c),
          fetch: fakeFetch,
          privateKey: OWNER_KEY,
          bundlerUrl: 'http://x/bundler',
          smartAccount: DEAD,
        }),
      bundlerUrl: 'http://x/bundler',
    });
    expect(
      (
        await viaBundler.execute({
          chain: 'base',
          network: 'base-sepolia',
          kind: 'call',
          contract: DEAD,
          data: '0x',
        })
      ).mode,
    ).toBe('sponsored');
    expect(
      (
        await s.execute({
          chain: 'sui',
          network: 'sui-testnet',
          kind: 'transfer',
          to: SUI_RECIPIENT,
          amount: '1 USDC',
        })
      ).mode,
    ).toBe('gasless');
    const paidToSponsored = new SponsoredExecutor({
      adapterFactory: () =>
        ({
          ...factory('base'),
          executeGasless: async () => ({
            ok: true,
            mode: 'paid' as const,
            chain: 'base' as const,
            network: 'base',
          }),
        }) as ChainAdapter,
      bundlerUrl: 'http://x/bundler',
    });
    expect(
      (await paidToSponsored.execute({ chain: 'base', kind: 'call', contract: DEAD }))
        .mode,
    ).toBe('sponsored');
    expect(
      new SponsoredExecutor({ fetch: fakeFetch, sponsorKey: OWNER_KEY }).adapter('skale')
        .network.chain,
    ).toBe('skale');
    const { executeSponsored } = await import('../src/trust');
    expect(
      (
        await executeSponsored(
          {
            chain: 'sui',
            network: 'sui-testnet',
            kind: 'transfer',
            to: SUI_RECIPIENT,
            amount: '1 USDC',
          },
          { adapterFactory: factory },
        )
      ).ok,
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ */

const CSS = `
.buy { webmcp-tool: "purchase"; webmcp-auth: "erc8004"; webmcp-payment: "x402"; webmcp-chain: "base-sepolia"; webmcp-spending-limit: "10 USDC/day"; webmcp-rate-limit: "5 actions/minute"; webmcp-allowed-contracts: "${USDC}"; webmcp-pay-to: "${DEAD}"; webmcp-amount: "0.5 USDC"; }
.tip { webmcp-tool: "tip"; webmcp-auth: "session-key"; webmcp-chain: "sui-testnet"; webmcp-spending-limit: "5 USDC/day"; webmcp-rate-limit: "2 actions/minute"; }
.vote { webmcp-tool: "vote"; webmcp-auth: "zk-proof"; webmcp-chain: "base"; }
.donate { webmcp-tool: "donate"; webmcp-auth: "none"; webmcp-payment: "sponsored"; webmcp-chain: "skale"; webmcp-requires-human-proof: true; }
.free { webmcp-tool: "free"; webmcp-auth: "none"; webmcp-chain: "sui"; webmcp-rate-limit: "1 action/minute"; }
.plain { webmcp-tool: "subscribe"; }
`;

function makeEngine(extra: Partial<ConstructorParameters<typeof TrustEngine>[0]> = {}) {
  const humanProofVerifier = async (p: { nullifierHash: string }) =>
    p.nullifierHash === '0xhuman'
      ? { valid: true }
      : { valid: false, reason: 'no humano' };
  return new TrustEngine({
    policies: parseWebMCP(CSS),
    adapterFactory: factory,
    now,
    identity: new IdentityVerifier({ adapterFactory: factory, now, humanProofVerifier }),
    audit: new AuditLogger({ file: null, now }),
    tokenSecret: 'test-secret',
    ...extra,
  });
}

describe('TrustEngine', () => {
  it('extrae políticas del ToolMap y las describe; construye componentes por defecto', () => {
    const e = makeEngine();
    expect(Object.keys(e.policies).sort()).toEqual([
      'donate',
      'free',
      'purchase',
      'tip',
      'vote',
    ]);
    expect(e.describePolicies().find((p) => p.tool === 'purchase')).toMatchObject({
      auth: 'erc8004',
      payment: 'x402',
      chain: 'base',
      network: 'base-sepolia',
    });
    expect(e.getTrustPolicy('subscribe')).toBeUndefined();
    const bare = new TrustEngine({
      policies: { a: { auth: 'none', payment: 'none', chain: 'sui' } },
      fetch: fakeFetch,
    });
    expect(bare.getTrustPolicy('a')).toBeDefined();
    expect(
      bare.adapterFor({ auth: 'none', payment: 'none', chain: 'base' }).network.id,
    ).toBe('base');
    expect(new TrustEngine().describePolicies()).toEqual([]);
  });
  it('flujo ERC-8004 + x402 completo: verify → execute (gasless EIP-3009) → audit; rechaza cada paso que falta', async () => {
    const e = makeEngine();
    expect((await e.verify('subscribe', {})).code).toBe('no-policy');
    expect((await e.verify('purchase', {})).code).toBe('agent-required');
    expect((await e.verify('purchase', { agentId: '#99' })).code).toBe(
      'identity-unverified',
    );
    expect((await e.verify('purchase', { agentId: '#7' })).code).toBe('proof-required');
    const proof = signWith(OWNER_KEY);
    expect(
      (await e.verify('purchase', { proof, amount: '0.5 USDC', target: USDC })).code,
    ).toBe('payment-required');
    const ok = await e.verify('purchase', {
      proof,
      amount: '0.5 USDC',
      target: USDC,
      paymentProof: x402(),
    });
    expect(ok.allowed).toBe(true);
    expect(ok.identity?.name).toBe('Shopper Bot');
    expect(ok.paymentAmount).toBe('0.5 USDC');
    expect(ok.remainingLimit).toBe('9.5 USDC/day');
    const executed: string[] = [];
    const res = await e.executeTool(
      'purchase',
      { qty: 1 },
      {
        proof,
        amount: '0.5 USDC',
        target: USDC,
        paymentProof: x402(),
        tx: { chain: 'base', kind: 'transfer', to: DEAD, amount: '0.5 USDC' },
      },
      async (t) => {
        executed.push(t);
        return { clicked: true };
      },
    );
    expect(res.ok).toBe(true);
    expect(res.mode).toBe('trusted');
    expect(res.transaction?.mode).toBe('gasless');
    expect(res.result).toEqual({ clicked: true });
    expect(executed).toEqual(['purchase']);
    expect(res.audit).toMatchObject({
      action: 'purchase',
      result: 'ok',
      agentId: `eip155:84532:${REGISTRY}#7`,
      amount: '0.5 USDC',
    });
    expect(res.audit?.proofHash).toMatch(/^0x/);
    expect(e.audit.query({ result: 'ok' }).length).toBe(1);
    const denied = await e.executeTool('purchase', {}, { proof: signWith(STRANGER_KEY) });
    expect(denied.ok).toBe(false);
    expect(denied.verification?.code).toBe('unauthorized-signer');
    expect(denied.error).toMatch(/Permiso denegado/);
    expect(e.audit.query({ result: 'denied' }).length).toBe(1);
  });
  it('session-key en Sui: la firma acredita al agente; gasto y rate limit se consumen solo al ejecutar con éxito', async () => {
    const e = makeEngine();
    const proof = sui().signProof({
      agentId: SUI_ADDR,
      scope: ['tip'],
      nonce: 'n1',
      expiresAt: nowS() + 300,
    });
    const v = await e.verify('tip', { proof, amount: '2 USDC' });
    expect(v.allowed).toBe(true);
    expect(v.identity?.verified).toBe(true);
    expect(v.identity?.method).toBe('session-key');
    const tx = {
      chain: 'sui' as const,
      kind: 'transfer' as const,
      to: SUI_RECIPIENT,
      amount: '2 USDC',
    };
    const r1 = await e.executeTool('tip', {}, { proof, tx });
    expect(r1.ok).toBe(true);
    expect(r1.transaction?.txHash).toBe('OKDIGEST');
    suiState.failNext = true;
    const r2 = await e.executeTool('tip', {}, { proof, tx });
    expect(r2.ok).toBe(false);
    expect(r2.audit?.result).toBe('failed');
    const r3 = await e.executeTool('tip', {}, { proof, tx });
    expect(r3.ok).toBe(true);
    const r4 = await e.executeTool('tip', {}, { proof, tx });
    expect(r4.verification?.code).toBe('rate-limit');
    clock.value += 61_000;
    const r5 = await e.executeTool('tip', {}, { proof, amount: '2 USDC' });
    expect(r5.verification?.code).toBe('spending-limit');
  });
  it('zk-proof y requiresHumanProof; auth none con políticas; tool sin ejecutor; dry-run de tx', async () => {
    const e = makeEngine();
    expect((await e.verify('vote', { agentId: 'x' })).code).toBe('human-proof-required');
    expect(
      (
        await e.verify('vote', {
          agentId: 'x',
          humanProof: { provider: 'worldid', nullifierHash: '0xbad' },
        })
      ).code,
    ).toBe('human-proof-invalid');
    expect(
      (
        await e.verify('vote', {
          agentId: 'x',
          humanProof: { provider: 'worldid', nullifierHash: '0xhuman' },
        })
      ).allowed,
    ).toBe(true);
    expect((await e.verify('donate', {})).code).toBe('human-proof-required');
    expect(
      (
        await e.verify('donate', {
          humanProof: { provider: 'self', nullifierHash: '0xbad' },
        })
      ).code,
    ).toBe('human-proof-invalid');
    const d = await e.verify('donate', {
      humanProof: { provider: 'self', nullifierHash: '0xhuman' },
    });
    expect(d.allowed).toBe(true);
    expect(d.checks?.map((c) => c.name)).toContain('human-proof');
    expect((await e.verify('free', {})).allowed).toBe(true);
    expect((await e.executeTool('free', {}, {}, async () => 'ok')).ok).toBe(true);
    expect(
      (await e.executeTool('free', {}, {}, async () => 'ok')).verification?.code,
    ).toBe('rate-limit');
    expect((await e.executeTool('subscribe', {}, {})).error).toBe('sin ejecutor');
    expect(
      (
        await e.executeTool('subscribe', {}, {}, async () => {
          throw new Error('kaput');
        })
      ).error,
    ).toBe('kaput');
    expect((await e.executeTool('subscribe', {}, {}, async () => 1)).mode).toBe('plain');
    clock.value += 61_000;
    const domFail = await e.executeTool(
      'free',
      {},
      { tx: { chain: 'sui', kind: 'transfer', to: SUI_RECIPIENT, amount: '1 USDC' } },
      async () => {
        throw new Error('dom');
      },
    );
    expect(domFail.error).toBe('dom');
    clock.value += 61_000;
    const dryTx = await e.executeTool(
      'free',
      {},
      { tx: { chain: 'sui', kind: 'call', contract: '0x2::a::b' } },
    );
    expect(dryTx.ok).toBe(true);
    expect(dryTx.transaction?.mode).toBe('dry-run');
  });
  it('sponsored: usa el SponsoredExecutor', async () => {
    const e = makeEngine({
      sponsored: new SponsoredExecutor({
        adapterFactory: (c, n) =>
          new EvmAdapter({
            network: resolveTrustNetwork(n, c),
            fetch: fakeFetch,
            privateKey: OWNER_KEY,
          }),
      }),
    });
    const r = await e.executeTool(
      'donate',
      {},
      {
        humanProof: { provider: 'self', nullifierHash: '0xhuman' },
        tx: { chain: 'skale', kind: 'call', contract: DEAD, data: '0x' },
      },
    );
    expect(r.ok).toBe(true);
    expect(r.transaction?.mode).toBe('gasless');
  });
  it('tokens de confianza: emisión, validación, scope, expiración, manipulación y uso en verify/executeTool', async () => {
    const e = makeEngine();
    const t = e.issueToken('#7', ['purchase'], 60);
    expect(e.verifyToken(t.token, 'purchase')).toMatchObject({
      valid: true,
      agentId: '#7',
    });
    expect(e.verifyToken(t.token, 'tip').reason).toMatch(/scope/);
    expect(e.verifyToken(t.token + 'x').reason).toMatch(/firma/);
    expect(e.verifyToken('abc').reason).toMatch(/formato/);
    expect(e.verifyToken('bm90anNvbg.' + t.token.split('.')[1]).valid).toBe(false);
    clock.value += 61_000;
    expect(e.verifyToken(t.token).reason).toMatch(/expirado/);
    clock.value -= 61_000;
    expect(makeEngine({ tokenSecret: 'other' }).verifyToken(t.token).valid).toBe(false);
    const withToken = await e.verify('purchase', {
      trustToken: t.token,
      amount: '1 USDC',
      paymentProof: x402({ value: '1000000' }),
    });
    expect(withToken.allowed).toBe(true);
    expect(withToken.checks?.[0].name).toBe('trust-token');
    expect((await e.verify('purchase', { trustToken: t.token })).code).toBe(
      'payment-required',
    );
    expect((await e.verify('purchase', { trustToken: 'bad.token' })).code).toBe(
      'trust-token-invalid',
    );
    expect(
      (await e.verify('purchase', { trustToken: t.token, amount: '50 USDC' })).code,
    ).toBe('spending-limit');
    const wild = e.issueToken('#7', ['*']);
    expect((await e.verify('free', { trustToken: wild.token })).allowed).toBe(true);
    const exec = await e.executeTool(
      'free',
      {},
      { trustToken: wild.token },
      async () => 1,
    );
    expect(exec.audit?.agentId).toBe('#7');
    expect(new TrustEngine({ fetch: fakeFetch }).issueToken('a', ['*']).token).toContain(
      '.',
    );
  });
});

describe('MCP tools + McpCore + REST', () => {
  it('esquemas y nombres', () => {
    expect(TRUST_TOOL_NAMES.length).toBe(5);
    expect(TRUST_TOOL_SCHEMAS.map((s) => s.name)).toEqual([...TRUST_TOOL_NAMES]);
    expect(isTrustTool('trust_verify_identity')).toBe(true);
    expect(isTrustTool('purchase')).toBe(false);
  });
  it('callTrustTool: identidad, permiso (+token), ejecución, auditoría, políticas y errores de esquema', async () => {
    const e = makeEngine();
    const text = (r: { content: Array<Record<string, unknown>> }) =>
      JSON.parse(r.content[0].text as string);
    expect(
      text(
        await callTrustTool(
          'trust_verify_identity',
          { agentId: '#7', chain: 'base', network: 'base-sepolia' },
          e,
        ),
      ).verified,
    ).toBe(true);
    expect(
      (await callTrustTool('trust_verify_identity', { chain: 'base' }, e)).isError,
    ).toBe(true);
    expect(
      text(
        await callTrustTool(
          'trust_verify_identity',
          { agentId: SUI_ADDR, chain: 'base' },
          e,
        ),
      ).verified,
    ).toBe(false);
    const proof = signWith(OWNER_KEY);
    const perm = text(
      await callTrustTool(
        'trust_check_permission',
        {
          toolName: 'purchase',
          proof,
          amount: '0.5 USDC',
          target: USDC,
          paymentProof: x402(),
        },
        e,
      ),
    );
    expect(perm.allowed).toBe(true);
    expect(perm.trustToken.token).toContain('.');
    expect(perm.policy.auth).toBe('erc8004');
    expect(
      text(await callTrustTool('trust_check_permission', { tool: 'free' }, e)).trustToken,
    ).toBeUndefined();
    expect((await callTrustTool('trust_check_permission', {}, e)).isError).toBe(true);
    const bad = await callTrustTool(
      'trust_check_permission',
      { toolName: 'purchase', proof: { nonce: 1 } },
      e,
    );
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/Argumentos inválidos/);
    expect(
      text(
        await callTrustTool(
          'trust_execute_gasless',
          {
            chain: 'sui',
            network: 'sui-testnet',
            tx: { kind: 'transfer', to: SUI_RECIPIENT, amount: '1 USDC' },
            dryRun: true,
          },
          e,
        ),
      ).dryRun,
    ).toBe(true);
    expect(
      text(
        await callTrustTool(
          'trust_execute_gasless',
          {
            chain: 'sui',
            network: 'sui-testnet',
            tx: { kind: 'transfer', to: SUI_RECIPIENT, amount: '1 USDC' },
          },
          e,
        ),
      ).txHash,
    ).toBe('OKDIGEST');
    suiState.failNext = true;
    expect(
      (
        await callTrustTool(
          'trust_execute_gasless',
          {
            chain: 'sui',
            network: 'sui-testnet',
            tx: { kind: 'transfer', to: SUI_RECIPIENT, amount: '1 USDC' },
          },
          e,
        )
      ).isError,
    ).toBe(true);
    const viaPolicy = text(
      await callTrustTool(
        'trust_execute_gasless',
        {
          chain: 'sui',
          toolName: 'tip',
          tx: { kind: 'transfer', to: SUI_RECIPIENT, amount: '1 USDC' },
          proof: sui().signProof({
            agentId: SUI_ADDR,
            scope: ['tip'],
            nonce: 'z',
            expiresAt: nowS() + 60,
          }),
        },
        e,
      ),
    );
    expect(viaPolicy.ok).toBe(true);
    expect(viaPolicy.mode).toBe('trusted');
    expect(
      (await callTrustTool('trust_execute_gasless', { chain: 'sui' }, e)).isError,
    ).toBe(true);
    const log = text(
      await callTrustTool('trust_get_audit_log', { verify: true, limit: 10 }, e),
    );
    expect(log.count).toBe(3);
    expect(log.integrity.ok).toBe(true);
    expect(
      text(await callTrustTool('trust_get_audit_log', { result: 'failed' }, e)).count,
    ).toBe(1);
    expect(text(await callTrustTool('trust_get_policies', {}, e)).count).toBe(5);
    expect(
      text(await callTrustTool('trust_get_policies', { tool: 'nada' }, e)).policy,
    ).toBeNull();
    expect(text(await callTrustTool('trust_get_policies', { tool: 'tip' }, e)).auth).toBe(
      'session-key',
    );
    expect((await callTrustTool('nope' as never, {}, e)).isError).toBe(true);
  });
  it('McpCore: lista tools trust_*, aplica políticas en tools/call con contexto _trust; deshabilitado → error', async () => {
    const e = makeEngine();
    const executed: string[] = [];
    const core = new McpCore({
      toolMap: parseWebMCP(CSS),
      trust: e,
      execute: async (t) => {
        executed.push(t);
        return { done: t };
      },
    });
    expect(core.trustEnabled).toBe(true);
    expect(core.trust).toBe(e);
    expect(core.listTools().tools.map((t) => t.name)).toContain('trust_check_permission');
    const denied = await core.callTool('purchase', { qty: 2 });
    expect(denied.isError).toBe(true);
    expect(JSON.parse(denied.content[0].text as string).code).toBe('agent-required');
    const proof = signWith(OWNER_KEY);
    const ok = await core.callTool('purchase', {
      qty: 2,
      _trust: { proof, amount: '0.5 USDC', target: USDC, paymentProof: x402() },
    });
    expect(ok.isError).toBeUndefined();
    expect(JSON.parse(ok.content[0].text as string)).toMatchObject({
      success: true,
      result: { done: 'purchase' },
      remainingLimit: '9.5 USDC/day',
    });
    expect(executed).toEqual(['purchase']);
    const badCtx = await core.callTool('purchase', { _trust: { proof: { x: 1 } } });
    expect(badCtx.content[0].text).toMatch(/Contexto de confianza inválido/);
    expect(
      (await core.callTool('subscribe', { email: 'a@b.c' })).isError,
    ).toBeUndefined();
    expect(
      JSON.parse(
        (await core.callTool('trust_get_policies', {})).content[0].text as string,
      ).count,
    ).toBe(5);
    const dryCore = new McpCore({ toolMap: parseWebMCP(CSS), trust: makeEngine() });
    const dry = JSON.parse(
      (await dryCore.callTool('free', {})).content[0].text as string,
    );
    expect(dry).toMatchObject({ success: true, dryRun: true });
    const off = new McpCore({ toolMap: parseWebMCP(CSS) });
    expect(off.trustEnabled).toBe(false);
    expect(off.listTools().tools.some((x) => String(x.name).startsWith('trust_'))).toBe(
      false,
    );
    expect((await off.callTrust('trust_get_policies', {})).isError).toBe(true);
  });

  describe('REST /api/trust/*', () => {
    let server: http.Server;
    let base = '';
    const e = makeEngine();
    beforeAll(async () => {
      server = createMcpHttpServer(new McpCore({ toolMap: parseWebMCP(CSS), trust: e }));
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });
    afterAll(() => {
      server?.closeAllConnections?.();
      server?.close();
    });
    const req = async (
      method: string,
      route: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) => {
      const res = await fetch(base + route, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };
    it('policies, identity, verify (200/403/422), execute, audit, token en /api/call, OPTIONS y 404', async () => {
      expect((await req('GET', '/api/trust/policies')).json.count).toBe(5);
      expect((await req('GET', '/api/trust/policies?tool=tip')).json).toMatchObject({
        tool: 'tip',
        auth: 'session-key',
      });
      expect(
        (
          await req(
            'GET',
            '/api/trust/identity?agentId=%237&chain=base&network=base-sepolia',
          )
        ).json.verified,
      ).toBe(true);
      expect((await req('GET', '/api/trust/identity?chain=base')).status).toBe(422);
      const proof = sui().signProof({
        agentId: SUI_ADDR,
        scope: ['tip'],
        nonce: 'r1',
        expiresAt: nowS() + 60,
      });
      const ok = await req('POST', '/api/trust/verify', {
        tool: 'tip',
        proof,
        amount: '1 USDC',
      });
      expect(ok.status).toBe(200);
      expect(ok.json.allowed).toBe(true);
      const token = (ok.json.trustToken as { token: string }).token;
      expect(
        (
          await req('POST', '/api/trust/verify', {
            toolName: 'tip',
            proof: { ...proof, nonce: 'r2' },
          })
        ).status,
      ).toBe(403);
      expect(
        (await req('POST', '/api/trust/verify', { toolName: 'tip', proof: { bad: 1 } }))
          .status,
      ).toBe(422);
      expect((await req('POST', '/api/trust/verify')).status).toBe(422);
      const raw = await fetch(base + '/api/trust/verify', {
        method: 'POST',
        body: '{bad json',
      });
      expect(raw.status).toBe(400);
      const exec = await req('POST', '/api/trust/execute', {
        chain: 'sui',
        network: 'sui-testnet',
        tx: { kind: 'transfer', to: SUI_RECIPIENT, amount: '1 USDC' },
      });
      expect(exec.status).toBe(200);
      expect(exec.json.txHash).toBe('OKDIGEST');
      expect((await req('POST', '/api/trust/execute', { chain: 'sui' })).status).toBe(
        422,
      );
      const call = await req(
        'POST',
        '/api/call',
        { tool: 'tip', args: {} },
        { 'X-Trust-Token': token },
      );
      expect(call.status).toBe(200);
      expect(
        JSON.parse((call.json.content as Array<{ text: string }>)[0].text).success,
      ).toBe(true);
      expect(
        (
          await req(
            'POST',
            '/api/call',
            { tool: 'purchase', args: {} },
            { 'X-Trust-Token': token },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await req(
            'POST',
            '/api/call',
            { tool: 'tip', args: {} },
            { 'X-Trust-Token': 'zz' },
          )
        ).status,
      ).toBe(403);
      const audit = await req('GET', '/api/trust/audit?verify=1&limit=5');
      expect((audit.json.integrity as { ok: boolean }).ok).toBe(true);
      expect(audit.json.count).toBeGreaterThan(0);
      expect((await req('GET', '/api/trust/nada')).status).toBe(404);
      const opts = await fetch(base + '/api/trust/verify', { method: 'OPTIONS' });
      expect(opts.headers.get('access-control-allow-headers')).toContain('X-Trust-Token');
      const notFound = await req('GET', '/nada');
      expect(String(notFound.json.error)).toContain('/api/trust/*');
      const off = createMcpHttpServer(new McpCore({ toolMap: parseWebMCP(CSS) }));
      await new Promise<void>((r) => off.listen(0, '127.0.0.1', r));
      const offBase = `http://127.0.0.1:${(off.address() as { port: number }).port}`;
      expect((await fetch(offBase + '/api/trust/policies')).status).toBe(404);
      off.closeAllConnections?.();
      off.close();
    });
  });
});

describe('script de navegador', () => {
  it('genera window.__WEBMCP_TRUST__ con políticas, helpers y evento; se evalúa sin errores', async () => {
    const { JSDOM } = await import('jsdom');
    const policies = {
      purchase: {
        auth: 'erc8004' as const,
        payment: 'x402' as const,
        chain: 'base' as const,
        spendingLimit: '10 USDC/day',
      },
    };
    const script = buildTrustBrowserScript(policies, {
      apiBase: 'http://localhost:8090',
      origin: 'https://shop.example',
      chainId: 84532,
    });
    expect(script).toContain('window.__WEBMCP_TRUST__');
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      runScripts: 'outside-only',
      url: 'https://shop.example/',
    });
    let ready: unknown;
    dom.window.addEventListener('webmcp:trust-ready', (ev) => {
      ready = (ev as CustomEvent).detail;
    });
    dom.window.eval(script);
    const T = (dom.window as unknown as { __WEBMCP_TRUST__: Record<string, unknown> })
      .__WEBMCP_TRUST__;
    expect(T.tools).toEqual(['purchase']);
    expect(ready).toEqual({ tools: ['purchase'] });
    const requires = T.requires as (t: string) => Record<string, unknown>;
    expect(requires('purchase')).toMatchObject({
      trust: true,
      identity: true,
      payment: true,
      chain: 'base',
    });
    expect(requires('other')).toEqual({ trust: false });
    const proof = (
      T.buildProof as (
        a: string,
        s: string,
        sc: string,
        ttl: number,
      ) => Record<string, unknown>
    )('#7', OWNER, 'purchase', 60);
    expect(proof).toMatchObject({
      agentId: '#7',
      signer: OWNER,
      scope: ['purchase'],
      origin: 'https://shop.example',
    });
    expect(String(proof.nonce)).toMatch(/^0x[0-9a-f]{64}$/);
    await expect(
      (T.signProofEvm as (p: unknown) => Promise<unknown>)(proof),
    ).rejects.toThrow(/window.ethereum/);
    await expect(
      (T.signProofSui as (p: unknown, w: unknown) => Promise<unknown>)(proof, {}),
    ).rejects.toThrow(/signPersonalMessage/);
    const p2 = {
      ...proof,
      scope: ['purchase'],
      expiresAt: 1,
      issuedAt: 0,
    } as unknown as PermissionProof;
    expect((T.suiMessage as (p: unknown) => string)(p2)).toBe(suiPermissionMessage(p2));
    const bare = buildTrustBrowserScript({});
    const dom2 = new JSDOM('<!doctype html><html></html>', {
      runScripts: 'outside-only',
    });
    dom2.window.eval(bare);
    const T2 = (dom2.window as unknown as { __WEBMCP_TRUST__: Record<string, unknown> })
      .__WEBMCP_TRUST__;
    await expect((T2.verify as (t: string) => Promise<unknown>)('x')).rejects.toThrow(
      /apiBase/,
    );
  });
});

describe('CLI trust (dist)', () => {
  const cli = path.join(__dirname, '..', 'dist', 'src', 'cli.js');
  const run = async (args: string[], cwd: string) => {
    const { stdout } = await promisify(execFile)('node', [cli, ...args], {
      cwd,
      env: { ...process.env, WEBMCP_TRUST_RPC: 'http://127.0.0.1:1/never' },
    });
    return stdout;
  };
  it('policies, set-policy, sign-proof, check-permission (offline), inject, networks, audit-log y dry-run', async () => {
    if (!fs.existsSync(cli)) return; // requiere `npm run build`
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-cli-'));
    const css = path.join(dir, 'site.webmcp.css');
    fs.writeFileSync(
      css,
      `.tip { webmcp-tool: "tip"; webmcp-auth: "session-key"; webmcp-chain: "sui-testnet"; webmcp-spending-limit: "5 USDC/day"; }\n.x { webmcp-tool: "x"; }\n`,
    );
    const pol = JSON.parse(
      await run(['trust', 'policies', '--file', css, '--json'], dir),
    );
    expect(pol.tip.auth).toBe('session-key');
    const set = JSON.parse(
      await run(
        [
          'trust',
          'set-policy',
          '--file',
          css,
          '--tool',
          'x',
          '--auth',
          'none',
          '--chain',
          'skale',
          '--rate-limit',
          '2 actions/minute',
          '--json',
        ],
        dir,
      ),
    );
    expect(set.policy).toMatchObject({
      auth: 'none',
      chain: 'skale',
      rateLimit: '2 actions/minute',
    });
    const proofOut = path.join(dir, 'proof.json');
    await run(
      [
        'trust',
        'sign-proof',
        '--agent',
        SUI_ADDR,
        '--scope',
        'tip',
        '--chain',
        'sui',
        '--network',
        'sui-testnet',
        '--key',
        SUI_SEED,
        '--ttl',
        '300',
        '--output',
        proofOut,
      ],
      dir,
    );
    expect(JSON.parse(fs.readFileSync(proofOut, 'utf8')).signer).toBe(SUI_ADDR);
    const evmProof = JSON.parse(
      await run(
        [
          'trust',
          'sign-proof',
          '--agent',
          '#7',
          '--scope',
          'purchase,tip',
          '--chain',
          'base',
          '--network',
          'base-sepolia',
          '--key',
          OWNER_KEY,
          '--max-spend',
          '5 USDC',
          '--origin',
          'https://shop.example',
        ],
        dir,
      ),
    );
    expect(evmProof).toMatchObject({
      signer: OWNER,
      scope: ['purchase', 'tip'],
      maxSpend: '5 USDC',
      chainId: 84532,
    });
    const check = JSON.parse(
      await run(
        [
          'trust',
          'check-permission',
          '--tool',
          'tip',
          '--file',
          css,
          '--proof',
          proofOut,
          '--amount',
          '1 USDC',
          '--json',
        ],
        dir,
      ),
    );
    expect(check.allowed).toBe(true);
    expect(check.remainingLimit).toBe('4 USDC/day');
    const noPolicy = JSON.parse(
      await run(
        ['trust', 'check-permission', '--tool', 'zzz', '--file', css, '--json'],
        dir,
      ),
    );
    expect(noPolicy.policy).toBeNull();
    const script = await run(
      ['trust', 'inject', '--file', css, '--api', 'http://localhost:8090'],
      dir,
    );
    expect(script).toContain('__WEBMCP_TRUST__');
    const nets = JSON.parse(await run(['trust', 'networks', '--json'], dir));
    expect(nets.some((n: { id: string }) => n.id === 'sui-testnet')).toBe(true);
    const log = JSON.parse(await run(['trust', 'audit-log', '--verify', '--json'], dir));
    expect(log.integrity.ok).toBe(true);
    const dry = JSON.parse(
      await run(
        [
          'trust',
          'execute-gasless',
          '--chain',
          'sui',
          '--network',
          'sui-testnet',
          '--tx',
          JSON.stringify({ kind: 'transfer', to: SUI_RECIPIENT, amount: '1 USDC' }),
          '--dry-run',
          '--json',
        ],
        dir,
      ),
    );
    expect(dry.dryRun).toBe(true);
    const human = await run(['trust', 'policies', '--file', css], dir);
    expect(human).toContain('session-key');
  }, 90_000);
});
