/**
 * Tests de Web3-MCP (v1.0.0): propiedades de pago, unidades, billetera con
 * límites, flujo x402 completo (402 → firma EIP-3009 → verificación →
 * liquidación) sobre HTTP real, script MetaMask/WalletConnect en jsdom,
 * validación y operaciones on-chain con un doble de `ethers`.
 */
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseWebMCP } from '../src/parser';
import { readHistory } from '../src/utils/history';
import {
  AgentWallet,
  NETWORKS,
  WEBMCP_PAYMENTS_SOL,
  X402Client,
  buildWalletConnectorScript,
  buildX402Requirements,
  createLocalFacilitator,
  createPaymentGate,
  decodePaymentHeader,
  deployContract,
  encodePaymentHeader,
  fromUnits,
  getBalance,
  listPaidTools,
  loadEthers,
  parsePaymentRequirement,
  resolveNetwork,
  sendPayment,
  setEthersModule,
  signX402Authorization,
  toUnits,
  toolId,
  validatePayments,
  type Signer,
} from '../src/web3';

const PAY_TO = '0x1111111111111111111111111111111111111111';
const css = `
#report { webmcp-tool: "descargarInforme"; webmcp-description: "Descarga el informe premium"; webmcp-payment: "required"; webmcp-network: "base"; webmcp-amount: "0.05 USDC"; webmcp-pay-to: "${PAY_TO}"; webmcp-confirmation: "needed"; webmcp-permissions: "full"; }
#tip { webmcp-tool: "propina"; webmcp-description: "Deja una propina"; webmcp-payment: "optional"; webmcp-amount: "0.001 ETH"; webmcp-network: "8453"; webmcp-pay-to: "0x2222222222222222222222222222222222222222"; }
#free { webmcp-tool: "buscar"; webmcp-description: "Busca"; }
#bad { webmcp-tool: "rota"; webmcp-description: "Mal declarada"; webmcp-payment: "required"; webmcp-pay-to: "no-es-address"; webmcp-network: "999999"; }
`;
const map = parseWebMCP(css);

const mockSigner = (
  address = '0xabcabcabcabcabcabcabcabcabcabcabcabcabca',
): Signer & { signed: unknown[] } => {
  const signed: unknown[] = [];
  return {
    signed,
    getAddress: async () => address,
    signTypedData: async (domain, types, value) => {
      signed.push({ domain, types, value });
      return `0xmock${'ab'.repeat(64)}`;
    },
  };
};

describe('web3 · propiedades de pago y unidades', () => {
  it('parsea webmcp-payment/network/amount/pay-to y resuelve redes por nombre o chainId', () => {
    const paid = listPaidTools(map);
    expect(paid.map((r) => r.tool)).toEqual(['descargarInforme', 'propina', 'rota']);
    const report = paid[0];
    expect(report).toMatchObject({
      policy: 'required',
      amount: 0.05,
      currency: 'USDC',
      amountUnits: '50000',
      payTo: PAY_TO,
      protocol: 'x402',
      decimals: 6,
    });
    expect(report.network).toMatchObject({ name: 'base', chainId: 8453 });
    expect(paid[1]).toMatchObject({
      policy: 'optional',
      currency: 'ETH',
      protocol: 'onchain',
      decimals: 18,
      amountUnits: '1000000000000000',
    });
    expect(paid[1].network.name).toBe('base'); // "8453" → base
    expect(parsePaymentRequirement('buscar', map.tools.buscar)).toBeNull();
    expect(resolveNetwork(undefined).name).toBe('base');
    expect(resolveNetwork('Polygon').chainId).toBe(137);
    expect(resolveNetwork(11155111).name).toBe('sepolia');
    expect(resolveNetwork('999999')).toMatchObject({ name: '999999', chainId: 999999 });
    expect(resolveNetwork('999999').usdc).toBeUndefined();
    expect(Object.keys(NETWORKS).length).toBeGreaterThanOrEqual(8);
    for (const n of Object.values(NETWORKS))
      if (n.usdc) expect(n.usdc).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('toUnits/fromUnits convierten sin pérdida', () => {
    expect(toUnits('0.05', 6)).toBe('50000');
    expect(toUnits(1.5, 18)).toBe('1500000000000000000');
    expect(toUnits('0', 6)).toBe('0');
    expect(toUnits('12.3456789', 6)).toBe('12345678');
    expect(fromUnits('50000', 6)).toBe(0.05);
    expect(fromUnits(1500000000000000000n, 18)).toBe(1.5);
    expect(fromUnits('7', 6)).toBe(0.000007);
    expect(toolId('descargarInforme')).toMatch(/^0x[0-9a-f]{64}$/);
    expect(toolId('a')).not.toBe(toolId('b'));
  });

  it('validatePayments detecta importes, direcciones, redes y confirmaciones ausentes', () => {
    const issues = validatePayments(map);
    const of = (tool: string) =>
      issues.filter((i) => i.tool === tool).map((i) => `${i.severity}:${i.message}`);
    expect(of('descargarInforme')).toEqual([]);
    expect(of('buscar')).toEqual([]);
    expect(of('rota').filter((m) => m.startsWith('error')).length).toBe(2); // sin amount y pay-to inválido
    expect(of('rota').join(' ')).toMatch(/No conozco el contrato USDC/);
    expect(of('rota').join(' ')).toMatch(/sin confirmación/);
    expect(of('rota').join(' ')).toMatch(/webmcp-permissions: "full"/);
    const noPayTo = parseWebMCP(
      '#x { webmcp-tool: "x"; webmcp-payment: "optional"; webmcp-amount: "1 USDC"; }',
    );
    expect(validatePayments(noPayTo)[0].message).toMatch(/Falta webmcp-pay-to/);
  });
});

describe('web3 · billetera con límites de gasto', () => {
  it('canSpend aplica límites por operación, sesión, día, receptores y redes', () => {
    let now = Date.parse('2026-09-04T10:00:00Z');
    const wallet = new AgentWallet({
      limits: {
        perTx: 1,
        perSession: 2.5,
        perDay: 3,
        allowedRecipients: [PAY_TO],
        allowedNetworks: ['base', 'polygon'],
      },
      now: () => now,
    });
    expect(wallet.canSpend(0.5, PAY_TO, 'base')).toEqual({
      allowed: true,
      reasons: [],
      remaining: { perSession: 2.5, perDay: 3 },
    });
    expect(wallet.canSpend(1.5, PAY_TO, 'base').reasons[0]).toMatch(
      /límite por operación/,
    );
    expect(
      wallet.canSpend(0.5, '0x9999999999999999999999999999999999999999', 'base')
        .reasons[0],
    ).toMatch(/lista blanca/);
    expect(wallet.canSpend(0.5, PAY_TO, 'ethereum').reasons[0]).toMatch(
      /red ethereum no permitida/,
    );
    expect(wallet.canSpend(-1, PAY_TO, 'base').reasons[0]).toBe('importe inválido');
    for (let i = 0; i < 3; i++)
      wallet.record({
        to: PAY_TO,
        amount: 0.8,
        currency: 'USDC',
        network: 'base',
        protocol: 'x402',
        status: i === 1 ? 'rejected' : 'settled',
      });
    expect(wallet.spentSession).toBeCloseTo(1.6);
    expect(wallet.canSpend(1, PAY_TO, 'base').reasons[0]).toMatch(/límite de sesión/);
    expect(wallet.canSpend(0.9, PAY_TO, 'base').allowed).toBe(true);
    // El límite diario mira 24 h: al avanzar el reloj el gasto del día cae.
    now += 25 * 3600 * 1000;
    expect(wallet.spentDay).toBe(0);
    expect(wallet.spentSession).toBeCloseTo(1.6);
    expect(wallet.summary()).toMatchObject({ payments: 3, settled: 2, rejected: 1 });
  });

  it('sin límites todo pasa (Web3 abierto), y sin firmante lanza un error claro', async () => {
    const open = new AgentWallet();
    expect(open.canSpend(1_000_000, PAY_TO, 'cualquier-red')).toMatchObject({
      allowed: true,
      remaining: {},
    });
    await expect(open.getSigner()).rejects.toThrow(/WEBMCP_WALLET_KEY/);
    const withSigner = new AgentWallet({
      signer: mockSigner('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'),
    });
    expect(await withSigner.address()).toBe('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
  });

  it('registra los pagos en el historial cuando se pide', () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-w3-')),
      'history.json',
    );
    const wallet = new AgentWallet({ recordHistory: true, historyFile: file });
    wallet.record({
      tool: 'descargarInforme',
      to: PAY_TO,
      amount: 0.05,
      currency: 'USDC',
      network: 'base',
      protocol: 'x402',
      status: 'settled',
      txHash: '0xtx',
    });
    wallet.record({
      to: PAY_TO,
      amount: 9,
      currency: 'USDC',
      network: 'base',
      protocol: 'onchain',
      status: 'rejected',
      reason: 'límite',
    });
    const events = readHistory(file);
    expect(events.map((e) => [e.type, e.tool, e.ok])).toEqual([
      ['payment', 'descargarInforme', true],
      ['payment', undefined, false],
    ]);
    expect(events[0].details).toMatchObject({
      amount: 0.05,
      txHash: '0xtx',
      protocol: 'x402',
    });
  });
});

describe('web3 · x402 (micropagos USDC gasless)', () => {
  it('buildX402Requirements y cabeceras codifican/decodifican el payload', async () => {
    const req = parsePaymentRequirement('descargarInforme', map.tools.descargarInforme)!;
    const reqs = buildX402Requirements(req, '/tools/descargarInforme');
    expect(reqs.x402Version).toBe(1);
    expect(reqs.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'base',
      maxAmountRequired: '50000',
      asset: NETWORKS.base.usdc,
      payTo: PAY_TO,
      resource: '/tools/descargarInforme',
      extra: { name: 'USD Coin', version: '2' },
    });
    const signer = mockSigner();
    const payload = await signX402Authorization(signer, reqs.accepts[0], {
      now: 1_000_000,
    });
    expect(payload.payload.authorization).toMatchObject({
      from: await signer.getAddress(),
      to: PAY_TO,
      value: '50000',
      validAfter: '999940',
      validBefore: '1000300',
    });
    expect(payload.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    const typed = signer.signed[0] as {
      domain: { chainId: number; verifyingContract: string; name: string };
      types: Record<string, unknown>;
    };
    expect(typed.domain).toMatchObject({
      chainId: 8453,
      verifyingContract: NETWORKS.base.usdc,
      name: 'USD Coin',
    });
    expect(Object.keys(typed.types)).toEqual(['TransferWithAuthorization']);
    const header = encodePaymentHeader(payload);
    expect(decodePaymentHeader(header)).toEqual(payload);
    expect(decodePaymentHeader('no-base64!!')).toBeNull();
    expect(
      decodePaymentHeader(Buffer.from('{"x402Version":2}').toString('base64')),
    ).toBeNull();
  });

  it('el facilitador local valida receptor, importe, ventana temporal, nonce y formato de firma', async () => {
    const req = parsePaymentRequirement('descargarInforme', map.tools.descargarInforme)!;
    const accept = buildX402Requirements(req, '/r').accepts[0];
    const facilitator = createLocalFacilitator({ now: () => 1_000_000 });
    const good = await signX402Authorization(mockSigner(), accept, { now: 1_000_000 });
    expect(await facilitator.verify(good, accept)).toEqual({ valid: true });
    expect((await facilitator.verify(good, accept)).reason).toBe('nonce reutilizado');
    const tweak = (
      patch: Partial<typeof good.payload.authorization>,
      signature?: string,
    ) => ({
      ...good,
      payload: {
        signature: signature ?? good.payload.signature,
        authorization: {
          ...good.payload.authorization,
          nonce: `0x${'1'.repeat(64)}`,
          ...patch,
        },
      },
    });
    expect(
      (
        await facilitator.verify(
          tweak({ to: '0x3333333333333333333333333333333333333333' }),
          accept,
        )
      ).reason,
    ).toBe('receptor incorrecto');
    expect((await facilitator.verify(tweak({ value: '49999' }), accept)).reason).toBe(
      'importe insuficiente',
    );
    expect(
      (await facilitator.verify(tweak({ validAfter: '1000001' }), accept)).reason,
    ).toBe('autorización aún no válida');
    expect(
      (await facilitator.verify(tweak({ validBefore: '999999' }), accept)).reason,
    ).toBe('autorización expirada');
    expect((await facilitator.verify(tweak({}, '0xzzz'), accept)).reason).toBe(
      'firma con formato inválido',
    );
    expect(
      (await facilitator.verify(tweak({}, `0x${'a'.repeat(130)}`), accept)).valid,
    ).toBe(true);
  });

  describe('flujo completo sobre HTTP', () => {
    let server: http.Server;
    let url: string;
    const settlements: string[] = [];

    beforeAll(async () => {
      const req = parsePaymentRequirement(
        'descargarInforme',
        map.tools.descargarInforme,
      )!;
      const facilitator = createLocalFacilitator();
      const gate = createPaymentGate(req, {
        verify: facilitator.verify,
        settle: async (payload) => {
          settlements.push(payload.payload.authorization.nonce);
          return { ok: true, txHash: `0xsettled${settlements.length}` };
        },
      });
      const optionalGate = createPaymentGate(
        parsePaymentRequirement('propina', map.tools.propina)!,
      );
      const freeGate = createPaymentGate({
        tool: 'buscar',
        policy: 'none',
        network: NETWORKS.base,
        amount: 0,
        currency: 'USDC',
        amountUnits: '0',
        protocol: 'x402',
        decimals: 6,
      });
      server = http.createServer(async (rq, rs) => {
        const g = rq.url?.startsWith('/tools/propina')
          ? optionalGate
          : rq.url?.startsWith('/tools/buscar')
            ? freeGate
            : gate;
        if (!(await g({ url: rq.url, headers: rq.headers }, rs))) return;
        rs.setHeader('Content-Type', 'application/json');
        rs.end(JSON.stringify({ ok: true, tool: rq.url }));
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
      url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });

    afterAll(async () => {
      (
        server as http.Server & { closeAllConnections?: () => void }
      ).closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
    });

    it('sin cabecera responde 402 con los requisitos; opcional y gratis pasan', async () => {
      const res = await fetch(`${url}/tools/descargarInforme`);
      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.accepts[0]).toMatchObject({
        payTo: PAY_TO,
        maxAmountRequired: '50000',
        resource: '/tools/descargarInforme',
      });
      expect(body.error).toMatch(/X-PAYMENT/);
      expect((await fetch(`${url}/tools/propina`)).status).toBe(200);
      expect((await fetch(`${url}/tools/buscar`)).status).toBe(200);
      const bad = await fetch(`${url}/tools/descargarInforme`, {
        headers: {
          'X-PAYMENT': Buffer.from(
            '{"x402Version":1,"payload":{"authorization":{"to":"0x0","value":"1","validAfter":"0","validBefore":"0","nonce":"0x1"}}}',
          ).toString('base64'),
        },
      });
      expect(bad.status).toBe(402);
      expect((await bad.json()).error).toBe('receptor incorrecto');
    });

    it('X402Client paga automáticamente dentro de los límites y registra la liquidación', async () => {
      const wallet = new AgentWallet({
        limits: { perTx: 0.1, perSession: 0.12 },
        signer: mockSigner(),
      });
      const client = new X402Client(wallet);
      const r1 = await client.fetch(
        `${url}/tools/descargarInforme`,
        {},
        { tool: 'descargarInforme' },
      );
      expect(r1.response.status).toBe(200);
      expect(await r1.response.json()).toEqual({
        ok: true,
        tool: '/tools/descargarInforme',
      });
      expect(r1.payment).toMatchObject({
        tool: 'descargarInforme',
        status: 'settled',
        amount: 0.05,
        currency: 'USDC',
        network: 'base',
        protocol: 'x402',
        txHash: '0xsettled1',
      });
      expect(r1.settlement).toMatchObject({
        success: true,
        txHash: '0xsettled1',
        network: 'base',
        payer: await wallet.address(),
      });
      const r2 = await client.fetch(
        `${url}/tools/descargarInforme`,
        {},
        { tool: 'descargarInforme' },
      );
      expect(r2.payment?.status).toBe('settled');
      // Tercer pago: 0.15 > perSession 0.12 → rechazado sin firmar ni llamar de nuevo.
      const r3 = await client.fetch(
        `${url}/tools/descargarInforme`,
        {},
        { tool: 'descargarInforme' },
      );
      expect(r3.response.status).toBe(402);
      expect(r3.payment).toMatchObject({ status: 'rejected' });
      expect(r3.payment?.reason).toMatch(/límite de sesión/);
      expect(settlements).toHaveLength(2);
      expect(wallet.summary()).toMatchObject({ payments: 3, settled: 2, rejected: 1 });
      expect(wallet.spentSession).toBeCloseTo(0.1);
      // maxAmount por llamada y recursos sin 402 pasan directos.
      const r4 = await client.fetch(
        `${url}/tools/descargarInforme`,
        {},
        { maxAmount: 0.01 },
      );
      expect(r4.payment?.reason).toMatch(/supera maxAmount/);
      expect((await client.fetch(`${url}/tools/buscar`)).payment).toBeUndefined();
    });

    it('una liquidación fallida deja el pago como failed', async () => {
      const failing = createPaymentGate(
        parsePaymentRequirement('descargarInforme', map.tools.descargarInforme)!,
        {
          verify: async () => ({ valid: true }),
          settle: async () => ({ ok: false, reason: 'fondos insuficientes' }),
        },
      );
      const srv = http.createServer(async (rq, rs) => {
        if (!(await failing({ url: rq.url, headers: rq.headers }, rs))) {
          if (!rs.writableEnded) {
            rs.statusCode = 402;
            rs.end();
          }
          return;
        }
        rs.end('ok');
      });
      await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
      const port = (srv.address() as { port: number }).port;
      try {
        const client = new X402Client(new AgentWallet({ signer: mockSigner() }));
        const r = await client.fetch(`http://127.0.0.1:${port}/tools/descargarInforme`);
        expect(r.payment?.status).toBe('failed');
        expect(r.payment?.reason).toBe('fondos insuficientes');
        expect(r.settlement?.success).toBe(false);
      } finally {
        (
          srv as http.Server & { closeAllConnections?: () => void }
        ).closeAllConnections?.();
        await new Promise<void>((r) => srv.close(() => r()));
      }
    });
  });
});

describe('web3 · navegador (MetaMask / WalletConnect)', () => {
  it('buildWalletConnectorScript expone __WEBMCP_WALLET__ y firma EIP-712 vía eth_signTypedData_v4', async () => {
    const script = buildWalletConnectorScript(map, { perTx: 0.1, perSession: 0.12 });
    expect(script).toContain('descargarInforme');
    expect(script).not.toContain('</'); // seguro para incrustar en <script> (los datos escapan "<")
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
    const calls: Array<{ method: string; params?: unknown[] }> = [];
    const w = dom.window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.ethereum = {
      request: async (r: { method: string; params?: unknown[] }) => {
        calls.push(r);
        switch (r.method) {
          case 'eth_requestAccounts':
            return ['0xabcabcabcabcabcabcabcabcabcabcabcabcabca'];
          case 'eth_chainId':
            return '0x2105'; // 8453
          case 'eth_signTypedData_v4':
            return `0x${'cd'.repeat(65)}`;
          case 'eth_sendTransaction':
            return '0xtxhash';
          default:
            throw new Error(`método inesperado ${r.method}`);
        }
      },
    };
    w.eval(script);
    const wallet = w.__WEBMCP_WALLET__;
    expect(wallet.paidTools.map((t: { tool: string }) => t.tool)).toEqual([
      'descargarInforme',
      'propina',
      'rota',
    ]);
    expect(wallet.limits).toEqual({ perTx: 0.1, perSession: 0.12 });
    expect(await wallet.connect()).toEqual({
      account: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca',
      chainId: 8453,
    });
    const paid = await wallet.payTool('descargarInforme');
    expect(paid.paid).toBe(true);
    expect(paid.payload.payload.authorization).toMatchObject({
      from: '0xabcabcabcabcabcabcabcabcabcabcabcabcabca',
      to: PAY_TO,
      value: '50000',
    });
    const decoded = decodePaymentHeader(paid.header);
    expect(decoded?.network).toBe('base');
    const typed = JSON.parse(
      calls.find((c) => c.method === 'eth_signTypedData_v4')!.params![1] as string,
    );
    expect(typed.primaryType).toBe('TransferWithAuthorization');
    expect(typed.domain).toMatchObject({
      chainId: 8453,
      verifyingContract: NETWORKS.base.usdc,
    });
    expect(wallet.spent).toBeCloseTo(0.05);
    // Segundo pago excede la sesión (0.10 > límite? no: 0.10 ≤ 0.12), tercero sí.
    expect((await wallet.payTool('descargarInforme')).paid).toBe(true);
    const third = await wallet.payTool('descargarInforme');
    expect(third).toMatchObject({ paid: false });
    expect(third.reason).toMatch(/sesion/);
    expect(await wallet.payTool('buscar')).toEqual({
      paid: false,
      reason: 'la tool no requiere pago',
    });
    // Pago nativo (protocol onchain) usa eth_sendTransaction.
    const openWallet = (() => {
      w.eval(buildWalletConnectorScript(map));
      return w.__WEBMCP_WALLET__;
    })();
    const tip = await openWallet.payTool('propina');
    expect(tip).toEqual({ paid: true, txHash: '0xtxhash' });
    expect(calls.at(-1)).toMatchObject({
      method: 'eth_sendTransaction',
      params: [
        { to: '0x2222222222222222222222222222222222222222', value: '0x38d7ea4c68000' },
      ],
    });
  });

  it('sin proveedor EIP-1193 connect lanza un error claro', async () => {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { runScripts: 'outside-only' });
    const w = dom.window as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    w.eval(buildWalletConnectorScript(map));
    await expect(w.__WEBMCP_WALLET__.connect()).rejects.toThrow(/MetaMask|WalletConnect/);
  });
});

describe('web3 · on-chain con doble de ethers', () => {
  const txs: unknown[] = [];
  const fakeEthers = {
    JsonRpcProvider: class {
      constructor(public rpc: string) {}
      async getBalance() {
        return 1_500_000_000_000_000_000n;
      }
    },
    Contract: class {
      constructor(
        public address: string,
        public abi: string[],
        public runner: unknown,
      ) {}
      async balanceOf() {
        return 12_500_000n;
      }
      async transfer(to: string, value: bigint) {
        txs.push({ kind: 'usdc', to, value: value.toString() });
        return { hash: '0xusdc', wait: async () => ({}) };
      }
    },
    ContractFactory: class {
      constructor(
        public abi: unknown[],
        public bytecode: string,
        public runner: unknown,
      ) {}
      async deploy(...args: unknown[]) {
        txs.push({ kind: 'deploy', args });
        return {
          deploymentTransaction: () => ({ hash: '0xdeploy' }),
          waitForDeployment: async () => ({}),
          getAddress: async () => '0xC0ffee0000000000000000000000000000000000',
        };
      }
    },
    Wallet: class {
      constructor(public key: string) {}
      async getAddress() {
        return '0xfromkey00000000000000000000000000000000';
      }
      async signTypedData() {
        return '0xsig';
      }
      connect(provider: unknown) {
        return {
          ...this,
          provider,
          sendTransaction: async (t: { to: string; value: bigint }) => (
            txs.push({ kind: 'native', ...t, value: t.value.toString() }),
            { hash: '0xnative', wait: async () => ({}) }
          ),
        };
      }
    },
    formatEther: (wei: bigint) => (Number(wei) / 1e18).toString(),
    parseEther: (v: string) => BigInt(Math.round(Number(v) * 1e18)),
  };

  afterEach(() => setEthersModule(null));

  it('sin ethers instalado las operaciones on-chain explican cómo instalarlo', async () => {
    await expect(loadEthers()).rejects.toThrow(/npm i ethers/);
    await expect(getBalance(PAY_TO)).rejects.toThrow(/ethers/);
  });

  it('getBalance consulta saldo nativo y USDC en la red indicada', async () => {
    setEthersModule(fakeEthers);
    const bal = await getBalance(PAY_TO, 'polygon');
    expect(bal).toEqual({
      address: PAY_TO,
      network: 'polygon',
      native: { symbol: 'MATIC', balance: 1.5 },
      usdc: { balance: 12.5, contract: NETWORKS.polygon.usdc },
    });
    expect((await getBalance(PAY_TO, '999999')).usdc).toBeUndefined();
  });

  it('sendPayment transfiere USDC o nativo respetando límites y deployContract despliega', async () => {
    setEthersModule(fakeEthers);
    const wallet = new AgentWallet({
      privateKey: '0x' + '1'.repeat(64),
      limits: { perTx: 5 },
    });
    expect(await wallet.address()).toBe('0xfromkey00000000000000000000000000000000');
    const usdc = await sendPayment(wallet, {
      to: PAY_TO,
      amount: 2.5,
      network: 'base',
      tool: 'descargarInforme',
    });
    expect(usdc).toMatchObject({
      status: 'settled',
      txHash: '0xusdc',
      currency: 'USDC',
      network: 'base',
      protocol: 'onchain',
      tool: 'descargarInforme',
    });
    expect(txs.at(-1)).toEqual({ kind: 'usdc', to: PAY_TO, value: '2500000' });
    const native = await sendPayment(wallet, {
      to: PAY_TO,
      amount: 0.25,
      currency: 'eth',
      network: 'arbitrum',
    });
    expect(native).toMatchObject({
      status: 'settled',
      txHash: '0xnative',
      currency: 'ETH',
      network: 'arbitrum',
    });
    expect(txs.at(-1)).toMatchObject({
      kind: 'native',
      to: PAY_TO,
      value: '250000000000000000',
    });
    const rejected = await sendPayment(wallet, { to: PAY_TO, amount: 50 });
    expect(rejected.status).toBe('rejected');
    expect(rejected.reason).toMatch(/límite por operación/);
    const noUsdc = await sendPayment(wallet, {
      to: PAY_TO,
      amount: 1,
      network: '424242',
    });
    expect(noUsdc.status).toBe('failed');
    expect(noUsdc.reason).toMatch(/No conozco el contrato USDC/);
    const deployed = await deployContract(
      wallet,
      { abi: [], bytecode: '0x60' },
      { network: 'base', args: [NETWORKS.base.usdc] },
    );
    expect(deployed).toEqual({
      address: '0xC0ffee0000000000000000000000000000000000',
      txHash: '0xdeploy',
      network: 'base',
      explorer: 'https://basescan.org/address/0xC0ffee0000000000000000000000000000000000',
    });
    expect(txs.at(-1)).toEqual({ kind: 'deploy', args: [NETWORKS.base.usdc] });
    expect(wallet.summary().settled).toBe(2);
  });

  it('el contrato Solidity de referencia incluye pagos nativos y USDC por tool', () => {
    expect(WEBMCP_PAYMENTS_SOL).toContain('contract WebMCPPayments');
    expect(WEBMCP_PAYMENTS_SOL).toContain(
      'function payTool(bytes32 toolId) external payable',
    );
    expect(WEBMCP_PAYMENTS_SOL).toContain('function payToolUSDC(bytes32 toolId)');
    expect(WEBMCP_PAYMENTS_SOL).toContain(
      'function hasAccess(address payer, bytes32 toolId)',
    );
    expect(WEBMCP_PAYMENTS_SOL).toMatch(/pragma solidity \^0\.8/);
  });
});
