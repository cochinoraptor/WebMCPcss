# Resolución de conflictos de animación (referencia v0.9.0)

Referencia técnica del subsistema que permite que las animaciones declaradas
con `webmcp-animation-*` **convivan** con las que ya tiene el sitio (GSAP,
Framer Motion, Anime.js, transiciones y `@keyframes` propios). La guía de
uso con ejemplos está en [animation-conflicts.md](./animation-conflicts.md);
esta página documenta el modelo, los módulos y la CLI.

## Módulos

| Módulo                               | Responsabilidad                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `src/animation/conflict-resolver.ts` | Registro de animaciones activas por elemento y decisión (`replace` / `queue` / `ignore` / `merge`)             |
| `src/animation/orchestrator.ts`      | Cola por prioridad (`critical > high > normal > low`), detección y registro de externas, sandbox, ejecución    |
| `src/animation/validators.ts`        | Validación estática y contra DOM, **simulación en seco** de conflictos e informe (`AnimationValidationReport`) |
| `src/animation/executor.ts`          | Puente Puppeteer/DOM: inyecta el runtime, ejecuta `plan` / `runAll` y devuelve el resultado serializado        |

## Qué es un conflicto

Dos animaciones entran en conflicto cuando actúan **sobre el mismo elemento**
y **sobre alguna propiedad CSS común** (`transform`, `opacity`, `filter`,
`background-color`…). El resolutor compara la animación entrante con las
registradas (propias o externas) y decide una acción.

## Estrategias

| Estrategia | Efecto                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `replace`  | Cancela la animación en conflicto y aplica la nueva                                                         |
| `queue`    | Espera a que termine la existente (o a su siguiente iteración) y después aplica la nueva                    |
| `ignore`   | No aplica la nueva; la existente se respeta                                                                 |
| `merge`    | Combina ambas si sus propiedades son **componibles** (p. ej. `opacity` + `transform`); si no, cae a `queue` |

Se fijan por animación con `webmcp-animation-conflict` o globalmente con
`--conflict-strategy` (por defecto `queue`).

## Flujo de decisión

1. **Prioridad mayor** que la existente → `replace` (o `merge` si las
   propiedades son componibles y la estrategia es `merge`).
2. **Prioridad menor** → `queue` o `ignore` según la estrategia (nunca pisa
   una animación más prioritaria).
3. **Misma prioridad** → estrategia declarada (`webmcp-animation-conflict`) o
   la global.

Las animaciones **externas** detectadas (GSAP, Framer Motion, Anime.js,
WAAPI, `@keyframes`/transiciones del sitio) se registran con prioridad
`high` por defecto (`externalPriority`), de modo que una animación `normal`
nunca las rompe y una `critical` puede sustituirlas de forma explícita.

## Simulación en seco e informe

`validateAnimations(map, window?, options)` devuelve:

```ts
interface AnimationValidationReport {
  entries: AnimationValidationEntry[]; // por animación: exists, count, engine, errors, warnings
  conflicts: PredictedConflict[]; // animation, conflictsWith, properties, action, reason
  capabilities?: BrowserCapabilities; // waapi, webgl, scrollTimeline, reducedMotion, libraries
  ok: boolean; // sin errores bloqueantes
}
```

Sin `window` solo se validan las reglas estáticas (tipo ↔ parámetros). Con
un DOM (navegador o jsdom) comprueba selectores, motor compatible,
`prefers-reduced-motion` y **predice los conflictos** registrando primero las
externas en un `ConflictResolver` de simulación.

## CLI

### `validate-conflicts` (nuevo en v0.9.0)

```bash
webmcpcss validate-conflicts <animation-file> --url <url> [opciones]

  --conflict-strategy <s>   replace | queue | ignore | merge (def. queue)
  --type <engine>           forzar motor: css | waapi | three
  --sandbox                 simula con aislamiento en shadow root
  --strict                  código de salida 1 también si hay conflictos previstos
  -o, --output <file>       guarda el informe JSON
  --json                    imprime SOLO el JSON del informe
```

Abre la página, inyecta el runtime, construye el plan y ejecuta la
validación **sin aplicar nada**. Código de salida `1` si el informe tiene
errores bloqueantes (selector inexistente, sin motor compatible) o, con
`--strict`, si hay conflictos previstos — útil en CI.

Informe (`--json` / `-o`):

```json
{
  "file": "hero.webmcp.css",
  "url": "https://mi-sitio.com",
  "ok": true,
  "strategy": "queue",
  "plan": [
    {
      "name": "flipCard",
      "priority": "normal",
      "engine": "waapi",
      "strategy": "queue",
      "properties": ["transform"]
    }
  ],
  "entries": [
    {
      "name": "flipCard",
      "selector": "#card-2",
      "exists": true,
      "count": 1,
      "compatible": true,
      "errors": [],
      "warnings": []
    }
  ],
  "conflicts": [
    {
      "animation": "flipCard",
      "conflictsWith": "gsap@wa7",
      "properties": ["transform"],
      "action": "queue",
      "reason": "prioridad normal < high"
    }
  ],
  "capabilities": {
    "waapi": true,
    "webgl": true,
    "scrollTimeline": true,
    "reducedMotion": false,
    "libraries": [{ "name": "GSAP", "version": "3.12.5" }]
  },
  "external": [{ "id": "gsap@wa7", "library": "gsap", "priority": "high" }]
}
```

### `animate`

`animate --dry-run` produce el mismo informe junto al plan; `animate` sin
`--dry-run` ejecuta y devuelve por animación `executed` / `queued` /
`ignored` / `failed` con su `resolution`. Opciones relevantes:

- `--conflict-strategy <s>` — estrategia global.
- `--sandbox` (v0.9.0) — aísla las animaciones en un **shadow root**
  (equivale a `webmcp-animation-sandbox: shadow` en todas las reglas): las
  clases y `@keyframes` inyectados no pueden colisionar con el CSS del sitio.
  Sin `--url`, el loader `index.html` del runtime generado también pasa
  `sandbox: "shadow"`.

## API

```ts
import {
  ConflictResolver,
  AnimationOrchestrator,
  validateAnimations,
  parseAnimationsFile,
} from 'webmcpcss';

const map = parseAnimationsFile('hero.webmcp.css');
const report = validateAnimations(map, window, { strategy: 'merge' });
if (report.ok) {
  const orchestrator = new AnimationOrchestrator(window, {
    strategy: 'merge',
    sandbox: 'shadow',
  });
  orchestrator.registerExternal(
    'mi-slider',
    document.querySelectorAll('.slide'),
    ['transform'],
    'high',
  );
  await orchestrator.runAll(map);
}
```

En el navegador, el runtime expone lo mismo bajo `window.webmcpcss.animation`
(`orchestrator()`, `validate()`, `run()`, `registerExternal()`).

## Integración con agentes

- **MCP**: `webmcpcss_animate` (servidor genérico) y `apply_animation`
  (servidor Flomny) aceptan `dryRun: true` para obtener este informe.
- **Claude Code**: `/webmcpcss:animate` ejecuta `validate-conflicts` antes
  de animar y pide confirmación si hay conflictos.
- **DeerFlow**: `browser_animate(dry_run=True)` devuelve el informe como
  mensaje estructurado `{"type": "webmcp_animation"}`.
