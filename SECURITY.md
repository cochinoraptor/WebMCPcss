# Política de Seguridad

## Versiones soportadas

| Versión | Soporte |
| ------- | ------- |
| 0.6.x   | ✅      |
| < 0.6   | ❌      |

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
