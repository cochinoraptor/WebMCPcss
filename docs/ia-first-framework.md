# IA-First Framework (v1.0.0)

Componentes web que **nacen con WebMCP**: cada botón, formulario, tarjeta,
navegación, hero o grid declara en su `.webmcp.css` la intención, si necesita
confirmación humana y su accesibilidad. Los agentes IA no tienen que adivinar
nada; las personas obtienen HTML semántico y accesible.

- Código: `src/framework/` (`components.ts`, `generator.ts`, `assistant.ts`, `docs.ts`)
- CLI: `webmcpcss init`, `webmcpcss assist`
- Ejemplo generado: [`examples/v1/ia-first-project/`](../examples/v1/ia-first-project/)

## Propiedades nuevas

| Propiedad                      | Valores                                                   | Uso                                                                                        |
| ------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `webmcp-component`             | `button` \| `form` \| `card` \| `nav` \| `hero` \| `grid` | Tipo de componente IA-First                                                                |
| `webmcp-intent`                | `submit` \| `cancel` \| `navigate` \| `action` \| `read`  | Qué pretende la herramienta                                                                |
| `webmcp-confirmation`          | `needed` \| `none`                                        | Si el agente debe pedir confirmación humana antes de ejecutar                              |
| `webmcp-confirmation-selector` | selector CSS                                              | Post-condición verificable (sustituye al viejo uso de `webmcp-confirmation` como selector) |
| `webmcp-accessibility`         | `"aria-label: X; role: Y"`                                | Atributos de accesibilidad que el componente garantiza                                     |

Ejemplo real generado por `assist`:

```css
[data-tool='send-contact-submit'] {
  webmcp-tool: 'sendContact';
  webmcp-component: 'form';
  webmcp-intent: 'submit';
  webmcp-confirmation: 'needed';
  webmcp-description: 'Formulario de contacto';
  webmcp-accessibility: 'aria-label: Enviar mensaje';
  webmcp-param-name: value(#send-contact-name);
  webmcp-param-email: value(#send-contact-email);
  webmcp-param-message: value(#send-contact-message);
  webmcp-trigger: 'submit' on #send-contact-form;
  webmcp-confirmation-selector: "[data-confirmation='send-contact']";
}
```

## Catálogo de componentes

| Componente            | Etiqueta    | Intent por defecto | Confirmación | Genera                                                      |
| --------------------- | ----------- | ------------------ | ------------ | ----------------------------------------------------------- |
| `IAButton` (`button`) | `<button>`  | `action`           | `none`       | 1 tool                                                      |
| `IAForm` (`form`)     | `<form>`    | `submit`           | `needed`     | 1 tool con un `webmcp-param-*` por campo + trigger `submit` |
| `IACard` (`card`)     | `<article>` | `read`             | `none`       | contexto (título/precio/…) + tool opcional                  |
| `IANav` (`nav`)       | `<nav>`     | `navigate`         | `none`       | 1 tool `navigate` por enlace                                |
| `IAHero` (`hero`)     | `<section>` | `navigate`         | `none`       | contexto + CTA                                              |
| `IAGrid` (`grid`)     | `<section>` | `read`             | `none`       | contexto por columna + tool por acción de ítem              |

Todos los componentes emiten `data-tool="…"` como selector estable (nunca
clases de framework ni ids autogenerados) y atributos ARIA coherentes con
`webmcp-accessibility`.

## CLI

```bash
# Proyecto completo (index.html, webmcp.css, mcp.json, .well-known/webmcp.json, runtime)
webmcpcss init mi-tienda --framework ia-first --name "Mi tienda" --url https://mi-tienda.com
webmcpcss init mi-tienda --framework minimal      # solo lo imprescindible

# Componentes desde lenguaje natural (heurístico; con --llm usa un modelo)
webmcpcss assist "crea un formulario de contacto con nombre, email y mensaje" -o ./contacto
webmcpcss assist "una tarjeta de producto con precio y botón comprar" --llm ollama --model llama3.2
```

`assist` devuelve `component.html` y `component.webmcp.css` listos para pegar;
con `--json` imprime el plan (componentes, opciones, tools).

## API

```ts
import { framework } from 'webmcpcss';

const { html, css, tools } = framework.renderComponent('form', {
  tool: 'sendContact',
  label: 'Enviar mensaje',
  confirmation: 'needed',
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Mensaje', type: 'textarea' },
  ],
});

const report = framework.validateIaFirst(parseWebMCP(css));
// report.ok, report.issues: [{ tool, severity, message }]

await framework.initProject({ dir: './mi-tienda', framework: 'ia-first' });
const plan = await framework.assist('crea un formulario de contacto', llmOrNull);
```

`validateIaFirst` comprueba que cada tool declare `webmcp-component`,
`webmcp-intent` válido, `webmcp-confirmation` `needed|none` y
`webmcp-accessibility` con formato `atributo: valor`.

## Documentación para agentes

`framework.docs` (`src/framework/docs.ts`) genera el `README.md` y
`components/README.md` del proyecto: explica a un agente qué significa cada
intent, cuándo pedir confirmación y cómo descubrir el contrato vía
`.well-known/webmcp.json` o `<link rel="webmcp">`.
