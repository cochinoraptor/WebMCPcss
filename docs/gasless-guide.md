# Ejecución sin gas: Sui, EVM (Base/Ethereum) y SKALE

"Sin gas" significa que **el agente no necesita el token nativo** (SUI, ETH,
sFUEL) para actuar. Hay tres mecanismos distintos y `GaslessExecutor` elige el
adecuado según la cadena y la configuración:

| Cadena           | Mecanismo                                                                                                                                                                                                          | Quién paga            | Requisitos                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------- |
| Sui              | **Transferencia gasless de stablecoins a nivel de protocolo** (`0x2::balance::send_funds` con `gasPrice = 0`, `gasBudget = 0`, sin coins de gas). Desde mayo 2026 en mainnet para USDC, USDsui, FDUSD, USDY, AUSD… | nadie (fee 0)         | el remitente tiene el stablecoin en su _address balance_; mínimo 0.01             |
| Sui (Move calls) | Transacción patrocinada (gas station)                                                                                                                                                                              | el sitio/patrocinador | `WEBMCP_TRUST_SUI_GAS_STATION`                                                    |
| EVM              | **EIP-3009 `transferWithAuthorization`** (USDC): el agente firma off-chain y un relayer/facilitador x402 la liquida                                                                                                | relayer / facilitador | `WEBMCP_TRUST_RELAYER` o un facilitador x402 que consuma `X-PAYMENT`              |
| EVM              | **ERC-4337 v0.7 UserOperation + paymaster** (`pm_sponsorUserOperation`)                                                                                                                                            | paymaster             | `WEBMCP_TRUST_BUNDLER` (+ `WEBMCP_TRUST_PAYMASTER`, `WEBMCP_TRUST_SMART_ACCOUNT`) |
| SKALE            | Gas gratuito (sFUEL sin valor): transacción normal firmada                                                                                                                                                         | nadie                 | clave del agente                                                                  |

## Transacciones

Un objeto `Transaction` describe la operación de forma neutra:

```jsonc
{ "chain": "sui", "network": "sui-testnet", "kind": "transfer",
  "to": "0xab…", "amount": "1 USDC", "token": "0x…::usdc::USDC" }

{ "chain": "base", "kind": "transfer", "to": "0x…dEaD", "amount": "0.5 USDC" }

{ "chain": "base", "kind": "call", "contract": "0x…", "data": "0xa9059cbb…" }

{ "chain": "sui", "kind": "raw", "raw": "<txBytes base64>", "signatures": ["<flag||sig||pk base64>"] }
```

`kind`: `transfer` (stablecoin), `call` (contrato/Move) o `raw` (bytes ya
construidos y firmados, útil cuando la billetera del agente firma fuera del
servidor).

## Sui — transferencia gasless nativa

```bash
# Sin clave: devuelve los bytes BCS para firmarlos en la billetera
webmcpcss trust execute-gasless --chain sui --network sui-testnet \
  --tx '{"kind":"transfer","from":"0x4893…","to":"0xabab…","amount":"1 USDC"}'
# → mode: dry-run, payload.txBytes (base64), payload.digest, gasless: true

# Con la seed Ed25519 del agente (hex de 32 bytes): firma y ejecuta
WEBMCP_TRUST_KEY=2222… webmcpcss trust execute-gasless --chain sui --network sui-testnet \
  --tx '{"kind":"transfer","to":"0xabab…","amount":"1 USDC"}'
# → { ok: true, mode: "gasless", txHash: "<digest>", explorerUrl: "https://suiscan.xyz/testnet/tx/<digest>" }
```

Qué hace el adaptador (`SuiAdapter`):

1. Consulta `epoch { epochId } chainIdentifier` por GraphQL (los fullnodes
   públicos retiraron JSON-RPC en 2026).
2. Construye `TransactionData::V2` con BCS propio (`sui-bcs.ts`):
   inputs `Pure(recipient)` + `FundsWithdrawal(MaxAmountU64, Balance<T>, Sender)`;
   comandos `balance::redeem_funds<T>` → `balance::send_funds<T>`; gas
   `payment: [], price: 0, budget: 0`; expiración `ValidDuring { minEpoch,
maxEpoch, chain, nonce }`. Los bytes son idénticos a los de
   `Transaction.build()` del SDK oficial (test con vector).
3. Firma `blake2b256(intent(0,0,0) || bytes)` con Ed25519 y serializa
   `flag(0x00) || sig || pubkey` en base64.
4. `mutation executeTransaction(transactionDataBcs, signatures)` y devuelve el
   digest y el estado (`SUCCESS`/`FAILURE` con `executionError`).

Si la dirección no tiene el stablecoin en address balance la red responde
`Insufficient address balance … Note that the address balance does not include
funds held in Coin objects` — mueve tus coins a address balance o usa una tx
`raw` construida con `@mysten/sui` (`coinWithBalance`).

### Seal (MPC / firmante externo)

Si las claves del agente viven en un comité (Seal, KMS, HSM), inyecta un
`sealSigner`: recibe `txBytes` y el digest y devuelve la firma serializada.
El adaptador comprueba que la dirección del firmante coincide con `from`.

```ts
const adapter = new trust.SuiAdapter({
  network: trust.TRUST_NETWORKS['sui-mainnet'],
  sealSigner: async (txBytes, digest) => sealClient.sign(digest),
});
```

### Move calls (no gasless)

Las llamadas a contratos requieren gas. Configura una gas station
(`POST { sender, target, args, network } → { txBytes, signature }`) en
`WEBMCP_TRUST_SUI_GAS_STATION`; el adaptador añade la firma del agente y envía
ambas (`mode: sponsored`).

## EVM — EIP-3009 (x402)

```bash
WEBMCP_TRUST_KEY=0x11… webmcpcss trust execute-gasless --chain base --network base-sepolia \
  --tx '{"kind":"transfer","to":"0x…dEaD","amount":"0.5 USDC"}' --json
```

Sin relayer, la respuesta es `{ ok: true, mode: "gasless", pending: true,
payload: { xPayment, payload: { signature, authorization } } }`: una autorización
`TransferWithAuthorization` firmada (EIP-712 sobre el dominio `USD Coin`/`2`)
lista para enviarse como cabecera `X-PAYMENT` a un servidor x402 o para que un
facilitador la liquide. Con `WEBMCP_TRUST_RELAYER` el adaptador la envía y
devuelve el `txHash`.

El mismo objeto sirve como `paymentProof` para políticas `webmcp-payment: x402`:
`PaymentVerifier` recupera la firma sin `ethers`, comprueba receptor, importe,
ventana y replay.

## EVM — ERC-4337 (paymaster)

```bash
export WEBMCP_TRUST_BUNDLER=https://api.pimlico.io/v2/84532/rpc?apikey=…
export WEBMCP_TRUST_SMART_ACCOUNT=0x…   # cuenta del agente (SimpleAccount/Kernel/Safe-4337)
export WEBMCP_TRUST_KEY=0x…             # owner de la smart account
webmcpcss trust execute-gasless --chain base --network base-sepolia \
  --tx '{"kind":"call","contract":"0x…","data":"0x…"}'
```

El adaptador construye `callData = execute(dest, 0, func)`, pide
`pm_sponsorUserOperation` (Pimlico/Alchemy/Coinbase devuelven los campos
`paymaster*` de v0.7), estima gas si no hay patrocinio, calcula el
`userOpHash` packed del EntryPoint v0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`),
firma EIP-191 y llama a `eth_sendUserOperation`. Sin clave devuelve `dry-run`
con `userOp` y `userOpHash` para firmarlos fuera.

## SKALE — gas gratuito

En SKALE Europa (`skale-europa`, chainId 2046399126) el gas se paga en sFUEL,
que se distribuye gratis. El adaptador firma una transacción legacy (RLP +
EIP-155) con la clave del agente y la envía con `eth_sendRawTransaction`
(`mode: gasless`).

## Ejecutor patrocinado

`SponsoredExecutor` fuerza que el gas lo pague un tercero: bundler + paymaster
en EVM, gas station en Sui, o la clave del patrocinador
(`WEBMCP_TRUST_SPONSOR_KEY`) en redes de gas gratuito. Las políticas con
`webmcp-payment: sponsored` lo usan automáticamente.

## Dry-run y seguridad

- Sin clave privada **nunca se envía nada**: se devuelve la carga a firmar.
- `--dry-run` / `dryRun: true` muestra la red, el RPC y la transacción normalizada.
- Las claves se leen solo de `--key`/`WEBMCP_TRUST_KEY` y no se escriben en el
  audit log ni en el estado.
- Los importes se manejan como enteros (`toUnits`) para evitar errores de coma
  flotante; USDC usa 6 decimales.
