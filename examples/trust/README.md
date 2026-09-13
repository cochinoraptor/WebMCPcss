# Ejemplos · Capa de Confianza Blockchain Gasless

| Archivo            | Qué muestra                                                                                                                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shop.webmcp.css`  | Cinco herramientas con políticas distintas: ERC-8004 + x402 (Base Sepolia), clave de sesión + gasless (Sui testnet), prueba ZK de humanidad, pago patrocinado (SKALE) y una tool sin política |
| `demo.sh`          | Recorrido completo por la CLI: redes, políticas, identidad real en Base Sepolia, prueba de permiso Sui, dry-run gasless, autorización EIP-3009, denegación, script de navegador y auditoría   |
| `agent-client.mjs` | Cliente REST para agentes autónomos: `/api/trust/verify` → token → `/api/call` con `X-Trust-Token` → `/api/trust/audit`                                                                       |
| `mcp-client.cjs`   | Cliente MCP stdio que llama a `trust_get_policies` y `trust_verify_identity`                                                                                                                  |
| `browser.html`     | Página que carga `window.__WEBMCP_TRUST__` y pide a la billetera (MetaMask / Sui Wallet) que firme una prueba de permiso                                                                      |

```bash
npm run build
bash examples/trust/demo.sh
```

Las claves de los ejemplos (`0x1111…`, `2222…`) son de prueba y no tienen
fondos: las transferencias reales quedan en `dry-run` o son rechazadas por la
red por saldo insuficiente, que es exactamente lo que se quiere demostrar sin
gastar nada. Documentación: [`docs/trust-layer.md`](../../docs/trust-layer.md).
