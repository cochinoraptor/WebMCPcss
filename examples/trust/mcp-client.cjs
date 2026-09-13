/**
 * Uso de las herramientas MCP trust_* por stdio (Claude Code, Cursor…):
 * envía initialize + tools/call trust_verify_identity y trust_get_policies.
 *   node examples/trust/mcp-client.cjs
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const cli = path.join(__dirname, '..', '..', 'dist', 'src', 'cli.js');
const server = spawn('node', [cli, 'mcp', '--serve', '--css', path.join(__dirname, 'shop.webmcp.css'), '--no-prompt', '--no-animate'], { stdio: ['pipe', 'pipe', 'inherit'] });
const send = (msg) => server.stdin.write(JSON.stringify(msg) + '\n');
let buf = '';
server.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const res = JSON.parse(line);
    const text = res.result?.content?.[0]?.text;
    console.log(`← id ${res.id}:`, text ? JSON.parse(text) : res.result);
    if (res.id === 3) server.kill();
  }
});
send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'trust_get_policies', arguments: {} } });
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'trust_verify_identity', arguments: { agentId: '#1', chain: 'base', network: 'base-sepolia' } } });
