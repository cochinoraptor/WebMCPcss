# Contribuir al Component Hub

Aceptamos componentes nuevos, adaptadores a otras librerías y mejoras de los existentes. Todo el contenido es MIT.

## Publicar desde la CLI (recomendado)

```bash
export GITHUB_TOKEN=ghp_…   # token con permiso repo (nunca lo guardes en el repo)
npx webmcpcss components publish ./mi-boton.webmcp.css \
  --name "Botón de reserva" --category buttons --library tailwind \
  --html ./mi-boton.html --description "Reserva una mesa con confirmación" --tags reserva,cta
```

La CLI valida el CSS (`parseWebMCP` + `parseAnimations`), genera `component.json`, hace fork del repositorio, crea la rama `hub/<id>-…`, sube los archivos a `components/community/<id>/` y abre un Pull Request. Si no indicas `--html`, se genera un ejemplo mínimo a partir de los selectores del contrato.

## Publicar a mano

1. Crea `components/community/<library>-<slug>/` con `component.json`, `<slug>.webmcp.css` y `<slug>.html`.
2. Ejecuta `npm run build:hub` para regenerar `site/components/` y `site/api/components.json`.
3. Ejecuta `npm test` y abre el PR.

## Requisitos de un componente

- **Id** en kebab-case con el prefijo de la librería: `tailwind-pricing-table`, `core-toast`.
- **Descripción** ≥ 15 caracteres que explique la acción para un agente, no solo el aspecto.
- Al menos una **herramienta** (`webmcp-tool`), **contexto** (`webmcp-context`) o **animación** (`webmcp-animation`).
- Cada herramienta con `webmcp-description`, `webmcp-intent`, `webmcp-confirmation` y `webmcp-permissions`.
- Selectores basados en `data-*` (no en clases de estilo).
- HTML accesible: etiquetas en los campos, `aria-*` donde toque, objetivo táctil ≥ 44 px.
- Sin dependencias de pago ni recursos externos obligatorios (los CDN de Tailwind/Bootstrap se usan solo para la previsualización).

### `component.json`

```json
{
  "id": "tailwind-pricing-table",
  "name": "Pricing Table",
  "category": "cards",
  "library": "tailwind",
  "version": "1.0.0",
  "description": "Tabla de precios con tres planes; la herramienta choosePlan selecciona uno.",
  "tags": ["pricing", "plans"],
  "controls": [
    { "variable": "--wm-primary", "label": "Color primario", "type": "color", "default": "#2563eb" }
  ],
  "promptExamples": ["resalta el plan Pro"],
  "animateExamples": ["haz que los planes aparezcan en cascada"],
  "related": ["core-pricing-table"]
}
```

Categorías válidas: `buttons`, `cards`, `forms`, `layout`, `animations`, `intelligent`. Librerías: `core`, `tailwind`, `bootstrap`, `mui`, `shadcn`.

## Versionado

Cada componente tiene su propia versión SemVer. Sube **patch** si cambias estilos, **minor** si añades herramientas o parámetros compatibles y **major** si renombras herramientas o cambias selectores. El `hash` del índice permite a `components update` detectar cualquier cambio.

## Revisión

Un mantenedor comprueba que el contrato es coherente con el HTML (`webmcpcss standard scan`), que `npm run build:hub -- --check` pasa en CI y que la previsualización funciona en el sitio. Gracias por contribuir.
