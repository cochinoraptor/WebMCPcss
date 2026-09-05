# Primeros pasos

El **Component Hub** es un catálogo de componentes de interfaz *IA-First*: cada uno trae su HTML, su contrato `.webmcp.css` (qué puede hacer un agente con él) y metadatos (`component.json`). Existe en versión *core* (CSS puro) y adaptado a **Tailwind CSS**, **Bootstrap 5**, **Material UI** y **shadcn/ui**.

## Requisitos

- Node.js 18 o superior (usa `fetch` nativo).
- `npx webmcpcss` (no hace falta instalar nada globalmente) o `npm i -g webmcpcss`.

## 1. Explora el catálogo

```bash
npx webmcpcss components list
npx webmcpcss components list --category forms --library tailwind
npx webmcpcss components list --search "checkout" --json
```

La lista se descarga de `https://cochinoraptor.github.io/WebMCPcss/api/components.json`. Si no hay conexión, la CLI usa el catálogo incluido en el paquete npm (`--offline` fuerza ese modo). Puedes apuntar a otro hub con `--hub <url>` o la variable `WEBMCPCSS_HUB_URL`.

## 2. Importa un componente

```bash
npx webmcpcss components import tailwind-button-primary --output ./src/components
```

Se crea `./src/components/tailwind-button-primary/` con:

| Archivo | Para qué sirve |
| --- | --- |
| `button-primary.html` | Marcado listo para pegar (con `data-tool`, `aria-*`, atributos declarativos WebMCP). |
| `button-primary.webmcp.css` | Contrato para agentes: `webmcp-tool`, parámetros, intención, confirmación, permisos. |
| `component.json` | Metadatos: versión, controles del editor, ejemplos de prompt, relacionados. |
| `preview.css` | Solo si el componente lo necesita para la previsualización (no lo importes en producción). |

La importación se registra en `.webmcpcss/components.lock.json` (id, versión y hash) para poder actualizar después.

Si prefieres mantener un único `webmcp.css`, fusiona el contrato en él:

```bash
npx webmcpcss components import core-checkout-form --merge ./webmcp.css
```

El bloque queda delimitado por `/* @webmcpcss-component core-checkout-form v1.0.0 */ … /* @end webmcpcss-component core-checkout-form */` y se reemplaza al actualizar.

## 3. Sírvelo a los agentes

El `.webmcp.css` es la fuente de verdad. Con él puedes:

```bash
# Servidor MCP (stdio) para Claude, Cursor, Gemini CLI…
npx webmcpcss mcp --serve --css ./webmcp.css --url https://tu-sitio

# Estándar WebMCP del navegador: document.modelContext + atributos declarativos
npx webmcpcss standard compile ./webmcp.css --html ./index.html -o ./index.webmcp.html

# Exportar para un agente concreto
npx webmcpcss export ./webmcp.css --agent claude-code -o ./.claude
```

Añade `--hub` al servidor MCP para que los agentes también puedan **descubrir e importar** componentes del catálogo (`list_components`, `get_component`, `import_component`).

## 4. Mantén los componentes al día

```bash
npx webmcpcss components update --dry-run   # ¿qué ha cambiado?
npx webmcpcss components update             # descarga las versiones nuevas
```

## 5. Genera un sitio de demostración

```bash
npx webmcpcss components demo --output ./demo-site --library tailwind
```

Crea una página estática con varios componentes del hub, sus contratos y el runtime de animaciones, ideal para probar un agente de punta a punta.

## Siguiente paso

Lee [Uso de componentes](../component-usage/) para adaptar estilos y contratos a tu proyecto, o [Contribuir](../contributing/) para publicar los tuyos.
