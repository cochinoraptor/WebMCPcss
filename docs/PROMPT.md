# Modificación de sitios con lenguaje natural (v0.7.0)

`webmcpcss prompt` convierte una orden en español o inglés en una acción
estructurada, localiza el elemento en la página y la ejecuta (o solo la
muestra, en modo _dry-run_). La misma capacidad se expone como herramienta
MCP `webmcpcss_prompt` y como API de librería (`PromptManager`).

```bash
# Interpretar sin tocar nada (dry-run por defecto)
webmcpcss prompt "cambia el color del botón Añadir al carrito a verde" \
  --url https://mi-tienda.com --css webmcp.css

# Ejecutar y guardar evidencia
webmcpcss prompt "sube esta imagen en la foto de perfil" \
  --url https://mi-sitio.com/perfil --image ./foto.png --execute --screenshot despues.png
```

Funciona **sin ningún LLM** (intérprete heurístico incorporado) y mejora la
comprensión cuando configuras Ollama, OpenAI o Anthropic. No añade
dependencias al paquete: usa `fetch` nativo, una tabla MIME propia y `fs`.

## Cómo funciona

```
prompt ─► 1. Interpretar ─► 2. Localizar ─► 3. Ejecutar ─► 4. Evidencia + historial
            (LLM o            (progresivo)     (DOM o
             heurística)                        herramienta WebMCPcss)
```

1. **Interpretar** (`src/prompt/interpreter.ts`). El LLM recibe el system
   prompt _"Eres un asistente que traduce comandos en lenguaje natural a
   acciones estructuradas para modificar un sitio web…"_ junto con el
   contexto de la página (título, candidatos interactivos y herramientas
   del `.webmcp.css`) y devuelve un JSON `PromptAction`. La respuesta se
   normaliza y valida; si no hay LLM configurado, falla o devuelve algo
   inválido, actúa el intérprete heurístico ES/EN.
2. **Localizar** (`src/prompt/element-finder.ts`). Estrategias en orden,
   cada una con su confianza:
   `selector` explícito → `tool` (herramienta WebMCPcss que coincide con la
   descripción) → `llm` (el modelo propone un selector que se verifica) →
   `text` (texto visible, `<label>`, `placeholder`, `aria-label`, `name`) →
   `vision` (puntuación semántica de `src/core/vision.ts`, la misma de la
   auto-reparación) → `probe` (selectores típicos por tipo de elemento:
   carrusel, popup, buscador, anuncio…). Si nada supera el umbral, el
   resultado incluye **sugerencias** para que pidas más especificidad.
3. **Ejecutar** (`src/prompt/action-executor.ts`). Si el elemento pertenece a
   una herramienta del `.webmcp.css`, `click`/`fill`/`other` la ejecutan a
   través de `WebMCPcss.execute()` (con auto-reparación incluida); el resto
   de acciones mutan el DOM mediante `DomMutator` (implementado por
   `PuppeteerAdapter` y `DomAdapter`).
4. **Evidencia e historial**. El resultado incluye instantánea del elemento
   antes/después, captura opcional y un `log` por fase; cada ejecución se
   registra en `.webmcpcss/history.json` (tipo `prompt`, visible en el
   dashboard).

## Acciones soportadas

| Acción        | Ejemplos de orden                                              | Efecto                                                                                   |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `upload`      | "sube esta imagen al carrusel", "upload the PDF to the form"   | Resuelve el archivo (ruta, URL, `data:`) y lo asigna al `input[type=file]` del elemento  |
| `changeColor` | "cambia el color del botón a verde", "pon el fondo #0f172a"    | `background-color` en botones/contenedores, `color` en textos (o la propiedad indicada)  |
| `delete`      | "elimina el popup de cookies", "remove all the ads"            | `element.remove()` (con `all` → todos los que coincidan)                                 |
| `hide`        | "oculta el header", "hide the banner"                          | `display: none`                                                                          |
| `move`        | "mueve el precio debajo del botón", "move the logo to the top" | Reubica el nodo `before`/`after`/`inside`/`start` respecto a otro elemento (o `x,y`)     |
| `click`       | "haz clic en Añadir al carrito", "click Accept"                | Herramienta WebMCPcss si existe; si no, `click()` sobre el elemento                      |
| `fill`        | "escribe DESCUENTO10 en el cupón", "pon la cantidad en 3"      | Resuelve el campo (por `<label>`, placeholder, name…) y escribe el valor                 |
| `setText`     | "cambia el título a \"Oferta de verano\""                      | Sustituye el texto del elemento                                                          |
| `setStyle`    | "haz el título más grande", "pon el precio en negrita"         | Estilos de una **lista blanca** (color, fuente, tamaño, bordes, espaciado, visibilidad…) |
| `other`       | "suscribe newsletter con ana@mail.com", cualquier herramienta  | Ejecuta la herramienta WebMCPcss nombrada con los argumentos deducidos                   |

Formato de la acción interpretada:

```json
{
  "action": "changeColor",
  "target": "botón Añadir al carrito",
  "parameters": { "color": "green" },
  "confidence": 0.8,
  "source": "heuristic"
}
```

## CLI

```
webmcpcss prompt "<orden>" --url <url|archivo.html> [opciones]

  --css <file>            .webmcp.css: permite delegar en sus herramientas
  --image <file...>       imagen(es) a subir (ruta local, URL http(s) o data-URI)
  --file <file...>        archivo(s) a subir
  --text <texto>          valor a escribir (si no va dentro de la orden)
  --llm <provider>        ollama | openai | anthropic (def.: WEBMCP_LLM_PROVIDER)
  --model <modelo>        llama3, gpt-4o-mini, claude-3-5-haiku-latest…
  --llm-base-url <url>    endpoint del proveedor (ej. http://localhost:11434)
  --execute               aplica la acción (sin esta opción: dry-run)
  --dry-run               fuerza solo interpretación
  --screenshot <png>      captura tras ejecutar
  -o, --output <json>     guarda el PromptResult completo
  --json                  imprime SOLO el JSON en stdout (para scripts)
  --no-headless           muestra el navegador
```

Salida típica:

```
ℹ Acción: changeColor → botón Añadir al carrito [heuristic, confianza 0.80]
    color: green
ℹ Elemento: [data-product] .btn-add (vía tool, 0.50) · herramienta addToCart · "Añadir al carrito"
✔ background-color = green en 1 elemento(s) ([data-product] .btn-add)
ℹ Captura: despues.png
```

El comando termina con código `1` si la acción no pudo interpretarse,
localizarse o ejecutarse; el JSON (`--json`/`-o`) incluye `suggestions` con
alternativas cuando el elemento es ambiguo.

## Configuración del LLM (opcional)

Solo variables de entorno; nunca se leen claves de archivos del repositorio.

| Variable                   | Descripción                                      | Por defecto                 |
| -------------------------- | ------------------------------------------------ | --------------------------- |
| `WEBMCP_LLM_PROVIDER`      | `ollama`, `openai`, `anthropic` o `none`         | ninguno (heurística)        |
| `WEBMCP_OLLAMA_MODEL`      | Modelo local de Ollama                           | `llama3`                    |
| `WEBMCP_OLLAMA_BASE_URL`   | Endpoint de Ollama                               | `http://localhost:11434`    |
| `WEBMCP_OPENAI_API_KEY`    | Clave de OpenAI (obligatoria con `openai`)       | —                           |
| `WEBMCP_OPENAI_MODEL`      | Modelo de OpenAI                                 | `gpt-4o-mini`               |
| `WEBMCP_OPENAI_BASE_URL`   | Endpoint compatible con OpenAI                   | `https://api.openai.com/v1` |
| `WEBMCP_ANTHROPIC_API_KEY` | Clave de Anthropic (obligatoria con `anthropic`) | —                           |
| `WEBMCP_ANTHROPIC_MODEL`   | Modelo de Anthropic                              | `claude-3-5-haiku-latest`   |
| `WEBMCP_LLM_TIMEOUT_MS`    | Tiempo máximo por petición                       | `60000`                     |

```bash
# Ollama local
export WEBMCP_LLM_PROVIDER=ollama WEBMCP_OLLAMA_MODEL=llama3
webmcpcss prompt "quita todos los anuncios" --url https://noticias.test --execute

# OpenAI puntual por línea de comandos
WEBMCP_OPENAI_API_KEY=sk-… webmcpcss prompt "move the logo to the top" \
  --url https://mi-sitio.com --llm openai --model gpt-4o-mini
```

Sin `WEBMCP_LLM_PROVIDER` el proveedor se infiere: si hay
`WEBMCP_OPENAI_API_KEY` → `openai`; si hay `WEBMCP_ANTHROPIC_API_KEY` →
`anthropic`; Ollama solo se activa implícitamente si defines
`WEBMCP_OLLAMA_MODEL` o `WEBMCP_OLLAMA_BASE_URL` (evita esperar a un
servidor local inexistente). Si el LLM no responde a tiempo o devuelve JSON
inválido se usa la heurística y `action.source` indica `heuristic`.

## Herramienta MCP `webmcpcss_prompt`

`webmcpcss mcp --serve` expone, junto a las herramientas del `.webmcp.css`,
la herramienta `webmcpcss_prompt` (desactívala con `--no-prompt`):

```json
{
  "name": "webmcpcss_prompt",
  "arguments": {
    "prompt": "sube esta imagen al carrusel",
    "url": "https://mi-sitio.com",
    "files": ["/ruta/foto.png"],
    "dryRun": false,
    "screenshot": true
  }
}
```

La respuesta es el `PromptResult` en JSON (`isError: true` si falló). En
modo HTTP (`--http`) el mismo contrato está en `POST /api/prompt`.

## API de librería

```ts
import puppeteer from 'puppeteer';
import {
  parseWebMCPFile,
  PuppeteerAdapter,
  PromptManager,
  createLlmClient,
} from 'webmcpcss';

const page = await (await puppeteer.launch()).newPage();
await page.goto('https://mi-tienda.com');

const manager = new PromptManager(new PuppeteerAdapter(page), {
  toolMap: parseWebMCPFile('webmcp.css'), // opcional
  llm: createLlmClient(), // null si no hay variables de entorno → heurística
});

const result = await manager.run('escribe "DESCUENTO10" en el cupón', {
  historyFile: false, // o ruta al historial
});
console.log(result.success, result.action, result.match?.selector, result.outcome);
```

Piezas exportadas: `PromptManager`, `runPrompt`, `interpretPrompt`,
`interpretHeuristically`, `ElementFinder`, `ActionExecutor`, `AssetManager`,
`createLlmClient`, `resolveLlmConfig`, `sanitizeStyles`, `isSafeColor` y
todos los tipos (`PromptAction`, `PromptResult`, `ElementMatch`, …).

## Seguridad y límites

- **Dry-run por defecto**: sin `--execute` (o con `dryRun: true`) no se
  modifica nada.
- **Acciones acotadas**: solo las de la tabla; `setStyle` acepta una lista
  blanca de propiedades CSS y los colores se validan (`isSafeColor`); no se
  inyecta HTML ni JavaScript arbitrario.
- **Archivos**: rutas locales, URLs `http(s)` y `data:`; límite de 25 MB
  (configurable con `assetOptions.maxBytes`), MIME detectado por extensión
  o cabecera y temporales eliminados al terminar.
- **URLs**: el navegador solo abre `http(s)://` o archivos locales
  existentes; las herramientas WebMCPcss ejecutadas conservan sus propias
  validaciones.
- **Auditoría**: cada ejecución queda en `.webmcpcss/history.json` con
  prompt, acción, selector, resultado y duración.
- **Credenciales**: solo por variables de entorno (`WEBMCP_*_API_KEY`);
  nunca se escriben en disco ni se muestran en la salida.

## Ejemplo completo

En [`examples/prompt/`](../examples/prompt/README.md) hay un script que
recorre la tienda de demostración (`examples/shopping-cart`) con varias
órdenes: cambiar colores, rellenar campos por etiqueta, mover elementos,
ocultar/eliminar y subir un archivo, generando capturas de cada paso.

## Desde agentes (v0.9.0)

`prompt` está disponible en todas las integraciones generadas por
`webmcpcss export`:

| Integración  | Cómo se invoca                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- |
| MCP genérico | herramienta `webmcpcss_prompt` (`webmcpcss mcp --serve`) / `POST /api/prompt`                   |
| Claude Code  | `/webmcpcss:prompt "<orden>"` — interpreta en seco, pide confirmación y ejecuta con `--execute` |
| Cursor       | herramienta `webmcpcss_prompt` del servidor registrado en `~/.cursor/mcp.json`                  |
| DeerFlow     | `browser_prompt(prompt, execute=False)` → mensaje estructurado `{"type": "webmcp_prompt"}`      |
| Flomny       | `execute_prompt` del servidor dedicado (`webmcpcss mcp --serve --flomny`)                       |

Ver [docs/agents/](./agents/) para instalar cada una.
