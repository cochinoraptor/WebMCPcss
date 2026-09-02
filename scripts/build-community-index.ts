/**
 * Script: (re)genera community-styles/index.json.
 * Uso: npm run build:community-index  [-- --check]
 */
import * as path from 'path';
import { writeCommunityIndex } from '../src/community/index-builder';
import { logger } from '../src/utils/logger';

const check = process.argv.includes('--check');
// Relativo al directorio de trabajo (el script se ejecuta desde la raíz del repo).
const dir = path.resolve(process.cwd(), 'community-styles');

try {
  const target = writeCommunityIndex(dir, check);
  logger.success(check ? `Índice al día: ${target}` : `Índice regenerado: ${target}`);
} catch (err) {
  logger.error((err as Error).message);
  process.exit(1);
}
