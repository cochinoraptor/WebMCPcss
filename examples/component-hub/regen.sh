#!/usr/bin/env bash
# Regenera examples/component-hub/ con el catálogo empaquetado (sin red).
# Ejecutar desde cualquier sitio tras `npm run build`: bash examples/component-hub/regen.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
CLI="node dist/src/cli.js"
OUT=examples/component-hub
rm -rf "$OUT/demo" "$OUT/imported" "$OUT/.webmcpcss" "$OUT/webmcp.css"

# 1. Sitio de demostración con los componentes Tailwind (index.html + webmcp.css unificado)
$CLI components demo --offline --library tailwind --output "$OUT/demo" > /dev/null
rm -f "$OUT/demo/webmcp-animation.js"   # runtime compilado (88 KB): se genera con `npm run build`

# 2. Importar dos componentes a un proyecto y fusionarlos en un webmcp.css con marcadores
(
  cd "$OUT"
  node ../../dist/src/cli.js components import shadcn-product-card core-pulse --offline \
    --output imported --merge webmcp.css > /dev/null
)

# 3. Listado en JSON (para agentes / CI)
$CLI components list --offline --library shadcn --json > "$OUT/list-shadcn.json"

# Salidas deterministas: elimina marcas de tiempo del lock
node -e "
  const fs=require('fs'); const p='$OUT/.webmcpcss/components.lock.json';
  const l=JSON.parse(fs.readFileSync(p,'utf8'));
  for (const c of Object.values(l.components)) c.installedAt='2026-09-05T00:00:00.000Z';
  fs.writeFileSync(p, JSON.stringify(l,null,2)+'\n');
"
echo "✔ examples/component-hub regenerado"
