#!/usr/bin/env bash
# Regenera examples/graph/{graph.json,graph.svg,vault} desde examples/graph/src/.
set -euo pipefail
cd "$(dirname "$0")/../.."
rm -rf examples/graph/vault
node dist/src/cli.js graph examples/graph/src \
  --fragility \
  --status-file examples/graph/src/status.json \
  --output examples/graph/graph.json \
  --svg examples/graph/graph.svg \
  --obsidian examples/graph/vault
echo "examples/graph/ regenerado"
