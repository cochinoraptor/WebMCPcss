# Registro de auditoría

Cada acción que pasa por la capa de confianza —permitida, denegada o fallida—
se registra en un **log append-only encadenado por hash**: cada entrada incluye
`prevHash` (hash de la anterior) y `hash = keccak256(JSON canónico de la
entrada)`. Modificar, borrar o reordenar una entrada rompe la cadena.

## Entrada

```jsonc
{
  "id": "m1abc-12",
  "timestamp": 1789340906046,
  "agentId": "eip155:84532:0x8004A818…BD9e#7",
  "action": "purchase",                 // herramienta o trust_execute_gasless
  "result": "ok",                        // ok | denied | failed
  "reason": "rate-limit: 6/5 por minute",// si denied/failed
  "amount": "0.5 USDC",
  "txHash": "0x…",                       // hash EVM o digest Sui
  "chain": "base", "network": "base-sepolia",
  "proofHash": "0x…",                    // keccak de la prueba de permiso usada
  "meta": { "txMode": "gasless" },
  "prevHash": "0x…",
  "hash": "0x…",
  "anchor": "0x…"                        // referencia on-chain (opcional)
}
```

Por defecto se escribe en `.webmcpcss/trust-audit.jsonl` (una línea JSON por
entrada). `AuditLogger({ file: null })` mantiene el log solo en memoria.

## Consultar

```bash
# Últimas 20 entradas, más recientes primero
webmcpcss trust audit-log
# Filtrar por agente, limitar y verificar la integridad de toda la cadena
webmcpcss trust audit-log --agent "#7" --limit 50 --verify [--json]
```

MCP: `trust_get_audit_log { agentId?, limit?, action?, result?, verify? }`.
REST: `GET /api/trust/audit?agentId=…&limit=…&verify=1`.

Respuesta: `{ count, head, integrity?: { ok, entries, brokenAt?, reason? }, entries }`.

## Verificar integridad

`AuditLogger.verify()` recorre la cadena desde el génesis
(`0x000…000`), recalcula cada hash y comprueba `prevHash`. Devuelve
`{ ok: false, brokenAt, reason: 'hash alterado' | 'prevHash no coincide' }` si
alguien tocó el archivo. El campo `meta.anchorError` (añadido si el anclaje
on-chain falla) se excluye del cálculo para no romper la cadena por un fallo de
red.

## Anclaje on-chain

Con un adaptador y `anchorMode`:

| Modo     | Qué ancla                                              |
| -------- | ------------------------------------------------------ |
| `never`  | nada (por defecto sin adaptador)                       |
| `tx`     | solo entradas con `txHash` (por defecto con adaptador) |
| `always` | todas                                                  |

`ChainAdapter.registerAuditLog(entry)` devuelve la referencia:

- EVM con `WEBMCP_TRUST_AUDIT_CONTRACT` (+ clave): envía
  `anchor(bytes32 hash, uint256 timestamp)` y devuelve el `txHash`;
  recomendable en SKALE (gas gratuito) o vía ERC-4337 patrocinado.
- Sin contrato: devuelve el keccak local (la entrada sigue siendo verificable
  off-chain).

Un contrato mínimo:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract WebMCPAudit {
    event Anchored(address indexed reporter, bytes32 indexed hash, uint256 timestamp);
    function anchor(bytes32 hash, uint256 timestamp) external {
        emit Anchored(msg.sender, hash, timestamp);
    }
}
```

## Qué NO se registra

Claves privadas, firmas completas de las pruebas (solo su `proofHash`),
cabeceras `X-PAYMENT` ni parámetros de la herramienta. Si necesitas trazar
parámetros, añádelos a `meta` desde una regla personalizada del `PolicyEngine`
o envolviendo `AuditLogger.log`.

## API

```ts
import { trust } from 'webmcpcss';

const audit = new trust.AuditLogger({ file: '.webmcpcss/trust-audit.jsonl', anchor, anchorMode: 'tx' });
await audit.log({ agentId: '#7', action: 'purchase', result: 'ok', txHash: '0x…', amount: '0.5 USDC' });
audit.query({ agentId: '#7', result: 'denied', since: Date.now() - 86_400_000, limit: 10 });
audit.verify();  // { ok: true, entries: 42 }
audit.head;      // último hash
```
