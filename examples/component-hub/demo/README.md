# Demo WebMCPcss

Generada con `webmcpcss components demo` (v1.2.0).

- `index.html` — todos los componentes.
- `webmcp.css` — contratos concatenados (bloques `@webmcpcss-component`).
- `components/<id>/` — archivos de cada componente.
- `webmcp-animation.js` — runtime de animaciones.

## Probar con un agente

```bash
npx serve .                      # o cualquier servidor estático
npx webmcpcss mcp --serve --css ./webmcp.css --url http://localhost:3000
```

Componentes: `tailwind-button-icon`, `tailwind-button-outline`, `tailwind-button-primary`, `tailwind-button-secondary`, `tailwind-product-card`, `tailwind-profile-card`, `tailwind-contact-form`, `tailwind-login-form`, `tailwind-hero`, `tailwind-navbar`.
