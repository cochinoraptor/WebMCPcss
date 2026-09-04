# Convivencia y resolución de conflictos de animaciones

El orquestador de WebMCPcss está diseñado para trabajar en sitios que **ya
tienen animaciones**: transiciones y `@keyframes` propios, WAAPI, GSAP,
Framer Motion, Anime.js, Velocity, Lottie, AOS, ScrollMagic, Three.js…
Nunca sobrescribe una propiedad que otra animación esté controlando, salvo
que la animación declarada tenga **prioridad mayor** y la estrategia lo
permita.

## Qué es un conflicto

Dos animaciones entran en conflicto cuando coinciden en **al menos un
elemento** y **al menos una propiedad CSS animada**. El resolutor
(`ConflictResolver`) mantiene un registro por elemento (`data-webmcp-el`) con
las propiedades que cada animación controla:

- **Propias**: las que el orquestador ha ejecutado (`source: "webmcpcss"`).
- **Externas** (`source: "external"`): detectadas automáticamente antes de
  cada ejecución o registradas a mano con `registerExternal()`.

### Detección automática de externas

Antes de ejecutar, el orquestador inspecciona los elementos objetivo:

| Origen                 | Cómo se detecta                                                                                                            | Propiedades registradas                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `@keyframes` del sitio | `getComputedStyle(el).animationName ≠ none`                                                                                | Las declaradas en el `@keyframes` (si se puede leer) o `all` |
| Transiciones           | `transition-property` con duración > 0                                                                                     | Las de `transition-property`                                 |
| WAAPI ajenas           | `el.getAnimations()` sin el prefijo `webmcpcss:`                                                                           | Las de sus keyframes (`all` si no son legibles)              |
| GSAP                   | `el._gsap` / `window.gsap`                                                                                                 | `transform`, `opacity` (`all` si no se sabe)                 |
| Librerías globales     | `window.gsap`, `anime`, `Motion`/`framer-motion`, `Velocity`, `lottie`, `ScrollMagic`, `AOS`, `THREE`, `popmotion`, `mojs` | Solo informativo (`capabilities.libraries`)                  |

Las externas se registran con prioridad `high` por defecto, así que una
animación `normal` nunca las pisa.

## Estrategias

| Estrategia | Comportamiento                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `replace`  | Detiene la animación en conflicto (propia: `stop`; externa CSS/WAAPI: `cancel` + `animation-name: none`) y ejecuta la nueva.                                                                     |
| `queue`    | La nueva espera a que termine la actual y entonces se ejecuta (se re-evalúan los conflictos al salir de la cola).                                                                                |
| `ignore`   | La nueva no se ejecuta; el resultado es `ignored` con el motivo.                                                                                                                                 |
| `merge`    | Ambas conviven si las propiedades son **componibles** (`transform`, `translate`, `rotate`, `scale`, `opacity`); con WAAPI se usa `composite: "add"`. Si no son componibles se degrada a `queue`. |

La estrategia se decide, de mayor a menor precedencia, por: el argumento
`strategyOverride` de `run()`, la propiedad `webmcp-animation-conflict` de la
animación y la opción global (`--conflict-strategy`, por defecto `queue`).

## Flujo de decisión

```
nueva animación N frente a las activas A que comparten elemento + propiedad
│
├─ sin solapamiento ................................... execute
│
├─ prioridad(N) > prioridad(A) ......................... replace
│     (propia → stop; externa → cancel/neutralizar)
│
├─ prioridad(N) < prioridad(A)
│     ├─ estrategia ignore / replace ................... ignore
│     └─ estrategia queue / merge
│           ├─ A es externa (no sabemos cuándo acaba) .. ignored
│           └─ A es propia ............................. queue (hasta que A termine)
│
└─ prioridad(N) == prioridad(A) ........................ según estrategia
      replace → replace · queue → queue · ignore → ignore
      merge   → merge si componible, si no queue
```

Prioridades: `critical` > `high` > `normal` > `low`. Las animaciones se
ejecutan siempre en ese orden (y, a igualdad, en orden de declaración), de
modo que las críticas reservan primero sus propiedades.

## Ejemplos

### Respetar una animación de GSAP

```html
<script>
  gsap.to('#card-2', { rotationY: 180, duration: 2, repeat: -1 });
</script>
```

```css
#card-2 {
  webmcp-animation: 'flipCard';
  webmcp-animation-type: 3d-transform;
  webmcp-animation-conflict: queue;
}
```

Resultado: `flipCard: ignored — conflicto con animaciones externas
(gsap@…)`. GSAP sigue controlando `transform`. Si el agente necesita
imponerse, declara `webmcp-animation-priority: critical` (o `high` con
`replace`): el resolutor libera el registro y la animación se ejecuta
encima (GSAP no se puede cancelar desde fuera; visualmente gana la última
escritura en cada fotograma, por eso se recomienda `registerExternal` +
detener GSAP desde el propio sitio en ese caso).

### Sustituir una animación CSS del sitio

```css
/* sitio */ .badge { animation: sitePulse 1s infinite; }
/* webmcp */ #badge { webmcp-animation: "badgePop"; webmcp-animation-priority: critical; … }
```

`badgePop` (critical) > `sitePulse` (externa, high) → `replace`: se cancela la
`CSSAnimation`, se fuerza `animation-name: none !important` en el elemento
para que la regla del sitio no la reinicie y se ejecuta `badgePop`.

### Dos animaciones propias sobre el mismo elemento

```css
#c1 {
  webmcp-animation: 'a';
  webmcp-animation-keyframes: '[{"opacity":0},{"opacity":1}]';
}
#c1 {
  webmcp-animation: 'b';
  webmcp-animation-keyframes: '[{"opacity":0.5},{"opacity":1}]';
}
```

Con la estrategia por defecto (`queue`), `b` se ejecuta cuando `a` termina.
Con `merge`, como `opacity` es componible, ambas conviven (`composite: add`
en WAAPI). Con `replace`, `b` detiene a `a`.

## Registrar animaciones externas a mano

Cuando el sitio anima con JavaScript sin dejar rastro detectable (por
ejemplo `requestAnimationFrame` propio), regístralo para que el orquestador
lo respete:

```js
webmcpcss.animation.registerExternal(
  'hero-rAF', // id
  '#hero .title', // elementos o selector
  ['transform', 'opacity'],
  { library: 'custom', priority: 'high' },
);
// … y libéralo cuando termine:
webmcpcss.animation.releaseExternal('hero-rAF');
```

En Node (Puppeteer) puedes hacer lo mismo con
`page.evaluate(() => webmcpcss.animation.registerExternal(...))` antes de
`animateWithPage`, o pasar `detectExternal: false` si prefieres desactivar
por completo la detección.

## Simular conflictos sin tocar la página

```bash
webmcpcss animate animations.webmcp.css --url https://mi-sitio.test --dry-run --json
```

El informe de validación (`validation.conflicts`) enumera cada conflicto
previsto con la acción que se tomaría:

```json
{
  "animation": "flipCard",
  "conflictsWith": "gsap@wa7",
  "properties": ["transform"],
  "action": "queue"
}
```

y las `capabilities` del navegador (`waapi`, `webgl`, `scrollTimeline`,
`shadowDom`, `reducedMotion`, `libraries`). La misma información está
disponible desde la API con `validateAnimations(map, window)` y desde el
runtime con `webmcpcss.animation.validate(map)`.

## Sandbox

`webmcp-animation-sandbox: shadow` monta las escenas Three.js dentro de un
Shadow DOM propio, de forma que sus estilos y su canvas no interfieran con el
CSS del sitio. Las animaciones CSS/WAAPI actúan sobre los elementos reales
(no tendría sentido aislarlas), pero sus reglas viven en un único `<style
data-webmcp-animations>` con clases prefijadas `webmcp-anim-*` que se
eliminan al detener la animación (`stop` / `stopAll`).
