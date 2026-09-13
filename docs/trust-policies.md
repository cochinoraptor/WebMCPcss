# Declarar políticas de confianza en `.webmcp.css`

Una política de confianza se declara **en la misma regla** que define la
herramienta (`webmcp-tool`). El parser principal conserva las propiedades
`webmcp-*` extendidas en `tool.meta`; el módulo `trust` las convierte en una
`TrustPolicy` validada.

```css
.checkout-button {
  webmcp-tool: "purchase";
  webmcp-description: "Compra el carrito";

  /* identidad + pago + cadena */
  webmcp-auth: "erc8004";           /* erc8004 | zk-proof | session-key | none */
  webmcp-payment: "x402";           /* x402 | eip3009 | sponsored | none      */
  webmcp-chain: "base-sepolia";     /* sui | evm | base | skale | <red>        */

  /* límites y restricciones */
  webmcp-spending-limit: "100 USDC/day";
  webmcp-rate-limit: "5 actions/minute";
  webmcp-allowed-contracts: "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  webmcp-allowed-hours: "09:00-18:00";           /* UTC */
  webmcp-requires-human-proof: true;

  /* datos del pago (compartidos con el módulo Web3 v1.0) */
  webmcp-pay-to: "0x000000000000000000000000000000000000dEaD";
  webmcp-amount: "0.5 USDC";
}
```

## Cuándo se activa la política

Una herramienta tiene política si declara **`webmcp-auth*`**, **`webmcp-chain*`**
o un **`webmcp-payment`** con tipo de confianza (`x402`, `eip3009`, `sponsored`).
Los valores `webmcp-payment: required | optional | none` del módulo Web3 v1.0
**no** activan la capa por sí solos (compatibilidad hacia atrás): si añades
`webmcp-chain`, `required`/`optional` se traducen a `x402` (o `sponsored` si
`webmcp-payment-protocol: onchain`).

## Propiedades

| Propiedad                                 | Valores                                                                                                 | Notas                                                                                                                                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `webmcp-auth` (`-type`, `-method`)        | `erc8004`, `zk-proof`, `session-key`, `none`                                                            | `erc8004` exige identidad on-chain + prueba firmada por owner/billetera/delegado; `session-key` acepta cualquier clave que firme la prueba; `zk-proof` exige prueba de humanidad; `none` solo aplica límites |
| `webmcp-payment` (`-type`, `-method`)     | `x402`, `eip3009`, `sponsored`, `none`                                                                  | `x402`/`eip3009` exigen una autorización EIP-3009 firmada por el pagador; `sponsored` no exige prueba (el sitio paga el gas)                                                                                 |
| `webmcp-chain` (`-type`)                  | `sui`, `evm`, `base`, `skale` o una red (`sui-testnet`, `base-sepolia`, `skale-europa`…)                | si indicas una red se infieren familia y `network`                                                                                                                                                           |
| `webmcp-network` (`webmcp-chain-network`) | id de red                                                                                               | opcional si ya va en `webmcp-chain`                                                                                                                                                                          |
| `webmcp-spending-limit`                   | `"100 USDC/day"`, `"0.5 USDC per tx"`, `"20 USDC"` (acumulado), ventanas `hour/day/week/month/tx/total` | acumulado por agente y herramienta                                                                                                                                                                           |
| `webmcp-rate-limit`                       | `"5 actions/minute"`, `"10/min"`, `"100 per hour"`, `"3 acciones por 10 s"`                             | ventana deslizante por agente y herramienta; por defecto `60 actions/minute`                                                                                                                                 |
| `webmcp-allowed-contracts`                | lista separada por comas de direcciones EVM o paquetes Sui (`0x2::coin`)                                | se compara con `target`/`tx.contract`/`tx.to`; prefijos Move (`0x2::coin::transfer` cumple `0x2::coin`)                                                                                                      |
| `webmcp-allowed-hours`                    | `"HH:MM-HH:MM"` UTC (admite rangos que cruzan medianoche)                                               |                                                                                                                                                                                                              |
| `webmcp-requires-human-proof`             | `true`/`false`                                                                                          | exige `humanProof` además de la identidad                                                                                                                                                                    |
| `webmcp-identity-registry`                | dirección                                                                                               | registro ERC-8004 distinto del canónico de la red                                                                                                                                                            |
| `webmcp-pay-to`, `webmcp-amount`          | receptor e importe                                                                                      | los verifica `PaymentVerifier` (receptor exacto, importe ≥)                                                                                                                                                  |

Los errores de validación se lanzan al parsear (`TrustSchemaError` con la ruta
del campo), así que `webmcpcss validate`, `parse` y `trust policies` fallan
pronto si una política está mal escrita.

## Herramientas para editar políticas

```bash
# Ver las políticas de un archivo
webmcpcss trust policies --file sitio.webmcp.css [--json]

# Añadir o cambiar propiedades sin tocar el resto del archivo
webmcpcss trust set-policy --file sitio.webmcp.css --tool purchase \
  --auth erc8004 --payment x402 --chain base-sepolia \
  --spending-limit "100 USDC/day" --rate-limit "5 actions/minute" \
  --allowed-contracts 0x036CbD53842c5426634e7929541eC2318f3dCF7e \
  --requires-human-proof true
```

`set-policy` trabaja sobre el texto (conserva comentarios y formato) y valida el
resultado volviéndolo a parsear.

## API

```ts
import { trust } from 'webmcpcss';

const policies = trust.parseTrustPolicies(css);      // { purchase: TrustPolicy, … }
const one = trust.policyFromTool(toolMap.tools.purchase);
const css2 = trust.setPolicyInCss(css, 'purchase', { spendingLimit: '50 USDC/day' });
trust.validateTrustPolicy({ auth: 'erc8004', chain: 'base' });
trust.parseSpendingLimit('100 USDC/day'); // { amount: 100, currency: 'USDC', per: 'day', windowMs: 86400000 }
trust.parseRateLimit('5 actions/minute'); // { count: 5, per: 'minute', windowMs: 60000 }
```

## Contexto que debe aportar el agente

Según la política, el agente envía en `_trust` (MCP), en el cuerpo de
`POST /api/trust/verify` o como opciones de la CLI:

| Campo              | Cuándo                                   | Contenido                                                                          |
| ------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `agentId`          | `erc8004`, `session-key`                 | `eip155:<chainId>:<registry>#<id>`, `#<id>` o dirección Sui                        |
| `proof`            | `erc8004`, `session-key`                 | [`PermissionProof`](agent-identity.md#pruebas-de-permiso-claves-de-sesión) firmada |
| `humanProof`       | `zk-proof`, `requires-human-proof`       | `{ provider, nullifierHash, proof, merkleRoot, level, action }`                    |
| `paymentProof`     | `x402`, `eip3009`                        | cabecera `X-PAYMENT` (base64) o `{ authorization, signature }`                     |
| `amount`, `target` | límites y listas blancas                 | importe previsto y contrato destino                                                |
| `tx`               | si la acción implica una transacción     | [`Transaction`](gasless-guide.md#transacciones)                                    |
| `trustToken`       | tras un `trust_check_permission` exitoso | evita repetir identidad y firma en la misma sesión                                 |
| `origin`           | pruebas limitadas a un sitio             | URL del sitio                                                                      |

Ejemplos completos en [`examples/trust/`](../examples/trust/).
