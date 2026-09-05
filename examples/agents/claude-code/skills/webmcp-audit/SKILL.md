---
name: webmcp-audit
description: Audita la fragilidad de los selectores de un .webmcp.css (hashes de CSS Modules, Vue scoped, styled-components, nth-child…) y propone alternativas estables. Úsala cuando el usuario pida revisar, auditar o robustecer un archivo .webmcp.css, o cuando validate reporte selectores rotos de forma recurrente.
allowed-tools:
  - Bash
  - Read
  - Write
---

# Auditoría de fragilidad de selectores WebMCP

## Cuándo usar esta skill

- El usuario pide "revisar", "auditar" o "hacer robusto" un `.webmcp.css`.
- `/webmcpcss:validate` falla repetidamente tras cada despliegue del sitio.
- Antes de publicar un `.webmcp.css` en el proxy comunitario.

## Procedimiento

1. Genera el grafo con análisis de fragilidad:
   ```bash
   webmcpcss graph examples/shopping-cart/webmcp.css --fragility --output /tmp/webmcp-graph.json
   ```
2. Lee `/tmp/webmcp-graph.json` y, para cada nodo `selector`, revisa
   `metadata.fragility`: `level` (low/medium/high), `reasons`,
   `suggestions` y `framework` detectado.
3. Presenta una tabla: selector · nivel · framework · motivo principal ·
   sugerencia. Ordena por gravedad (high primero).
4. Para cada selector `high`, propón un reemplazo concreto siguiendo el
   orden de preferencia: `[data-tool]`/`[data-testid]` → `#id`
   semántico → `[name]`/`[aria-label]` → clase semántica propia.
5. Si el usuario acepta, edita el `.webmcp.css` (o pide al equipo del
   sitio añadir los atributos) y añade `webmcp-fingerprint` a las
   herramientas críticas para que `webmcpcss repair` pueda re-localizarlas.
6. Termina validando: `webmcpcss validate https://tienda.example.com examples/shopping-cart/webmcp.css`.

## Salida opcional

- Vault Obsidian navegable: `webmcpcss graph examples/shopping-cart/webmcp.css --obsidian ./vault`
- Dashboard interactivo con filtros por framework: `webmcpcss graph examples/shopping-cart/webmcp.css --dashboard`
