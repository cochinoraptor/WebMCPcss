/**
 * Construye el índice de estilos comunitarios (`community-styles/index.json`)
 * para que agentes y herramientas descubran qué dominios tienen definición
 * con una sola petición HTTP (raw.githubusercontent.com).
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseWebMCP } from '../parser';

/** Entrada del índice para un dominio. */
export interface CommunityIndexEntry {
  /** Dominio cubierto (nombre del archivo sin extensión). */
  domain: string;
  /** Ruta relativa del archivo dentro del repo. */
  file: string;
  /** URL de validación en CI, si el archivo la declara. */
  validateUrl: string | null;
  /** Herramientas declaradas. */
  tools: Array<{ name: string; description: string | null }>;
  /** Datos de contexto declarados. */
  context: string[];
}

/** Índice completo. */
export interface CommunityIndex {
  /** Fecha de generación (ISO). */
  generated: string;
  /** Número de dominios. */
  count: number;
  /** Base para consumir los archivos crudos. */
  rawBase: string;
  styles: CommunityIndexEntry[];
}

/** Extrae la URL de validación opcional de los comentarios del CSS. */
function extractValidateUrl(css: string): string | null {
  const m = /@validate-url:\s*(\S+)/.exec(css);
  return m ? m[1] : null;
}

/**
 * Recorre `dir` y construye el índice a partir de los `*.webmcp.css`.
 * Lanza si algún archivo no parsea (el índice nunca referencia inválidos).
 *
 * @param dir Carpeta community-styles.
 * @param rawBase Base raw para consumo remoto.
 */
export function buildCommunityIndex(
  dir: string,
  rawBase = 'https://raw.githubusercontent.com/cochinoraptor/WebMCPcss/main/community-styles/',
): CommunityIndex {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.webmcp.css'))
    .sort();

  const styles: CommunityIndexEntry[] = files.map((file) => {
    const css = fs.readFileSync(path.join(dir, file), 'utf8');
    const map = parseWebMCP(css); // lanza si es inválido
    return {
      domain: file.replace(/\.webmcp\.css$/, ''),
      file: `community-styles/${file}`,
      validateUrl: extractValidateUrl(css),
      tools: Object.entries(map.tools).map(([name, t]) => ({
        name,
        description: t.description ?? null,
      })),
      context: Object.keys(map.context),
    };
  });

  return {
    generated: new Date().toISOString().slice(0, 10),
    count: styles.length,
    rawBase,
    styles,
  };
}

/**
 * Escribe (o comprueba) `index.json` en la carpeta.
 * @param dir Carpeta community-styles.
 * @param check Si es `true`, no escribe: lanza si el índice está desactualizado.
 * @returns Ruta del index.json.
 */
export function writeCommunityIndex(dir: string, check = false): string {
  const index = buildCommunityIndex(dir);
  const target = path.join(dir, 'index.json');
  const next = JSON.stringify(index, null, 2) + '\n';
  if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    // Se ignora la fecha de generación al comparar.
    const strip = (s: string): string =>
      s.replace(/"generated": "[^"]*"/, '"generated": ""');
    if (strip(current) !== strip(next)) {
      throw new Error(
        'community-styles/index.json está desactualizado. Ejecuta: npm run build:community-index',
      );
    }
    return target;
  }
  fs.writeFileSync(target, next, 'utf8');
  return target;
}
