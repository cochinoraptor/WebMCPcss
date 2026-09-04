# `webmcpcss animate`

Aplica un archivo de animaciones `.webmcp.css` sobre una página en un
navegador headless (Puppeteer), o genera el runtime autocontenido para
incluirlo en tu sitio.

```
webmcpcss animate <animation-file> [opciones]
```

## Opciones

| Opción                             | Descripción                                                                                      | Por defecto          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------- |
| `--url <url>`                      | URL o ruta local de la página. Sin `--url` se genera el runtime en `--output`.                   | —                    |
| `-o, --output <ruta>`              | Con `--url`: archivo JSON con el resultado. Sin `--url`: carpeta del runtime.                    | `./webmcp-animation` |
| `--type <motor>`                   | Fuerza el motor: `css`, `waapi` o `three`.                                                       | `auto`               |
| `--conflict-strategy <estrategia>` | `replace`, `queue`, `ignore` o `merge` (ver [animation-conflicts.md](./animation-conflicts.md)). | `queue`              |
| `--dry-run`                        | Planifica y valida sin modificar la página.                                                      | `false`              |
| `--sandbox`                        | Aísla las animaciones en un shadow root (`webmcp-animation-sandbox: shadow` global). v0.9.0.     | `false`              |
| `--screenshot <archivo.png>`       | Captura tras aplicar las animaciones.                                                            | —                    |
| `--settle <ms>`                    | Espera antes de la captura.                                                                      | `600`                |
| `--json`                           | Salida JSON en stdout (para agentes/CI).                                                         | `false`              |
| `--no-headless`                    | Muestra el navegador.                                                                            | headless             |

Código de salida `0` si todas las animaciones se ejecutaron (o se encolaron
según lo previsto) y `1` si la validación falla, alguna animación falla o no
se pudo abrir la página.

## Ejemplos

### Aplicar y capturar

```bash
webmcpcss animate examples/animation/animations.webmcp.css \
  --url examples/animation/index.html \
  --screenshot hero.png -o resultado.json
```

```
WebMCPcss · animate
ℹ Plan (7 animación(es), por prioridad):
    badgePop [keyframes, critical] → waapi #badge · transform · queue
    titleIn [keyframes, high] → waapi .hero .title · opacity, transform · queue
    heroParallax [parallax, normal] → css #hero · transform · queue
    …
ℹ Conflictos previstos (2):
    badgePop ⇄ css:sitePulse@wa9 [transform] → replace · prioridad critical > high
    flipCard ⇄ gsap@wa7 [transform] → queue · prioridad normal < high
ℹ Navegador: waapi=true webgl=true scrollTimeline=true reducedMotion=false · librerías: GSAP 3.12.5
✔ badgePop: keyframes ejecutada con waapi sobre 1 elemento(s) (sustituyendo css:sitePulse@wa9)
✔ titleIn: keyframes ejecutada con waapi sobre 1 elemento(s)
✔ heroParallax: parallax ejecutada con css sobre 3 elemento(s)
✔ isoCard: isometric ejecutada con waapi sobre 1 elemento(s)
⚠ flipCard: Ignorada para no pisar animaciones externas (gsap@wa7)
✔ depthScene: three-scene ejecutada con three sobre 1 elemento(s)
✔ cardIn: keyframes ejecutada con waapi sobre 1 elemento(s)
✔ 6 executed, 1 ignored · captura en hero.png
```

### Simular (dry-run) para ver plan y conflictos

```bash
webmcpcss animate animations.webmcp.css --url https://mi-sitio.test --dry-run --json
```

```jsonc
{
  "dryRun": true,
  "success": true,
  "plan": [
    { "name": "badgePop", "engine": "waapi", "priority": "critical", "trigger": "load" },
    "…",
  ],
  "validation": {
    "ok": true,
    "capabilities": {
      "waapi": true,
      "webgl": true,
      "scrollTimeline": true,
      "libraries": ["gsap"],
    },
    "conflicts": [
      {
        "animation": "badgePop",
        "conflictsWith": "css:sitePulse@wa9",
        "properties": ["opacity"],
        "action": "replace",
      },
      {
        "animation": "flipCard",
        "conflictsWith": "gsap@wa7",
        "properties": ["transform"],
        "action": "queue",
      },
    ],
    "entries": [
      {
        "name": "heroParallax",
        "exists": true,
        "matches": 1,
        "engine": "css",
        "errors": [],
        "warnings": [],
      },
      "…",
    ],
  },
  "result": {
    "outcomes": [{ "name": "badgePop", "status": "dry-run", "engine": "waapi" }, "…"],
  },
  "message": "[dry-run] 7 animación(es) planificadas",
}
```

### Forzar motor y estrategia

```bash
# Todo por CSS inyectado (máxima compatibilidad) y sustituyendo lo que haya
webmcpcss animate animations.webmcp.css --url https://mi-sitio.test --type css --conflict-strategy replace

# Solo WAAPI: las animaciones que WAAPI no soporte fallan (o usan su fallback)
webmcpcss animate animations.webmcp.css --url https://mi-sitio.test --type waapi
```

### Generar el runtime para el sitio (sin navegador)

```bash
webmcpcss animate animations.webmcp.css -o ./public/webmcp-animation
```

Crea:

- `webmcpcss-animation.js` — runtime sin dependencias (`window.webmcpcss.animation`).
- `animations.json` — el mapa parseado.
- `index.html` — ejemplo de carga (`webmcpcss.animation.run(map, { strategy })`).

Inclúyelo en tu página:

```html
<script src="/webmcp-animation/webmcpcss-animation.js"></script>
<script>
  fetch('/webmcp-animation/animations.json')
    .then((r) => r.json())
    .then((map) => webmcpcss.animation.run(map, { strategy: 'queue' }));
</script>
```

## Uso desde el servidor MCP

```bash
webmcpcss mcp --serve --css tools.webmcp.css --url https://mi-sitio.test
```

Registra la herramienta `webmcpcss_animate` (además de las herramientas del
`.webmcp.css` y de `webmcpcss_prompt`). Con `--http` también responde en
`POST /api/animate`:

```bash
curl -X POST http://localhost:8090/api/animate \
  -H 'Content-Type: application/json' \
  -d '{"animationFile":"animations.webmcp.css","strategy":"merge","dryRun":true}'
```

Respuestas: `200` resultado, `422` error de ejecución/validación, `404` si el
servidor se lanzó con `--no-animate`, `400` JSON inválido.

## Requisitos

- Node 18+ y Chrome/Chromium para Puppeteer (`npx puppeteer browsers install chrome`
  si no se descargó al instalar).
- Para `three-scene`: WebGL en el navegador (en headless suele estar
  disponible con SwiftShader) y acceso a Three.js (`window.THREE` o
  `moduleUrl`). Sin WebGL se usa el `fallback` declarado.
- El comando no instala dependencias nuevas: el runtime se construye a partir
  del propio paquete compilado.

## `webmcpcss validate-conflicts` (v0.9.0)

```
webmcpcss validate-conflicts <animation-file> --url <url> [--conflict-strategy <s>] [--type <motor>] [--sandbox] [--strict] [-o informe.json] [--json]
```

Valida el archivo contra la página y **simula** los conflictos con las
animaciones existentes sin ejecutar nada. Código de salida `1` si hay errores
bloqueantes o, con `--strict`, si se prevé algún conflicto. Detalles e
informe en [conflict-resolution.md](./conflict-resolution.md).
