/**
 * Búsqueda de estilos WebMCP en el repositorio comunitario.
 *
 * Localiza archivos `.webmcp.css` aportados por la comunidad para un dominio
 * dado, primero en una carpeta local (`community-styles/`) y opcionalmente en
 * un repositorio remoto (URL base tipo raw.githubusercontent.com).
 */
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/** Opciones de búsqueda comunitaria. */
export interface CommunityLookupOptions {
  /** Carpeta local con estilos comunitarios. Por defecto `community-styles/`. */
  dir?: string;
  /** URL base remota, p. ej. `https://raw.githubusercontent.com/org/repo/main/community-styles`. */
  remoteBaseUrl?: string;
}

/** Resultado de una búsqueda comunitaria. */
export interface CommunityStyle {
  /** Dominio con el que casó (`amazon.com`). */
  domain: string;
  /** Origen: ruta local o URL remota. */
  source: string;
  /** Contenido del archivo `.webmcp.css`. */
  css: string;
}

/**
 * Normaliza un dominio o URL a su forma canónica (`www.Amazon.com/x` → `amazon.com`).
 * @param input Dominio o URL.
 */
export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  try {
    if (host.includes('://')) host = new URL(host).hostname;
  } catch {
    /* no era una URL */
  }
  host = host.split('/')[0].split(':')[0];
  return host.replace(/^www\./, '');
}

/**
 * Genera la cadena de dominios candidatos, del más específico al más
 * general: `shop.eu.example.com` → [`shop.eu.example.com`, `eu.example.com`, `example.com`].
 * @param domain Dominio normalizado.
 */
export function domainChain(domain: string): string[] {
  const parts = domain.split('.');
  const chain: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    chain.push(parts.slice(i).join('.'));
  }
  return chain.length > 0 ? chain : [domain];
}

/**
 * Busca un estilo comunitario para el dominio dado.
 *
 * Orden de búsqueda por cada dominio de la cadena:
 * 1. `<dir>/<domain>.webmcp.css`
 * 2. `<dir>/<domain>/webmcp.css`
 * 3. `<remoteBaseUrl>/<domain>.webmcp.css` (si se configuró)
 *
 * @param domainOrUrl Dominio (`amazon.com`) o URL completa.
 * @param options Opciones de búsqueda.
 * @returns El estilo encontrado o `null`.
 */
export async function findCommunityStyle(
  domainOrUrl: string,
  options: CommunityLookupOptions = {},
): Promise<CommunityStyle | null> {
  const dir = options.dir ?? path.join(process.cwd(), 'community-styles');
  const domain = normalizeDomain(domainOrUrl);

  for (const candidate of domainChain(domain)) {
    // 1) Archivo plano local.
    const flat = path.join(dir, `${candidate}.webmcp.css`);
    if (fs.existsSync(flat)) {
      logger.debug(`community: encontrado ${flat}`);
      return { domain: candidate, source: flat, css: fs.readFileSync(flat, 'utf8') };
    }
    // 2) Carpeta por dominio.
    const nested = path.join(dir, candidate, 'webmcp.css');
    if (fs.existsSync(nested)) {
      logger.debug(`community: encontrado ${nested}`);
      return {
        domain: candidate,
        source: nested,
        css: fs.readFileSync(nested, 'utf8'),
      };
    }
    // 3) Remoto.
    if (options.remoteBaseUrl) {
      const url = `${options.remoteBaseUrl.replace(/\/$/, '')}/${candidate}.webmcp.css`;
      try {
        const res = await fetch(url);
        if (res.ok) {
          logger.debug(`community: encontrado remoto ${url}`);
          return { domain: candidate, source: url, css: await res.text() };
        }
      } catch (err) {
        logger.debug(
          `community: fallo remoto ${url}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
  return null;
}
