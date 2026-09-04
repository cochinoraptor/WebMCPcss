# Estándar de animaciones de WebMCPcss (v0.8.0)

WebMCPcss permite declarar **animaciones avanzadas en CSS** —parallax, vistas
isométricas, transformaciones 3D, keyframes y escenas 2.5D con Three.js— con
las mismas propiedades personalizadas `webmcp-*` que ya usas para las
herramientas. Un agente (o el CLI) lee el archivo, valida que los selectores
existan, elige el motor más adecuado para el navegador y ejecuta las
animaciones **sin pisar** las que el sitio ya tenga (GSAP, Framer Motion,
Anime.js, animaciones CSS/WAAPI propias…).

- Guía de conflictos y convivencia con otras librerías: [animation-conflicts.md](./animation-conflicts.md)
- Referencia del CLI: [cli-animate.md](./cli-animate.md)
- Ejemplos listos para usar: [`examples/animation/`](../examples/animation/)

## Ejemplo mínimo

```css
/* animations.webmcp.css */
.hero .title {
  webmcp-animation: 'titleIn';
  webmcp-animation-type: keyframes;
  webmcp-animation-priority: high;
  webmcp-animation-duration: 900ms;
  webmcp-animation-keyframes: '[{"opacity":0,"transform":"translateY(24px)"},{"opacity":1,"transform":"none"}]';
}

#hero {
  webmcp-animation: 'heroParallax';
  webmcp-animation-type: parallax;
  webmcp-animation-layers:
    '.sky' 0.1,
    '.mountains' 0.4,
    '.ground' 0.75;
}
```

```bash
# Aplica las animaciones en un navegador headless y guarda una captura
webmcpcss animate animations.webmcp.css --url https://mi-sitio.test --screenshot hero.png

# Solo planifica (sin tocar la página) e informa de conflictos
webmcpcss animate animations.webmcp.css --url https://mi-sitio.test --dry-run
```

## Propiedades

Toda regla con `webmcp-animation` (o `webmcp-animation-name`) declara una
animación. El **selector de la regla** es el elemento objetivo, salvo que se
indique `webmcp-animation-selector`. Se admiten anidamiento CSS (`&`),
`var()` en el selector y en los valores, y `@import`.

| Propiedad                      | Valores                                                         | Descripción                                                     |
| ------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------- |
| `webmcp-animation`             | `"nombre"`                                                      | Identificador único (`[A-Za-z_][\w-]*`).                        |
| `webmcp-animation-type`        | `parallax` `isometric` `3d-transform` `keyframes` `three-scene` | Tipo (por defecto `keyframes`).                                 |
| `webmcp-animation-priority`    | `low` `normal` `high` `critical`                                | Orden de ejecución y peso en conflictos (por defecto `normal`). |
| `webmcp-animation-selector`    | selector CSS                                                    | Objetivo explícito (si difiere del selector de la regla).       |
| `webmcp-animation-engine`      | `auto` `css` `waapi` `three`                                    | Fuerza un motor. Por defecto se elige según capacidades.        |
| `webmcp-animation-trigger`     | `load` `scroll` `visible` `hover` `manual`                      | Cuándo arrancar (parallax implica `scroll`).                    |
| `webmcp-animation-conflict`    | `replace` `queue` `ignore` `merge`                              | Estrategia ante conflictos de esta animación.                   |
| `webmcp-animation-sandbox`     | `none` `shadow`                                                 | Aísla la escena Three.js en Shadow DOM.                         |
| `webmcp-animation-params`      | JSON                                                            | Parámetros completos (ver tabla siguiente).                     |
| `webmcp-animation-keyframes`   | JSON (array de fotogramas)                                      | Atajo de `params.keyframes`.                                    |
| `webmcp-animation-layers`      | `"sel" velocidad [profundidad], …` o JSON                       | Capas de parallax.                                              |
| `webmcp-animation-scene`       | JSON                                                            | Configuración de la escena Three.js (`params.sceneConfig`).     |
| `webmcp-animation-fallback`    | `"otraAnimacion"` o JSON inline                                 | Alternativa si el motor no está disponible o no hay elementos.  |
| `webmcp-animation-description` | texto                                                           | Documentación para agentes.                                     |

Atajos de parámetros: `-duration`, `-delay`, `-easing`, `-iterations`
(`número` o `infinite`), `-direction`, `-fill`, `-perspective`,
`-rotation-x`, `-rotation-y`, `-rotation-z`, `-translation-z`, `-scale`,
`-scroll-container`. Los atajos **tienen prioridad** sobre el JSON de
`webmcp-animation-params`.

### Parámetros (`AnimationConfig.parameters`)

| Campo                  | Tipo                                 | Uso                                                             |
| ---------------------- | ------------------------------------ | --------------------------------------------------------------- |
| `duration` / `delay`   | `"900ms"`, `"1.2s"` o número (ms)    | Tiempos (por defecto 1000 ms / 0).                              |
| `easing`               | timing-function CSS                  | Por defecto `ease`.                                             |
| `iterations`           | número o `"infinite"`                |                                                                 |
| `direction` / `fill`   | valores CSS                          | `fill` por defecto `forwards`.                                  |
| `layers`               | `LayerConfig[]`                      | Parallax: `{ selector, speed (0–1), depth? }`.                  |
| `perspective`          | longitud                             | `3d-transform` (p. ej. `900px`).                                |
| `rotationX/Y/Z`        | ángulo                               | Isométrico (defecto `60deg`/`-45deg`) y 3D (`rotationY` 25deg). |
| `translationZ`         | longitud                             | 3D.                                                             |
| `scale`                | número                               | Isométrico y 3D.                                                |
| `keyframes`            | `Record<string, string \| number>[]` | Fotogramas (`offset` y `easing` opcionales por fotograma).      |
| `sceneConfig`          | `ThreeSceneConfig`                   | Escena 2.5D (ver más abajo).                                    |
| `scrollContainer`      | selector                             | Contenedor con scroll propio para parallax.                     |
| `respectReducedMotion` | booleano (defecto `true`)            | Con `prefers-reduced-motion` aplica el estado final estático.   |

## Tipos de animación

### `parallax`

Cada capa se desplaza según el scroll: `translateY = scroll × (1 − speed)`.
`speed 0` deja la capa "fija" al fondo; `speed 1` la mueve con el contenido.
Requiere `layers`. Motores: `css` (listener de scroll + `translate3d`,
universal), `waapi` (`ScrollTimeline`, Chrome 115+, solo si se fuerza) y
`three` (convierte las capas en una escena WebGL).

### `isometric`

Anima de `transform: none` a `rotateX(rx) rotateZ(rz) [scale(s)]` con
`transform-style: preserve-3d`. Defectos: `60deg` / `-45deg`.

### `3d-transform`

Compone `perspective() rotateX() rotateY() rotateZ() translateZ() scale()`
con los atajos indicados. Si no se indica ninguno, gira `rotateY(25deg)` y se
emite un aviso en la validación.

### `keyframes`

Fotogramas arbitrarios. Con WAAPI se usan tal cual (camelCase o kebab-case);
con CSS se genera un `@keyframes` y una clase inyectados en un `<style
data-webmcp-animations>`.

### `three-scene`

Monta un canvas WebGL con planos apilados en Z que reaccionan al ratón y/o al
scroll. Three.js **no** es dependencia del paquete: se usa `window.THREE` si
existe o se importa `sceneConfig.moduleUrl` (por defecto
`https://unpkg.com/three@0.160.0/build/three.module.js`). Requiere WebGL;
si no está disponible se ejecuta el `fallback`.

```jsonc
{
  "camera": "orthographic" | "perspective",
  "viewHeight": 10,               // unidades de mundo visibles en vertical
  "interaction": "mouse" | "scroll" | "both" | "none",
  "background": "transparent" | "#101010",
  "moduleUrl": "/vendor/three.module.js",
  "maxPixelRatio": 2,
  "layers": [
    { "color": "#1d4ed8", "position": { "x": 0, "y": 0, "z": -4 },
      "size": { "width": 30, "height": 14 }, "parallax": 0.2, "spin": 0.4 },
    { "image": "/img/trees.png", "position": { "z": -1 }, "parallax": 0.9 }
  ]
}
```

## Selección de motor

| Tipo           | Orden en modo `auto`      | Requisito                              |
| -------------- | ------------------------- | -------------------------------------- |
| keyframes      | `waapi` → `css`           | `Element.animate` para WAAPI           |
| isometric / 3d | `waapi` → `css`           |                                        |
| parallax       | `css` → `waapi` → `three` | `ScrollTimeline` / WebGL si se fuerzan |
| three-scene    | `three`                   | WebGL (si no, `fallback`)              |

`--type` en el CLI (o `engine` en la API) fuerza un motor para todas las
animaciones; si el motor no soporta la animación el resultado es `failed`
con el motivo (o se usa el `fallback`).

## Accesibilidad

Si el usuario tiene `prefers-reduced-motion: reduce`, los motores aplican el
estado final de forma estática (sin movimiento) y las escenas Three.js se
renderizan sin animar. Puede desactivarse por animación con
`"respectReducedMotion": false` en `webmcp-animation-params`.

## API de Node

```ts
import {
  parseAnimationsFile,
  validateAnimations,
  animateWithPage, // Puppeteer
  animateInWindow, // DOM local (jsdom o el propio navegador)
  buildRuntimeScript,
} from 'webmcpcss';

const map = parseAnimationsFile('animations.webmcp.css');
const result = await animateWithPage(page, map, {
  strategy: 'queue',
  engine: 'auto',
  dryRun: false,
  screenshot: true,
});
console.log(result.message, result.result?.outcomes);
```

`ExecuteResult` incluye el `plan` (motor previsto por animación), la
`validation` (selectores, capas, conflictos previstos, capacidades del
navegador), el `result` de la orquestación (`executed`, `queued`, `ignored`,
`failed`, `dry-run` por animación) y, opcionalmente, `screenshotBase64`.

## Runtime en el navegador

`webmcpcss animate archivo.css` **sin `--url`** genera
`webmcp-animation/webmcpcss-animation.js` (≈85 KB, sin dependencias) junto a
`animations.json` y un `index.html` de ejemplo:

```html
<script src="webmcpcss-animation.js"></script>
<script>
  fetch('animations.json')
    .then((r) => r.json())
    .then((map) => webmcpcss.animation.run(map, { strategy: 'queue' }));
</script>
```

API de `window.webmcpcss.animation`: `run(map, options)`, `plan(map)`,
`validate(map)`, `registerExternal(id, elementos | selector, propiedades,
{ library, priority })`, `releaseExternal(id)`, `active()`, `stop(nombre)`,
`stopAll()`, `detectCapabilities()`, `detectLibraries()` y la clase
`AnimationOrchestrator` para usos avanzados.

## Herramienta MCP `webmcpcss_animate`

El servidor `webmcpcss mcp --serve` expone la herramienta
`webmcpcss_animate` (desactivable con `--no-animate`):

```json
{
  "name": "webmcpcss_animate",
  "arguments": {
    "animationFile": "animations.webmcp.css",
    "url": "https://mi-sitio.test",
    "strategy": "queue",
    "engine": "auto",
    "dryRun": false,
    "screenshot": true
  }
}
```

También acepta `css` inline en lugar de `animationFile`. Por HTTP:
`POST /api/animate` con el mismo cuerpo. La captura se devuelve como
contenido `image` (PNG en base64).

## Historial

Cada ejecución (no dry-run) se registra en el historial de WebMCPcss con
`type: "animate"` (animaciones, resultado por animación y estrategia), visible
en `webmcpcss history` y en el dashboard.
