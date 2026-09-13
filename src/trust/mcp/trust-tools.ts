/**
 * Herramientas MCP de la capa de confianza: `trust_verify_identity`,
 * `trust_check_permission`, `trust_execute_gasless`, `trust_get_audit_log`
 * y `trust_get_policies`. Se registran en `McpCore` cuando el servidor arranca
 * con `--trust` (o cuando el `.webmcp.css` declara políticas).
 */
import type { TrustEngine } from '../engine';
import {
  validateHumanProof,
  validatePermissionProof,
  validateTransaction,
  TrustSchemaError,
} from '../parser/schema';
import type { ChainType, ExecutionContext } from '../types';

/** Nombres de las herramientas. */
export const TRUST_TOOL_NAMES = [
  'trust_verify_identity',
  'trust_check_permission',
  'trust_execute_gasless',
  'trust_get_audit_log',
  'trust_get_policies',
] as const;
export type TrustToolName = (typeof TRUST_TOOL_NAMES)[number];

const CHAIN_ENUM = ['sui', 'evm', 'base', 'skale'];

/** Esquemas MCP. */
export const TRUST_TOOL_SCHEMAS: Array<Record<string, unknown>> = [
  {
    name: 'trust_verify_identity',
    description:
      'Verifica la identidad on-chain de un agente (ERC-8004 en EVM/Base; registro Sui) y devuelve owner, billetera, reputación y si está verificado.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description:
            'eip155:<chainId>:<registry>#<id>, <registry>#<id>, #<id> o dirección Sui',
        },
        chain: { type: 'string', enum: CHAIN_ENUM },
        network: {
          type: 'string',
          description: 'Red concreta (base-sepolia, sui-testnet…)',
        },
        skipCache: { type: 'boolean' },
      },
      required: ['agentId', 'chain'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'trust_check_permission',
    description:
      'Comprueba si un agente puede ejecutar una herramienta: identidad, prueba de permiso firmada, límites de gasto, rate limit, lista blanca y pago. No ejecuta nada. Devuelve un token de confianza si todo pasa.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        toolName: { type: 'string' },
        proof: {
          type: 'object',
          description:
            'PermissionProof {signature, nonce, expiresAt, scope, agentId, signer, …}',
        },
        humanProof: { type: 'object' },
        paymentProof: { description: 'Cabecera X-PAYMENT (base64) u objeto x402' },
        amount: { type: 'string', description: 'Importe previsto, p. ej. "1.5 USDC"' },
        target: { type: 'string', description: 'Contrato/paquete destino' },
        origin: { type: 'string' },
      },
      required: ['toolName'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'trust_execute_gasless',
    description:
      'Ejecuta una transacción sin gas para el agente: transferencia de stablecoin a nivel de protocolo en Sui, EIP-3009/ERC-4337 en EVM, gas gratuito en SKALE. Si se indica toolName, aplica antes la política de confianza y audita.',
    inputSchema: {
      type: 'object',
      properties: {
        chain: { type: 'string', enum: CHAIN_ENUM },
        network: { type: 'string' },
        tx: {
          type: 'object',
          description:
            'Transaction {kind: transfer|call|raw, to, amount, token, contract, data, raw, signatures}',
        },
        proof: { type: 'object' },
        toolName: { type: 'string' },
        agentId: { type: 'string' },
        paymentProof: {},
        dryRun: { type: 'boolean' },
      },
      required: ['chain', 'tx'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  {
    name: 'trust_get_audit_log',
    description:
      'Historial de acciones autorizadas/denegadas de un agente (cadena de hashes verificable).',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        limit: { type: 'number' },
        action: { type: 'string' },
        result: { type: 'string', enum: ['ok', 'denied', 'failed'] },
        verify: { type: 'boolean', description: 'Verificar la integridad de la cadena' },
      },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'trust_get_policies',
    description:
      'Lista las políticas de confianza declaradas en el .webmcp.css (auth, pago, cadena, límites).',
    inputSchema: { type: 'object', properties: { tool: { type: 'string' } } },
    annotations: { readOnlyHint: true },
  },
];

/** ¿Es una herramienta de confianza? */
export function isTrustTool(name: string): name is TrustToolName {
  return (TRUST_TOOL_NAMES as readonly string[]).includes(name);
}

/** Resultado MCP. */
export interface TrustCallResult {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
}

const text = (v: unknown, isError = false): TrustCallResult => ({
  content: [
    {
      type: 'text',
      text: typeof v === 'string' ? v : JSON.stringify(v, bigintReplacer, 2),
    },
  ],
  ...(isError ? { isError: true } : {}),
});

function bigintReplacer(_k: string, v: unknown): unknown {
  return typeof v === 'bigint' ? v.toString() : v;
}

/** Construye un `ExecutionContext` a partir de argumentos MCP/REST (valida esquemas). */
export function contextFromArgs(args: Record<string, unknown>): ExecutionContext {
  const ctx: ExecutionContext = {};
  if (typeof args.agentId === 'string') ctx.agentId = args.agentId;
  if (args.proof) ctx.proof = validatePermissionProof(args.proof);
  if (args.humanProof) ctx.humanProof = validateHumanProof(args.humanProof);
  if (args.paymentProof !== undefined)
    ctx.paymentProof = args.paymentProof as string | Record<string, unknown>;
  if (args.tx)
    ctx.tx = validateTransaction({
      chain: args.chain,
      network: args.network,
      ...(args.tx as Record<string, unknown>),
    });
  if (typeof args.amount === 'string') ctx.amount = args.amount;
  if (typeof args.target === 'string') ctx.target = args.target;
  if (typeof args.origin === 'string') ctx.origin = args.origin;
  if (typeof args.trustToken === 'string') ctx.trustToken = args.trustToken;
  return ctx;
}

/**
 * Ejecuta una herramienta de confianza.
 * @param name Nombre.
 * @param args Argumentos.
 * @param engine Motor.
 */
export async function callTrustTool(
  name: TrustToolName,
  args: Record<string, unknown>,
  engine: TrustEngine,
): Promise<TrustCallResult> {
  try {
    switch (name) {
      case 'trust_verify_identity': {
        const agentId = String(args.agentId ?? '');
        const chain = String(args.chain ?? 'sui') as ChainType;
        if (!agentId) return text('Falta "agentId".', true);
        const identity = await engine.identity.verifyIdentity(agentId, chain, {
          network: args.network as string | undefined,
          skipCache: args.skipCache === true,
        });
        if (!identity)
          return text({
            verified: false,
            reason: 'agentId no reconocido para esta cadena',
          });
        return text(identity);
      }
      case 'trust_check_permission': {
        const tool = String(args.toolName ?? args.tool ?? '');
        if (!tool) return text('Falta "toolName".', true);
        const ctx = contextFromArgs(args);
        const res = await engine.verify(tool, ctx);
        const { commit: _c, ...rest } = res;
        const token =
          res.allowed && (ctx.agentId ?? ctx.proof?.agentId)
            ? engine.issueToken(
                ctx.agentId ?? ctx.proof!.agentId,
                ctx.proof?.scope ?? [tool],
              )
            : undefined;
        return text({
          tool,
          policy: engine.getTrustPolicy(tool) ?? null,
          ...rest,
          trustToken: token,
        });
      }
      case 'trust_execute_gasless': {
        const ctx = contextFromArgs(args);
        if (!ctx.tx) return text('Falta "tx".', true);
        const tool = typeof args.toolName === 'string' ? args.toolName : undefined;
        if (args.dryRun === true) {
          const adapter = engine.adapterFor({
            auth: 'none',
            payment: 'none',
            chain: ctx.tx.chain,
            network: ctx.tx.network,
          });
          return text({
            dryRun: true,
            chain: ctx.tx.chain,
            network: adapter.network.id,
            tx: ctx.tx,
          });
        }
        if (tool && engine.getTrustPolicy(tool)) {
          const res = await engine.executeTool(tool, {}, ctx);
          return text(res, !res.ok);
        }
        const result = await engine.gasless.execute(ctx.tx);
        if (result.mode !== 'dry-run')
          await engine.audit.log({
            agentId: ctx.agentId ?? 'anonymous',
            action: tool ?? 'trust_execute_gasless',
            result: result.ok ? 'ok' : 'failed',
            txHash: result.txHash,
            amount: ctx.tx.amount,
            chain: ctx.tx.chain,
            network: result.network,
            reason: result.error,
            meta: { txMode: result.mode },
          });
        return text(result, !result.ok && result.mode !== 'dry-run');
      }
      case 'trust_get_audit_log': {
        const entries = engine.audit.query({
          agentId: args.agentId as string | undefined,
          action: args.action as string | undefined,
          result: args.result as 'ok' | 'denied' | 'failed' | undefined,
          limit: args.limit !== undefined ? Number(args.limit) : 20,
        });
        const integrity = args.verify === true ? engine.audit.verify() : undefined;
        return text({
          count: entries.length,
          head: engine.audit.head,
          integrity,
          entries,
        });
      }
      case 'trust_get_policies': {
        const all = engine.describePolicies();
        const tool = typeof args.tool === 'string' ? args.tool : undefined;
        return text(
          tool
            ? (all.find((p) => p.tool === tool) ?? { tool, policy: null })
            : { count: all.length, policies: all },
        );
      }
      default:
        return text(`Herramienta desconocida: ${String(name)}`, true);
    }
  } catch (err) {
    const e = err as Error;
    return text(
      e instanceof TrustSchemaError
        ? `Argumentos inválidos — ${e.message}`
        : `Error en ${name}: ${e.message}`,
      true,
    );
  }
}
