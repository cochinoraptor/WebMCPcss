# Web3-MCP (v1.0.0)

Herramientas **de pago** declaradas en el `.webmcp.css`, billeteras de agente
con **límites de gasto**, micropagos **USDC sin gas** (protocolo x402) y
operaciones on-chain (saldo, pago, despliegue) con `ethers` como peer
opcional. Sin dependencias nuevas: el flujo x402 completo funciona con Node
nativo; `ethers` solo hace falta para hablar con una cadena real.

- Código: `src/web3/index.ts`
- CLI: `webmcpcss web3 validate | balance | pay | deploy`
- Ejemplo: [`examples/v1/output/web3/`](../examples/v1/output/web3/) (`validate.json`, `wallet-connector.js`, `WebMCPPayments.sol`)

> **Sobre «NanoCrawl».** La especificación original hablaba de micropagos
> «NanoCrawl» en USDC. No existe un protocolo público con ese nombre; lo que
> hay en producción es **x402** (HTTP `402 Payment Required` + autorización
> USDC firmada, verificada y liquidada por un _facilitador_) y las
> **nanotransacciones USDC gas-free de Circle**. WebMCPcss implementa por tanto
> un **perfil x402/USDC** —`webmcp-payment-protocol: "x402"`, el valor por
> defecto para USDC— que cubre el mismo caso de uso: pagos de fracciones de
> céntimo por invocación, sin gas para el agente.

## Propiedades

| Propiedad                 | Ejemplo                               | Significado                                            |
| ------------------------- | ------------------------------------- | ------------------------------------------------------ |
| `webmcp-payment`          | `required` \| `optional` \| `none`    | Si la tool exige pago                                  |
| `webmcp-network`          | `base`, `polygon`, `8453`, `11155111` | Red por nombre o chainId (cualquiera)                  |
| `webmcp-amount`           | `"0.05 USDC"`, `"0.001 ETH"`          | Importe y moneda (USDC por defecto)                    |
| `webmcp-pay-to`           | `0x…`                                 | Dirección receptora                                    |
| `webmcp-payment-protocol` | `x402` \| `onchain`                   | x402 (USDC gasless) u on-chain (transfer/valor nativo) |

```css
#report {
  webmcp-tool: 'descargarInforme';
  webmcp-description: 'Descarga el informe premium (de pago)';
  webmcp-payment: 'required';
  webmcp-network: 'base';
  webmcp-amount: '0.05 USDC';
  webmcp-pay-to: '0x1111111111111111111111111111111111111111';
  webmcp-permissions: 'full';
  webmcp-confirmation: 'needed';
}
```

Redes incluidas (`NETWORKS`): ethereum, polygon, base, arbitrum, optimism,
avalanche, sepolia, base-sepolia, con RPC público, explorador y contrato USDC.
**No hay restricción de red**: cualquier otro chainId se acepta (sin USDC
conocido, por lo que `validatePayments` avisa si se declara USDC en ella).

`webmcpcss web3 validate --file tienda.webmcp.css` audita: importe válido,
`pay-to` con formato EVM, USDC conocido en la red, confirmación y permisos
`full` en tools de pago; `--connector` escribe el script de billetera para el
navegador.

## Billetera del agente y límites de gasto

```ts
import { web3 } from 'webmcpcss';

const wallet = new web3.AgentWallet({
  privateKey: process.env.WEBMCP_WALLET_KEY, // o signer: cualquier { getAddress, signTypedData }
  limits: {
    perTx: 0.1,
    perSession: 1,
    perDay: 5,
    allowedRecipients: ['0x1111…'],
    allowedNetworks: ['base'],
  },
  recordHistory: true, // .webmcpcss/history.json (type: 'payment')
});
wallet.canSpend(0.05, '0x1111…', 'base'); // { allowed, reasons, remaining }
wallet.summary(); // spentSession, spentDay, payments, settled, rejected
```

Los límites son la **única** barrera: sin límites, la billetera acepta
cualquier importe en cualquier red (decisión de diseño acordada: Web3 abierto,
control por presupuesto).

## Micropagos x402 (USDC, sin gas para el agente)

```
Agente ──GET /tools/descargarInforme──▶ Sitio
       ◀── 402 { x402Version: 1, accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "50000", asset: USDC, payTo, resource }] }
Agente firma EIP-712 TransferWithAuthorization (EIP-3009): from, to, value, validAfter, validBefore, nonce
Agente ──GET … X-PAYMENT: base64(payload)──▶ Sitio ──verify/settle──▶ Facilitador (on-chain o local)
       ◀── 200 + X-PAYMENT-RESPONSE: base64({ success, txHash, network, payer })
```

- **Servidor** (`createPaymentGate(requirement, facilitator)`): middleware
  para `http`/Express que responde 402 con los requisitos, valida la cabecera
  `X-PAYMENT` y añade `X-PAYMENT-RESPONSE`. `optional` deja pasar sin pago.
- **Facilitador** (`createLocalFacilitator()`): comprueba receptor, importe,
  ventana temporal y nonce único; si `ethers` está instalado verifica la firma
  EIP-712 (`verifyTypedData`). Puede sustituirse por un facilitador remoto
  (`verify`/`settle` que llamen a la API de un proveedor x402).
- **Cliente** (`new X402Client(wallet).fetch(url, init, { tool, maxAmount })`):
  hace la petición, y si recibe 402 comprueba límites, firma con la billetera,
  reintenta con `X-PAYMENT` y registra el pago (`authorized` → `settled` /
  `failed`; `rejected` si lo bloquea un límite).

`tests/web3.test.ts` levanta un servidor real con la puerta de pago y paga
con el cliente: dos pagos liquidados y el tercero rechazado por el límite de
sesión.

## Navegador: MetaMask / WalletConnect

`buildWalletConnectorScript(toolMap, limits)` genera un script sin
dependencias que expone `window.__WEBMCP_WALLET__`:

```js
await __WEBMCP_WALLET__.connect(); // eth_requestAccounts + eth_chainId (EIP-1193)
const r = await __WEBMCP_WALLET__.payTool('descargarInforme');
// x402: firma eth_signTypedData_v4 → { paid: true, header, payload }
// onchain: eth_sendTransaction → { paid: true, txHash }
```

Cambia de red si hace falta (`wallet_switchEthereumChain`), aplica los mismos
límites (`perTx`, `perSession`, `allowedRecipients`) y funciona con MetaMask o
con un `WalletConnectProvider` cargado en la página.

## On-chain con `ethers` (peer opcional)

```bash
npm i ethers
export WEBMCP_WALLET_KEY=0x…

webmcpcss web3 balance --address 0x… --network base
webmcpcss web3 pay --to 0x… --amount 0.05 --currency USDC --network base --max-tx 0.1 --tool descargarInforme
webmcpcss web3 pay --to 0x… --amount 0.01 --currency ETH --network arbitrum --allow-to 0x…
webmcpcss web3 deploy --export-sol WebMCPPayments.sol         # contrato de referencia
webmcpcss web3 deploy --contract build/WebMCPPayments.json --network base --args <usdcAddress>
```

`getBalance` devuelve saldo nativo y USDC; `sendPayment` transfiere USDC
(`transfer`) o valor nativo respetando los límites de la billetera y registra
`txHash`; `deployContract` despliega cualquier artefacto `{ abi, bytecode }`
y devuelve dirección, hash y enlace al explorador. `setEthersModule()` permite
inyectar un doble en tests.

### `WebMCPPayments.sol`

Contrato de referencia (`WEBMCP_PAYMENTS_SOL`): precios por `toolId`
(`keccak`/sha256 del nombre) en moneda nativa y USDC, `payTool(bytes32)`
(payable), `payToolUSDC(bytes32)` (`transferFrom`), `hasAccess(payer, toolId)`
con 24 h de acceso y evento `ToolPaid`. Compílalo con solc/Hardhat y despliega
con `web3 deploy --contract`.

## Seguridad

- Las tools de pago deben declarar `webmcp-permissions: "full"` y
  `webmcp-confirmation: "needed"` (Security-MCP y `web3 validate` lo exigen).
- La clave privada solo se lee de `WEBMCP_WALLET_KEY` o `--key`; nunca se
  escribe en archivos ni en el historial.
- Cada autorización x402 lleva nonce aleatorio y caduca a los 5 minutos.
