# Capa de Confianza Blockchain Gasless (v1.3.0)

El módulo `trust` permite que los agentes de IA operen en sitios WebMCPcss con
**permisos verificables on-chain** y **transacciones sin gas**, mitigando los
ataques típicos de la agencia autónoma: prompt injection que desencadena
compras, gasto descontrolado, acciones fuera de horario o contra contratos no
autorizados, y agentes sin identidad ni reputación.

- Declaras la política **en el mismo `.webmcp.css`** (`webmcp-auth`,
  `webmcp-payment`, `webmcp-chain`, `webmcp-spending-limit`…).
- El servidor MCP/REST **verifica antes de ejecutar**: identidad ERC-8004,
  prueba de permiso firmada (clave de sesión), prueba de humanidad ZK, pago
  x402/EIP-3009, límites de gasto y frecuencia, lista blanca y horario.
- Las transacciones se ejecutan **sin gas para el agente**: transferencias de
  stablecoins a nivel de protocolo en Sui, EIP-3009 / ERC-4337 con paymaster en
  EVM, gas gratuito en SKALE.
- Cada acción queda en un **registro de auditoría encadenado por hash**
  (opcionalmente anclado on-chain).

> **Sin dependencias.** Keccak-256, secp256k1, EIP-712, RLP, ABI, BLAKE2b,
> Ed25519 (nativo de Node) y BCS están implementados en `src/trust/crypto/` y
> `src/trust/chains/sui-bcs.ts`, verificados byte a byte contra `ethers` 6 y
> `@mysten/sui` 2 (`tests/fixtures/trust-vectors.json`). Los RPC se consumen con
> `fetch` (JSON-RPC en EVM, GraphQL en Sui). Node ≥ 18.

## Arquitectura

```
src/trust/
├── index.ts                 # exportaciones públicas (namespace `trust`)
├── types.ts                 # TrustPolicy, AgentIdentity, PermissionProof, …
├── engine.ts                # TrustEngine: verify → execute → audit + tokens
├── browser.ts               # window.__WEBMCP_TRUST__ para agentes de navegación
├── config/defaults.ts       # redes, registros ERC-8004, USDC, EntryPoint, TTLs
├── crypto/                  # keccak, secp256k1, eip712, abi, blake2b, ed25519
├── parser/
│   ├── trust-parser.ts      # webmcp-auth/payment/chain/… → TrustPolicy
│   └── schema.ts            # validación sin dependencias (límites, pruebas, tx)
├── verifier/
│   ├── identity-verifier.ts # ERC-8004 / registro Sui / World ID / Self.xyz + caché
│   ├── permission-verifier.ts # firma, vigencia, replay, scope, delegación
│   ├── payment-verifier.ts  # x402 / EIP-3009 / sponsored
│   └── policy-engine.ts     # rate limit, gasto por ventana, listas, horario, reglas
├── chains/
│   ├── base-adapter.ts      # interfaz ChainAdapter + RPC helpers
│   ├── evm-adapter.ts       # ERC-8004, EIP-3009, ERC-4337 v0.7, SKALE, RLP
│   ├── sui-adapter.ts       # GraphQL, gasless nativo, Seal (firmante externo)
│   └── sui-bcs.ts           # TransactionData v2 para balance::send_funds
├── executors/
│   ├── gasless-executor.ts  # elige la vía sin gas por cadena
│   ├── sponsored-executor.ts# paymaster / gas station / gas gratuito
│   └── audit-logger.ts      # JSONL encadenado + anclaje on-chain
└── mcp/trust-tools.ts       # trust_verify_identity, trust_check_permission, …
```

## Flujo de una herramienta con política

```
tools/call purchase { qty: 1, _trust: { proof, paymentProof, amount, target } }
        │
        ▼
 ┌─ TrustEngine.verify ──────────────────────────────────────────────┐
 │ 1. identidad     erc8004 → ownerOf/agentWallet/tokenURI/reputación │
 │                  session-key → la firma acredita                  │
 │                  zk-proof → World ID / Self.xyz                   │
 │ 2. humanidad     webmcp-requires-human-proof                      │
 │ 3. permiso       EIP-712 / Ed25519 · vigencia · nonce · scope     │
 │                  firmante = owner | agentWallet | delegado        │
 │                  → PolicyEngine: rate limit, gasto, lista, horario │
 │ 4. pago          x402 / EIP-3009 (firma, importe, receptor, replay)│
 └───────────────────────────────────────────────────────────────────┘
        │ allowed
        ▼
 ejecutar tx (gasless | sponsored)  →  ejecutar acción DOM (Puppeteer)
        │
        ▼
 commit de cuotas (solo si todo fue bien)  →  AuditLogger.log (hash encadenado)
```

Cada paso devuelve un `code` estable para el agente: `agent-required`,
`identity-unverified`, `proof-required`, `proof-expired`, `nonce-reused`,
`agent-mismatch`, `origin-mismatch`, `invalid-signature`, `unauthorized-signer`,
`out-of-scope`, `rate-limit`, `spending-limit`, `session-max-spend`,
`allowed-contracts`, `allowed-hours`, `human-proof-required`,
`human-proof-invalid`, `payment-required`, `payment-insufficient`,
`payment-bad-signature`, `payment-replay`, `trust-token-invalid`.

## Cómo se activa

```bash
# El servidor detecta las políticas del CSS y activa la capa automáticamente;
# --trust la fuerza aunque el CSS no declare ninguna.
webmcpcss mcp --serve --css sitio.webmcp.css --url https://tienda.example --http -p 8090 --trust
```

Se exponen:

| Superficie              | Elementos                                                                                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP `tools/list`        | `trust_verify_identity`, `trust_check_permission`, `trust_execute_gasless`, `trust_get_audit_log`, `trust_get_policies`                                                                     |
| MCP `tools/call <tool>` | si la tool tiene política, el argumento reservado `_trust` lleva el `ExecutionContext` (`agentId`, `proof`, `humanProof`, `paymentProof`, `tx`, `amount`, `target`, `origin`, `trustToken`) |
| REST                    | `GET /api/trust/policies`, `GET /api/trust/identity`, `POST /api/trust/verify`, `POST /api/trust/execute`, `GET /api/trust/audit`                                                           |
| REST `POST /api/call`   | cabecera `X-Trust-Token: <token>` obtenida en `/api/trust/verify`                                                                                                                           |
| Navegador               | `webmcpcss trust inject` → `window.__WEBMCP_TRUST__`                                                                                                                                        |
| CLI                     | `webmcpcss trust networks                                                                                                                                                                   | policies | set-policy | verify-identity | check-permission | sign-proof | execute-gasless | audit-log | balance | inject` |

## API programática

```ts
import { trust } from 'webmcpcss';

const engine = new trust.TrustEngine({
  policies: parseWebMCP(css), // o un TrustPolicyMap
  privateKey: process.env.WEBMCP_TRUST_KEY, // opcional: firma pruebas/tx
});

const res = await engine.executeTool('purchase', { qty: 1 }, {
  proof,                     // PermissionProof firmada por el owner del agente
  paymentProof: xPayment,    // cabecera X-PAYMENT (x402) o { authorization, signature }
  amount: '0.5 USDC',
  target: usdcAddress,
  tx: { chain: 'base', kind: 'transfer', to: shop, amount: '0.5 USDC' },
}, async (tool, params) => page.click(...)); // ejecutor normal (opcional)

res.ok; res.verification.checks; res.transaction.txHash; res.audit.hash;
```

Componentes reutilizables por separado: `IdentityVerifier`,
`PermissionVerifier`, `PaymentVerifier`, `PolicyEngine` (con `MemoryPolicyStore`,
`FilePolicyStore` o `RedisPolicyStore` para `ioredis`), `GaslessExecutor`,
`SponsoredExecutor`, `AuditLogger`, `createChainAdapter(chain, network, opts)`.

## Redes soportadas

| id                                     | familia | gasless                                      | ERC-8004              | USDC               |
| -------------------------------------- | ------- | -------------------------------------------- | --------------------- | ------------------ |
| `sui-mainnet`, `sui-testnet`           | Sui     | **nativo** (stablecoins P2P, gas 0)          | registro Sui opcional | Circle USDC nativo |
| `base`, `base-sepolia`                 | EVM     | EIP-3009 (relayer/x402) · ERC-4337 paymaster | ✓                     | ✓                  |
| `ethereum`, `sepolia`                  | EVM     | EIP-3009 · ERC-4337                          | ✓                     | ✓                  |
| `skale-europa`, `skale-europa-testnet` | EVM     | **gas gratuito** (sFUEL)                     | —                     | Europa USDC        |

`webmcpcss trust networks` las lista; `WEBMCP_TRUST_RPC` o
`WEBMCP_TRUST_RPC_<ID>` sustituyen el endpoint.

## Variables de entorno

| Variable                                                                                   | Uso                                                                      |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `WEBMCP_TRUST_KEY`                                                                         | clave privada del agente/patrocinador (hex secp256k1 o seed Ed25519)     |
| `WEBMCP_TRUST_SECRET`                                                                      | secreto HMAC de los tokens de confianza (aleatorio por proceso si falta) |
| `WEBMCP_TRUST_RPC`, `WEBMCP_TRUST_RPC_BASE_SEPOLIA`…                                       | endpoints RPC/GraphQL                                                    |
| `WEBMCP_TRUST_BUNDLER`, `WEBMCP_TRUST_PAYMASTER`, `WEBMCP_TRUST_SMART_ACCOUNT`             | ERC-4337                                                                 |
| `WEBMCP_TRUST_RELAYER`                                                                     | relayer de autorizaciones EIP-3009                                       |
| `WEBMCP_TRUST_SUI_REGISTRY`, `WEBMCP_TRUST_SUI_GAS_STATION`                                | registro de identidad y gas station en Sui                               |
| `WEBMCP_TRUST_POLICY_CONTRACT`, `WEBMCP_TRUST_AUDIT_CONTRACT`                              | contratos opcionales de límites y anclaje                                |
| `WEBMCP_TRUST_WORLD_APP_ID`, `WEBMCP_TRUST_WORLD_ACTION`, `WEBMCP_TRUST_SELF_VERIFIER_URL` | pruebas de humanidad                                                     |
| `WEBMCP_TRUST_LIVE=1`                                                                      | ejecuta los tests de integración contra testnets reales                  |

## Modelo de amenazas (qué mitiga y qué no)

| Riesgo                              | Mitigación                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Prompt injection que ordena comprar | la acción exige prueba firmada por el owner con `scope` y `maxSpend`; el LLM no puede fabricarla              |
| Gasto descontrolado                 | `webmcp-spending-limit` por ventana + `maxSpend` de sesión; solo se consume cuota si la ejecución tiene éxito |
| Replay de pruebas/pagos             | nonces únicos (`singleUse`) y ventana `validAfter/validBefore` en EIP-3009                                    |
| Agente desconocido                  | ERC-8004 (`ownerOf`, reputación mínima, `agentWallet`) o clave de sesión delegada                             |
| Contratos no autorizados            | `webmcp-allowed-contracts` ∩ `allowedContracts` de la sesión                                                  |
| Bots sin humano detrás              | `webmcp-requires-human-proof` (World ID / Self.xyz), caché por `nullifierHash`                                |
| Manipulación del historial          | cadena de hashes keccak (`audit-log --verify`) + anclaje on-chain opcional                                    |

No sustituye la seguridad del sitio: el backend debe seguir validando pagos
(liquidando la autorización EIP-3009 con un facilitador) y las firmas de las
pruebas en su propio servidor si no confía en el servidor MCP.

Documentación relacionada: [políticas](trust-policies.md) ·
[gasless](gasless-guide.md) · [identidad](agent-identity.md) ·
[auditoría](audit-logs.md) · ejemplos en [`examples/trust/`](../examples/trust/).
