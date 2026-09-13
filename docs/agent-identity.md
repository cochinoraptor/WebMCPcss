# Identidad de agentes: ERC-8004, claves de sesión y pruebas ZK

## ERC-8004 (Trustless Agents)

[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) define tres registros por
cadena: **Identity** (ERC-721; el `tokenId` es el `agentId` y el `tokenURI` el
archivo de registro), **Reputation** (feedback firmado por clientes) y
**Validation**. Los registros canónicos están desplegados con la misma
dirección en Ethereum, Base, Arbitrum, BSC, Celo, Linea… y sus testnets:

|          | Identity                                     | Reputation                                   |
| -------- | -------------------------------------------- | -------------------------------------------- |
| mainnets | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` |
| testnets | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |

### Identificadores aceptados

| Forma         | Ejemplo                               | Significado                                       |
| ------------- | ------------------------------------- | ------------------------------------------------- |
| completa      | `eip155:84532:0x8004A818…BD9e#12`     | registro explícito (CAIP-2 + dirección + tokenId) |
| registro + id | `0x8004A818…BD9e#12`                  | registro explícito en la red configurada          |
| solo id       | `#12` o `12`                          | registro canónico de la red                       |
| dirección Sui | `0x4893…e45f` o `sui:testnet:0x4893…` | agente Sui (ver abajo)                            |

### Qué verifica `verifyIdentity`

```bash
webmcpcss trust verify-identity --agent "#1" --chain base --network base-sepolia
#   ✔ verificado eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e#1
#   owner: 0x21fd…e235
#   nombre: Test Agent 004 (Image Test)
#   reputación: 50/100 (74 feedbacks)
```

1. `ownerOf(agentId)` → dueño humano/operador (`ownerAddress`). Si revierte,
   `verified: false` con motivo `agentId … no existe`.
2. `getAgentWallet(agentId)` → billetera de cobro verificada (EIP-712/1271),
   `agentWallet` si no es la dirección cero.
3. `tokenURI(agentId)` → `agentURI`; si es `data:application/json;base64,…` se
   extrae `name`.
4. Reputación: `getClients(agentId)` y `getSummary(agentId, clients, '', '')`
   (la spec exige filtrar por clientes para evitar Sybil). `reputation` es el
   valor 0–100 y `feedbackCount` el número de feedbacks. `minReputation` en
   `IdentityVerifier` invalida agentes por debajo del umbral **solo si tienen
   feedback**.

Las identidades se cachean 5 minutos (`cacheTtlMs`); `--no-cache` /
`skipCache: true` fuerzan la consulta.

### Quién puede firmar por un agente ERC-8004

Con `webmcp-auth: erc8004` la prueba de permiso debe estar firmada por:

- el **owner** del ERC-721,
- la **`agentWallet`** verificada, o
- una **clave de sesión delegada**: el owner/billetera firma una
  `SessionDelegation` (EIP-712 `Delegation(address delegate,address delegator,
uint256 expiresAt,string scope)`) y la clave delegada firma las pruebas
  incluyéndola en `proof.delegation`. La delegación no puede expirar antes que
  la prueba y su `scope` acota el de la prueba.

Esto permite que el agente opere con una clave efímera de bajo valor mientras la
clave del dueño permanece fría.

## Sui

Sui no tiene ERC-8004. `SuiAdapter.verifyIdentity`:

- sin registro configurado → `verified: false` con el motivo; la identidad se
  acredita con `webmcp-auth: session-key` (la firma Ed25519 de la prueba
  demuestra control de la dirección);
- con `WEBMCP_TRUST_SUI_REGISTRY=<paquete>` → busca un objeto
  `<paquete>::identity::AgentIdentity` propiedad de la dirección y lee
  `owner`, `name`, `wallet`, `uri`, `reputation` de su contenido.

Las firmas de mensajes personales Ed25519 se verifican en local
(`blake2b256(intent(3,0,0) || bcs(vector<u8>))`); zkLogin, passkeys, MultiSig y
secp256k1/r1 se delegan en `verifySignature` del nodo GraphQL.

## Pruebas de permiso (claves de sesión)

```jsonc
{
  "agentId": "eip155:84532:0x8004A818BFB912233c491871b3d84c89A494BD9e#7",
  "signer": "0x19E7…ff2A",
  "scope": ["purchase", "add_to_cart"],   // o ["*"]
  "nonce": "0xab…",                       // bytes32 en EVM, texto libre en Sui
  "issuedAt": 1757700000,
  "expiresAt": 1757700900,                // ≤ 24 h desde issuedAt
  "maxSpend": "50 USDC",                  // límite adicional de la sesión (opcional)
  "allowedContracts": ["0x036c…"],        // subconjunto de la política (opcional)
  "origin": "https://shop.example",       // limita la prueba a un sitio (opcional)
  "chain": "base", "chainId": 84532,
  "signature": "0x…",                      // EIP-712 (EVM) o base64 flag||sig||pk (Sui)
  "delegation": { "delegate": "0x…", "delegator": "0x…", "expiresAt": 1757790000, "scope": ["purchase"], "signature": "0x…" }
}
```

Dominio EIP-712: `{ name: "WebMCPcss Trust", version: "1", chainId }`, tipo
`Permission(string agentId,address signer,string scope,bytes32 nonce,uint256
issuedAt,uint256 expiresAt,string maxSpend,string allowedContracts,string
origin)`. En Sui se firma el mensaje personal multilínea
`WebMCPcss Trust Permission\nagentId: …\nsigner: …\nscope: …\n…` (mismo formato
que genera `window.__WEBMCP_TRUST__.suiMessage`).

```bash
# El owner firma una prueba para el agente #7 (15 minutos, máx. 50 USDC)
webmcpcss trust sign-proof --agent "#7" --scope purchase,add_to_cart \
  --chain base --network base-sepolia --key $OWNER_KEY --ttl 900 --max-spend "50 USDC" \
  --origin https://shop.example --output proof.json

# Comprobar sin ejecutar
webmcpcss trust check-permission --tool purchase --file sitio.webmcp.css \
  --agent "#7" --proof proof.json --amount "0.5 USDC" --target 0x036C…
```

Desde el navegador, `window.__WEBMCP_TRUST__.buildProof(...)` +
`signProofEvm(proof)` (MetaMask `eth_signTypedData_v4`) o
`signProofSui(proof, wallet, account)` (Wallet Standard
`sui:signPersonalMessage`) producen el mismo objeto.

### Comprobaciones de `PermissionVerifier`

`expiry` → `nonce` (anti-replay; `singleUse` quema el nonce al ejecutar) →
`agent` (la prueba es del mismo agente) → `origin` → `signature` →
`signer-authorized` (owner / billetera / delegado, solo con identidad
verificada) → `scope` → políticas (`rate-limit`, `spending-limit`,
`session-max-spend`, `allowed-contracts`, `allowed-hours`, reglas propias).

## Pruebas de humanidad (ZK)

`webmcp-auth: zk-proof` o `webmcp-requires-human-proof: true` exigen un
`humanProof`:

```jsonc
{ "provider": "worldid", "nullifierHash": "0x…", "merkleRoot": "0x…",
  "proof": "0x…", "level": "orb", "action": "webmcpcss" }
```

- **World ID**: con `WEBMCP_TRUST_WORLD_APP_ID` se llama al Developer Portal
  (`POST /api/v2/verify/{app_id}`), que valida la prueba ZK y la unicidad del
  `nullifier_hash` por acción.
- **Self.xyz** u otro verificador: `WEBMCP_TRUST_SELF_VERIFIER_URL` recibe el
  objeto por `POST` y responde `{ valid | result | status: 'success' }`.
- Programáticamente: `new IdentityVerifier({ humanProofVerifier })`.

Los `nullifierHash` válidos se recuerdan hasta `expiresAt` (o 24 h) para no
reverificar en cada acción; el nullifier también sirve de `agentId` para los
límites cuando la política es `zk-proof` sin `agentId`.

## Tokens de confianza

Tras un `trust_check_permission` / `POST /api/trust/verify` exitoso, el motor
emite un token HMAC-SHA256 (`WEBMCP_TRUST_SECRET`) con `agentId`, `scope` y
expiración (15 min por defecto). El agente lo envía en `X-Trust-Token`
(`POST /api/call`) o como `trustToken` en `_trust`: sustituye la verificación de
identidad y firma, pero **no** las políticas de gasto/frecuencia ni el pago,
que se evalúan en cada acción.
