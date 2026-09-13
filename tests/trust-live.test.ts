/**
 * Tests de integración contra redes reales (Base Sepolia · ERC-8004 y Sui
 * testnet · GraphQL). Solo se ejecutan con `WEBMCP_TRUST_LIVE=1` para no
 * depender de la red en CI. Solo lecturas y simulaciones: no gastan fondos.
 */
import { describe, expect, it } from 'vitest';
import {
  IdentityVerifier,
  SuiAdapter,
  TRUST_NETWORKS,
  createChainAdapter,
} from '../src/trust';

const live = process.env.WEBMCP_TRUST_LIVE === '1';
const d = live ? describe : describe.skip;

d('integración en vivo (WEBMCP_TRUST_LIVE=1)', () => {
  it('Base Sepolia: identidad ERC-8004 #1 verificada con owner, nombre y reputación', async () => {
    const id = await new IdentityVerifier().verifyIdentity('#1', 'base', {
      network: 'base-sepolia',
    });
    expect(id?.verified).toBe(true);
    expect(id?.ownerAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(id?.agentId).toBe(
      `eip155:84532:${TRUST_NETWORKS['base-sepolia'].identityRegistry}#1`,
    );
    expect(typeof id?.reputation).toBe('number');
    expect(id?.feedbackCount).toBeGreaterThan(0);
  }, 30_000);
  it('Base Sepolia: agente inexistente y saldo USDC', async () => {
    const adapter = createChainAdapter('base', 'base-sepolia');
    expect((await adapter.verifyIdentity('#999999999'))?.verified).toBe(false);
    const bal = await adapter.getBalance('0x000000000000000000000000000000000000dEaD');
    expect(bal.currency).toBe('USDC');
    expect(bal.amount).toBeGreaterThanOrEqual(0);
  }, 30_000);
  it('Sui testnet: GraphQL responde época, saldo y estado de tx; la tx gasless se construye y la red la evalúa', async () => {
    const sui = new SuiAdapter({
      network: TRUST_NETWORKS['sui-testnet'],
      privateKey: '22'.repeat(32),
    });
    const { epochId, chainIdentifier } = await sui.epochInfo();
    expect(epochId).toBeGreaterThan(0);
    expect(chainIdentifier).toMatch(/^[1-9A-HJ-NP-Za-km-z]{40,50}$/);
    const bal = await sui.getBalance('0x' + '0'.repeat(63) + '1', 'native');
    expect(bal.currency).toBe('SUI');
    const r = await sui.executeGasless({
      chain: 'sui',
      kind: 'transfer',
      to: '0x' + 'ab'.repeat(32),
      amount: '1 USDC',
    });
    // La clave de prueba no tiene USDC: la red debe rechazar por saldo, lo que demuestra que
    // aceptó el formato BCS gasless (gas 0) y evaluó la retirada de address balance.
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Insufficient address balance|insufficient/i);
    expect(await sui.getTransaction('11111111111111111111111111111111')).toEqual({
      found: false,
    });
  }, 30_000);
});
