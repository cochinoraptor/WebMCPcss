# Design-to-WebMCP (v1.0.0)

De un diseño —captura/mockup, archivo de Figma o una descripción en texto— a
un `.webmcp.css` y un HTML de andamiaje con selectores estables. Cuando el
sitio ya está implementado, `design validate` comprueba que la implementación
respeta el diseño (elementos presentes, posiciones y textos) y
`design optimize` afina el contrato para que los agentes lo entiendan mejor.

- Código: `src/design-to-webmcp/` (`analyzer.ts`, `generator.ts`, `validator.ts`, `optimizer.ts`)
- CLI: `webmcpcss design analyze | validate | optimize`
- Ejemplo: [`examples/v1/output/design/`](../examples/v1/output/design/)

## Flujo

```
imagen / Figma / texto ──▶ analyzer ──▶ DesignStructure (elementos, cajas, intents)
                                          │
                                          ├─▶ generator ──▶ .webmcp.css + scaffold.html + mapping
                                          │
                                          └─▶ validator (con la URL real) ──▶ ok / missing / moved / relabeled
.webmcp.css cualquiera ──▶ optimizer ──▶ sugerencias + contrato optimizado + puntuación IA-friendly
```

### Fuentes de análisis

| Fuente             | Cómo                                                                                                                                                                                    | Requisitos        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Imagen (`--image`) | Con `--llm` se envía la imagen a un modelo con visión (OpenAI/Anthropic/Ollama) que devuelve elementos y cajas; sin LLM se leen dimensiones y se genera una estructura vacía con avisos | PNG/JPEG/GIF/WebP |
| Figma (`--figma`)  | REST API de Figma (`FIGMA_TOKEN`); los nodos se clasifican por nombre/tipo (`Button/…`, `Input Email`, `Form`, `Nav`, `Card`), el nombre de campo sale del nombre de capa               | Token personal    |
| Texto (`--text`)   | Heurística ES/EN: detecta formularios, campos, botones, enlaces, tarjetas y precios en la descripción; con `--llm` se refina                                                            | —                 |

Cada elemento tiene `id`, `kind` (`button|input|select|checkbox|link|form|card|nav|hero|list|price|text|other`),
`label`, `intent`, `parent`, `box`, `fieldName` y `confidence` (0-1).

## CLI

```bash
# Analizar
webmcpcss design analyze --image mockup.png --llm openai -o design.webmcp.css --scaffold scaffold.html --design-json design.json
webmcpcss design analyze --figma https://www.figma.com/file/XXXX/Tienda -o design.webmcp.css
webmcpcss design analyze --text "Buscador con botón Buscar, tarjeta de producto con precio y botón Añadir al carrito" -o design.webmcp.css

# Validar el sitio implementado contra el diseño
webmcpcss design validate --design design.json --css design.webmcp.css --url https://tienda.test
webmcpcss design validate --design design.webmcp.css --url https://tienda.test   # solo presencia/etiquetas

# Optimizar un contrato existente
webmcpcss design optimize tienda.webmcp.css                   # informa
webmcpcss design optimize tienda.webmcp.css -o tienda.opt.css # aplica
```

### Qué comprueba `design validate`

| Estado      | Significado                                                           |
| ----------- | --------------------------------------------------------------------- |
| `ok`        | El selector existe y (si hay caja) está donde el diseño indica        |
| `missing`   | El selector no existe en la página                                    |
| `moved`     | Existe pero su posición difiere más del umbral (relativo al viewport) |
| `relabeled` | Existe pero el texto visible no coincide con la etiqueta del diseño   |

Devuelve `score` (0-100) y una lista de `checks` por herramienta.

### Qué sugiere `design optimize`

- Nombres de tool en `camelCase` verbales (`buscar` → `buscarProductos`)
- Descripciones accionables cuando faltan o son ambiguas
- Selectores frágiles (`div > div:nth-child(3)`, clases hash) → `data-tool`
- `webmcp-confirmation: "needed"` para acciones de pago/eliminación
- `webmcp-format` de contextos (`currency`, `number`, `date`) por nombre y selector
- Puntuación `scoreBefore` / `scoreAfter` (`iaFriendlyScore`)

## API

```ts
import { design } from 'webmcpcss';

const structure = await design.analyzeDescription(
  'Formulario de login con email y contraseña',
);
const { toolMap, css, scaffoldHtml, mapping, warnings } =
  design.generateFromDesign(structure);

const result = await design.validateDesign(
  toolMap,
  probe,
  structure,
  'https://tienda.test',
);
// probe = { probe(selector) → { exists, box, text }, viewport?() } (Puppeteer o cualquier DOM)

const opt = design.optimizeToolMap(toolMap, { apply: true });
// opt.suggestions, opt.toolMap, opt.css, opt.scoreBefore, opt.scoreAfter
```

`analyzeImage(path, llm)` y `analyzeFigma(fileRef, token, fetchImpl)` aceptan
las dependencias por inyección para poder probarse sin red.
