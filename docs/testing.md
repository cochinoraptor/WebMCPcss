# Test-MCP (v1.0.0)

El `.webmcp.css` es un **contrato**: los selectores existen, los parámetros
apuntan a campos reales, las confirmaciones son válidas y los contextos tienen
el formato declarado. Test-MCP convierte ese contrato en pruebas ejecutables
—Playwright o Cypress— y también puede ejecutarlas directamente con Puppeteer
y emitir JUnit para CI.

- Código: `src/testing/index.ts`
- CLI: `webmcpcss test generate | run`
- Ejemplo: [`examples/v1/output/testing/`](../examples/v1/output/testing/) (`webmcp.spec.ts`, `webmcp.cy.js`, `plan.json`)

## Plan de pruebas

`buildTestPlan(toolMap, { execute })` deriva casos deterministas (`tc001`, `tc002`…):

| Caso                              | Qué comprueba                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `tool-exists`                     | El selector de la tool existe                                                                                   |
| `tool-params`                     | Cada `webmcp-param-*` con `value(sel)` apunta a un elemento existente (`attr()` apunta a la propia tool)        |
| `tool-confirmation`               | El selector de confirmación es válido                                                                           |
| `context-exists`                  | El selector del contexto existe                                                                                 |
| `context-format`                  | El texto del contexto respeta `webmcp-format` (`currency`, `number`, `date`, `boolean`, `url`, `email`, `list`) |
| `tool-execute` (solo `--execute`) | Rellena los campos con datos de ejemplo (`sampleFor`) y ejecuta la tool                                         |

Los casos de ejecución **solo** se generan para tools seguras: sin
confirmación declarada, sin `webmcp-payment`, sin nombre destructivo
(`eliminar`, `pagar`, `borrar`…) y con al menos un campo rellenable.

## CLI

```bash
# Generar suites
webmcpcss test generate --file tienda.webmcp.css --url https://tienda.test -o webmcp.spec.ts
webmcpcss test generate --file tienda.webmcp.css --framework cypress -o webmcp.cy.js
webmcpcss test generate --file tienda.webmcp.css --execute --json > plan.json
webmcpcss test generate --file tienda.webmcp.css --url https://tienda.test --ci   # .github/workflows/webmcp-tests.yml

# Ejecutar sin Playwright/Cypress (Puppeteer incluido)
webmcpcss test run --url https://tienda.test --file tienda.webmcp.css --junit webmcp-junit.xml
webmcpcss test run --url https://tienda.test --file plan.json --execute
```

`BASE_URL` (Playwright) y `Cypress.env('BASE_URL')` permiten reutilizar la
misma suite en distintos entornos.

### Fragmento generado (Playwright)

```ts
test('tc003 tool "buscarProductos" se ejecuta con datos de ejemplo', async ({ page }) => {
  await page.locator('#q').first().fill('webmcp');
  await page.locator('#search-btn').first().click();
  await page.waitForLoadState('domcontentloaded');
  expect(page.url()).toBeTruthy();
});
```

## Integración en CI

`buildTestWorkflow({ url, css })` genera un workflow que instala `webmcpcss`,
ejecuta `test run … --junit` en cada PR y publica el XML. Los fallos incluyen
el selector que falta o el motivo del formato incorrecto.

## API

```ts
import { testing } from 'webmcpcss';

const plan = testing.buildTestPlan(toolMap, {
  execute: true,
  source: 'tienda.webmcp.css',
});
const { code, filename } = testing.generateTests(toolMap, {
  framework: 'playwright',
  url,
});

const probe = testing.puppeteerProbe(page); // o cualquier TestProbe { count, text, fill?, click?, url }
const report = await testing.runTestPlan(plan, probe, { execute: true });
const xml = testing.toJUnit(report); // <testsuite tests failures skipped>
```
