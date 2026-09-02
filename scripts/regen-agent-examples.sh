#!/usr/bin/env bash
# Regenera examples/agents/ desde examples/shopping-cart/webmcp.css.
set -euo pipefail
cd "$(dirname "$0")/.."
for f in mcp-config claude-code cursor crewai autogen langgraph browser-inject json-schema; do
  node dist/src/cli.js export examples/shopping-cart/webmcp.css \
    --format "$f" -o "examples/agents/$f" --url https://tienda.example.com
done
echo "Ejemplos regenerados en examples/agents/"
