/**
 * Subcomandos `webmcpcss components …` (Component Hub, v1.2.0).
 *
 * - `list [--category] [--library] [--search] [--json]` — catálogo remoto (o empaquetado).
 * - `import <id...> [--output] [--merge] [--force]`      — copia HTML + .webmcp.css + component.json.
 * - `update [id...] [--dry-run]`                          — actualiza los importados (lock).
 * - `demo [--output] [--library] [--ids]`                 — genera un sitio de demostración.
 * - `publish <css> --name --category [...]`               — abre un PR a components/community/.
 * - `build [--out] [--check] [--base-url]`                — regenera el sitio del hub (mantenedores).
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import {
  LOCK_FILE,
  fetchComponent,
  importComponent,
  listComponents,
  prepareComponent,
  readLock,
  resolveHubUrl,
  updateComponents,
  type HubClientOptions,
} from './hub/client';
import { publishComponent } from './hub/publish';
import { buildDemoSite } from './hub/demo';
import {
  CATEGORY_LABELS,
  HUB_CATEGORIES,
  HUB_LIBRARIES,
  LIBRARY_LABELS,
} from './hub/types';
import { logger } from './utils/logger';

const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));

/** Opciones comunes de acceso al hub. */
interface CommonOpts {
  hub?: string;
  offline?: boolean;
  json?: boolean;
}

function clientOptions(o: CommonOpts): HubClientOptions {
  return {
    hubUrl: o.hub,
    offline: o.offline,
    localRoot: process.env.WEBMCPCSS_HUB_DIR || undefined,
  };
}

function sourceNote(source: 'remote' | 'bundled', location: string): string {
  return source === 'remote'
    ? `hub remoto ${chalk.dim(location)}`
    : `catálogo empaquetado ${chalk.dim('(sin conexión con el hub)')}`;
}

/**
 * Registra el comando `components` y sus subcomandos.
 * @param program Programa Commander raíz.
 */
export function registerComponentCommands(program: Command): void {
  const cmp = program
    .command('components')
    .description(
      'Component Hub: catálogo de componentes IA-First (list, import, update, demo, publish)',
    );
  const withCommon = (c: Command): Command =>
    c
      .option(
        '--hub <url>',
        'URL del hub (por defecto WEBMCPCSS_HUB_URL o el hub público)',
      )
      .option('--offline', 'usar solo el catálogo incluido en el paquete');

  withCommon(
    cmp
      .command('list')
      .description('Lista los componentes del hub')
      .option('-c, --category <category>', `categoría: ${HUB_CATEGORIES.join(', ')}`)
      .option('-l, --library <library>', `librería: ${HUB_LIBRARIES.join(', ')}`)
      .option('-s, --search <text>', 'texto libre (nombre, herramienta, etiqueta)')
      .option('--json', 'salida JSON'),
  ).action(
    async (o: CommonOpts & { category?: string; library?: string; search?: string }) => {
      if (o.category && !(HUB_CATEGORIES as readonly string[]).includes(o.category)) {
        throw new Error(
          `Categoría inválida "${o.category}". Usa: ${HUB_CATEGORIES.join(', ')}`,
        );
      }
      if (o.library && !(HUB_LIBRARIES as readonly string[]).includes(o.library)) {
        throw new Error(
          `Librería inválida "${o.library}". Usa: ${HUB_LIBRARIES.join(', ')}`,
        );
      }
      const { components, resolved } = await listComponents(
        { category: o.category, library: o.library, search: o.search },
        clientOptions(o),
      );
      if (o.json) {
        return json({
          source: resolved.source,
          hub: resolved.location,
          total: components.length,
          components,
        });
      }
      logger.title('WebMCPcss · Component Hub');
      logger.info(`Fuente: ${sourceNote(resolved.source, resolved.location)}`);
      if (!components.length) {
        logger.warn('Sin resultados para esos filtros.');
        return;
      }
      let lastCat = '';
      for (const c of components) {
        if (c.category !== lastCat) {
          lastCat = c.category;
          console.log(`\n${chalk.bold(CATEGORY_LABELS[c.category] ?? c.category)}`);
        }
        const tools = c.tools.length
          ? c.tools.map((t) => t.name).join(', ')
          : c.animations.map((a) => a.name).join(', ');
        console.log(
          `  ${chalk.cyan(c.id.padEnd(30))} ${chalk.dim(`v${c.version}`)}  ${LIBRARY_LABELS[c.library] ?? c.library}${tools ? chalk.dim(`  · ${tools}`) : ''}`,
        );
      }
      console.log(
        `\n${components.length} componente(s). Importa con ${chalk.bold('webmcpcss components import <id>')}`,
      );
    },
  );

  withCommon(
    cmp
      .command('import')
      .description('Importa uno o varios componentes al proyecto')
      .argument('<ids...>', 'identificadores (ej. tailwind-button-primary)')
      .option('-o, --output <dir>', 'carpeta destino', 'webmcp-components')
      .option(
        '--merge <css>',
        'añadir el contrato a este .webmcp.css (bloque actualizable)',
      )
      .option('-f, --force', 'sobrescribir si ya existe')
      .option('--json', 'salida JSON'),
  ).action(
    async (
      ids: string[],
      o: CommonOpts & { output: string; merge?: string; force?: boolean },
    ) => {
      const results = [];
      for (const id of ids) {
        const r = await importComponent(id, {
          ...clientOptions(o),
          output: o.output,
          merge: o.merge,
          force: o.force,
        });
        results.push(r);
        if (!o.json) {
          if (r.skipped) logger.info(`${chalk.bold(id)} ya estaba al día en ${r.dir}`);
          else logger.success(`${chalk.bold(id)} v${r.version} → ${r.dir}`);
          for (const f of r.files) console.log(`    ${chalk.dim(f)}`);
          if (r.merged)
            console.log(`    ${chalk.dim(`contrato fusionado en ${r.merged}`)}`);
        }
      }
      if (o.json) return json({ imported: results });
      logger.info(`Registro: ${chalk.dim(LOCK_FILE)}`);
    },
  );

  withCommon(
    cmp
      .command('update')
      .description('Actualiza los componentes importados (según el lock)')
      .argument('[ids...]', 'solo estos componentes')
      .option('--dry-run', 'solo informar, sin escribir')
      .option('--merge <css>', 'reescribir también el bloque fusionado en este CSS')
      .option('--json', 'salida JSON'),
  ).action(
    async (ids: string[], o: CommonOpts & { dryRun?: boolean; merge?: string }) => {
      const lock = readLock();
      if (!Object.keys(lock.components).length) {
        if (o.json) return json({ statuses: [] });
        logger.warn(`No hay componentes importados (${LOCK_FILE}).`);
        return;
      }
      const { statuses, resolved } = await updateComponents({
        ...clientOptions(o),
        dryRun: o.dryRun,
        merge: o.merge,
        ids,
      });
      if (o.json) return json({ source: resolved.source, statuses });
      logger.title('WebMCPcss · components update');
      logger.info(`Fuente: ${sourceNote(resolved.source, resolved.location)}`);
      for (const s of statuses) {
        const icon =
          s.status === 'updated'
            ? chalk.green('↑')
            : s.status === 'outdated'
              ? chalk.yellow('!')
              : s.status === 'missing-remote'
                ? chalk.red('?')
                : chalk.green('✔');
        const label =
          s.status === 'updated'
            ? `actualizado ${s.installed} → ${s.available}`
            : s.status === 'outdated'
              ? `disponible ${s.available} (instalado ${s.installed})`
              : s.status === 'missing-remote'
                ? 'ya no existe en el hub'
                : `al día (${s.installed})`;
        console.log(`  ${icon} ${chalk.bold(s.id)} — ${label}`);
      }
      if (o.dryRun && statuses.some((s) => s.status === 'outdated')) {
        logger.info('Ejecuta sin --dry-run para aplicar.');
      }
    },
  );

  withCommon(
    cmp
      .command('demo')
      .description('Genera un sitio de demostración con componentes del hub')
      .option('-o, --output <dir>', 'carpeta destino', 'webmcp-demo')
      .option('-l, --library <library>', `librería: ${HUB_LIBRARIES.join(', ')}`, 'core')
      .option('--ids <ids>', 'componentes concretos, separados por comas')
      .option('--json', 'salida JSON'),
  ).action(async (o: CommonOpts & { output: string; library: string; ids?: string }) => {
    if (!(HUB_LIBRARIES as readonly string[]).includes(o.library)) {
      throw new Error(
        `Librería inválida "${o.library}". Usa: ${HUB_LIBRARIES.join(', ')}`,
      );
    }
    const result = await buildDemoSite({
      ...clientOptions(o),
      output: o.output,
      library: o.library as (typeof HUB_LIBRARIES)[number],
      ids: o.ids
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
    if (o.json) return json(result);
    logger.success(
      `Demo generada en ${chalk.bold(result.dir)} con ${result.components.length} componente(s)`,
    );
    for (const f of result.files) console.log(`    ${chalk.dim(f)}`);
    logger.info(`Ábrela: ${chalk.bold(path.join(result.dir, 'index.html'))}`);
    logger.info(
      `Sirve el contrato a agentes: ${chalk.bold(`webmcpcss mcp --serve --css ${path.join(result.dir, 'webmcp.css')}`)}`,
    );
  });

  cmp
    .command('publish')
    .description('Publica un componente como PR a components/community/ del hub')
    .argument('<css>', 'archivo .webmcp.css del componente')
    .requiredOption('-n, --name <name>', 'nombre legible (ej. "Botón de reserva")')
    .requiredOption(
      '-c, --category <category>',
      `categoría: ${HUB_CATEGORIES.join(', ')}`,
    )
    .option('-l, --library <library>', `librería: ${HUB_LIBRARIES.join(', ')}`, 'core')
    .option('--html <file>', 'HTML de ejemplo (si falta se genera uno mínimo)')
    .option('-d, --description <text>', 'descripción para agentes (≥ 15 caracteres)')
    .option('--tags <tags>', 'etiquetas separadas por comas')
    .option('--author <name>', 'autor/a')
    .option('--component-version <semver>', 'versión del componente', '1.0.0')
    .option('--token <token>', 'token de GitHub (o variable GITHUB_TOKEN)')
    .option('--dry-run', 'validar y mostrar los archivos sin publicar')
    .option('--json', 'salida JSON')
    .action(
      async (
        css: string,
        o: {
          name: string;
          category: string;
          library: string;
          html?: string;
          description?: string;
          tags?: string;
          author?: string;
          componentVersion: string;
          token?: string;
          dryRun?: boolean;
          json?: boolean;
        },
      ) => {
        const prepared = prepareComponent({
          cssPath: css,
          name: o.name,
          category: o.category,
          library: o.library,
          htmlPath: o.html,
          description: o.description,
          tags: o.tags
            ?.split(',')
            .map((t) => t.trim())
            .filter(Boolean),
          author: o.author,
          version: o.componentVersion,
        });
        if (o.dryRun) {
          if (o.json) return json({ dryRun: true, ...prepared });
          logger.title('WebMCPcss · components publish (dry-run)');
          logger.success(
            `${chalk.bold(prepared.id)} válido: ${prepared.summary.tools} herramienta(s), ${prepared.summary.context} contexto(s), ${prepared.summary.animations} animación(es)`,
          );
          console.log(`  ${chalk.dim(`${prepared.dir}/component.json`)}`);
          console.log(`  ${chalk.dim(`${prepared.dir}/${prepared.meta.css}`)}`);
          console.log(`  ${chalk.dim(`${prepared.dir}/${prepared.meta.html}`)}`);
          console.log(JSON.stringify(prepared.meta, null, 2));
          return;
        }
        const token = o.token ?? process.env.GITHUB_TOKEN;
        if (!token) {
          throw new Error(
            'Falta el token de GitHub: exporta GITHUB_TOKEN o usa --token. Prueba primero con --dry-run.',
          );
        }
        if (!o.json) logger.title('WebMCPcss · components publish');
        const result = await publishComponent({ component: prepared, token });
        if (o.json) return json({ id: prepared.id, ...result });
        logger.success(`PR creado: ${chalk.bold(result.prUrl)}`);
        console.log(`  fork: ${result.fork} · rama: ${result.branch}`);
        for (const f of result.files) console.log(`    ${chalk.dim(f)}`);
      },
    );

  cmp
    .command('build')
    .description('(Mantenedores) regenera site/components y site/api/components.json')
    .option('--components <dir>', 'carpeta components/', 'components')
    .option('--out <dir>', 'carpeta del sitio', 'site')
    .option(
      '--docs <dir>',
      'carpeta con getting-started.md, component-usage.md, contributing.md',
      'docs/hub',
    )
    .option('--base-url <url>', 'URL pública del sitio')
    .option('--check', 'no escribir: fallar si el sitio está desactualizado')
    .action(
      async (o: {
        components: string;
        out: string;
        docs: string;
        baseUrl?: string;
        check?: boolean;
      }) => {
        const { buildHubSite, checkHubSite } = await import('./hub/site');
        let animationRuntime: string | undefined;
        try {
          const { buildRuntimeScript } = await import('./animation/runtime-bundle');
          animationRuntime = buildRuntimeScript();
        } catch {
          /* sin build */
        }
        const options = {
          componentsDir: path.resolve(o.components),
          siteDir: path.resolve(o.out),
          docsDir: fs.existsSync(o.docs) ? path.resolve(o.docs) : undefined,
          baseUrl: o.baseUrl ?? resolveHubUrl(),
          animationRuntime,
        };
        if (o.check) {
          const stale = checkHubSite(options);
          if (stale.length) {
            throw new Error(
              `Sitio del hub desactualizado (${stale.length} archivo(s)). Ejecuta: webmcpcss components build\n- ${stale.slice(0, 10).join('\n- ')}`,
            );
          }
          logger.success('Sitio del Component Hub al día.');
          return;
        }
        const result = buildHubSite(options);
        for (const w of result.warnings) logger.warn(w);
        logger.success(
          `Hub generado: ${result.components} componentes, ${result.files.length} archivos en ${options.siteDir}`,
        );
      },
    );

  // Atajo: `webmcpcss components show <id>` (útil para depurar sin importar).
  withCommon(
    cmp
      .command('show')
      .description('Muestra el contrato .webmcp.css y el HTML de un componente')
      .argument('<id>', 'identificador')
      .option('--json', 'salida JSON'),
  ).action(async (id: string, o: CommonOpts) => {
    const files = await fetchComponent(id, clientOptions(o));
    if (o.json)
      return json({ ...files.entry, meta: files.meta, css: files.css, html: files.html });
    logger.title(`${files.entry.name} · ${files.entry.id} · v${files.entry.version}`);
    console.log(chalk.dim(files.entry.description));
    console.log(`\n${chalk.bold(files.meta.css ?? 'webmcp.css')}\n`);
    console.log(files.css.trimEnd());
    console.log(`\n${chalk.bold(files.meta.html ?? 'html')}\n`);
    console.log(files.html.trimEnd());
  });
}
