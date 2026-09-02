# Demo: WebMCPcss × Tailwind CSS

Página de ejemplo con componentes Tailwind (header, tarjeta, botón CTA y
formulario) que registra **herramientas WebMCP de edición Tailwind** vía
`navigator.modelContext.registerTool()`. Un agente de IA puede cambiar
colores, espaciado o layout de la página en tiempo real.

> Tailwind se carga desde CDN (`cdn.tailwindcss.com`), así que necesitas
> conexión a internet para ver los estilos.

## Uso en 5 minutos

```bash
# 1. Sirve la carpeta
npx serve examples/tailwind-demo          # o: python3 -m http.server 8000

# 2. Inspecciona las clases Tailwind de un elemento
webmcpcss tailwind inspect http://localhost:8000/index.html "#feature-card"

# 3. Genera herramientas de edición para TODA la página
webmcpcss tailwind generate http://localhost:8000/index.html -o my-tools
#   → my-tools.js (script standalone) + my-tools.webmcp.css

# 4. Exporta un componente con sus clases actuales
webmcpcss tailwind export http://localhost:8000/index.html -s "#feature-card" -o Card.jsx
```

## Herramientas registradas por la página

| Herramienta              | Elemento        | Categoría |
| ------------------------ | --------------- | --------- |
| `editSiteHeaderColors`   | `#site-header`  | colors    |
| `editFeatureCardSpacing` | `#feature-card` | spacing   |
| `editCtaButtonColors`    | `#cta-button`   | colors    |
| `editContactFormLayout`  | `#contact-form` | layout    |

Todas aceptan `{ add, remove, replace }`:

```js
await agent.execute('editCtaButtonColors', {
  replace: 'bg-emerald-500:bg-rose-500',
  add: 'ring-4 ring-rose-200',
});
```

Además, `webmcp.css` declara dos herramientas declarativas (`clickCta`,
`sendContactForm`) descubribles con `webmcpcss validate` o `discover`
gracias al `<meta name="webmcp">`.
