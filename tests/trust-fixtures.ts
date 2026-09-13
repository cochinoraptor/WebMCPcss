/**
 * Nodos simulados compartidos por los tests de la capa de confianza (v1.3.0):
 * un JSON-RPC EVM con ERC-8004 (identidad + reputación), USDC (ERC-20),
 * bundler/paymaster ERC-4337 y relayer EIP-3009; y un GraphQL de Sui con
 * saldos, `verifySignature`, `executeTransaction` y registro de identidades.
 */
import {
  EvmAdapter,
  SuiAdapter,
  TRUST_NETWORKS,
  resolveTrustNetwork,
} from '../src/trust';
import type { ChainAdapter, ChainType, FetchLike, PermissionProof } from '../src/trust';
import { encodeParams, selector } from '../src/trust/crypto/abi';
import { ed25519PublicKey, suiAddressFromPublicKey } from '../src/trust/crypto/ed25519';
import { keccak256Hex } from '../src/trust/crypto/keccak';
import { privateKeyToAddress } from '../src/trust/crypto/secp256k1';

export const OWNER_KEY = '0x' + '11'.repeat(32);
export const OWNER = privateKeyToAddress(OWNER_KEY);
export const SESSION_KEY = '0x' + '33'.repeat(32);
export const SESSION = privateKeyToAddress(SESSION_KEY);
export const STRANGER_KEY = '0x' + '44'.repeat(32);
export const SUI_SEED = '22'.repeat(32);
export const SUI_ADDR = suiAddressFromPublicKey(
  ed25519PublicKey(Buffer.from(SUI_SEED, 'hex')),
);
export const REGISTRY = TRUST_NETWORKS['base-sepolia'].identityRegistry as string;
export const REPUTATION = TRUST_NETWORKS['base-sepolia'].reputationRegistry as string;
export const USDC = TRUST_NETWORKS['base-sepolia'].usdc as string;
export const DEAD = '0x000000000000000000000000000000000000dEaD';
export const SUI_RECIPIENT = '0x' + 'ab'.repeat(32);

export const sel = (sig: string): string => selector(sig);
const hex = (b: Buffer): string => '0x' + b.toString('hex');

interface FakeAgent {
  owner: string;
  wallet?: string;
  uri?: string;
  clients: string[];
  summary?: [bigint, bigint, bigint];
}

/** Estado mutable del nodo EVM simulado. */
export const evmState = {
  agents: new Map<bigint, FakeAgent>(),
  balances: new Map<string, bigint>(),
  calls: [] as string[],
  userOps: [] as unknown[],
  sponsor: true,
  rawTxs: [] as string[],
};

function evmCall(to: string, data: string): string {
  const s = data.slice(0, 10);
  const arg = (i: number): bigint =>
    BigInt('0x' + data.slice(10 + i * 64, 10 + (i + 1) * 64));
  evmState.calls.push(s);
  if (to.toLowerCase() === REGISTRY.toLowerCase()) {
    const agent = evmState.agents.get(arg(0));
    if (s === sel('ownerOf(uint256)')) {
      if (!agent)
        throw { code: 3, message: 'execution reverted: ERC721NonexistentToken' };
      return hex(encodeParams(['address'], [agent.owner]));
    }
    if (s === sel('getAgentWallet(uint256)'))
      return hex(encodeParams(['address'], [agent?.wallet ?? '0x' + '0'.repeat(40)]));
    if (s === sel('tokenURI(uint256)'))
      return hex(encodeParams(['string'], [agent?.uri ?? '']));
  }
  if (to.toLowerCase() === REPUTATION.toLowerCase()) {
    const agent = evmState.agents.get(arg(0));
    if (s === sel('getClients(uint256)'))
      return hex(encodeParams(['address[]'], [agent?.clients ?? []]));
    if (s === sel('getSummary(uint256,address[],string,string)'))
      return hex(
        encodeParams(['uint64', 'int128', 'uint8'], agent?.summary ?? [0n, 0n, 0n]),
      );
  }
  if (to.toLowerCase() === USDC.toLowerCase()) {
    if (s === sel('balanceOf(address)')) {
      const addr = '0x' + data.slice(34, 74);
      return hex(
        encodeParams(['uint256'], [evmState.balances.get(addr.toLowerCase()) ?? 0n]),
      );
    }
    if (s === sel('decimals()')) return hex(encodeParams(['uint8'], [6]));
    if (s === sel('symbol()')) return hex(encodeParams(['string'], ['USDC']));
  }
  if (s === sel('remaining(address)'))
    return hex(encodeParams(['uint256'], [42_000_000n]));
  if (s === sel('getNonce(address,uint192)')) return hex(encodeParams(['uint256'], [5n]));
  return '0x';
}

/** Estado mutable del nodo Sui simulado. */
export const suiState = {
  balances: new Map<string, string>(),
  executed: [] as { tx: string; sigs: string[] }[],
  failNext: false,
  identities: new Map<string, Record<string, unknown>>(),
};

function suiGraphql(body: {
  query: string;
  variables?: Record<string, unknown>;
}): unknown {
  const q = body.query;
  const v = body.variables ?? {};
  if (q.includes('epoch { epochId } chainIdentifier'))
    return {
      data: {
        epoch: { epochId: 1222 },
        chainIdentifier: '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD',
      },
    };
  if (q.includes('verifySignature'))
    return { data: { verifySignature: { success: String(v.s).startsWith('AQ') } } };
  if (q.includes('executeTransaction')) {
    suiState.executed.push({ tx: String(v.tx), sigs: v.sigs as string[] });
    if (suiState.failNext) {
      suiState.failNext = false;
      return {
        data: {
          executeTransaction: {
            effects: {
              digest: 'FAILDIGEST',
              status: 'FAILURE',
              executionError: { message: 'InsufficientBalance' },
            },
          },
        },
      };
    }
    return {
      data: {
        executeTransaction: {
          effects: { digest: 'OKDIGEST', status: 'SUCCESS', executionError: null },
        },
      },
    };
  }
  if (q.includes('objects(first: 5')) {
    const id = suiState.identities.get(String(v.a).toLowerCase());
    return {
      data: {
        address: {
          objects: {
            nodes: id
              ? [{ address: '0x1', contents: { type: { repr: String(v.t) }, json: id } }]
              : [],
          },
        },
      },
    };
  }
  if (q.includes('balance(coinType:$t)'))
    return {
      data: {
        address: {
          balance: { totalBalance: suiState.balances.get(`${v.a}|${v.t}`) ?? '0' },
        },
      },
    };
  if (q.includes('balance(coinType:"0x2::sui::SUI")'))
    return { data: { address: { address: v.a, balance: { totalBalance: '1' } } } };
  if (q.includes('transaction(digest:$d)'))
    return {
      data: {
        transaction:
          v.d === 'OKDIGEST'
            ? {
                effects: {
                  status: 'SUCCESS',
                  timestamp: '2026-09-13T00:00:00Z',
                  checkpoint: { sequenceNumber: 9 },
                },
              }
            : null,
      },
    };
  return { errors: [{ message: `query no simulada: ${q.slice(0, 40)}` }] };
}

/** fetch simulado: JSON-RPC EVM + GraphQL Sui + relayer/bundler/gas station. */
export const fakeFetch: FetchLike = async (url, init) => {
  const body = JSON.parse(init?.body ?? '{}') as Record<string, unknown>;
  const reply = (obj: unknown, status = 200) => ({
    ok: status < 400,
    status,
    json: async () => obj,
    text: async () => JSON.stringify(obj),
  });
  if (url.includes('graphql'))
    return reply(
      suiGraphql(body as { query: string; variables?: Record<string, unknown> }),
    );
  if (url.endsWith('/relayer')) return reply({ txHash: '0x' + 'ab'.repeat(32) });
  if (url.endsWith('/gas-station'))
    return reply({
      txBytes: Buffer.from('sponsored-bytes').toString('base64'),
      signature: 'AQ==',
    });
  if (url.endsWith('/broken')) return reply({ error: 'boom' }, 500);
  const { method, params, id } = body as {
    method: string;
    params: unknown[];
    id: number;
  };
  const rpc = (result: unknown) => reply({ jsonrpc: '2.0', id, result });
  try {
    switch (method) {
      case 'eth_call': {
        const p = params[0] as { to: string; data: string };
        return rpc(evmCall(p.to, p.data));
      }
      case 'eth_getBalance':
        return rpc('0xde0b6b3a7640000');
      case 'eth_chainId':
        return rpc('0x14a34');
      case 'eth_gasPrice':
        return rpc('0x3b9aca00');
      case 'eth_getTransactionCount':
        return rpc('0x7');
      case 'eth_estimateGas':
        return rpc('0x5208');
      case 'eth_sendRawTransaction': {
        evmState.rawTxs.push(params[0] as string);
        return rpc(keccak256Hex(params[0] as string));
      }
      case 'pm_sponsorUserOperation':
        if (!evmState.sponsor)
          return reply({
            jsonrpc: '2.0',
            id,
            error: { code: -32000, message: 'no sponsor' },
          });
        return rpc({
          paymaster: DEAD,
          paymasterData: '0x',
          paymasterVerificationGasLimit: '0x1',
          paymasterPostOpGasLimit: '0x1',
          callGasLimit: '0x5208',
          verificationGasLimit: '0x5208',
          preVerificationGas: '0x5208',
          maxFeePerGas: '0x1',
          maxPriorityFeePerGas: '0x1',
        });
      case 'eth_estimateUserOperationGas':
        return rpc({
          callGasLimit: '0x5208',
          verificationGasLimit: '0x5208',
          preVerificationGas: '0x5208',
        });
      case 'eth_sendUserOperation': {
        evmState.userOps.push(params[0]);
        return rpc('0x' + 'ab'.repeat(32));
      }
      default:
        return reply({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  } catch (err) {
    return reply({ jsonrpc: '2.0', id, error: err });
  }
};

/** Reloj controlable. */
export const clock = { value: Date.UTC(2026, 8, 13, 12, 0, 0) };
export const now = (): number => clock.value;
export const nowS = (): number => Math.floor(clock.value / 1000);

export const evm = (): EvmAdapter =>
  new EvmAdapter({
    network: TRUST_NETWORKS['base-sepolia'],
    fetch: fakeFetch,
    now,
    privateKey: OWNER_KEY,
  });
export const sui = (): SuiAdapter =>
  new SuiAdapter({
    network: TRUST_NETWORKS['sui-testnet'],
    fetch: fakeFetch,
    now,
    privateKey: SUI_SEED,
  });

/** Fábrica de adaptadores simulados para engines/verificadores. */
export const factory = (chain: ChainType, network?: string): ChainAdapter => {
  const net = resolveTrustNetwork(network, chain);
  return net.chain === 'sui'
    ? new SuiAdapter({
        network: net,
        fetch: fakeFetch,
        now,
        privateKey: SUI_SEED,
        registryPackage: '0xabc',
      })
    : new EvmAdapter({ network: net, fetch: fakeFetch, now, privateKey: OWNER_KEY });
};

/** Firma una prueba EVM para el agente #7 con la clave indicada. */
export function signWith(
  key: string,
  over: Partial<PermissionProof> = {},
): PermissionProof {
  const a = new EvmAdapter({
    network: TRUST_NETWORKS['base-sepolia'],
    fetch: fakeFetch,
    now,
    privateKey: key,
  });
  return a.signProof({
    agentId: `eip155:84532:${REGISTRY}#7`,
    scope: ['purchase'],
    nonce: keccak256Hex(String(Math.random())),
    issuedAt: nowS(),
    expiresAt: nowS() + 600,
    ...over,
  });
}

/** Restablece el estado de ambos nodos y el reloj. */
export function resetNodes(): void {
  clock.value = Date.UTC(2026, 8, 13, 12, 0, 0);
  evmState.agents.clear();
  evmState.agents.set(7n, {
    owner: OWNER,
    uri:
      'data:application/json;base64,' +
      Buffer.from(JSON.stringify({ name: 'Shopper Bot' })).toString('base64'),
    clients: [DEAD, OWNER],
    summary: [2n, 850n, 1n],
  });
  evmState.agents.set(8n, { owner: DEAD, clients: [], uri: 'ipfs://x' });
  evmState.balances.clear();
  evmState.balances.set(OWNER.toLowerCase(), 12_500_000n);
  evmState.calls = [];
  evmState.userOps = [];
  evmState.rawTxs = [];
  evmState.sponsor = true;
  suiState.balances.clear();
  suiState.balances.set(`${SUI_ADDR}|${TRUST_NETWORKS['sui-testnet'].usdc}`, '3000000');
  suiState.executed = [];
  suiState.failNext = false;
  suiState.identities.clear();
}
