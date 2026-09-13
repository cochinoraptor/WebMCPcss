/**
 * Comandos `webmcpcss trust *` (v1.3.0): verificación de identidad on-chain,
 * comprobación de permisos, ejecución sin gas, auditoría, políticas en CSS y
 * utilidades para firmar pruebas de permiso y generar el script de navegador.
 * Se registra desde `cli.ts` con {@link registerTrustCommands}.
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { parseWebMCPFile } from './parser';
import {
  AuditLogger,
  FilePolicyStore,
  IdentityVerifier,
  PermissionVerifier,
  PolicyEngine,
  TRUST_DEFAULTS,
  TRUST_NETWORKS,
  TrustEngine,
  buildTrustBrowserScript,
  contextFromArgs,
  createChainAdapter,
  extractTrustPolicies,
  resolveTrustNetwork,
  setPolicyInCss,
  validateTransaction,
  type ChainType,
  type PermissionProof,
  type TrustPolicy,
} from './trust';
import { EvmAdapter } from './trust/chains/evm-adapter';
import { SuiAdapter } from './trust/chains/sui-adapter';
import { logger } from './utils/logger';

const json = (v: unknown): void => {
  console.log(
    JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x), 2),
  );
};

const readJsonArg = (v: string | undefined): Record<string, unknown> | undefined => {
  if (!v) return undefined;
  const trimmed = v.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('['))
    return JSON.parse(trimmed) as Record<string, unknown>;
  return JSON.parse(fs.readFileSync(trimmed, 'utf8')) as Record<string, unknown>;
};

/** Construye un engine para la CLI (estado persistido en `.webmcpcss/`). */
export function buildCliTrustEngine(
  cssFile?: string,
  opts: { key?: string; network?: string; stateDir?: string } = {},
): TrustEngine {
  const stateDir = opts.stateDir ?? '.webmcpcss';
  const policies =
    cssFile && fs.existsSync(cssFile)
      ? extractTrustPolicies(parseWebMCPFile(cssFile))
      : {};
  const policyEngine = new PolicyEngine({
    store: new FilePolicyStore(path.join(stateDir, 'trust-state.json')),
  });
  return new TrustEngine({
    policies,
    policyEngine,
    permission: new PermissionVerifier({ engine: policyEngine }),
    audit: new AuditLogger({ file: path.join(stateDir, 'trust-audit.jsonl') }),
    privateKey: opts.key ?? process.env.WEBMCP_TRUST_KEY,
  });
}

/** Imprime un resultado de verificación de forma legible. */
function printChecks(
  checks: Array<{ name: string; passed: boolean; detail?: string }> | undefined,
): void {
  for (const c of checks ?? []) {
    console.log(
      `  ${c.passed ? chalk.green('✔') : chalk.red('✖')} ${c.name}${c.detail ? chalk.dim(' · ' + c.detail) : ''}`,
    );
  }
}

/**
 * Registra el comando `trust` y sus subcomandos.
 * @param program Programa Commander raíz.
 */
export function registerTrustCommands(program: Command): void {
  const trust = program
    .command('trust')
    .description(
      'Capa de confianza blockchain gasless: identidad ERC-8004/Sui, permisos firmados, transacciones sin gas y auditoría',
    );

  trust
    .command('networks')
    .description(
      'Lista las redes soportadas (Sui, Base, Ethereum, SKALE) y sus registros',
    )
    .option('--json', 'salida JSON')
    .action((o: { json?: boolean }) => {
      const nets = Object.values(TRUST_NETWORKS);
      if (o.json) return json(nets);
      logger.title('WebMCPcss · trust networks');
      for (const n of nets) {
        console.log(
          `  ${chalk.cyan(n.id.padEnd(22))} ${n.name.padEnd(22)} ${n.testnet ? chalk.yellow('testnet') : chalk.green('mainnet')}  ${n.nativeGasless ? chalk.green('gasless nativo') : 'gas: ERC-4337/EIP-3009'}${n.identityRegistry ? chalk.dim('  ERC-8004 ✓') : ''}`,
        );
      }
    });

  trust
    .command('verify-identity')
    .description(
      'Verifica la identidad on-chain de un agente (ERC-8004 en EVM/Base; registro Sui)',
    )
    .requiredOption(
      '--agent <agentId>',
      'eip155:<chainId>:<registry>#<id>, <registry>#<id>, #<id> o dirección Sui',
    )
    .requiredOption('--chain <chain>', 'sui | evm | base | skale')
    .option('--network <network>', 'red concreta (base-sepolia, sui-testnet…)')
    .option('--no-cache', 'ignorar la caché')
    .option('--json', 'salida JSON')
    .action(
      async (o: {
        agent: string;
        chain: ChainType;
        network?: string;
        cache?: boolean;
        json?: boolean;
      }) => {
        const verifier = new IdentityVerifier();
        const identity = await verifier.verifyIdentity(o.agent, o.chain, {
          network: o.network,
          skipCache: o.cache === false,
        });
        if (o.json)
          return json(identity ?? { verified: false, reason: 'agentId no reconocido' });
        logger.title('WebMCPcss · trust verify-identity');
        if (!identity) {
          logger.error('agentId no reconocido para esta cadena');
          process.exitCode = 1;
          return;
        }
        console.log(
          `  ${identity.verified ? chalk.green('✔ verificado') : chalk.red('✖ no verificado')} ${chalk.bold(identity.agentId)}`,
        );
        console.log(
          `  owner: ${identity.ownerAddress}${identity.agentWallet ? `\n  wallet: ${identity.agentWallet}` : ''}`,
        );
        if (identity.name) console.log(`  nombre: ${identity.name}`);
        if (identity.reputation !== undefined)
          console.log(
            `  reputación: ${identity.reputation}/100 (${identity.feedbackCount ?? 0} feedbacks)`,
          );
        if (identity.agentURI)
          console.log(
            chalk.dim(
              `  uri: ${identity.agentURI.slice(0, 80)}${identity.agentURI.length > 80 ? '…' : ''}`,
            ),
          );
        if (identity.reason) console.log(chalk.yellow(`  motivo: ${identity.reason}`));
        if (!identity.verified) process.exitCode = 1;
      },
    );

  trust
    .command('check-permission')
    .description(
      'Verifica si un agente puede ejecutar una herramienta según la política del .webmcp.css',
    )
    .requiredOption('--tool <name>', 'herramienta')
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .option('--agent <agentId>', 'identificador del agente')
    .option('--proof <json|file>', 'prueba de permiso firmada (JSON o ruta)')
    .option('--human-proof <json|file>', 'prueba de humanidad')
    .option('--payment <header|json|file>', 'prueba de pago (X-PAYMENT base64 o JSON)')
    .option('--amount <amount>', 'importe previsto ("1.5 USDC")')
    .option('--target <contract>', 'contrato/paquete destino')
    .option('--origin <url>', 'origen desde el que se opera')
    .option('--json', 'salida JSON')
    .action(
      async (o: {
        tool: string;
        file: string;
        agent?: string;
        proof?: string;
        humanProof?: string;
        payment?: string;
        amount?: string;
        target?: string;
        origin?: string;
        json?: boolean;
      }) => {
        const engine = buildCliTrustEngine(o.file);
        const policy = engine.getTrustPolicy(o.tool);
        const ctx = contextFromArgs({
          agentId: o.agent,
          proof: readJsonArg(o.proof),
          humanProof: readJsonArg(o.humanProof),
          paymentProof:
            o.payment && !o.payment.trim().startsWith('{') && fs.existsSync(o.payment)
              ? fs.readFileSync(o.payment, 'utf8').trim()
              : o.payment,
          amount: o.amount,
          target: o.target,
          origin: o.origin,
        });
        const res = await engine.verify(o.tool, ctx);
        const { commit: _c, ...rest } = res;
        if (o.json) return json({ tool: o.tool, policy: policy ?? null, ...rest });
        logger.title('WebMCPcss · trust check-permission');
        if (!policy) {
          logger.info(
            `"${o.tool}" no declara política de confianza (se ejecuta sin verificación).`,
          );
          return;
        }
        console.log(
          chalk.dim(
            `  política: auth=${policy.auth} payment=${policy.payment} chain=${policy.chain}${policy.network ? '/' + policy.network : ''}${policy.spendingLimit ? ' limit=' + policy.spendingLimit : ''}${policy.rateLimit ? ' rate=' + policy.rateLimit : ''}`,
          ),
        );
        printChecks(res.checks);
        console.log(
          res.allowed
            ? chalk.green(
                `\n  ✔ permitido${res.remainingLimit ? ` · restante ${res.remainingLimit}` : ''}`,
              )
            : chalk.red(`\n  ✖ denegado (${res.code}): ${res.reason}`),
        );
        if (!res.allowed) process.exitCode = 1;
      },
    );

  trust
    .command('execute-gasless')
    .description(
      'Ejecuta una transacción sin gas (Sui: stablecoin a nivel de protocolo; EVM: EIP-3009/ERC-4337; SKALE: gas gratuito)',
    )
    .requiredOption('--chain <chain>', 'sui | evm | base | skale')
    .requiredOption(
      '--tx <json|file>',
      'transacción {kind, to, amount, token, contract, data, raw}',
    )
    .option('--network <network>', 'red concreta')
    .option('--file <css>', 'archivo .webmcp.css (para aplicar la política de --tool)')
    .option('--tool <name>', 'herramienta cuya política se aplica antes de ejecutar')
    .option('--agent <agentId>', 'identificador del agente')
    .option('--proof <json|file>', 'prueba de permiso firmada')
    .option('--key <hex>', 'clave privada del agente (o WEBMCP_TRUST_KEY)')
    .option('--dry-run', 'no enviar: mostrar la carga útil a firmar')
    .option('--json', 'salida JSON')
    .action(
      async (o: {
        chain: ChainType;
        tx: string;
        network?: string;
        file?: string;
        tool?: string;
        agent?: string;
        proof?: string;
        key?: string;
        dryRun?: boolean;
        json?: boolean;
      }) => {
        const engine = buildCliTrustEngine(o.file, { key: o.key });
        const tx = validateTransaction({
          chain: o.chain,
          network: o.network,
          ...readJsonArg(o.tx),
        });
        const ctx = contextFromArgs({ agentId: o.agent, proof: readJsonArg(o.proof) });
        ctx.tx = tx;
        if (!o.json) logger.title('WebMCPcss · trust execute-gasless');
        if (o.dryRun) {
          const net = resolveTrustNetwork(o.network, o.chain);
          const out = { dryRun: true, chain: o.chain, network: net.id, rpc: net.rpc, tx };
          if (o.json) return json(out);
          console.log(chalk.dim(`  red: ${net.name} (${net.rpc})`));
          json(tx);
          return;
        }
        if (o.tool && engine.getTrustPolicy(o.tool)) {
          const res = await engine.executeTool(o.tool, {}, ctx);
          if (o.json) return json(res);
          printChecks(res.verification?.checks);
          if (res.transaction) printTx(res.transaction);
          if (!res.ok) {
            logger.error(res.error ?? 'fallo');
            process.exitCode = 1;
          }
          return;
        }
        const result = await engine.gasless.execute(tx);
        if (result.mode !== 'dry-run')
          await engine.audit.log({
            agentId: o.agent ?? 'cli',
            action: o.tool ?? 'execute-gasless',
            result: result.ok ? 'ok' : 'failed',
            txHash: result.txHash,
            amount: tx.amount,
            chain: tx.chain,
            network: result.network,
            reason: result.error,
            meta: { txMode: result.mode },
          });
        if (o.json) return json(result);
        printTx(result);
        if (!result.ok && result.mode !== 'dry-run') process.exitCode = 1;
      },
    );

  trust
    .command('audit-log')
    .description('Muestra el historial de acciones (cadena de hashes verificable)')
    .option('--agent <agentId>', 'filtrar por agente')
    .option('--limit <n>', 'número de entradas', '20')
    .option('--verify', 'verificar la integridad de la cadena')
    .option('--json', 'salida JSON')
    .action((o: { agent?: string; limit: string; verify?: boolean; json?: boolean }) => {
      const audit = new AuditLogger({
        file: path.join('.webmcpcss', 'trust-audit.jsonl'),
      });
      const entries = audit.query({ agentId: o.agent, limit: Number(o.limit) });
      const integrity = o.verify ? audit.verify() : undefined;
      if (o.json)
        return json({ count: entries.length, head: audit.head, integrity, entries });
      logger.title('WebMCPcss · trust audit-log');
      if (!entries.length) logger.info('Sin entradas.');
      for (const e of entries) {
        const icon =
          e.result === 'ok'
            ? chalk.green('✔')
            : e.result === 'denied'
              ? chalk.yellow('⊘')
              : chalk.red('✖');
        console.log(
          `  ${icon} ${new Date(e.timestamp).toISOString()} ${chalk.bold(e.action)} ${chalk.dim(e.agentId)}${e.amount ? ' ' + e.amount : ''}${e.txHash ? chalk.dim(' tx ' + e.txHash.slice(0, 14) + '…') : ''}${e.reason ? chalk.dim(' — ' + e.reason) : ''}`,
        );
      }
      if (integrity)
        console.log(
          integrity.ok
            ? chalk.green(`\n  ✔ cadena íntegra (${integrity.entries} entradas)`)
            : chalk.red(
                `\n  ✖ cadena rota en #${integrity.brokenAt}: ${integrity.reason}`,
              ),
        );
      if (integrity && !integrity.ok) process.exitCode = 1;
    });

  trust
    .command('set-policy')
    .description(
      'Fija propiedades de confianza en la regla de una herramienta del .webmcp.css',
    )
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .requiredOption('--tool <name>', 'herramienta')
    .option('--auth <type>', 'erc8004 | zk-proof | session-key | none')
    .option('--payment <type>', 'x402 | eip3009 | sponsored | none')
    .option('--chain <chain>', 'sui | evm | base | skale')
    .option('--network <network>', 'red concreta')
    .option('--spending-limit <limit>', 'p. ej. "100 USDC/day"')
    .option('--rate-limit <limit>', 'p. ej. "5 actions/minute"')
    .option('--allowed-contracts <list>', 'lista separada por comas')
    .option('--allowed-hours <range>', 'p. ej. "09:00-18:00" (UTC)')
    .option('--requires-human-proof [bool]', 'exigir prueba de humanidad')
    .option('--output <file>', 'escribir en otro archivo (por defecto sobrescribe)')
    .option('--json', 'salida JSON')
    .action(
      (o: {
        file: string;
        tool: string;
        auth?: string;
        payment?: string;
        chain?: string;
        network?: string;
        spendingLimit?: string;
        rateLimit?: string;
        allowedContracts?: string;
        allowedHours?: string;
        requiresHumanProof?: string | boolean;
        output?: string;
        json?: boolean;
      }) => {
        const patch: Partial<TrustPolicy> = {};
        if (o.auth) patch.auth = o.auth as TrustPolicy['auth'];
        if (o.payment) patch.payment = o.payment as TrustPolicy['payment'];
        if (o.chain) patch.chain = o.chain as ChainType;
        if (o.network) patch.network = o.network;
        if (o.spendingLimit) patch.spendingLimit = o.spendingLimit;
        if (o.rateLimit) patch.rateLimit = o.rateLimit;
        if (o.allowedContracts)
          patch.allowedContracts = o.allowedContracts.split(',').map((s) => s.trim());
        if (o.allowedHours) patch.allowedHours = o.allowedHours;
        if (o.requiresHumanProof !== undefined)
          patch.requiresHumanProof =
            o.requiresHumanProof === true || o.requiresHumanProof === 'true';
        if (!Object.keys(patch).length)
          throw new Error(
            'Indica al menos una propiedad (--auth, --payment, --chain, --spending-limit…)',
          );
        const css = fs.readFileSync(o.file, 'utf8');
        const updated = setPolicyInCss(css, o.tool, patch);
        const out = o.output ?? o.file;
        fs.writeFileSync(out, updated, 'utf8');
        const policies = extractTrustPolicies(parseWebMCPFile(out));
        if (o.json)
          return json({ file: out, tool: o.tool, policy: policies[o.tool] ?? null });
        logger.success(`Política de "${o.tool}" actualizada en ${out}`);
        json(policies[o.tool] ?? null);
      },
    );

  trust
    .command('policies')
    .description('Lista las políticas de confianza declaradas en un .webmcp.css')
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .option('--json', 'salida JSON')
    .action((o: { file: string; json?: boolean }) => {
      const policies = extractTrustPolicies(parseWebMCPFile(o.file));
      if (o.json) return json(policies);
      logger.title('WebMCPcss · trust policies');
      const entries = Object.entries(policies);
      if (!entries.length) logger.info('Ninguna herramienta declara confianza.');
      for (const [tool, p] of entries) {
        console.log(
          `  ${chalk.bold(tool)}: auth=${p.auth} payment=${p.payment} chain=${p.chain}${p.network ? '/' + p.network : ''}${p.spendingLimit ? ` limit=${p.spendingLimit}` : ''}${p.rateLimit ? ` rate=${p.rateLimit}` : ''}${p.requiresHumanProof ? ' human-proof' : ''}${p.allowedContracts ? ` contracts=${p.allowedContracts.length}` : ''}`,
        );
      }
    });

  trust
    .command('sign-proof')
    .description('Firma una prueba de permiso (clave de sesión) con la clave del agente')
    .requiredOption('--agent <agentId>', 'identificador del agente')
    .requiredOption(
      '--scope <tools>',
      'herramientas permitidas separadas por comas (o *)',
    )
    .requiredOption('--chain <chain>', 'sui | evm | base | skale')
    .option('--network <network>', 'red (define el chainId del dominio EIP-712)')
    .option('--key <hex>', 'clave privada (o WEBMCP_TRUST_KEY)')
    .option('--ttl <seconds>', 'validez en segundos', '900')
    .option('--max-spend <amount>', 'límite de la sesión ("50 USDC")')
    .option('--allowed-contracts <list>', 'contratos permitidos por la sesión')
    .option('--origin <url>', 'origen al que se limita')
    .option('--output <file>', 'guardar la prueba en un archivo')
    .action(
      (o: {
        agent: string;
        scope: string;
        chain: ChainType;
        network?: string;
        key?: string;
        ttl: string;
        maxSpend?: string;
        allowedContracts?: string;
        origin?: string;
        output?: string;
      }) => {
        const key = o.key ?? process.env.WEBMCP_TRUST_KEY;
        if (!key) throw new Error('Indica --key o define WEBMCP_TRUST_KEY');
        const adapter = createChainAdapter(o.chain, o.network, { privateKey: key });
        const now = Math.floor(Date.now() / 1000);
        const base: Omit<PermissionProof, 'signature' | 'signer'> = {
          agentId: o.agent,
          scope: o.scope
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
          nonce:
            o.chain === 'sui'
              ? `n-${now}-${Math.random().toString(36).slice(2)}`
              : '0x' + require('crypto').randomBytes(32).toString('hex'),
          issuedAt: now,
          expiresAt: now + Number(o.ttl),
          maxSpend: o.maxSpend,
          allowedContracts: o.allowedContracts
            ?.split(',')
            .map((s) => s.trim().toLowerCase()),
          origin: o.origin,
          chain: o.chain,
        };
        const proof =
          adapter instanceof SuiAdapter
            ? adapter.signProof(base)
            : (adapter as EvmAdapter).signProof(base);
        if (o.output) {
          fs.writeFileSync(o.output, JSON.stringify(proof, null, 2), 'utf8');
          logger.success(`Prueba guardada en ${o.output} (firmante ${proof.signer})`);
        } else json(proof);
      },
    );

  trust
    .command('inject')
    .description('Genera el script window.__WEBMCP_TRUST__ para agentes de navegación')
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .option('--api <url>', 'URL base de la API REST (mcp --serve --http --trust)')
    .option('--origin <url>', 'origen del sitio')
    .option('--output <file>', 'archivo de salida (por defecto stdout)')
    .action((o: { file: string; api?: string; origin?: string; output?: string }) => {
      const policies = extractTrustPolicies(parseWebMCPFile(o.file));
      const script = buildTrustBrowserScript(policies, {
        apiBase: o.api,
        origin: o.origin,
      });
      if (o.output) {
        fs.writeFileSync(o.output, script, 'utf8');
        logger.success(
          `Script escrito en ${o.output} (${Object.keys(policies).length} políticas)`,
        );
      } else process.stdout.write(script);
    });

  trust
    .command('balance')
    .description(
      'Consulta el saldo de stablecoin (o nativo) de una dirección sin dependencias',
    )
    .requiredOption('--address <address>', 'dirección EVM o Sui')
    .requiredOption('--chain <chain>', 'sui | evm | base | skale')
    .option('--network <network>', 'red concreta')
    .option('--token <token>', 'contrato/tipo del token o "native"')
    .option('--json', 'salida JSON')
    .action(
      async (o: {
        address: string;
        chain: ChainType;
        network?: string;
        token?: string;
        json?: boolean;
      }) => {
        const adapter = createChainAdapter(o.chain, o.network);
        const bal = await adapter.getBalance(o.address, o.token);
        if (o.json)
          return json({ address: o.address, network: adapter.network.id, ...bal });
        console.log(
          `  ${o.address} · ${adapter.network.name}: ${chalk.bold(String(bal.amount))} ${bal.currency}`,
        );
      },
    );

  function printTx(t: {
    ok: boolean;
    mode: string;
    txHash?: string;
    explorerUrl?: string;
    error?: string;
    payload?: unknown;
    network: string;
  }): void {
    if (t.ok)
      console.log(
        chalk.green(`  ✔ ${t.mode} en ${t.network}${t.txHash ? ` · ${t.txHash}` : ''}`),
      );
    else
      console.log(
        (t.mode === 'dry-run' ? chalk.yellow : chalk.red)(
          `  ${t.mode === 'dry-run' ? '◌ dry-run' : '✖ fallo'} en ${t.network}: ${t.error ?? ''}`,
        ),
      );
    if (t.explorerUrl) console.log(chalk.dim(`  ${t.explorerUrl}`));
    if (t.payload && (!t.ok || t.mode === 'gasless')) json(t.payload);
  }
}

/** Valores por defecto exportados para documentación/tests. */
export const TRUST_CLI_DEFAULTS = TRUST_DEFAULTS;
