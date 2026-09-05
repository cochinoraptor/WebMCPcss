# Ejemplos v1.0.0: los diez módulos sobre una misma tienda

Esta carpeta contiene un contrato de ejemplo (`tienda.webmcp.css` +
`tienda.html`), una segunda versión del contrato (`tienda.v2.webmcp.css`) y la
salida real de cada comando v1.0.0 en `output/`. Todo se regenera sin
navegador, sin red y sin LLM con:

```bash
npm run build
bash examples/v1/regen.sh
```

| Módulo | Comando | Salida |
| --- | --- | --- |
| IA-First Framework | `webmcpcss init examples/v1/ia-first-project --name "Tienda IA-First"` | [`ia-first-project/`](./ia-first-project/) (HTML + `.webmcp.css` + `mcp.json` + `.well-known/webmcp.json`) |
| | `webmcpcss assist "crea un formulario de contacto…" -o output/assist-contacto` | [`output/assist-contacto/`](./output/assist-contacto/) |
| Design-to-WebMCP | `webmcpcss design analyze --text "…" -o design.webmcp.css --scaffold scaffold.html --design-json design.json` | [`output/design/`](./output/design/) |
| | `webmcpcss design optimize tienda.webmcp.css -o tienda.optimized.webmcp.css` | [`output/design/tienda.optimized.webmcp.css`](./output/design/tienda.optimized.webmcp.css) |
| Retro-WebMCP | `webmcpcss retro scan tests/fixtures/legacy-site.html -o legacy.webmcp.css` | [`output/retro/`](./output/retro/) |
| A11y-MCP | `webmcpcss a11y audit --url https://tienda.test --ci` (workflow) | [`output/a11y/webmcp-a11y.yml`](./output/a11y/webmcp-a11y.yml) |
| Test-MCP | `webmcpcss test generate --file tienda.webmcp.css --framework playwright\|cypress --execute` | [`output/testing/`](./output/testing/) |
| Version-MCP | `webmcpcss version snapshot` / `diff` / `migrate` | [`output/versioning/`](./output/versioning/) (`diff.json`, `MIGRATION.md`, contrato migrado) |
| Doc-MCP | `webmcpcss doc generate --file tienda.webmcp.css -o output/doc` | [`output/doc/`](./output/doc/) (`index.html`, `README.md`, `doc.json`, `llms.txt`, `AGENTS.md`) |
| Security-MCP | `webmcpcss security validate --file tienda.webmcp.css --agent "bot:restricted:orders:pay" --json` | [`output/security/`](./output/security/) (`report.json`, `policies.webmcp.css`) |
| Recommender-MCP | `webmcpcss recommend "inicia sesión y compra 2 zapatillas rojas" --css tienda.webmcp.css --json` | [`output/recommender/plan.json`](./output/recommender/plan.json) |
| Web3-MCP | `webmcpcss web3 validate --file tienda.webmcp.css --connector wallet-connector.js` / `web3 deploy --export-sol` | [`output/web3/`](./output/web3/) |

## Con navegador (no incluido en `regen.sh`)

Sirve la tienda (`npx serve examples/v1`) y prueba los comandos que necesitan
una página real:

```bash
webmcpcss a11y audit --url http://localhost:3000/tienda.html --min-score 80
webmcpcss a11y fix --url http://localhost:3000/tienda.html -o a11y.webmcp.css --script a11y-fix.js
webmcpcss test run --url http://localhost:3000/tienda.html --file examples/v1/tienda.webmcp.css --execute --junit junit.xml
webmcpcss version snapshot --file examples/v1/tienda.webmcp.css --url http://localhost:3000/tienda.html
webmcpcss design validate --design examples/v1/output/design/design.json --css examples/v1/tienda.webmcp.css --url http://localhost:3000/tienda.html
webmcpcss retro proxy https://tienda-legacy.example --css legacy.webmcp.css --port 8080
webmcpcss retro inject https://tienda-legacy.example --css legacy.webmcp.css --browser
webmcpcss doc serve --file examples/v1/tienda.webmcp.css --port 3001
```

## Web3 con red real

`web3 balance`, `web3 pay` y `web3 deploy --contract` necesitan el peer
opcional `ethers` (`npm i ethers`) y una clave en `WEBMCP_WALLET_KEY`. No hay
restricción de red: cualquier `--network` conocido o `chainId` numérico vale;
los límites de gasto (`--max-tx`, `--max-session`, `--max-day`, `--allow-to`)
son la única barrera.

```bash
webmcpcss web3 balance --address 0x… --network base
webmcpcss web3 pay --to 0x… --amount 0.05 --currency USDC --network base --max-tx 0.1 --tool descargarInforme
webmcpcss web3 deploy --contract build/WebMCPPayments.json --network base --args 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
```

Los micropagos x402 (HTTP 402 → autorización USDC firmada → recurso) se ven en
[`docs/web3.md`](../../docs/web3.md) y en `tests/web3.test.ts`, que levanta un
servidor con `createPaymentGate` y paga con `X402Client`.
