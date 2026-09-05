# Recommender-MCP (v1.0.0)

Dado un **objetivo en lenguaje natural** («inicia sesión y compra 2
zapatillas rojas») y el contrato de un sitio, recomienda qué herramientas
usar, en qué orden, con qué parámetros y qué contexto leer para verificar el
resultado. Aprende del historial local de ejecuciones y recomendaciones, y
puede refinarse con un LLM.

- Código: `src/recommender/index.ts` (+ `src/utils/history.ts`)
- CLI: `webmcpcss recommend`
- Ejemplo: [`examples/v1/output/recommender/plan.json`](../examples/v1/output/recommender/plan.json)

## CLI

```bash
webmcpcss recommend "buscar zapatillas rojas" --url https://tienda.test          # descubre el contrato del sitio
webmcpcss recommend "compra 2 zapatillas" --css tienda.webmcp.css --json
webmcpcss recommend "compra 2 zapatillas" --css tienda.webmcp.css --record        # guarda la recomendación
webmcpcss recommend "compra 2 zapatillas" --css tienda.webmcp.css --outcome ok    # registra el resultado real
webmcpcss recommend "reserva mesa para 4" --url https://resto.test --llm ollama --model llama3.2
```

Salida: pasos ordenados (`tool`, `score`, `reasons`, `params`, `missingParams`,
`requiresConfirmation`, `history`), alternativas descartadas, contextos útiles,
`confidence`, `source` (`heuristic` | `llm`) y una explicación:

```
Para "inicia sesión y compra 2 zapatillas rojas" recomiendo estos 2 pasos (confianza 95 %):
  1. anadirAlCarrito con cantidad="2" — requiere confirmación
  2. pagarPedido — requiere confirmación
Contexto útil: articulosCarrito (.cart-count)
```

## Cómo puntúa

1. **Tokens y sinónimos** ES/EN (`expandTokens`): pliega acentos, elimina
   stopwords, añade sinónimos (`comprar` ↔ `buy`, `checkout`, `carrito`,
   `cart`…) cuando las palabras comparten raíz (`paga` ≈ `pagar`) y respeta
   límites de palabra en las frases («ir a» no casa dentro de «añadir al»).
2. **Coincidencia** nombre (hasta 0.5) > descripción (0.35) > parámetros
   (0.15) > metadatos (0.1), con motivos legibles.
3. **Historial** por host: con ≥ 2 ejecuciones, la tasa de éxito ajusta ±0.15;
   las recomendaciones que acabaron bien dan un pequeño bonus.
4. **Penalización de acciones sensibles**: tools `full`, de pago o
   destructivas se multiplican por 0.4 si el objetivo no las pide
   explícitamente (así «buscar botas» nunca propone `eliminarCuenta`).
5. **Parámetros** (`extractParams`): comillas → campos de texto, emails →
   `*mail*`, números → cantidad/precio, y el texto que sigue a «busca»,
   «llamado», «ciudad»… Los requeridos que faltan van en `missingParams`.
6. El login, si puntúa, se antepone; se devuelven como máximo `--max-steps`
   (3) pasos por encima del 45 % de la mejor puntuación.

## Historial

Los eventos se guardan en `.webmcpcss/history.json` (el mismo archivo que
usa el dashboard): `execute`, `prompt`, `recommend` y `payment`.
`recordOutcome(plan, ok)` registra el resultado real y `computeStats` los
agrega (`recommendations`, `payments`…). El historial se filtra por host de
la URL para no mezclar sitios.

## Refinado con LLM

`refineWithLlm(plan, toolMap, llm)` envía objetivo, lista de tools y plan
heurístico; el modelo responde JSON `{ steps: [{ tool, params, why }], confidence }`.
Solo se aceptan tools existentes; si la respuesta es inválida o falla, se
conserva el plan heurístico (`source: 'heuristic'`).

## API

```ts
import { recommender } from 'webmcpcss';

const plan = await recommender.recommend('compra 2 zapatillas rojas', toolMap, {
  url: 'https://tienda.test',
  history: events, // o historyFile
  llm: llmClientOrNull,
  maxSteps: 3,
  record: true,
});
recommender.recordOutcome(plan, true);
```
