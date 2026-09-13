/**
 * Cliente de ejemplo para agentes autónomos (DeerFlow, Flomny, n8n…):
 * 1. consulta las políticas, 2. verifica el permiso y obtiene un token de
 * confianza, 3. ejecuta la herramienta reutilizando el token.
 *
 * Arranca antes el servidor:
 *   webmcpcss mcp --serve --css examples/trust/shop.webmcp.css --http -p 8090 --trust
 * y firma una prueba Sui:
 *   webmcpcss trust sign-proof --agent <addr> --scope tip --chain sui --network sui-testnet --key <seed> --output proof-sui.json
 */
import { readFileSync } from 'node:fs';

const API = process.env.WEBMCP_API ?? 'http://localhost:8090';
const proof = JSON.parse(readFileSync(new URL('./proof-sui.json', import.meta.url), 'utf8'));

const policies = await (await fetch(`${API}/api/trust/policies`)).json();
console.log('políticas:', policies.policies.map((p) => `${p.tool} (${p.auth}/${p.payment}/${p.chain})`));

const verify = await fetch(`${API}/api/trust/verify`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ tool: 'tip', proof, amount: '1 USDC' }),
});
const verdict = await verify.json();
console.log('verify →', verify.status, verdict.allowed ? `permitido · restante ${verdict.remainingLimit}` : `${verdict.code}: ${verdict.reason}`);
if (!verdict.allowed) process.exit(1);

const call = await fetch(`${API}/api/call`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Trust-Token': verdict.trustToken.token },
  body: JSON.stringify({ tool: 'tip', args: { amount: 1 } }),
});
console.log('call →', call.status, JSON.parse((await call.json()).content[0].text));

const audit = await (await fetch(`${API}/api/trust/audit?verify=1&limit=3`)).json();
console.log('audit →', audit.integrity, audit.entries.map((e) => `${e.action}:${e.result}`));
