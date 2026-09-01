# Contribuir a WebMCPcss

¡Gracias por tu interés en contribuir! 🎉 Este documento explica cómo hacerlo.

## Código de conducta

Sé respetuoso y constructivo. No se toleran ataques personales ni acoso.

## Cómo empezar

```bash
git clone https://github.com/cochinoraptor/WebMCPcss.git
cd WebMCPcss
npm install
npm run build && npm test
```

Requisitos: Node.js ≥ 18 y npm. Puppeteer descargará Chromium automáticamente
(usa `PUPPETEER_SKIP_DOWNLOAD=true npm install` si solo trabajarás en el
parser/lógica y no necesitas navegador).

## Normas de estilo

- **100% TypeScript estricto**: nada de `any` sin justificación (el linter lo marca).
- **JSDoc obligatorio** en toda función/clase/interfaz exportada.
- Formato con **Prettier** (`npm run format`) y linteo con **ESLint**
  (`npm run lint`). El CI rechaza PRs que no pasen ambos.
- Mensajes de commit estilo [Conventional Commits](https://www.conventionalcommits.org/):
  `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `chore: ...`.
- Los tests viven en `tests/` y usan **Vitest**. Toda funcionalidad nueva debe
  llegar con tests; la lógica central (parser, reparación) no puede bajar de
  cobertura.

## Proceso de Pull Request

1. Haz **fork** y crea una rama descriptiva: `feat/vision-ocr`, `fix/parser-quotes`.
2. Desarrolla con tests (`npm run test:watch`).
3. Antes de abrir el PR verifica localmente:
   ```bash
   npm run lint && npm run format:check && npm run build && npm test
   ```
4. Abre el PR contra `main` describiendo **qué** cambia y **por qué**. Enlaza
   el issue relacionado si existe.
5. El CI ejecutará lint + build + tests en Node 18/20/22 y validará
   `community-styles/`. Un maintainer revisará y hará merge.

## Añadir estilos comunitarios

Los archivos `.webmcp.css` para sitios populares viven en
[`community-styles/`](community-styles/README.md). Resumen:

1. Crea `community-styles/<dominio>.webmcp.css` (minúsculas, sin `www.`).
2. Usa selectores estables (`data-*`, IDs semánticos, `aria-label`).
3. Documenta cada herramienta con `webmcp-description`.
4. Opcional pero recomendado: añade `/* @validate-url: https://... */` para
   que el CI valide los selectores en vivo con Puppeteer.
5. Verifica antes del PR:
   ```bash
   npm run build
   node dist/src/cli.js parse community-styles/tudominio.com.webmcp.css
   node dist/src/cli.js validate https://tudominio.com community-styles/tudominio.com.webmcp.css
   ```

No se aceptan estilos que expongan acciones destructivas (pagos, borrado de
cuentas) sin `webmcp-confirmation`, ni estilos para sitios que lo prohíban en
sus términos de servicio.

## Reportar bugs y proponer features

Usa las plantillas de issues:

- [Bug report](.github/ISSUE_TEMPLATE/bug_report.md)
- [Feature request](.github/ISSUE_TEMPLATE/feature_request.md)

## Arquitectura (mapa rápido)

| Módulo          | Responsabilidad                                                  |
| --------------- | ---------------------------------------------------------------- |
| `src/parser/`   | `.webmcp.css` ⇄ `ToolMap` JSON (postcss)                         |
| `src/core/`     | Ejecución de herramientas + auto-reparación + visión             |
| `src/adapters/` | Abstracción `PageAdapter` (Puppeteer, DOM/jsdom)                 |
| `src/proxy/`    | Búsqueda e inyección de estilos comunitarios                     |
| `src/cli.ts`    | Comandos `generate` / `validate` / `repair` / `inject` / `parse` |
| `src/utils/`    | Logger con chalk y utilidades DOM auto-contenidas                |

Regla de oro: la lógica central (visión, reparación) debe ser **pura y
testeable sin navegador**; todo acceso a la página pasa por `PageAdapter`.

## Licencia

Al contribuir aceptas que tu código se publique bajo la licencia [MIT](LICENSE).
