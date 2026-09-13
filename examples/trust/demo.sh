#!/usr/bin/env bash
# Recorrido completo de la capa de confianza con la CLI (sin fondos reales).
# Requiere `npm run build` en la raíz del repo. Las consultas de identidad y
# saldo van contra Base Sepolia / Sui testnet reales (solo lectura).
set -euo pipefail
cd "$(dirname "$0")"
W="node ../../dist/src/cli.js"
OWNER_KEY=0x1111111111111111111111111111111111111111111111111111111111111111   # clave de prueba EVM
SUI_SEED=2222222222222222222222222222222222222222222222222222222222222222     # seed Ed25519 de prueba
rm -rf .webmcpcss

echo "── 1. Redes y políticas declaradas"
$W trust networks
$W trust policies --file shop.webmcp.css

echo; echo "── 2. Identidad ERC-8004 real en Base Sepolia (agente #1)"
$W trust verify-identity --agent "#1" --chain base --network base-sepolia || true

echo; echo "── 3. Prueba de permiso Sui (clave de sesión) y comprobación de 'tip'"
SUI_ADDR=$(node -e "const e=require('../../dist/src/trust/crypto/ed25519.js');console.log(e.suiAddressFromPublicKey(e.ed25519PublicKey(Buffer.from('$SUI_SEED','hex'))))")
$W trust sign-proof --agent "$SUI_ADDR" --scope tip --chain sui --network sui-testnet --key $SUI_SEED --ttl 600 --output proof-sui.json
$W trust check-permission --tool tip --file shop.webmcp.css --proof proof-sui.json --amount "1 USDC" \
  --target 0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC

echo; echo "── 4. Transferencia gasless en Sui (dry-run: bytes BCS a firmar)"
$W trust execute-gasless --chain sui --network sui-testnet \
  --tx "{\"kind\":\"transfer\",\"from\":\"$SUI_ADDR\",\"to\":\"0xabababababababababababababababababababababababababababababababab\",\"amount\":\"1 USDC\"}" --json | head -c 600; echo

echo; echo "── 5. Autorización EIP-3009 (x402) firmada para Base Sepolia"
$W trust execute-gasless --chain base --network base-sepolia --key $OWNER_KEY \
  --tx '{"kind":"transfer","to":"0x000000000000000000000000000000000000dEaD","amount":"0.5 USDC"}' --json | head -c 500; echo

echo; echo "── 6. Prueba EVM firmada por una clave que NO es el owner del agente #1 → denegado"
$W trust sign-proof --agent "#1" --scope purchase --chain base --network base-sepolia --key $OWNER_KEY --ttl 600 --output proof-evm.json
$W trust check-permission --tool purchase --file shop.webmcp.css --agent "#1" --proof proof-evm.json --amount "0.5 USDC" || true

echo; echo "── 7. Script para agentes de navegación"
$W trust inject --file shop.webmcp.css --api http://localhost:8090 --output trust-inject.js

echo; echo "── 8. Auditoría encadenada"
$W trust audit-log --verify
