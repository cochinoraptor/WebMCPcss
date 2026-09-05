# Ejemplo: Component Hub (v1.2.0)

Salidas reales de `webmcpcss components …` generadas **sin red** con el catálogo
empaquetado (`--offline`). Regenerables con `bash examples/component-hub/regen.sh`
(tras `npm run build`) y comprobadas en CI.

| Ruta | Comando | Qué es |
| --- | --- | --- |
| `demo/` | `components demo --library tailwind` | Sitio de demostración: `index.html` con los 10 componentes Tailwind, `webmcp.css` unificado y `components/<id>/` |
| `imported/` + `webmcp.css` | `components import shadcn-product-card core-pulse --output imported --merge webmcp.css` | Componentes importados a un proyecto y contrato fusionado con marcadores `@webmcpcss-component` |
| `.webmcpcss/components.lock.json` | (lo escribe `import`) | Lock con id, versión, hash y archivos; `components update` lo compara con el hub |
| `list-shadcn.json` | `components list --library shadcn --json` | Salida JSON para agentes/CI |

Pruébalo con un agente:

```bash
npx serve examples/component-hub/demo            # http://localhost:3000
npx webmcpcss mcp --serve --http --hub --css examples/component-hub/demo/webmcp.css --url http://localhost:3000
curl 'http://localhost:8090/api/components?library=tailwind&category=forms'
```

Sitio público: <https://cochinoraptor.github.io/WebMCPcss/components/> ·
Índice: <https://cochinoraptor.github.io/WebMCPcss/api/components.json> ·
Guía: [docs/hub.md](../../docs/hub.md).
