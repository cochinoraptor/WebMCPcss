# community-styles

Estilos `.webmcp.css` aportados por la comunidad para sitios que **no**
publican su propio WebMCP. El proxy (`webmcpcss inject`) prueba el
auto-descubrimiento del sitio primero y cae aquí como fallback.

## Convenciones

- Un archivo por dominio: `<dominio>.webmcp.css` (minúsculas, sin `www.`).
  La resolución prueba la cadena de subdominios: `a.b.ejemplo.com` →
  `b.ejemplo.com` → `ejemplo.com`.
- Usa selectores estables (`data-*`, IDs semánticos, `aria-label`) y
  documenta cada herramienta con `webmcp-description`.
- Opcional: `/* @validate-url: https://... */` para que el CI valide los
  selectores en vivo.
- Todas las herramientas con efectos deben declarar
  `webmcp-confirmation`. No se aceptan estilos que expongan acciones
  destructivas (pagos, borrado de cuentas) ni estilos para sitios que lo
  prohíban en sus términos de servicio.

## Verificar antes del PR

```bash
npm run build
node dist/src/cli.js parse community-styles/<dominio>.webmcp.css
node dist/src/cli.js validate https://<dominio> community-styles/<dominio>.webmcp.css
```

## Índice

| Dominio | Herramientas | Notas |
| ------- | ------------ | ----- |
| `example.com` | `moreInfo` | Ilustrativo, contra el dominio de documentación reservado |
