/**
 * Script: genera el sitio del Component Hub (`site/components/**` y
 * `site/api/components.json`) a partir de `components/` y `docs/hub/`.
 *
 * Uso: npm run build:hub  [-- --check] [-- --out <dir>] [-- --base-url <url>]
 *
 * `--check` no escribe: falla si el sitio publicado no coincide con el que
 * se generaría (para CI). La URL base se toma de `--base-url`,
 * `WEBMCPCSS_HUB_URL` o la pública por defecto.
 */
import * as path from 'path';
import { buildRuntimeScript } from '../src/animation/runtime-bundle';
import { buildHubSite, checkHubSite } from '../src/hub/site';
import { logger } from '../src/utils/logger';

const args = process.argv.slice(2);
const check = args.includes('--check');
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
};

const root = process.cwd();
const options = {
  componentsDir: path.resolve(root, 'components'),
  siteDir: path.resolve(root, flag('--out') ?? 'site'),
  docsDir: path.resolve(root, 'docs', 'hub'),
  baseUrl: flag('--base-url'),
  animationRuntime: undefined as string | undefined,
};

try {
  try {
    options.animationRuntime = buildRuntimeScript();
  } catch {
    /* sin build previo: se avisa en el resultado */
  }
  if (check) {
    const stale = checkHubSite(options);
    if (stale.length) {
      logger.error(
        `El sitio del hub está desactualizado (${stale.length} archivo(s)). Ejecuta: npm run build:hub\n- ${stale.slice(0, 15).join('\n- ')}${stale.length > 15 ? '\n- …' : ''}`,
      );
      process.exit(1);
    }
    logger.success('Sitio del Component Hub al día.');
  } else {
    const result = buildHubSite(options);
    for (const w of result.warnings) logger.warn(w);
    logger.success(
      `Hub generado: ${result.components} componentes, ${result.files.length} archivos en ${options.siteDir}`,
    );
  }
} catch (err) {
  logger.error((err as Error).message);
  process.exit(1);
}
