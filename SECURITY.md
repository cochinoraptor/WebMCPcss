# Política de Seguridad

## Versiones soportadas

| Versión | Soporte                             |
| ------- | ----------------------------------- |
| 1.2.x   | ✅                                  |
| 1.0.x   | ✅ (solo correcciones de seguridad) |
| < 1.0   | ❌                                  |

## Reportar una vulnerabilidad

Si encuentras una vulnerabilidad de seguridad en WebMCPcss, **no abras un
issue público**. En su lugar:

1. Usa [GitHub Security Advisories](https://github.com/cochinoraptor/WebMCPcss/security/advisories/new)
   (pestaña _Security_ → _Report a vulnerability_).
2. Describe el problema, los pasos para reproducirlo y el impacto estimado.

Nos comprometemos a responder en un plazo razonable y a acreditar el
descubrimiento si lo deseas.

## Consideraciones de seguridad al usar WebMCPcss

- **Los archivos `.webmcp.css` ejecutan acciones reales** en sitios web vía
  navegador. Revisa siempre las definiciones de terceros (community-styles)
  antes de ejecutarlas con `run`, `mcp --serve --url` o `repair`.
- **Herramientas destructivas**: el estándar del repositorio exige
  `webmcp-confirmation` en acciones sensibles (pagos, borrado). Los PR
  comunitarios que no lo cumplan serán rechazados.
- **Tokens**: `webmcpcss publish` acepta el token por variable de entorno
  `GITHUB_TOKEN` (recomendado) o `--token`. Nunca lo comitees; usa secrets
  en CI.
- **Servidor MCP HTTP** (`mcp --serve --http`) tiene CORS abierto y está
  pensado para uso local. Si lo expones, ponlo detrás de tu propia
  autenticación.
- **Component Hub** (`webmcpcss components import`): los componentes se
  descargan de la URL configurada (`WEBMCPCSS_HUB_URL`, por defecto el sitio
  oficial) o del catálogo incluido en el paquete. Revisa el contrato
  `.webmcp.css` importado como cualquier otra dependencia; `publish` solo usa
  el token desde `GITHUB_TOKEN`/`--token` y nunca lo escribe en disco.

## Avisos conocidos de `npm audit`

- **`extract-zip` (GHSA-jmr9-qjv8-65gv, transitiva de `puppeteer` →
  `@puppeteer/browsers`)**: solo interviene al **descargar Chrome** durante
  `npm install`, nunca al ejecutar la CLI, el servidor MCP ni la API. No existe
  versión parcheada compatible con Node 18 (`puppeteer` 25 exige Node ≥ 22.12);
  se actualizará al subir el mínimo de Node. Mitigación: instala con
  `PUPPETEER_SKIP_DOWNLOAD=true` y apunta `PUPPETEER_EXECUTABLE_PATH` a un
  Chrome/Chromium ya instalado en el sistema.
