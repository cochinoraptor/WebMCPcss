#!/usr/bin/env bash
# Regenera las salidas de examples/v1/ con los comandos v1.0.0 (sin navegador,
# sin red y sin LLM). Ejecutar desde cualquier sitio: bash examples/v1/regen.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
CLI="node dist/src/cli.js"
CSS=examples/v1/tienda.webmcp.css
OUT=examples/v1/output
rm -rf "$OUT" examples/v1/ia-first-project
mkdir -p "$OUT"

# 1. IA-First Framework
$CLI init examples/v1/ia-first-project --name "Tienda IA-First" --url https://tienda.test > /dev/null
$CLI assist "crea un formulario de contacto con nombre, email y mensaje" -o "$OUT/assist-contacto" > /dev/null

# 2. Design-to-WebMCP (desde una descripción textual)
$CLI design analyze --text "Página de tienda con buscador (campo texto y botón Buscar), tarjeta de producto con precio y botón Añadir al carrito, botón Pagar pedido y formulario de contacto con email y mensaje" \
  -o "$OUT/design/design.webmcp.css" --scaffold "$OUT/design/scaffold.html" --design-json "$OUT/design/design.json" > /dev/null
$CLI design optimize "$CSS" -o "$OUT/design/tienda.optimized.webmcp.css" > /dev/null

# 3. Retro-WebMCP (escaneo del fixture legacy, local)
$CLI retro scan tests/fixtures/legacy-site.html -o "$OUT/retro/legacy.webmcp.css" > /dev/null
$CLI retro scan tests/fixtures/legacy-site.html --json > "$OUT/retro/scan.json"

# 4. A11y-MCP: workflow de CI (la auditoría necesita navegador; ver README)
mkdir -p "$OUT/a11y"
node -e "const {buildA11yWorkflow}=require('./dist/src/a11y'); process.stdout.write(buildA11yWorkflow({urls:['https://tienda.test'],minScore:85}))" > "$OUT/a11y/webmcp-a11y.yml"

# 5. Test-MCP
$CLI test generate --file "$CSS" --url https://tienda.test --execute -o "$OUT/testing/webmcp.spec.ts" > /dev/null
$CLI test generate --file "$CSS" --url https://tienda.test --framework cypress -o "$OUT/testing/webmcp.cy.js" > /dev/null
$CLI test generate --file "$CSS" --url https://tienda.test --json > "$OUT/testing/plan.json"

# 6. Version-MCP
$CLI version snapshot --file "$CSS" --tag 1.0.0 -o "$OUT/versioning/v1.snapshot.json" > /dev/null
$CLI version snapshot --file examples/v1/tienda.v2.webmcp.css --tag 2.0.0 -o "$OUT/versioning/v2.snapshot.json" > /dev/null
$CLI version diff "$OUT/versioning/v1.snapshot.json" "$OUT/versioning/v2.snapshot.json" --json > "$OUT/versioning/diff.json"
$CLI version migrate "$OUT/versioning/v1.snapshot.json" "$OUT/versioning/v2.snapshot.json" \
  -o "$OUT/versioning/tienda.migrated.webmcp.css" --notes "$OUT/versioning/MIGRATION.md" > /dev/null

# 7. Doc-MCP
$CLI doc generate --file "$CSS" --title "Tienda de ejemplo" --url https://tienda.test -o "$OUT/doc" > /dev/null

# 8. Security-MCP
mkdir -p "$OUT/security" "$OUT/web3"
$CLI security validate --file "$CSS" --agent "bot:restricted:orders:pay" --json > "$OUT/security/report.json"
$CLI security validate --file "$CSS" --suggest-output "$OUT/security/policies.webmcp.css" > /dev/null

# 9. Recommender-MCP (historial local vacío, sin LLM)
mkdir -p "$OUT/recommender"
$CLI recommend "inicia sesión y compra 2 zapatillas rojas" --css "$CSS" --url https://tienda.test --json > "$OUT/recommender/plan.json"

# 10. Web3-MCP
$CLI web3 validate --file "$CSS" --connector "$OUT/web3/wallet-connector.js" --json > "$OUT/web3/validate.json" 2> /dev/null
$CLI web3 deploy --export-sol "$OUT/web3/WebMCPPayments.sol" > /dev/null

# 11. Estándar WebMCP (v1.1.0): .webmcp.css → API declarativa y viceversa
mkdir -p "$OUT/standard"
$CLI standard compile "$CSS" --html examples/v1/tienda.html -o "$OUT/standard/tienda.declarative.html" --script "$OUT/standard/webmcp-declarative.js" > /dev/null
$CLI standard compile "$CSS" --json > "$OUT/standard/compile.json"
$CLI standard scan "$OUT/standard/tienda.declarative.html" -o "$OUT/standard/from-declarative.webmcp.css" > /dev/null 2>&1
$CLI generate --api "$CSS" -o "$OUT/standard/webmcp-tools.js" > /dev/null

# Elimina marcas de tiempo para que la salida sea determinista.
node - "$OUT" <<'JS'
const fs = require('fs'), path = require('path');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
for (const f of walk(process.argv[2])) {
  const src = fs.readFileSync(f, 'utf8');
  const out = src.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '2026-01-01T00:00:00.000Z');
  if (out !== src) fs.writeFileSync(f, out);
}
JS
echo "examples/v1/ regenerado"
