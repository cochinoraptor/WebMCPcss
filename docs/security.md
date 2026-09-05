# Security-MCP (v1.0.0)

Permisos **por herramienta**, autenticación de agentes y auditoría del
contrato. Un sitio declara en su `.webmcp.css` qué puede hacer cada agente y
con qué credenciales; WebMCPcss lo hace cumplir al filtrar el contrato y al
autorizar cada invocación, y avisa cuando algo está mal declarado.

- Código: `src/security/index.ts`
- CLI: `webmcpcss security validate | token`
- Ejemplo: [`examples/v1/output/security/`](../examples/v1/output/security/) (`report.json`, `policies.webmcp.css`)

## Propiedades

| Propiedad            | Valores                                           | Significado                                              |
| -------------------- | ------------------------------------------------- | -------------------------------------------------------- |
| `webmcp-permissions` | `read-only` \| `restricted` \| `full`             | Nivel mínimo que debe tener el agente                    |
| `webmcp-requires`    | `none` \| `auth` \| `oauth` \| `jwt` \| `session` | Mecanismo de autenticación exigido (`auth` = cualquiera) |
| `webmcp-scope`       | `"orders:pay profile:write"`                      | Scopes OAuth/JWT necesarios                              |
| `webmcp-risk`        | `low` \| `medium` \| `high`                       | Riesgo declarado (por defecto se deriva del nivel)       |
| `webmcp-rate-limit`  | `"5/min"`, `"100/h"`, `"1000/day"`                | Límite de invocaciones                                   |

```css
#checkout {
  webmcp-tool: 'pagarPedido';
  webmcp-permissions: 'full';
  webmcp-requires: 'oauth';
  webmcp-scope: 'orders:pay';
  webmcp-rate-limit: '5/min';
  webmcp-confirmation: 'needed';
}
```

### Niveles

- **read-only**: buscar, filtrar, navegar, ver, leer, descargar. Sin autenticación por defecto.
- **restricted**: enviar, guardar, crear, editar, registrar, añadir, reservar, subir. Requiere autenticación.
- **full**: eliminar, pagar, comprar, transferir, cerrar cuenta y toda tool con `webmcp-payment`. Requiere autenticación, confirmación humana y suele llevar rate-limit.

Si una tool no declara `webmcp-permissions`, `inferPermissionLevel` lo deduce
del nombre, la descripción, la confirmación, el trigger y los parámetros; la
auditoría avisa (`missing-permissions`) para que se declare explícitamente.

## Autorización

```ts
import { security } from 'webmcpcss';

const agent = {
  id: 'bot-7',
  level: 'restricted',
  scopes: ['profile:write'],
  authenticatedBy: 'jwt',
};
security.authorizeTool('pagarPedido', tool, agent);
// { allowed: false, reasons: ['requiere nivel full; el agente tiene restricted', 'requiere oauth; el agente se autenticó con jwt'], requiresConfirmation: true }

const visible = security.filterToolMapForAgent(toolMap, agent); // solo lo autorizado (contexto intacto)
```

`authorizeTool` comprueba nivel, mecanismo (`requires`) y scopes (el scope `*`
concede todos). `requiresConfirmation` es `true` para `full`, riesgo `high` o
`webmcp-confirmation: "needed"`. Un agente `null` se evalúa como anónimo
`read-only`.

## Identidad del agente

```ts
// JWT HS256 sin dependencias
const token = security.createAgentToken(agent, process.env.WEBMCP_JWT_SECRET!, {
  ttlSeconds: 3600,
  issuer: 'tienda',
});
const verified = security.verifyJwt(token, secret, { issuer: 'tienda' }); // { ok, agent, claims } | { ok: false, error }

// Desde las cabeceras HTTP de una petición al servidor MCP/REST
const who = security.agentFromHeaders(req.headers, {
  secret, // Authorization: Bearer <jwt>
  sessionResolver: (cookie) => lookup(cookie), // cookie de sesión del sitio
  trustHeaders: true, // X-WebMCP-Agent / X-WebMCP-Level / X-WebMCP-Scopes (tras un gateway OAuth)
});
```

```bash
webmcpcss security token --agent "bot-7:restricted:profile:write" --secret "$WEBMCP_JWT_SECRET" --ttl 3600
```

## Auditoría

```bash
webmcpcss security validate --file tienda.webmcp.css
webmcpcss security validate --file tienda.webmcp.css --agent "bot:restricted:orders:pay" --json
webmcpcss security validate --file tienda.webmcp.css --suggest-output policies.webmcp.css
webmcpcss security validate --file tienda.webmcp.css --strict     # exit 1 si hay errores (CI)
```

| Hallazgo                                     | Severidad | Motivo                                                           |
| -------------------------------------------- | --------- | ---------------------------------------------------------------- |
| `invalid-permissions`                        | error     | Valor fuera de `read-only\|restricted\|full`                     |
| `underdeclared`                              | error     | Declarado `read-only` pero inferido `full` (p. ej. «borrarTodo») |
| `payment-without-auth`                       | error     | Tool de pago con `requires: none`                                |
| `missing-permissions`                        | warning   | Tool de escritura/destructiva sin nivel declarado                |
| `full-without-confirmation`                  | warning   | `full` sin `webmcp-confirmation: "needed"`                       |
| `write-without-auth`                         | warning   | Escritura sin autenticación                                      |
| `selector-inline-handler`                    | warning   | Selector basado en `onclick=`                                    |
| `no-scopes`, `no-rate-limit`, `all-inferred` | info      | Recomendaciones                                                  |

`score` (0-100) resta 15 por error, 6 por aviso y 1 por info. `suggestPolicies`
genera un **overlay** `.webmcp.css` parseable con permisos, `requires`, scopes,
confirmación y rate-limit sugeridos (corrigiendo lo subdeclarado y respetando
lo ya declarado).
