# Version-MCP (v1.0.0)

Un `.webmcp.css` cambia con el sitio: se renombran tools, se mueven
selectores, aparecen parámetros. Version-MCP **congela** el contrato en
snapshots, calcula un **diff semántico** (no textual) que clasifica el impacto
con SemVer y genera un **plan de migración** legible por agentes y aplicable
al contrato antiguo.

- Código: `src/versioning/index.ts`
- CLI: `webmcpcss version snapshot | diff | migrate`
- Ejemplo: [`examples/v1/output/versioning/`](../examples/v1/output/versioning/) (`v1.snapshot.json`, `v2.snapshot.json`, `diff.json`, `MIGRATION.md`, contrato migrado)

## Snapshots

```bash
webmcpcss version snapshot --file tienda.webmcp.css --tag 1.0.0 -o v1.snapshot.json
webmcpcss version snapshot --file tienda.webmcp.css --url https://tienda.test   # comprueba presencia y huellas
```

Cada snapshot guarda por tool: selector, descripción, parámetros, trigger,
confirmación, `meta` (permisos, pagos…) y un **hash** estable; con `--url`
añade `present` y `fingerprint` (`tag`, `text`, atributos) tomados de la
página real. El hash global permite saber de un vistazo si algo cambió.

## Diff semántico

```bash
webmcpcss version diff v1.snapshot.json v2.snapshot.json
webmcpcss version diff a.webmcp.css b.webmcp.css --json   # también acepta CSS directamente
```

| Cambio                                                                    | Impacto                     |
| ------------------------------------------------------------------------- | --------------------------- |
| `tool-removed`, `tool-renamed`, `param-removed`                           | **major**                   |
| `selector-changed` cuando el selector antiguo seguía existiendo           | major                       |
| `selector-changed` cuando el antiguo ya no existía (reparación)           | patch                       |
| `meta-changed` de permisos / pago                                         | major                       |
| `tool-added`, `param-added`, `context-added`, `context-changed` (formato) | **minor**                   |
| `description-changed`, `meta-changed` (otros), `context-removed`          | patch / minor según el caso |

Los **renombres** se detectan cuando una tool desaparece y otra aparece con el
mismo selector o la misma firma de parámetros (`buscarProductos` →
`buscarCatalogo`). El resultado incluye `impact`, `suggestedVersion`
(`bumpVersion`), `summary { added, removed, renamed, changed }` y la lista de
cambios con `detail`.

Salida real del ejemplo:

```
Impacto major · versión sugerida 2.0.0 · +2 −2 ~6 ↔1
```

## Migración

```bash
webmcpcss version migrate v1.snapshot.json v2.snapshot.json -o tienda.migrated.webmcp.css --notes MIGRATION.md
webmcpcss version migrate v1.snapshot.json v2.snapshot.json --url https://tienda.test   # verifica contra la página
```

`buildMigration(diff)` produce pasos (`rename-tool`, `drop-tool`,
`update-selector`, `add-param`, `drop-param`, `note`) y unas **notas para
agentes** en Markdown:

```markdown
# Migración WebMCP 1.0.0 → 2.0.0

Impacto: **major** · versión sugerida: **2.0.0**

- [rename-tool] Llama a "buscarCatalogo" en lugar de "buscarProductos".
- [drop-tool] La tool "descargarInforme" ya no existe; busca una alternativa en el nuevo contrato.
- [update-selector] Selector de "pagarPedido": #checkout → #checkout-now.
- [add-param] Nuevo parámetro "categoria" en "buscarProductos→buscarCatalogo".

> ⚠️ Cambios incompatibles: los agentes con contratos cacheados deben volver a leer el `.webmcp.css`.
```

`applyMigration(oldToolMap, plan, newSnapshot)` aplica los pasos al contrato
antiguo (renombra, elimina, actualiza selectores y parámetros, sincroniza el
contexto) y devuelve un tool map que coincide con la nueva versión.

## API

```ts
import { versioning } from 'webmcpcss';

const a = await versioning.createSnapshot(mapV1, { version: '1.0.0', page });
const b = await versioning.createSnapshot(mapV2, { version: '' });
const diff = versioning.diffSnapshots(a, b); // impact, suggestedVersion, changes
const plan = versioning.buildMigration(diff); // steps, agentNotes
const migrated = versioning.applyMigration(mapV1, plan, b);
const { present, missing } = await versioning.verifySnapshot(b, page);
```
