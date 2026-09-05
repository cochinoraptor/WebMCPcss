/**
 * IA-First Web Framework: generador de proyectos (`webmcpcss init`).
 *
 * Crea un proyecto base con estructura, componentes de ejemplo, `.webmcp.css`,
 * configuración MCP y documentación para agentes. Sin dependencias: solo `fs`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { VERSION } from '../version';
import { IA_FIRST_BASE_CSS, renderComponent, type RenderedComponent } from './components';

/** Opciones de `initProject`. */
export interface InitOptions {
  /** Carpeta destino (se crea si no existe). */
  dir: string;
  /** Nombre del proyecto (def. nombre de la carpeta). */
  name?: string;
  /** Plantilla: `ia-first` (def.) o `minimal`. */
  framework?: 'ia-first' | 'minimal';
  /** URL pública prevista (para la config MCP). */
  url?: string;
  /** Sobrescribir archivos existentes. */
  force?: boolean;
}

/** Resultado de `initProject`. */
export interface InitResult {
  dir: string;
  files: string[];
  tools: string[];
}

/** Componentes de la plantilla IA-First por defecto. */
export function defaultTemplateComponents(name: string): RenderedComponent[] {
  return [
    renderComponent('nav', {
      tool: 'mainNav',
      label: 'Navegación principal',
      items: [
        { label: 'Inicio', href: '/', tool: 'goHome' },
        { label: 'Productos', href: '/productos', tool: 'goProducts' },
        { label: 'Contacto', href: '/contacto', tool: 'goContact' },
      ],
    }),
    renderComponent('hero', {
      tool: 'hero',
      label: name,
      body: 'Un sitio diseñado para personas y para agentes de IA.',
      description: 'Empieza a explorar el catálogo',
      items: [{ label: 'Ver productos', href: '/productos', tool: 'startShopping' }],
    }),
    renderComponent('grid', {
      tool: 'products',
      label: 'Productos destacados',
      items: [
        { label: 'Producto A', tool: 'addToCart' },
        { label: 'Producto B', tool: 'addToCart' },
        { label: 'Producto C', tool: 'addToCart' },
      ],
    }),
    renderComponent('card', {
      tool: 'featured',
      label: 'Oferta de la semana',
      body: 'Envío gratis en pedidos superiores a 50 €.',
      items: [{ label: 'Aplicar oferta', tool: 'applyOffer' }],
    }),
    renderComponent('form', {
      tool: 'contact',
      label: 'Enviar mensaje',
      description: 'Envía un mensaje al equipo de soporte',
      confirmation: 'needed',
      fields: [
        { name: 'name', label: 'Nombre', required: true },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'message', label: 'Mensaje', type: 'textarea', required: true },
      ],
    }),
  ];
}

/** Ensambla la página `index.html` con los componentes. */
export function buildIndexHtml(name: string, components: RenderedComponent[]): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${name}</title>
  <!-- Descubrimiento WebMCP: los agentes encuentran el .webmcp.css sin escanear -->
  <link rel="webmcp" type="text/webmcp" href="/webmcp.css">
  <meta name="webmcp" content="/webmcp.css">
  <link rel="stylesheet" href="/styles/base.css">
</head>
<body>
  <a class="skip-link" href="#main">Saltar al contenido</a>
${components.map((c) => indent(c.html, 2)).join('\n\n')}
  <main id="main" aria-label="Contenido principal"></main>
  <script type="module" src="/webmcp-runtime.js"></script>
</body>
</html>
`;
}

/** Sangra un bloque de texto. */
function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => (l ? pad + l : l))
    .join('\n');
}

/** Runtime mínimo: confirma envíos de formularios y expone el grafo al agente. */
const RUNTIME_JS = `// WebMCPcss IA-First runtime (sin dependencias)
// 1) Muestra confirmación visible tras enviar formularios IA-First.
document.querySelectorAll('form.ia-form').forEach((form) => {
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const status = form.querySelector('[data-confirmation]');
    if (status) { status.hidden = false; status.textContent = 'Enviado correctamente'; }
  });
});
// 2) Publica el mapa de herramientas para agentes que inyectan WebMCP.
fetch('/webmcp.css').then((r) => r.text()).then((css) => {
  window.__WEBMCP_CSS__ = css;
}).catch(() => {});
`;

/**
 * Genera un proyecto IA-First en disco.
 * @param options Carpeta, nombre, plantilla.
 */
export function initProject(options: InitOptions): InitResult {
  const dir = path.resolve(options.dir);
  const name = options.name ?? path.basename(dir) ?? 'mi-sitio';
  const framework = options.framework ?? 'ia-first';
  fs.mkdirSync(dir, { recursive: true });
  const files: string[] = [];
  const write = (rel: string, content: string) => {
    const abs = path.join(dir, rel);
    if (fs.existsSync(abs) && !options.force) {
      throw new Error(`Ya existe ${rel} (usa --force para sobrescribir)`);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    files.push(rel);
  };

  const components =
    framework === 'minimal'
      ? defaultTemplateComponents(name).slice(-1)
      : defaultTemplateComponents(name);
  const css = [
    `/* ${name} — .webmcp.css generado por webmcpcss init --framework ${framework} (v${VERSION}) */`,
    `/* Cada regla declara intención, confirmación y accesibilidad para agentes IA. */`,
    '',
    ...components.map((c) => c.css.trimEnd()),
    '',
  ].join('\n');

  write('index.html', buildIndexHtml(name, components));
  write('webmcp.css', css);
  write(
    'styles/base.css',
    IA_FIRST_BASE_CSS +
      '.skip-link{position:absolute;left:-999px}.skip-link:focus{left:8px;top:8px}\n',
  );
  write('webmcp-runtime.js', RUNTIME_JS);
  write(
    'components/README.md',
    `# Componentes IA-First\n\nGenerados con \`renderComponent()\` de \`webmcpcss/framework\`. Cada componente vive en \`index.html\` y sus reglas en \`webmcp.css\`.\n\n| Componente | Herramientas |\n| --- | --- |\n${components.map((c) => `| ${c.component} | ${Object.keys(c.tools).join(', ') || '—'} |`).join('\n')}\n`,
  );
  write(
    '.well-known/webmcp.json',
    JSON.stringify(
      {
        version: '1',
        css: '/webmcp.css',
        framework: 'ia-first',
        generator: `webmcpcss@${VERSION}`,
        mcp: {
          command: 'webmcpcss',
          args: [
            'mcp',
            '--serve',
            '--css',
            'webmcp.css',
            ...(options.url ? ['--url', options.url] : []),
          ],
        },
      },
      null,
      2,
    ) + '\n',
  );
  write(
    'mcp.json',
    JSON.stringify(
      {
        mcpServers: {
          [name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()]: {
            command: 'webmcpcss',
            args: [
              'mcp',
              '--serve',
              '--css',
              'webmcp.css',
              ...(options.url ? ['--url', options.url] : []),
            ],
          },
        },
      },
      null,
      2,
    ) + '\n',
  );
  write(
    'webmcp.config.json',
    JSON.stringify(
      {
        name,
        framework,
        url: options.url ?? 'http://localhost:8080',
        css: 'webmcp.css',
        security: { defaultPermissions: 'restricted', requireConfirmation: ['contact'] },
        a11y: { minContrast: 4.5 },
      },
      null,
      2,
    ) + '\n',
  );
  write(
    'README.md',
    `# ${name}

Proyecto **IA-First** generado con \`webmcpcss init --framework ${framework}\`.

\`\`\`bash
npx serve .                                  # o cualquier servidor estático
webmcpcss validate http://localhost:3000 webmcp.css
webmcpcss mcp --serve --css webmcp.css --url http://localhost:3000
webmcpcss doc generate --file webmcp.css -o docs/
\`\`\`

- \`webmcp.css\` — intenciones, confirmaciones y accesibilidad de cada componente.
- \`index.html\` — componentes con selectores estables (\`data-tool\`).
- \`.well-known/webmcp.json\` y \`<link rel="webmcp">\` — descubrimiento por agentes.
- \`mcp.json\` — servidor MCP listo para Claude Desktop / Cursor / DeerFlow.

Siguiente paso: \`webmcpcss assist "añade un buscador de productos"\`.
`,
  );

  const tools = components.flatMap((c) => Object.keys(c.tools));
  return { dir, files, tools: [...new Set(tools)] };
}
