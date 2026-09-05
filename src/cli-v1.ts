/**
 * Comandos CLI de la v1.0.0 (10 ideas innovadoras). Se registran desde
 * `cli.ts` con {@link registerV1Commands} para mantener el archivo principal
 * manejable. Todos siguen el patrón de subcomandos anidados (`webmcpcss
 * design analyze …`, `webmcpcss web3 pay …`).
 */
import chalk from 'chalk';
import type { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import type { Browser, Page } from 'puppeteer';
import {
  auditPage,
  buildA11yCss,
  buildA11yFixScript,
  buildA11yWorkflow,
  passesThresholds,
  type A11yImpact,
} from './a11y';
import {
  analyzeDescription,
  analyzeFigma,
  analyzeImage,
  generateFromDesign,
  optimizeToolMap,
  validateDesign,
  type DesignPageProbe,
  type DesignStructure,
} from './design-to-webmcp';
import { generateDocs, startDocServer } from './doc';
import { assist, initProject } from './framework';
import { parseWebMCP, parseWebMCPFile, serializeToolMap } from './parser';
import { createLlmClient } from './prompt';
import { discoverWebMCP } from './proxy';
import { recommend, recordOutcome } from './recommender';
import {
  enhanceRetroWithLlm,
  fetchHtml,
  injectRetro,
  publishRetro,
  scanLegacyHtml,
  startRetroProxy,
} from './retro';
import {
  agentFromHeaders,
  createAgentToken,
  suggestPolicies,
  validateSecurity,
  type AgentIdentity,
  type PermissionLevel,
} from './security';
import {
  buildTestPlan,
  buildTestWorkflow,
  generateTests,
  puppeteerProbe,
  runTestPlan,
  toJUnit,
  type TestFramework,
  type TestPlan,
} from './testing';
import type { ToolMap } from './types';
import { appendHistory } from './utils/history';
import { logger } from './utils/logger';
import {
  applyMigration,
  buildMigration,
  createSnapshot,
  diffSnapshots,
  snapshotToToolMap,
  verifySnapshot,
  type Snapshot,
} from './versioning';
import {
  AgentWallet,
  deployContract,
  getBalance,
  listPaidTools,
  sendPayment,
  validatePayments,
  WEBMCP_PAYMENTS_SOL,
  buildWalletConnectorScript,
  type SpendingLimits,
} from './web3';

/** Dependencias inyectadas desde cli.ts (navegador). */
export interface V1Deps {
  launchBrowser(headless: boolean): Promise<Browser>;
  navigate(page: Page, url: string): Promise<void>;
}

interface LlmOpts {
  llm?: string;
  model?: string;
  llmBaseUrl?: string;
}

const llmFrom = (o: LlmOpts) =>
  createLlmClient({ provider: o.llm, model: o.model, baseUrl: o.llmBaseUrl });
const addLlmOptions = (c: Command) =>
  c
    .option('--llm <provider>', 'proveedor LLM: ollama | openai | anthropic | none')
    .option('--model <model>', 'modelo LLM')
    .option('--llm-base-url <url>', 'URL base del proveedor LLM');
const writeOut = (file: string, content: string) => {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  // En modo --json (stdout reservado) el aviso va a stderr.
  if (process.argv.includes('--json')) console.error(`✔ Escrito ${file}`);
  else logger.success(`Escrito ${chalk.bold(file)}`);
};
const json = (v: unknown) => console.log(JSON.stringify(v, null, 2));
const readMap = (css: string): ToolMap => parseWebMCPFile(css);

async function withPage<T>(
  deps: V1Deps,
  url: string,
  headless: boolean | undefined,
  fn: (page: Page) => Promise<T>,
): Promise<T> {
  const browser = await deps.launchBrowser(headless ?? true);
  try {
    const page = await browser.newPage();
    await deps.navigate(page, url);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

/**
 * Registra todos los comandos v1.0.0 en el programa.
 * @param program Instancia de commander.
 * @param deps Navegador.
 */
export function registerV1Commands(program: Command, deps: V1Deps): void {
  registerInitAndAssist(program);
  registerDesign(program, deps);
  registerRetro(program, deps);
  registerA11y(program, deps);
  registerTest(program, deps);
  registerVersion(program, deps);
  registerDoc(program);
  registerSecurity(program);
  registerRecommend(program);
  registerWeb3(program);
}

/* ------------------------------------------------------------------ */
/* init / assist (IA-First Framework)                                   */
/* ------------------------------------------------------------------ */
function registerInitAndAssist(program: Command): void {
  program
    .command('init')
    .description(
      'Crea un proyecto IA-First con componentes WebMCP listos (HTML + .webmcp.css + MCP)',
    )
    .argument('[dir]', 'carpeta destino', '.')
    .option('--framework <name>', 'plantilla: ia-first | minimal', 'ia-first')
    .option('-n, --name <name>', 'nombre del proyecto')
    .option('--url <url>', 'URL pública prevista')
    .option('-f, --force', 'sobrescribe archivos existentes')
    .option('--json', 'salida JSON')
    .action(
      (
        dir: string,
        o: {
          framework: string;
          name?: string;
          url?: string;
          force?: boolean;
          json?: boolean;
        },
      ) => {
        if (!o.json) logger.title('WebMCPcss · init');
        const result = initProject({
          dir,
          name: o.name,
          framework: o.framework === 'minimal' ? 'minimal' : 'ia-first',
          url: o.url,
          force: o.force,
        });
        if (o.json) return json(result);
        logger.success(
          `Proyecto creado en ${chalk.bold(result.dir)} (${result.files.length} archivos, ${result.tools.length} tools)`,
        );
        for (const f of result.files) console.log(`  ${chalk.dim('•')} ${f}`);
        console.log(
          `\n${chalk.dim('Siguiente:')} cd ${dir} && npx serve .   ${chalk.dim('→')} webmcpcss validate http://localhost:3000 webmcp.css`,
        );
      },
    );

  addLlmOptions(
    program
      .command('assist')
      .description(
        'Genera componentes IA-First desde una petición ("crea un formulario de contacto")',
      )
      .argument('<request>', 'petición en lenguaje natural')
      .option(
        '-o, --output <dir>',
        'carpeta donde escribir component.html y component.webmcp.css',
      )
      .option('--json', 'salida JSON'),
  ).action(async (request: string, o: LlmOpts & { output?: string; json?: boolean }) => {
    if (!o.json) logger.title('WebMCPcss · assist');
    const result = await assist(request, llmFrom(o));
    if (o.json) return json(result);
    logger.info(`Plan (${result.plan.source}): ${result.plan.rationale}`);
    for (const c of result.rendered)
      console.log(
        `  ${chalk.green('✔')} ${c.component} → tools: ${Object.keys(c.tools).join(', ') || '—'}`,
      );
    if (o.output) {
      writeOut(path.join(o.output, 'component.html'), result.html);
      writeOut(path.join(o.output, 'component.webmcp.css'), result.css);
    } else {
      console.log(
        `\n${chalk.bold('HTML')}\n${result.html}\n\n${chalk.bold('.webmcp.css')}\n${result.css}`,
      );
    }
  });
}

/* ------------------------------------------------------------------ */
/* design                                                               */
/* ------------------------------------------------------------------ */
function registerDesign(program: Command, deps: V1Deps): void {
  const design = program
    .command('design')
    .description('Design-to-WebMCP: de un diseño (imagen, Figma o texto) a .webmcp.css');

  addLlmOptions(
    design
      .command('analyze')
      .description('Analiza un diseño y genera el .webmcp.css + HTML de andamiaje')
      .option('--image <file>', 'captura/mockup PNG, JPEG, GIF o WebP')
      .option('--figma <ref>', 'URL o clave de archivo Figma (FIGMA_TOKEN en el entorno)')
      .option('--text <description>', 'descripción textual del diseño')
      .option('-o, --output <file>', 'archivo .webmcp.css de salida', 'design.webmcp.css')
      .option('--scaffold <file>', 'escribe también el HTML de andamiaje')
      .option('--design-json <file>', 'guarda la estructura del diseño (para validate)')
      .option('--json', 'salida JSON'),
  ).action(
    async (
      o: LlmOpts & {
        image?: string;
        figma?: string;
        text?: string;
        output: string;
        scaffold?: string;
        designJson?: string;
        json?: boolean;
      },
    ) => {
      if (!o.json) logger.title('WebMCPcss · design analyze');
      let structure: DesignStructure;
      if (o.image) structure = await analyzeImage(o.image, llmFrom(o));
      else if (o.figma) {
        const token = process.env.FIGMA_TOKEN;
        if (!token)
          throw new Error(
            'Define FIGMA_TOKEN en el entorno para analizar archivos Figma.',
          );
        structure = await analyzeFigma(o.figma, token);
      } else if (o.text) structure = await analyzeDescription(o.text, llmFrom(o));
      else throw new Error('Indica --image, --figma o --text.');
      const gen = generateFromDesign(structure);
      if (o.json) return json({ structure, generation: gen });
      logger.info(
        `Diseño: ${structure.title} · ${structure.elements.length} elementos · método ${structure.method}`,
      );
      for (const m of gen.mapping)
        console.log(
          `  ${chalk.green('✔')} ${m.tool} ← ${m.elementId} (${(m.confidence * 100).toFixed(0)} %)`,
        );
      for (const w of gen.warnings) logger.warn(w);
      writeOut(o.output, gen.css);
      if (o.scaffold) writeOut(o.scaffold, gen.scaffoldHtml);
      if (o.designJson) writeOut(o.designJson, JSON.stringify(structure, null, 2));
    },
  );

  design
    .command('validate')
    .description('Compara el .webmcp.css generado desde el diseño con el sitio real')
    .requiredOption(
      '--design <file>',
      'archivo .webmcp.css o la estructura JSON guardada con --design-json',
    )
    .requiredOption('--url <url>', 'URL del sitio implementado')
    .option(
      '--css <file>',
      '.webmcp.css a validar (si --design es el JSON de estructura)',
    )
    .option('--no-headless', 'muestra el navegador')
    .option('--json', 'salida JSON')
    .action(
      async (o: {
        design: string;
        url: string;
        css?: string;
        headless?: boolean;
        json?: boolean;
      }) => {
        if (!o.json) logger.title('WebMCPcss · design validate');
        let structure: DesignStructure | undefined;
        let map: ToolMap;
        if (o.design.endsWith('.json')) {
          structure = JSON.parse(fs.readFileSync(o.design, 'utf8')) as DesignStructure;
          map = o.css ? readMap(o.css) : generateFromDesign(structure).toolMap;
        } else map = readMap(o.design);
        const report = await withPage(deps, o.url, o.headless, async (page) => {
          const probe: DesignPageProbe = {
            probe: (selector) =>
              page.evaluate((s) => {
                const el = document.querySelector(s);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return {
                  text: (el.textContent ?? '').trim().slice(0, 120),
                  box: { x: r.x, y: r.y, width: r.width, height: r.height },
                  visible: r.width > 0 && r.height > 0,
                };
              }, selector),
            viewport: async () => page.viewport() ?? { width: 1280, height: 800 },
          };
          return validateDesign(map, probe, structure, o.url);
        });
        if (o.json) return json(report);
        logger.info(
          `Puntuación ${chalk.bold(String(report.score))}/100 · ${report.checks.filter((c) => c.status === 'ok').length}/${report.checks.length} correctas`,
        );
        for (const c of report.checks)
          console.log(
            `  ${c.status === 'ok' ? chalk.green('✔') : c.status === 'missing' ? chalk.red('✖') : chalk.yellow('⚠')} ${c.tool} ${chalk.dim(c.selector)} ${c.status}${c.labelExpected && c.labelFound && !c.labelMatch ? chalk.dim(` (esperado "${c.labelExpected}", encontrado "${c.labelFound}")`) : ''}${c.positionDelta !== undefined ? chalk.dim(` Δpos ${(c.positionDelta * 100).toFixed(0)} %`) : ''}`,
          );
        if (report.score < 60) process.exitCode = 1;
      },
    );

  design
    .command('optimize')
    .description(
      'Optimiza un .webmcp.css para agentes (nombres, descripciones, selectores, confirmaciones)',
    )
    .argument('<css>', 'archivo .webmcp.css')
    .option('-o, --output <file>', 'archivo de salida (por defecto solo informa)')
    .option('--json', 'salida JSON')
    .action((css: string, o: { output?: string; json?: boolean }) => {
      if (!o.json) logger.title('WebMCPcss · design optimize');
      const result = optimizeToolMap(readMap(css), { apply: Boolean(o.output) });
      if (o.json) return json(result);
      logger.info(
        `Puntuación IA-friendly: ${result.scoreBefore} → ${chalk.bold(String(result.scoreAfter))}`,
      );
      for (const s of result.suggestions)
        console.log(
          `  ${s.autofix && o.output ? chalk.green('✔') : chalk.yellow('•')} [${s.severity}/${s.kind}] ${s.tool} ${s.message}${s.after ? chalk.dim(` → ${s.after}`) : ''}`,
        );
      if (o.output) writeOut(o.output, serializeToolMap(result.toolMap));
    });
}

/* ------------------------------------------------------------------ */
/* retro                                                                */
/* ------------------------------------------------------------------ */
function registerRetro(program: Command, deps: V1Deps): void {
  const retro = program
    .command('retro')
    .description('Retro-WebMCP: dota de WebMCP a sitios legacy sin tocar su código');

  addLlmOptions(
    retro
      .command('scan')
      .description('Escanea un sitio legacy y propone un .webmcp.css')
      .argument('<url>', 'URL o archivo HTML')
      .option('-o, --output <file>', 'archivo .webmcp.css de salida')
      .option('--json', 'salida JSON'),
  ).action(async (url: string, o: LlmOpts & { output?: string; json?: boolean }) => {
    if (!o.json) logger.title('WebMCPcss · retro scan');
    const html = fs.existsSync(url) ? fs.readFileSync(url, 'utf8') : await fetchHtml(url);
    const scan = scanLegacyHtml(html, fs.existsSync(url) ? undefined : url);
    const llm = llmFrom(o);
    let improved = 0;
    if (llm) improved = await enhanceRetroWithLlm(scan, llm);
    if (o.json) return json(scan);
    logger.info(
      `${scan.title || url} · legacy ${chalk.bold(String(scan.legacyScore))}/100 · ${Object.keys(scan.toolMap.tools).length} tools, ${Object.keys(scan.toolMap.context).length} contextos${improved ? ` · ${improved} descripciones mejoradas por LLM` : ''}`,
    );
    for (const s of scan.signals)
      console.log(
        `  ${chalk.dim('•')} ${s.kind} ${chalk.dim(`(${s.count}) ${s.detail}`)}`,
      );
    for (const [name, t] of Object.entries(scan.toolMap.tools))
      console.log(
        `  ${chalk.green('✔')} ${name} ${chalk.dim(t.selector)} — ${t.description}`,
      );
    for (const n of scan.notes) logger.warn(n);
    if (o.output) writeOut(o.output, serializeToolMap(scan.toolMap));
    else console.log(`\n${serializeToolMap(scan.toolMap)}`);
  });

  retro
    .command('proxy')
    .description('Proxy de compatibilidad que sirve el sitio legacy con WebMCP inyectado')
    .argument('<url>', 'URL origen del sitio legacy')
    .requiredOption('--css <file>', 'archivo .webmcp.css a inyectar')
    .option('-p, --port <port>', 'puerto local', '8080')
    .option('--no-model-context', 'no registrar en navigator.modelContext')
    .action(
      async (url: string, o: { css: string; port: string; modelContext?: boolean }) => {
        logger.title('WebMCPcss · retro proxy');
        const { url: local } = await startRetroProxy({
          target: url,
          css: fs.readFileSync(o.css, 'utf8'),
          port: Number(o.port),
          registerModelContext: o.modelContext !== false,
        });
        logger.success(`Proxy en ${chalk.bold(local)} → ${url}`);
        logger.info(
          `Contrato: ${local}/.webmcp/webmcp.css · ${local}/.well-known/webmcp.json`,
        );
        await new Promise(() => undefined);
      },
    );

  retro
    .command('inject')
    .description(
      'Abre el sitio en un navegador con WebMCP inyectado (window.__WEBMCP_GRAPH__)',
    )
    .argument('<url>', 'URL del sitio')
    .requiredOption('--css <file>', 'archivo .webmcp.css')
    .option('--browser', 'mantiene el navegador abierto (modo visible)')
    .option('--json', 'salida JSON')
    .action(
      async (url: string, o: { css: string; browser?: boolean; json?: boolean }) => {
        if (!o.json) logger.title('WebMCPcss · retro inject');
        const css = fs.readFileSync(o.css, 'utf8');
        const map = parseWebMCP(css);
        const browser = await deps.launchBrowser(!o.browser);
        try {
          const page = await browser.newPage();
          await deps.navigate(page, url);
          const result = await injectRetro(page, map, css);
          if (o.json) json(result);
          else {
            logger.success(
              `Inyectado: ${result.tools.length} tools (${result.tools.filter((t) => t.exists).length} presentes en la página)`,
            );
            for (const m of result.missing) logger.warn(`selector ausente: ${m}`);
          }
          if (o.browser) {
            logger.info('Navegador abierto; Ctrl+C para salir.');
            await new Promise(() => undefined);
          }
        } finally {
          if (!o.browser) await browser.close();
        }
      },
    );

  retro
    .command('publish')
    .description(
      'Publica el .webmcp.css de un sitio legacy en el repositorio comunitario',
    )
    .argument('<css>', 'archivo .webmcp.css')
    .requiredOption('--domain <domain>', 'dominio del sitio (ej. tienda-antigua.com)')
    .option('--token <token>', 'token de GitHub (o GITHUB_TOKEN)')
    .option('--dry-run', 'solo prepara el envío')
    .option('--json', 'salida JSON')
    .action(
      async (
        css: string,
        o: { domain: string; token?: string; dryRun?: boolean; json?: boolean },
      ) => {
        if (!o.json) logger.title('WebMCPcss · retro publish');
        const token = o.token ?? process.env.GITHUB_TOKEN ?? '';
        if (!token && !o.dryRun)
          throw new Error('Necesitas --token o GITHUB_TOKEN (o usa --dry-run).');
        const { submission, result } = await publishRetro({
          domain: o.domain,
          token,
          css: fs.readFileSync(css, 'utf8'),
          dryRun: o.dryRun,
        });
        if (o.json)
          return json({ submission: { ...submission, css: undefined }, result });
        logger.info(
          `${submission.domain}: ${submission.tools} tools, ${submission.context} contextos`,
        );
        if (result) logger.success(`Publicado: ${result.prUrl}`);
        else logger.info('Dry-run: no se publicó nada.');
      },
    );
}

/* ------------------------------------------------------------------ */
/* a11y                                                                 */
/* ------------------------------------------------------------------ */
function registerA11y(program: Command, deps: V1Deps): void {
  const a11y = program
    .command('a11y')
    .description(
      'A11y-MCP: auditoría y corrección de accesibilidad para agentes y personas',
    );

  a11y
    .command('audit')
    .description('Audita la accesibilidad de una URL (WCAG 2.2 AA, subconjunto práctico)')
    .requiredOption('--url <url>', 'URL o archivo HTML')
    .option('--min-score <n>', 'puntuación mínima para salir con 0', '0')
    .option(
      '--fail-on <impact>',
      'falla si hay problemas de este impacto o superior: critical | serious | moderate | minor | none',
      'none',
    )
    .option('--no-headless', 'muestra el navegador')
    .option('--json', 'salida JSON')
    .option('--ci', 'genera .github/workflows/webmcp-a11y.yml para esta URL')
    .action(
      async (o: {
        url: string;
        minScore: string;
        failOn: string;
        headless?: boolean;
        json?: boolean;
        ci?: boolean;
      }) => {
        if (!o.json) logger.title('WebMCPcss · a11y audit');
        const summary = await withPage(deps, o.url, o.headless, (page) =>
          auditPage(page),
        );
        const verdict = passesThresholds(
          summary,
          Number(o.minScore),
          o.failOn as A11yImpact | 'none',
        );
        appendHistory({
          type: 'validate',
          url: o.url,
          ok: verdict.ok,
          details: { a11yScore: summary.score, issues: summary.total },
        });
        if (o.json) json({ ...summary, verdict });
        else {
          logger.info(
            `${summary.title || o.url} · puntuación ${chalk.bold(String(summary.score))}/100 · ${summary.total} problemas (${Object.entries(
              summary.byImpact,
            )
              .map(([k, v]) => `${v} ${k}`)
              .join(', ')})`,
          );
          for (const i of summary.issues.slice(0, 60))
            console.log(
              `  ${i.impact === 'critical' ? chalk.red('✖') : i.impact === 'serious' ? chalk.yellow('⚠') : chalk.dim('•')} [${i.rule} ${i.wcag}] ${i.message} ${chalk.dim(i.selector)}`,
            );
          if (summary.issues.length > 60)
            console.log(chalk.dim(`  … ${summary.issues.length - 60} más (usa --json)`));
          verdict.ok
            ? logger.success('Umbrales superados')
            : logger.error(`No supera los umbrales: ${verdict.reasons.join('; ')}`);
        }
        if (o.ci)
          writeOut(
            '.github/workflows/webmcp-a11y.yml',
            buildA11yWorkflow({
              urls: [o.url],
              minScore: Number(o.minScore) || 80,
              failOnCritical: o.failOn !== 'none',
            }),
          );
        if (!verdict.ok) process.exitCode = 1;
      },
    );

  a11y
    .command('fix')
    .description(
      'Genera un .webmcp.css con correcciones declarativas (webmcp-accessibility) y un script para aplicarlas',
    )
    .requiredOption('--url <url>', 'URL o archivo HTML')
    .option('-o, --output <file>', 'archivo .webmcp.css de salida', 'a11y.webmcp.css')
    .option('--script <file>', 'escribe también el script JS que aplica las correcciones')
    .option('--no-headless', 'muestra el navegador')
    .option('--json', 'salida JSON')
    .action(
      async (o: {
        url: string;
        output: string;
        script?: string;
        headless?: boolean;
        json?: boolean;
      }) => {
        if (!o.json) logger.title('WebMCPcss · a11y fix');
        const summary = await withPage(deps, o.url, o.headless, (page) =>
          auditPage(page),
        );
        const css = buildA11yCss(summary);
        const map = parseWebMCP(css);
        if (o.json)
          return json({
            score: summary.score,
            fixes: Object.keys(map.context).length,
            css,
          });
        logger.info(
          `${summary.total} problemas · ${Object.keys(map.context).length} correcciones declarativas`,
        );
        writeOut(o.output, css);
        if (o.script) writeOut(o.script, buildA11yFixScript(map));
        appendHistory({
          type: 'repair',
          url: o.url,
          ok: true,
          details: { a11yFixes: Object.keys(map.context).length },
        });
      },
    );
}

/* ------------------------------------------------------------------ */
/* test                                                                 */
/* ------------------------------------------------------------------ */
function registerTest(program: Command, deps: V1Deps): void {
  const test = program
    .command('test')
    .description('Test-MCP: genera y ejecuta pruebas a partir de un .webmcp.css');

  test
    .command('generate')
    .description('Genera pruebas Playwright o Cypress desde un .webmcp.css')
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .option('-o, --output <file>', 'archivo de pruebas (webmcp.spec.ts | webmcp.cy.js)')
    .option('--framework <fw>', 'playwright | cypress', 'playwright')
    .option('--url <url>', 'URL base de las pruebas', 'http://localhost:3000')
    .option('--execute', 'incluye casos que ejecutan tools seguras con datos de ejemplo')
    .option('--ci', 'genera .github/workflows/webmcp-tests.yml')
    .option('--json', 'salida JSON (plan)')
    .action(
      (o: {
        file: string;
        output?: string;
        framework: string;
        url: string;
        execute?: boolean;
        ci?: boolean;
        json?: boolean;
      }) => {
        if (!o.json) logger.title('WebMCPcss · test generate');
        const { code, plan, filename } = generateTests(readMap(o.file), {
          framework: o.framework as TestFramework,
          url: o.url,
          source: o.file,
          execute: o.execute,
        });
        if (o.json) return json(plan);
        logger.info(`${plan.cases.length} casos (${o.framework})`);
        writeOut(o.output ?? filename, code);
        if (o.ci)
          writeOut(
            '.github/workflows/webmcp-tests.yml',
            buildTestWorkflow({ url: o.url, css: o.file }),
          );
      },
    );

  test
    .command('run')
    .description(
      'Ejecuta el plan de pruebas de un .webmcp.css contra una URL (sin instalar Playwright)',
    )
    .requiredOption('--url <url>', 'URL o archivo HTML')
    .requiredOption(
      '--file <css>',
      'archivo .webmcp.css (o plan JSON de test generate --json)',
    )
    .option('--execute', 'ejecuta también las tools seguras con datos de ejemplo')
    .option('--junit <file>', 'escribe el informe JUnit XML')
    .option('--no-headless', 'muestra el navegador')
    .option('--json', 'salida JSON')
    .action(
      async (o: {
        url: string;
        file: string;
        execute?: boolean;
        junit?: string;
        headless?: boolean;
        json?: boolean;
      }) => {
        if (!o.json) logger.title('WebMCPcss · test run');
        const plan: TestPlan = o.file.endsWith('.json')
          ? (JSON.parse(fs.readFileSync(o.file, 'utf8')) as TestPlan)
          : buildTestPlan(readMap(o.file), { source: o.file, execute: o.execute });
        const report = await withPage(deps, o.url, o.headless, (page) =>
          runTestPlan(plan, puppeteerProbe(page), { execute: o.execute }),
        );
        appendHistory({
          type: 'validate',
          url: o.url,
          ok: report.failed === 0,
          details: { tests: report.total, failed: report.failed },
        });
        if (o.junit) writeOut(o.junit, toJUnit(report));
        if (o.json) json(report);
        else {
          for (const r of report.results)
            console.log(
              `  ${r.status === 'passed' ? chalk.green('✔') : r.status === 'skipped' ? chalk.dim('○') : chalk.red('✖')} ${r.name}${r.message ? chalk.dim(` — ${r.message}`) : ''}`,
            );
          (report.failed ? logger.error : logger.success)(
            `${report.passed}/${report.total} pasadas, ${report.failed} fallidas, ${report.skipped} omitidas (${report.durationMs} ms)`,
          );
        }
        if (report.failed) process.exitCode = 1;
      },
    );
}

/* ------------------------------------------------------------------ */
/* version                                                              */
/* ------------------------------------------------------------------ */
function registerVersion(program: Command, deps: V1Deps): void {
  const version = program
    .command('version')
    .description(
      'Version-MCP: snapshots, diffs semánticos y migraciones del contrato WebMCP',
    );

  version
    .command('snapshot')
    .description('Congela el contrato actual (opcionalmente comprobando la página real)')
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .option('--url <url>', 'URL para comprobar presencia y huellas')
    .option('-o, --output <file>', 'archivo JSON de salida', 'webmcp.snapshot.json')
    .option('--tag <version>', 'versión declarada del contrato', '1.0.0')
    .option('--no-headless', 'muestra el navegador')
    .action(
      async (o: {
        file: string;
        url?: string;
        output: string;
        tag: string;
        headless?: boolean;
      }) => {
        logger.title('WebMCPcss · version snapshot');
        const map = readMap(o.file);
        const snap = o.url
          ? await withPage(deps, o.url, o.headless, (page) =>
              createSnapshot(map, { version: o.tag, url: o.url, page }),
            )
          : await createSnapshot(map, { version: o.tag });
        writeOut(o.output, JSON.stringify(snap, null, 2));
        const missing = Object.entries(snap.tools)
          .filter(([, t]) => t.present === false)
          .map(([n]) => n);
        logger.info(
          `v${snap.version} · ${Object.keys(snap.tools).length} tools · hash ${snap.hash}${missing.length ? ` · ${chalk.yellow(`${missing.length} ausentes: ${missing.join(', ')}`)}` : ''}`,
        );
      },
    );

  version
    .command('diff')
    .description(
      'Compara dos snapshots (o dos .webmcp.css) y clasifica el impacto semver',
    )
    .argument('<a>', 'snapshot JSON o .webmcp.css antiguo')
    .argument('<b>', 'snapshot JSON o .webmcp.css nuevo')
    .option('--json', 'salida JSON')
    .action(async (a: string, b: string, o: { json?: boolean }) => {
      if (!o.json) logger.title('WebMCPcss · version diff');
      const [sa, sb] = await Promise.all([loadSnapshot(a), loadSnapshot(b)]);
      const diff = diffSnapshots(sa, sb);
      if (o.json) return json(diff);
      logger.info(
        `Impacto ${chalk.bold(diff.impact)} · versión sugerida ${chalk.bold(diff.suggestedVersion)} · +${diff.summary.added} −${diff.summary.removed} ~${diff.summary.changed} ↔${diff.summary.renamed}`,
      );
      for (const c of diff.changes)
        console.log(
          `  ${c.impact === 'major' ? chalk.red('✖') : c.impact === 'minor' ? chalk.yellow('•') : chalk.dim('·')} ${c.kind} ${chalk.bold(c.target)}${c.from ? ` ${chalk.dim(c.from)}` : ''}${c.to ? ` → ${c.to}` : ''}${c.detail ? chalk.dim(` (${c.detail})`) : ''}`,
        );
      if (diff.impact === 'major') process.exitCode = 2;
    });

  version
    .command('migrate')
    .description(
      'Genera el plan de migración entre dos versiones y el .webmcp.css migrado',
    )
    .argument('<a>', 'snapshot/.webmcp.css antiguo')
    .argument('<b>', 'snapshot/.webmcp.css nuevo')
    .option('--url <url>', 'verifica el contrato migrado contra la página')
    .option('-o, --output <file>', 'escribe el .webmcp.css migrado')
    .option('--notes <file>', 'escribe las notas de migración (markdown)')
    .option('--no-headless', 'muestra el navegador')
    .option('--json', 'salida JSON')
    .action(
      async (
        a: string,
        b: string,
        o: {
          url?: string;
          output?: string;
          notes?: string;
          headless?: boolean;
          json?: boolean;
        },
      ) => {
        if (!o.json) logger.title('WebMCPcss · version migrate');
        const [sa, sb] = await Promise.all([loadSnapshot(a), loadSnapshot(b)]);
        const diff = diffSnapshots(sa, sb);
        const plan = buildMigration(diff);
        const migrated = applyMigration(snapshotToToolMap(sa), plan, sb);
        let verification: { present: string[]; missing: string[] } | undefined;
        if (o.url)
          verification = await withPage(deps, o.url, o.headless, (page) =>
            verifySnapshot(
              {
                ...sb,
                tools: Object.fromEntries(
                  Object.entries(migrated.tools).map(([n, t]) => [
                    n,
                    { ...sb.tools[n], selector: t.selector },
                  ]),
                ),
              } as Snapshot,
              page,
            ),
          );
        if (o.json) return json({ diff, plan, migrated, verification });
        console.log(plan.agentNotes);
        if (verification)
          logger.info(
            `Verificación en ${o.url}: ${verification.present.length} presentes, ${verification.missing.length} ausentes${verification.missing.length ? ` (${verification.missing.join(', ')})` : ''}`,
          );
        if (o.output) writeOut(o.output, serializeToolMap(migrated));
        if (o.notes) writeOut(o.notes, plan.agentNotes);
      },
    );
}

async function loadSnapshot(file: string): Promise<Snapshot> {
  if (file.endsWith('.json'))
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Snapshot;
  return createSnapshot(readMap(file), { version: '0.0.0' });
}

/* ------------------------------------------------------------------ */
/* doc                                                                  */
/* ------------------------------------------------------------------ */
function registerDoc(program: Command): void {
  const doc = program
    .command('doc')
    .description(
      'Doc-MCP: documentación interactiva del contrato para humanos y agentes',
    );

  doc
    .command('generate')
    .description('Genera index.html, README.md, doc.json, llms.txt y AGENTS.md')
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .option('-o, --output <dir>', 'carpeta de salida', 'webmcp-docs')
    .option('--title <title>', 'título de la documentación')
    .option('--url <url>', 'URL del sitio (para los ejemplos)')
    .option('--format <fmt>', 'solo un formato: html | md | json | llms | agents')
    .action(
      (o: {
        file: string;
        output: string;
        title?: string;
        url?: string;
        format?: string;
      }) => {
        logger.title('WebMCPcss · doc generate');
        const docs = generateDocs(readMap(o.file), {
          title: o.title,
          url: o.url,
          cssPath: o.file,
        });
        const only: Record<string, keyof typeof docs> = {
          html: 'index.html',
          md: 'README.md',
          json: 'doc.json',
          llms: 'llms.txt',
          agents: 'AGENTS.md',
        };
        const names = o.format
          ? [only[o.format]]
          : (Object.keys(docs) as Array<keyof typeof docs>);
        if (names.some((n) => !n)) throw new Error(`Formato desconocido: ${o.format}`);
        for (const n of names) writeOut(path.join(o.output, n), docs[n]);
      },
    );

  doc
    .command('serve')
    .description(
      'Sirve la documentación interactiva con recarga al cambiar el .webmcp.css',
    )
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .option('-p, --port <port>', 'puerto', '3000')
    .option('--title <title>', 'título')
    .option('--url <url>', 'URL del sitio')
    .action(async (o: { file: string; port: string; title?: string; url?: string }) => {
      logger.title('WebMCPcss · doc serve');
      const { url } = await startDocServer({
        cssPath: o.file,
        port: Number(o.port),
        title: o.title,
        url: o.url,
      });
      logger.success(
        `Documentación en ${chalk.bold(url)} (llms.txt, AGENTS.md, doc.json, README.md)`,
      );
      await new Promise(() => undefined);
    });
}

/* ------------------------------------------------------------------ */
/* security                                                             */
/* ------------------------------------------------------------------ */
function registerSecurity(program: Command): void {
  const security = program
    .command('security')
    .description('Security-MCP: permisos por tool, autenticación de agentes y auditoría');

  security
    .command('validate')
    .description(
      'Audita permisos/autenticación de un .webmcp.css y, opcionalmente, qué puede hacer un agente',
    )
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .option(
      '--agent <spec>',
      'agente: "id:level[:scope1,scope2]" (level = read-only|restricted|full) o un JWT emitido con security token',
    )
    .option('--secret <secret>', 'secreto JWT (o WEBMCP_JWT_SECRET)')
    .option('--suggest', 'imprime las políticas sugeridas en formato .webmcp.css')
    .option('--strict', 'sale con 1 si hay errores')
    .option('--json', 'salida JSON')
    .action(
      (o: {
        file: string;
        agent?: string;
        secret?: string;
        suggest?: boolean;
        strict?: boolean;
        json?: boolean;
      }) => {
        if (!o.json) logger.title('WebMCPcss · security validate');
        const map = readMap(o.file);
        const agent = o.agent
          ? parseAgentSpec(o.agent, o.secret ?? process.env.WEBMCP_JWT_SECRET)
          : undefined;
        const report = validateSecurity(map, agent);
        if (o.json)
          return json({
            ...report,
            suggested: o.suggest ? suggestPolicies(map) : undefined,
          });
        logger.info(
          `Puntuación ${chalk.bold(String(report.score))}/100 · ${report.byLevel['read-only']} read-only, ${report.byLevel.restricted} restricted, ${report.byLevel.full} full`,
        );
        for (const p of report.policies)
          console.log(
            `  ${chalk.dim('•')} ${p.tool}: ${p.permissions}${p.inferred ? chalk.dim(' (inferido)') : ''} · ${p.requires}${p.scopes.length ? ` · scopes ${p.scopes.join(',')}` : ''} · riesgo ${p.risk}`,
          );
        for (const f of report.findings)
          console.log(
            `  ${f.severity === 'error' ? chalk.red('✖') : f.severity === 'warning' ? chalk.yellow('⚠') : chalk.dim('ℹ')} ${f.tool ? `${f.tool}: ` : ''}${f.message}${f.fix ? chalk.dim(` → ${f.fix}`) : ''}`,
          );
        if (report.agent) {
          console.log(`\n${chalk.bold(`Agente ${report.agent.id}`)}`);
          for (const d of report.agent.decisions)
            console.log(
              `  ${d.allowed ? chalk.green('✔') : chalk.red('✖')} ${d.tool}${d.requiresConfirmation ? chalk.yellow(' (confirmación)') : ''}${d.reasons.length ? chalk.dim(` — ${d.reasons.join('; ')}`) : ''}`,
            );
        }
        if (o.suggest) console.log(`\n${suggestPolicies(map)}`);
        if (o.strict && report.findings.some((f) => f.severity === 'error'))
          process.exitCode = 1;
      },
    );

  security
    .command('token')
    .description(
      'Emite un JWT HS256 para un agente (para probar Bearer/agentFromHeaders)',
    )
    .requiredOption('--agent <spec>', '"id:level[:scope1,scope2]"')
    .option('--secret <secret>', 'secreto (o WEBMCP_JWT_SECRET)')
    .option('--ttl <seconds>', 'validez en segundos', '3600')
    .action((o: { agent: string; secret?: string; ttl: string }) => {
      const secret = o.secret ?? process.env.WEBMCP_JWT_SECRET;
      if (!secret) throw new Error('Indica --secret o WEBMCP_JWT_SECRET.');
      const agent = parseAgentSpec(o.agent);
      if (!agent) throw new Error('Especificación de agente inválida.');
      console.log(createAgentToken(agent, secret, { ttlSeconds: Number(o.ttl) }));
    });
}

function parseAgentSpec(spec: string, secret?: string): AgentIdentity | null {
  if (spec.split('.').length === 3 && secret) {
    const a = agentFromHeaders({ authorization: `Bearer ${spec}` }, { secret });
    if (a) return a;
    throw new Error('El JWT no es válido con el secreto indicado.');
  }
  const [id, level = 'read-only', scopes = ''] = spec.split(':');
  if (!id) return null;
  return {
    id,
    level: (['read-only', 'restricted', 'full'].includes(level)
      ? level
      : 'read-only') as PermissionLevel,
    scopes: scopes.split(',').filter(Boolean),
    authenticatedBy: 'auth',
  };
}

/* ------------------------------------------------------------------ */
/* recommend                                                            */
/* ------------------------------------------------------------------ */
function registerRecommend(program: Command): void {
  addLlmOptions(
    program
      .command('recommend')
      .description(
        'Recomienda qué tools usar para un objetivo, aprendiendo del historial local',
      )
      .argument('<goal>', 'objetivo en lenguaje natural ("comprar 2 zapatillas rojas")')
      .option('--url <url>', 'URL del sitio (descubre el contrato o filtra el historial)')
      .option(
        '--css <file>',
        'archivo .webmcp.css (si no se puede descubrir desde la URL)',
      )
      .option('--max-steps <n>', 'máximo de pasos', '3')
      .option('--record', 'registra la recomendación en el historial')
      .option(
        '--outcome <ok|fail>',
        'registra el resultado real de la última recomendación para este objetivo',
      )
      .option('--json', 'salida JSON'),
  ).action(
    async (
      goal: string,
      o: LlmOpts & {
        url?: string;
        css?: string;
        maxSteps: string;
        record?: boolean;
        outcome?: string;
        json?: boolean;
      },
    ) => {
      if (!o.json) logger.title('WebMCPcss · recommend');
      let map: ToolMap | null = null;
      if (o.css) map = readMap(o.css);
      else if (o.url) {
        const discovered = await discoverWebMCP(o.url);
        if (discovered?.css) map = parseWebMCP(discovered.css);
      }
      if (!map)
        throw new Error('No hay contrato: indica --css o una --url que publique WebMCP.');
      const plan = await recommend(goal, map, {
        url: o.url,
        llm: llmFrom(o),
        maxSteps: Number(o.maxSteps),
        record: o.record,
      });
      if (o.outcome) recordOutcome(plan, o.outcome === 'ok');
      if (o.json) return json(plan);
      console.log(plan.explanation);
      if (plan.alternatives.length)
        console.log(
          chalk.dim(
            `Alternativas: ${plan.alternatives.map((a) => `${a.tool} (${a.score})`).join(', ')}`,
          ),
        );
    },
  );
}

/* ------------------------------------------------------------------ */
/* web3                                                                 */
/* ------------------------------------------------------------------ */
function registerWeb3(program: Command): void {
  const web3 = program
    .command('web3')
    .description(
      'Web3-MCP: pagos, micropagos x402/USDC y billeteras de agente con límites de gasto',
    );
  const limitsFrom = (o: {
    maxTx?: string;
    maxSession?: string;
    maxDay?: string;
    allowTo?: string[];
  }): SpendingLimits => ({
    perTx: o.maxTx !== undefined ? Number(o.maxTx) : undefined,
    perSession: o.maxSession !== undefined ? Number(o.maxSession) : undefined,
    perDay: o.maxDay !== undefined ? Number(o.maxDay) : undefined,
    allowedRecipients: o.allowTo,
  });
  const walletFrom = (o: {
    key?: string;
    maxTx?: string;
    maxSession?: string;
    maxDay?: string;
    allowTo?: string[];
  }) =>
    new AgentWallet({
      privateKey: o.key ?? process.env.WEBMCP_WALLET_KEY,
      limits: limitsFrom(o),
      recordHistory: true,
    });

  web3
    .command('validate')
    .description(
      'Audita la configuración de pagos de un .webmcp.css (webmcp-payment/network/amount/pay-to)',
    )
    .requiredOption('--file <css>', 'archivo .webmcp.css')
    .option(
      '--connector <file>',
      'escribe el script de billetera para el navegador (MetaMask/WalletConnect)',
    )
    .option('--json', 'salida JSON')
    .action((o: { file: string; connector?: string; json?: boolean }) => {
      if (!o.json) logger.title('WebMCPcss · web3 validate');
      const map = readMap(o.file);
      const paid = listPaidTools(map);
      const findings = validatePayments(map);
      if (o.json) return json({ paid, findings });
      for (const r of paid)
        console.log(
          `  ${chalk.dim('•')} ${r.tool}: ${r.policy} ${r.amount} ${r.currency} en ${r.network.name} → ${r.payTo ?? chalk.red('sin pay-to')} (${r.protocol})`,
        );
      for (const f of findings)
        console.log(
          `  ${f.severity === 'error' ? chalk.red('✖') : chalk.yellow('⚠')} ${f.tool}: ${f.message}`,
        );
      if (!paid.length) logger.info('Ninguna tool declara pagos.');
      if (o.connector) writeOut(o.connector, buildWalletConnectorScript(map));
      if (findings.some((f) => f.severity === 'error')) process.exitCode = 1;
    });

  web3
    .command('balance')
    .description(
      'Consulta el saldo nativo y USDC de una dirección (requiere el paquete opcional ethers)',
    )
    .requiredOption('--address <address>', 'dirección EVM')
    .option(
      '--network <network>',
      'red (ethereum, polygon, base, arbitrum, optimism, avalanche, sepolia, base-sepolia o chainId)',
      'base',
    )
    .option('--rpc <url>', 'RPC alternativo')
    .option('--json', 'salida JSON')
    .action(
      async (o: { address: string; network: string; rpc?: string; json?: boolean }) => {
        if (!o.json) logger.title('WebMCPcss · web3 balance');
        const bal = await getBalance(o.address, o.network, o.rpc);
        if (o.json) return json(bal);
        logger.info(
          `${bal.address} en ${bal.network}: ${bal.native.balance} ${bal.native.symbol}${bal.usdc ? ` · ${bal.usdc.balance} USDC` : ''}`,
        );
      },
    );

  web3
    .command('pay')
    .description(
      'Envía un pago on-chain (USDC o nativo) desde la billetera del agente, respetando límites de gasto',
    )
    .requiredOption('--to <address>', 'dirección receptora')
    .requiredOption('--amount <amount>', 'importe')
    .option('--currency <symbol>', 'USDC | ETH | MATIC…', 'USDC')
    .option('--network <network>', 'red', 'base')
    .option('--rpc <url>', 'RPC alternativo')
    .option('--tool <name>', 'tool asociada (para el registro)')
    .option('--key <privateKey>', 'clave privada (o WEBMCP_WALLET_KEY)')
    .option('--max-tx <amount>', 'límite por operación')
    .option('--max-session <amount>', 'límite por sesión')
    .option('--max-day <amount>', 'límite diario')
    .option('--allow-to <address...>', 'lista blanca de receptores')
    .option('--json', 'salida JSON')
    .action(
      async (o: {
        to: string;
        amount: string;
        currency: string;
        network: string;
        rpc?: string;
        tool?: string;
        key?: string;
        maxTx?: string;
        maxSession?: string;
        maxDay?: string;
        allowTo?: string[];
        json?: boolean;
      }) => {
        if (!o.json) logger.title('WebMCPcss · web3 pay');
        const wallet = walletFrom(o);
        const rec = await sendPayment(wallet, {
          to: o.to,
          amount: Number(o.amount),
          currency: o.currency,
          network: o.network,
          rpc: o.rpc,
          tool: o.tool,
        });
        if (o.json) return json(rec);
        if (rec.status === 'settled')
          logger.success(
            `Pago liquidado: ${rec.amount} ${rec.currency} → ${rec.to} (${rec.network}) tx ${rec.txHash}`,
          );
        else logger.error(`Pago ${rec.status}: ${rec.reason ?? ''}`);
        if (rec.status !== 'settled') process.exitCode = 1;
      },
    );

  web3
    .command('deploy')
    .description(
      'Despliega un contrato compilado ({abi,bytecode}) o exporta el contrato de referencia WebMCPPayments.sol',
    )
    .option('--contract <file>', 'artefacto JSON compilado (solc/hardhat)')
    .option('--network <network>', 'red', 'base')
    .option('--rpc <url>', 'RPC alternativo')
    .option('--args <values...>', 'argumentos del constructor')
    .option('--key <privateKey>', 'clave privada (o WEBMCP_WALLET_KEY)')
    .option('--export-sol <file>', 'escribe WebMCPPayments.sol de referencia y termina')
    .option('--json', 'salida JSON')
    .action(
      async (o: {
        contract?: string;
        network: string;
        rpc?: string;
        args?: string[];
        key?: string;
        exportSol?: string;
        json?: boolean;
      }) => {
        if (!o.json) logger.title('WebMCPcss · web3 deploy');
        if (o.exportSol) return writeOut(o.exportSol, WEBMCP_PAYMENTS_SOL);
        if (!o.contract)
          throw new Error('Indica --contract <artefacto.json> o --export-sol <archivo>.');
        const artifact = JSON.parse(fs.readFileSync(o.contract, 'utf8')) as {
          abi: unknown[];
          bytecode: string | { object: string };
        };
        const bytecode =
          typeof artifact.bytecode === 'string'
            ? artifact.bytecode
            : artifact.bytecode.object;
        const result = await deployContract(
          walletFrom(o),
          { abi: artifact.abi, bytecode },
          { network: o.network, rpc: o.rpc, args: o.args },
        );
        if (o.json) return json(result);
        logger.success(
          `Contrato desplegado en ${chalk.bold(result.address)} (${result.network}) tx ${result.txHash}${result.explorer ? `\n  ${result.explorer}` : ''}`,
        );
      },
    );
}
