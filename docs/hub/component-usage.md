# Uso de componentes

Cada componente del hub está formado por tres archivos que trabajan juntos. Esta guía explica cómo integrarlos en un proyecto real sin perder la capa "para agentes".

## Anatomía de un componente

```
tailwind-button-primary/
├── button-primary.html         ← marcado (clases de tu librería + data-tool)
├── button-primary.webmcp.css   ← contrato para agentes (propiedades webmcp-*)
└── component.json              ← metadatos (versión, controles, ejemplos, relacionados)
```

El contrato mínimo de un botón:

```css
[data-tool="clickButton"] {
  webmcp-tool: "clickButton";
  webmcp-description: "Ejecuta la acción principal del bloque";
  webmcp-intent: "submit";          /* submit | navigate | action | cancel */
  webmcp-confirmation: "none";      /* none | needed */
  webmcp-permissions: "restricted"; /* read-only | restricted | full */
  webmcp-accessibility: "focus-visible: ring; min-target: 44px";
}
```

Las propiedades `webmcp-*` no afectan al render (el navegador las ignora) y se pueden mezclar con CSS normal en el mismo archivo.

## Identificadores estables

Los selectores del contrato apuntan a atributos `data-tool`, `data-context`, `data-component` y `data-form`, no a clases de estilo. Así puedes cambiar utilidades de Tailwind o variantes de MUI sin romper el contrato. Regla práctica: **si renombras un `data-*`, actualiza el `.webmcp.css`**.

## Parámetros

Los parámetros se declaran con `webmcp-param-<nombre>` y una fuente:

| Fuente       | Ejemplo                                           | Lee…                     |
| ------------ | ------------------------------------------------- | ------------------------ |
| `attr(...)`  | `webmcp-param-productId: attr(data-product-id);`  | un atributo del elemento |
| `value(sel)` | `webmcp-param-email: value(form [name="email"]);` | el `value` de un campo   |
| `text(sel)`  | `webmcp-param-total: text(.total);`               | el texto de un elemento  |
| literal      | `webmcp-param-currency: "EUR";`                   | un valor fijo            |

Documenta cada parámetro con `webmcp-doc-<nombre>: "…"`; el servidor MCP lo usa como descripción del JSON Schema.

## Formularios y API declarativa

Los formularios del hub llevan además los atributos del estándar WebMCP (`toolname`, `tooldescription`, `toolparamtitle`, `toolparamdescription`, `toolautosubmit`). Un navegador compatible (Chrome 149+ con el origin trial) registra la herramienta automáticamente; el `.webmcp.css` expresa lo mismo para MCP y para navegadores sin soporte. `webmcpcss standard scan index.html` te muestra ambos lados sincronizados.

## Personalización visual

Los componentes _core_ y _Tailwind_ exponen variables CSS (`--wm-primary`, `--wm-on-primary`, `--wm-radius`, `--wm-surface`, …). Cambia su valor en tu hoja de estilos:

```css
:root { --wm-primary: #16a34a; --wm-radius: 12px; }
```

- **Bootstrap**: el `preview.css` del hub mapea `--wm-*` a las variables `--bs-*`; en tu proyecto puedes usar directamente las de Bootstrap.
- **MUI**: el HTML es el DOM que renderiza `<Button>`/`<Card>`; en React pasa `data-tool` como prop y personaliza con `sx` o el tema.
- **shadcn/ui**: usa los tokens de `globals.css` (`--primary`, `--radius`). El snippet React del detalle (`usage.code`) muestra el JSX equivalente.

El **editor en vivo** del sitio genera el bloque CSS con los valores que elijas; cópialo y pégalo en tu proyecto.

## Animaciones

Los componentes de la categoría _animations_ y algunos inteligentes declaran animaciones con el estándar de WebMCPcss:

```css
[data-animation="fade-in"] {
  webmcp-animation: "fadeIn";
  webmcp-animation-type: keyframes;
  webmcp-animation-trigger: visible;
  webmcp-animation-duration: 800ms;
  webmcp-animation-keyframes: '[{"opacity":0},{"opacity":1}]';
}
```

Para reproducirlas en tu página incluye el runtime y ejecuta el mapa:

```bash
npx webmcpcss animate fade-in.webmcp.css -o ./public/webmcp-animation
```

```html
<script src="/webmcp-animation/webmcp-animation.js"></script>
<script>webmcpcss.animation.run(window.__WEBMCP_ANIMATIONS__, { strategy: 'queue' });</script>
```

Conviven con GSAP, Framer Motion o Anime.js: registra tus animaciones externas con `webmcpcss.animation.registerExternal(...)` y el orquestador evitará conflictos.

## Seguridad y confirmaciones

Los componentes de pago y acciones sociales usan `webmcp-confirmation: "needed"`, `webmcp-permissions: "full"`, `webmcp-requires: "auth"`, `webmcp-rate-limit` y `webmcp-risk`. `webmcpcss security validate --file tu.webmcp.css` audita esas políticas antes de publicar.

## Actualizaciones

`webmcpcss components update` compara el hash de tus archivos con el del hub. Si has editado un componente localmente, usa `--dry-run` para revisar y decide si reimportar con `--force` (tus cambios se sobrescriben) o mantener tu versión.
