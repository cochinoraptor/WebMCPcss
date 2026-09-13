/**
 * Tests del parser de confianza y validación de esquemas (v1.3.0):
 * propiedades `webmcp-auth/payment/chain/...`, límites, listas, set-policy.
 */
import { describe, expect, it } from 'vitest';
import { parseWebMCP } from '../src/parser';
import {
  extractTrustPolicies,
  hasTrustProps,
  parseTrustPolicies,
  policyFromTool,
  policyToDeclarations,
  setPolicyInCss,
} from '../src/trust/parser/trust-parser';
import {
  TrustSchemaError,
  formatLimit,
  parseAmount,
  parseBool,
  parseList,
  parseRateLimit,
  parseSpendingLimit,
  validateHumanProof,
  validatePermissionProof,
  validateTransaction,
  validateTrustPolicy,
} from '../src/trust/parser/schema';

const CSS = `
.checkout-button {
  webmcp-tool: "purchase";
  webmcp-auth: "erc8004";
  webmcp-payment: "x402";
  webmcp-chain: "sui";
  webmcp-spending-limit: "100 USDC/day";
  webmcp-rate-limit: "5 actions/minute";
  webmcp-requires-human-proof: true;
  webmcp-allowed-contracts: "0xABC0000000000000000000000000000000000001,0xdef0000000000000000000000000000000000002";
}
.tip { webmcp-tool: "tip"; webmcp-chain: "base-sepolia"; webmcp-payment: "required"; webmcp-amount: "0.5 USDC"; webmcp-pay-to: "0x000000000000000000000000000000000000dEaD"; }
.legacy { webmcp-tool: "pay"; webmcp-payment: "optional"; webmcp-payment-protocol: "onchain"; webmcp-network: "base"; }
.legacy2 { webmcp-tool: "pay2"; webmcp-chain: "evm"; webmcp-payment: "optional"; webmcp-payment-protocol: "onchain"; webmcp-network: "base"; }
.plain { webmcp-tool: "subscribe"; webmcp-param-email: "string"; webmcp-payment: "none"; }
.ctx { webmcp-context: "total"; webmcp-format: "currency"; }
`;

describe('trust-parser', () => {
  it('extrae una TrustPolicy por herramienta con propiedades de confianza', () => {
    const policies = parseTrustPolicies(CSS);
    expect(Object.keys(policies).sort()).toEqual(['pay2', 'purchase', 'tip']);
    expect(policies.purchase).toEqual({
      auth: 'erc8004',
      payment: 'x402',
      chain: 'sui',
      spendingLimit: '100 USDC/day',
      rateLimit: '5 actions/minute',
      requiresHumanProof: true,
      allowedContracts: [
        '0xabc0000000000000000000000000000000000001',
        '0xdef0000000000000000000000000000000000002',
      ],
    });
  });
  it('separa familia y red cuando webmcp-chain trae la red (base-sepolia → base + network)', () => {
    const { tip } = parseTrustPolicies(CSS);
    expect(tip.chain).toBe('base');
    expect(tip.network).toBe('base-sepolia');
    expect(tip.payment).toBe('x402'); // required → protocolo por defecto x402
    expect(tip.amount).toBe('0.5 USDC');
    expect(tip.payTo).toBe('0x000000000000000000000000000000000000dEaD');
  });
  it('no activa la capa de confianza solo con webmcp-payment required|optional (módulo Web3 v1.0)', () => {
    const map = parseWebMCP(CSS);
    expect(hasTrustProps(map.tools.pay)).toBe(false);
    expect(parseTrustPolicies(CSS).pay).toBeUndefined();
  });
  it('mapea el módulo Web3 v1.0 (payment optional + onchain) a sponsored cuando hay webmcp-chain', () => {
    const { pay2 } = parseTrustPolicies(CSS);
    expect(pay2.payment).toBe('sponsored');
    expect(pay2.chain).toBe('evm');
    expect(pay2.network).toBe('base');
  });
  it('no crea política para tools sin auth/payment/chain', () => {
    const map = parseWebMCP(CSS);
    expect(hasTrustProps(map.tools.subscribe)).toBe(false);
    expect(policyFromTool(map.tools.subscribe)).toBeNull();
    expect(extractTrustPolicies({ tools: {}, context: {} })).toEqual({});
  });
  it('acepta alias auth-type/payment-method/chain-type', () => {
    const p = parseTrustPolicies(
      '.a { webmcp-tool: "x"; webmcp-auth-type: "session-key"; webmcp-payment-method: "eip3009"; webmcp-chain-type: "skale"; webmcp-allowed-hours: "09:00-18:00"; }',
    );
    expect(p.x).toMatchObject({
      auth: 'session-key',
      payment: 'eip3009',
      chain: 'skale',
      allowedHours: '09:00-18:00',
    });
  });
  it('lanza errores claros con valores inválidos', () => {
    expect(() =>
      parseTrustPolicies('.a { webmcp-tool: "x"; webmcp-auth: "magic"; }'),
    ).toThrow(/auth/);
    expect(() =>
      parseTrustPolicies(
        '.a { webmcp-tool: "x"; webmcp-auth: "none"; webmcp-spending-limit: "mucho"; }',
      ),
    ).toThrow(/spendingLimit/);
    expect(() =>
      parseTrustPolicies(
        '.a { webmcp-tool: "x"; webmcp-chain: "sui"; webmcp-allowed-contracts: "hola"; }',
      ),
    ).toThrow(/allowedContracts/);
  });
  it('serializa políticas a declaraciones CSS', () => {
    const lines = policyToDeclarations({
      auth: 'erc8004',
      payment: 'none',
      chain: 'base',
      requiresHumanProof: false,
      allowedContracts: ['0xabc0000000000000000000000000000000000001'],
    });
    expect(lines).toEqual([
      '  webmcp-auth: "erc8004";',
      '  webmcp-payment: "none";',
      '  webmcp-chain: "base";',
      '  webmcp-requires-human-proof: false;',
      '  webmcp-allowed-contracts: "0xabc0000000000000000000000000000000000001";',
    ]);
  });
});

describe('setPolicyInCss', () => {
  it('añade propiedades a la regla de la tool y actualiza las existentes conservando el resto', () => {
    const css = `/* c */\n.btn {\n  webmcp-tool: "purchase";\n  webmcp-spending-limit: "1 USDC/day";\n  color: red;\n}\n.other { webmcp-tool: "x"; }\n`;
    const out = setPolicyInCss(css, 'purchase', {
      spendingLimit: '100 USDC/day',
      auth: 'erc8004',
      chain: 'base',
      requiresHumanProof: true,
    });
    expect(out).toContain('webmcp-spending-limit: "100 USDC/day";');
    expect(out).not.toContain('"1 USDC/day"');
    expect(out).toContain('  webmcp-auth: "erc8004";');
    expect(out).toContain('  webmcp-requires-human-proof: true;');
    expect(out).toContain('color: red;');
    expect(out).toContain('.other { webmcp-tool: "x"; }');
    expect(out.startsWith('/* c */')).toBe(true);
    expect(parseTrustPolicies(out).purchase).toMatchObject({
      auth: 'erc8004',
      chain: 'base',
      spendingLimit: '100 USDC/day',
      requiresHumanProof: true,
    });
  });
  it('falla si la tool no existe', () => {
    expect(() =>
      setPolicyInCss('.a { webmcp-tool: "a"; }', 'zzz', { auth: 'none' }),
    ).toThrow(/zzz/);
  });
});

describe('schema helpers', () => {
  it('parseSpendingLimit acepta varias formas', () => {
    expect(parseSpendingLimit('100 USDC/day')).toEqual({
      amount: 100,
      currency: 'USDC',
      per: 'day',
      windowMs: 86_400_000,
    });
    expect(parseSpendingLimit('0.5 USDC per tx')).toMatchObject({
      amount: 0.5,
      per: 'tx',
      windowMs: 0,
    });
    expect(parseSpendingLimit('20 usdc')).toMatchObject({
      amount: 20,
      currency: 'USDC',
      per: 'total',
    });
    expect(parseSpendingLimit('5 ETH/hora')).toMatchObject({
      currency: 'ETH',
      per: 'hour',
    });
    expect(parseSpendingLimit(undefined)).toBeUndefined();
    expect(() => parseSpendingLimit('abc')).toThrow(TrustSchemaError);
    expect(() => parseSpendingLimit('1 USDC/fortnight')).toThrow(/ventana/);
  });
  it('parseRateLimit acepta varias formas', () => {
    expect(parseRateLimit('5 actions/minute')).toEqual({
      count: 5,
      per: 'minute',
      windowMs: 60_000,
    });
    expect(parseRateLimit('10/min')).toMatchObject({ count: 10, per: 'minute' });
    expect(parseRateLimit('100 per hour')).toMatchObject({ count: 100, per: 'hour' });
    expect(parseRateLimit('3 acciones por 10 s')).toEqual({
      count: 3,
      per: 'second',
      windowMs: 10_000,
    });
    expect(() => parseRateLimit('rápido')).toThrow(/rateLimit/);
    expect(() => parseRateLimit('1/week')).toThrow(/no soportada/);
  });
  it('parseList, parseBool, parseAmount y formatLimit', () => {
    expect(parseList('A, b  c')).toEqual(['a', 'b', 'c']);
    expect(parseList(['X'])).toEqual(['x']);
    expect(parseList('')).toBeUndefined();
    expect(parseBool('yes')).toBe(true);
    expect(parseBool('0')).toBe(false);
    expect(parseBool(undefined)).toBeUndefined();
    expect(() => parseBool('quizá')).toThrow(/booleano/);
    expect(parseAmount('1.5 usdc')).toEqual({ amount: 1.5, currency: 'USDC' });
    expect(parseAmount('3')).toEqual({ amount: 3, currency: 'USDC' });
    expect(() => parseAmount('x')).toThrow(/importe/);
    expect(formatLimit(4.5, 'USDC', 'day')).toBe('4.5 USDC/day');
    expect(formatLimit(10, 'USDC', 'total')).toBe('10 USDC');
  });
  it('validateTrustPolicy normaliza y valida', () => {
    expect(validateTrustPolicy({})).toEqual({
      auth: 'none',
      payment: 'none',
      chain: 'sui',
    });
    expect(
      validateTrustPolicy({
        auth: 'ERC8004',
        chain: 'Base',
        network: 'Base-Sepolia',
        identityRegistry: '0x8004A818BFB912233c491871b3d84c89A494BD9e',
      }),
    ).toMatchObject({ auth: 'erc8004', chain: 'base', network: 'base-sepolia' });
    expect(() => validateTrustPolicy({ allowedHours: '9-25h' })).toThrow(/allowedHours/);
    expect(() => validateTrustPolicy({ identityRegistry: '0x12' })).toThrow(
      /identityRegistry/,
    );
    expect(() => validateTrustPolicy({ payment: 'cash' })).toThrow(/payment/);
  });
  it('validatePermissionProof exige campos y normaliza scope/delegación', () => {
    const base = {
      signature: '0xaa',
      nonce: '0x01',
      expiresAt: 2e9,
      scope: 'purchase, tip',
      agentId: '#1',
      signer: '0x000000000000000000000000000000000000dEaD',
    };
    expect(validatePermissionProof(base).scope).toEqual(['purchase', 'tip']);
    expect(
      validatePermissionProof({
        ...base,
        maxSpend: '5 USDC',
        chain: 'base',
        chainId: '84532',
        issuedAt: '1',
      }),
    ).toMatchObject({ maxSpend: '5 USDC', chain: 'base', chainId: 84532, issuedAt: 1 });
    expect(() => validatePermissionProof(null)).toThrow(/objeto/);
    expect(() => validatePermissionProof({ ...base, signature: '' })).toThrow(
      /signature/,
    );
    expect(() => validatePermissionProof({ ...base, expiresAt: 'x' })).toThrow(
      /expiresAt/,
    );
    expect(() => validatePermissionProof({ ...base, scope: '' })).toThrow(/scope/);
    expect(() =>
      validatePermissionProof({
        ...base,
        delegation: { delegate: '0x1', delegator: '0x2', expiresAt: 1, signature: 's' },
      }),
    ).toThrow(/delegate/);
    const d = validatePermissionProof({
      ...base,
      delegation: {
        delegate: base.signer,
        delegator: '0x000000000000000000000000000000000000bEEF',
        expiresAt: 3e9,
        signature: '0xbb',
        scope: 'purchase',
      },
    });
    expect(d.delegation).toMatchObject({ delegate: base.signer, scope: ['purchase'] });
  });
  it('validateHumanProof y validateTransaction', () => {
    expect(
      validateHumanProof({
        provider: 'worldid',
        nullifier_hash: '0x1',
        merkle_root: '0x2',
        verification_level: 'orb',
        proof: { a: 1 },
      }),
    ).toMatchObject({
      provider: 'worldid',
      nullifierHash: '0x1',
      merkleRoot: '0x2',
      level: 'orb',
      proof: '{"a":1}',
    });
    expect(() => validateHumanProof({ provider: 'self' })).toThrow(/nullifierHash/);
    expect(
      validateTransaction({ chain: 'sui', to: '0x' + 'ab'.repeat(32), amount: '1 USDC' }),
    ).toMatchObject({ chain: 'sui', kind: 'transfer' });
    expect(() => validateTransaction({ kind: 'transfer', to: '0x1' })).toThrow(/amount/);
    expect(() => validateTransaction({ kind: 'call' })).toThrow(/contract/);
    expect(() => validateTransaction({ kind: 'raw' })).toThrow(/raw/);
    expect(
      validateTransaction({ kind: 'raw', raw: 'AAEC', signatures: ['x'], args: [1] }),
    ).toMatchObject({ raw: 'AAEC', signatures: ['x'], args: [1] });
  });
});
