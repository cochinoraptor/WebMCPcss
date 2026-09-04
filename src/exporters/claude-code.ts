/**
 * Exportador de plugin para **Claude Code**.
 *
 * Genera una carpeta instalable con `claude plugin install <carpeta>`:
 *
 * ```
 * .claude-plugin/plugin.json      manifiesto
 * commands/generate.md            /webmcpcss:generate <url>
 * commands/validate.md            /webmcpcss:validate <url> <css>
 * commands/repair.md              /webmcpcss:repair <url> <css>
 * commands/run.md                 /webmcpcss:run <herramienta> <args>
 * commands/prompt.md              /webmcpcss:prompt "<orden en lenguaje natural>"
 * commands/animate.md             /webmcpcss:animate <animation.webmcp.css>
 * skills/webmcp-audit/SKILL.md    skill: auditoría de fragilidad de selectores
 * .mcp.json                       servidor MCP del plugin (webmcpcss mcp --serve)
 * README.md
 * ```
 *
 * Todo el contenido son plantillas de texto: cero dependencias nuevas.
 */
import type { ToolMap } from '../types';
import { VERSION } from '../version';
import type { ExportContext } from './python-agents';
import { toolMapToJsonSchemas } from './schema';

/** Frontmatter + cuerpo de un comando slash de Claude Code. */
function command(description: string, body: string): string {
  return `---\ndescription: ${description}\n---\n\n${body.trim()}\n`;
}

/**
 * Genera un plugin de Claude Code: `plugin.json`, comandos slash
 * (`generate`, `validate`, `repair`, `run`, `prompt`, `animate`), la skill
 * `webmcp-audit` y el `.mcp.json` que arranca el servidor MCP.
 *
 * @param toolMap Tool map parseado.
 * @param ctx Ruta CSS y URL.
 * @returns Mapa ruta relativa → contenido.
 */
export function exportClaudeCodePlugin(
  toolMap: ToolMap,
  ctx: ExportContext,
): Record<string, string> {
  const schemas = toolMapToJsonSchemas(toolMap);
  const files: Record<string, string> = {};
  const urlArg = ctx.url ? ` --url ${ctx.url}` : '';
  const urlHint = ctx.url ?? '<url>';

  files['.claude-plugin/plugin.json'] =
    JSON.stringify(
      {
        name: 'webmcpcss',
        description:
          'Herramientas WebMCP: genera, valida, repara, ejecuta, modifica por prompt y anima sitios declarados en .webmcp.css',
        version: VERSION,
        author: { name: 'WebMCPcss' },
        homepage: 'https://github.com/cochinoraptor/WebMCPcss',
        license: 'MIT',
        keywords: ['webmcp', 'mcp', 'css', 'browser-automation', 'selectors'],
        commands: './commands',
        skills: './skills',
        mcpServers: './.mcp.json',
      },
      null,
      2,
    ) + '\n';

  files['.mcp.json'] =
    JSON.stringify(
      {
        mcpServers: {
          webmcpcss: {
            command: 'webmcpcss',
            args: [
              'mcp',
              '--serve',
              '--css',
              ctx.cssPath,
              ...(ctx.url ? ['--url', ctx.url] : []),
            ],
          },
        },
      },
      null,
      2,
    ) + '\n';

  files['commands/generate.md'] = command(
    'Genera un .webmcp.css para una URL (escaneo automático del DOM)',
    `Ejecuta \`webmcpcss generate $ARGUMENTS --auto -o webmcp.css\` con Bash y
resume las herramientas detectadas. Después valida con
\`webmcpcss validate $ARGUMENTS webmcp.css\`.`,
  );

  files['commands/validate.md'] = command(
    'Valida los selectores de un .webmcp.css contra la página',
    `Ejecuta \`webmcpcss validate $ARGUMENTS\` (URL y archivo CSS) con Bash y
reporta los selectores rotos. Si hay fallos, ofrece ejecutar
\`/webmcpcss:repair\`.`,
  );

  files['commands/repair.md'] = command(
    'Repara selectores rotos usando visión + huellas',
    `Ejecuta \`webmcpcss repair $ARGUMENTS\` con Bash, muestra el diff de
selectores reparados y vuelve a validar.`,
  );

  files['commands/run.md'] = command(
    'Ejecuta una herramienta WebMCP en el sitio (addToCart, login...)',
    `Ejecuta \`webmcpcss run ${urlHint} ${ctx.cssPath} <herramienta> --args '<json>'\`
con Bash usando los argumentos del usuario ($ARGUMENTS) y devuelve el
resultado JSON.

Herramientas disponibles en ${ctx.cssPath}:
${schemas.map((s) => `- **${s.name}** (${Object.keys(s.inputSchema.properties).join(', ') || 'sin parámetros'}): ${s.description}`).join('\n')}`,
  );

  files['commands/prompt.md'] = command(
    'Modifica la página con lenguaje natural ("sube esta imagen al carrusel", "oculta el popup")',
    `El usuario describe en lenguaje natural qué quiere cambiar en el sitio.

1. Interpreta primero en seco (sin tocar la página):
   \`webmcpcss prompt "$ARGUMENTS"${urlArg} --css ${ctx.cssPath} --json\`
2. Muestra al usuario la acción interpretada (tipo, selector elegido,
   herramienta WebMCP delegada si la hay) y pide confirmación.
3. Solo si confirma, ejecuta:
   \`webmcpcss prompt "$ARGUMENTS"${urlArg} --css ${ctx.cssPath} --execute --screenshot /tmp/webmcp-prompt.png --json\`
4. Resume el resultado y adjunta la captura si existe.

Si el usuario aporta imágenes o archivos, pásalos con \`--image <ruta>\` o
\`--file <ruta>\`. Nunca ejecutes acciones destructivas (pagos, borrados)
sin confirmación explícita.`,
  );

  files['commands/animate.md'] = command(
    'Aplica animaciones declarativas (webmcp-animation-*) sin romper las del sitio',
    `El argumento es un archivo \`.webmcp.css\` con reglas \`webmcp-animation-*\`
(y opcionalmente una URL).

1. Valida y simula conflictos antes de animar:
   \`webmcpcss validate-conflicts $ARGUMENTS${urlArg} --json\`
2. Si hay conflictos con animaciones existentes (GSAP, Framer Motion, CSS
   del sitio), explica al usuario la resolución prevista (replace / queue /
   ignore / merge) y ofrece cambiarla con \`--conflict-strategy\`.
3. Aplica:
   \`webmcpcss animate $ARGUMENTS${urlArg} --screenshot /tmp/webmcp-animate.png --json\`
   Usa \`--sandbox\` si el usuario quiere aislar las animaciones en un
   shadow root y \`--type css|waapi|three\` para forzar motor.
4. Resume qué animaciones se aplicaron, cuáles quedaron en cola y adjunta
   la captura.`,
  );

  files['skills/webmcp-audit/SKILL.md'] = `---
name: webmcp-audit
description: Audita la fragilidad de los selectores de un .webmcp.css (hashes de CSS Modules, Vue scoped, styled-components, nth-child…) y propone alternativas estables. Úsala cuando el usuario pida revisar, auditar o robustecer un archivo .webmcp.css, o cuando validate reporte selectores rotos de forma recurrente.
allowed-tools:
  - Bash
  - Read
  - Write
---

# Auditoría de fragilidad de selectores WebMCP

## Cuándo usar esta skill

- El usuario pide "revisar", "auditar" o "hacer robusto" un \`.webmcp.css\`.
- \`/webmcpcss:validate\` falla repetidamente tras cada despliegue del sitio.
- Antes de publicar un \`.webmcp.css\` en el proxy comunitario.

## Procedimiento

1. Genera el grafo con análisis de fragilidad:
   \`\`\`bash
   webmcpcss graph ${ctx.cssPath} --fragility --output /tmp/webmcp-graph.json
   \`\`\`
2. Lee \`/tmp/webmcp-graph.json\` y, para cada nodo \`selector\`, revisa
   \`metadata.fragility\`: \`level\` (low/medium/high), \`reasons\`,
   \`suggestions\` y \`framework\` detectado.
3. Presenta una tabla: selector · nivel · framework · motivo principal ·
   sugerencia. Ordena por gravedad (high primero).
4. Para cada selector \`high\`, propón un reemplazo concreto siguiendo el
   orden de preferencia: \`[data-tool]\`/\`[data-testid]\` → \`#id\`
   semántico → \`[name]\`/\`[aria-label]\` → clase semántica propia.
5. Si el usuario acepta, edita el \`.webmcp.css\` (o pide al equipo del
   sitio añadir los atributos) y añade \`webmcp-fingerprint\` a las
   herramientas críticas para que \`webmcpcss repair\` pueda re-localizarlas.
6. Termina validando: \`webmcpcss validate ${urlHint} ${ctx.cssPath}\`.

## Salida opcional

- Vault Obsidian navegable: \`webmcpcss graph ${ctx.cssPath} --obsidian ./vault\`
- Dashboard interactivo con filtros por framework: \`webmcpcss graph ${ctx.cssPath} --dashboard\`
`;

  files['README.md'] = `# Plugin Claude Code — webmcpcss v${VERSION}

Instalación:

\`\`\`bash
claude plugin install ./claude-plugin   # o la ruta de esta carpeta
\`\`\`

## Comandos slash

| Comando | Qué hace |
| --- | --- |
| \`/webmcpcss:generate <url>\` | Genera un \`.webmcp.css\` escaneando el DOM |
| \`/webmcpcss:validate <url> <css>\` | Reporta selectores rotos |
| \`/webmcpcss:repair <url> <css>\` | Repara con visión + huellas |
| \`/webmcpcss:run <herramienta> <args>\` | Ejecuta una herramienta de \`${ctx.cssPath}\` |
| \`/webmcpcss:prompt "<orden>"\` | Modifica la página con lenguaje natural (dry-run + confirmación) |
| \`/webmcpcss:animate <animation.webmcp.css>\` | Valida conflictos y aplica animaciones declarativas |

## Skill

- **webmcp-audit** — auditoría de fragilidad de selectores con sugerencias
  de migración (se activa al pedir "audita/revisa este webmcp.css").

## Servidor MCP

El plugin declara en \`.mcp.json\` el servidor \`webmcpcss mcp --serve\`, que
expone ${schemas.length} herramienta(s) del sitio (${schemas.map((s) => s.name).join(', ') || '—'})
más \`webmcpcss_prompt\` y \`webmcpcss_animate\`.

Requiere \`webmcpcss\` en el PATH (\`npm i -g webmcpcss\`).
`;
  return files;
}
