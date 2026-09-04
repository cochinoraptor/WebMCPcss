/**
 * Gestor de assets: resuelve los archivos que el usuario quiere subir.
 *
 * Acepta tres orígenes y los deja como archivo local listo para
 * `input[type="file"]` (Puppeteer `uploadFile`) o para leer en memoria:
 * - **Ruta local** (`./foto.jpg`, `/abs/logo.png`, `~/x.pdf`).
 * - **URL** `http(s)://` — se descarga a una carpeta temporal.
 * - **data-URI** (`data:image/png;base64,...`) — se decodifica a temporal.
 *
 * Detección de tipo MIME por extensión y, si falta, por firma de bytes
 * (magic numbers). Sin dependencias externas.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AssetOptions, ResolvedAsset } from './types';

/** Tamaño máximo por defecto: 25 MB. */
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/** Tabla extensión → MIME de los tipos habituales en formularios web. */
export const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/** MIME → extensión preferida (para nombrar temporales de URL/data-URI). */
const EXT_BY_MIME: Record<string, string> = Object.entries(MIME_BY_EXT).reduce(
  (acc, [ext, mime]) => {
    if (!acc[mime]) acc[mime] = ext;
    return acc;
  },
  {} as Record<string, string>,
);

/**
 * Detecta el MIME por firma de bytes (magic numbers) de los formatos más
 * comunes. Devuelve `null` si no reconoce la firma.
 * @param buf Primeros bytes del archivo (bastan 16).
 */
export function sniffMime(buf: Buffer): string | null {
  if (
    buf.length >= 8 &&
    buf
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a/.test(buf.subarray(0, 6).toString('latin1')))
    return 'image/gif';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (
    buf.length >= 4 &&
    buf[0] === 0x50 &&
    buf[1] === 0x4b &&
    buf[2] === 0x03 &&
    buf[3] === 0x04
  ) {
    return 'application/zip';
  }
  if (buf.length >= 12 && buf.subarray(4, 8).toString('latin1') === 'ftyp')
    return 'video/mp4';
  const head = buf.subarray(0, 64).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) {
    return 'image/svg+xml';
  }
  return null;
}

/**
 * Detecta el tipo MIME de un archivo local: extensión primero, firma de
 * bytes como respaldo, `application/octet-stream` si nada encaja.
 * @param filePath Ruta del archivo.
 */
export function detectMime(filePath: string): string {
  const byExt = MIME_BY_EXT[path.extname(filePath).toLowerCase()];
  if (byExt) return byExt;
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(64);
      const n = fs.readSync(fd, buf, 0, 64, 0);
      return sniffMime(buf.subarray(0, n)) ?? 'application/octet-stream';
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 'application/octet-stream';
  }
}

/** Clasifica el origen de una referencia de archivo. */
export function classifySource(ref: string): ResolvedAsset['source'] {
  if (/^data:/i.test(ref)) return 'data';
  if (/^https?:\/\//i.test(ref)) return 'url';
  return 'local';
}

/** Expande `~/` y resuelve a ruta absoluta. */
function expandLocal(ref: string): string {
  const withHome = ref.startsWith('~/') ? path.join(os.homedir(), ref.slice(2)) : ref;
  const noScheme = withHome.replace(/^file:\/\//i, '');
  return path.resolve(noScheme);
}

/** Nombre de archivo seguro a partir de una URL o un MIME. */
function safeName(base: string, mime: string): string {
  const cleaned = base
    .replace(/[^\w.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  const ext = path.extname(cleaned);
  if (ext && MIME_BY_EXT[ext.toLowerCase()]) return cleaned;
  return `${cleaned || 'asset'}${EXT_BY_MIME[mime] ?? ''}`;
}

/** Gestor de assets con carpeta temporal propia. */
export class AssetManager {
  private readonly maxBytes: number;
  private readonly tmpDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly created: string[] = [];

  /**
   * @param options Límites, carpeta temporal y `fetch` inyectable.
   */
  constructor(options: AssetOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.tmpDir = options.tmpDir ?? path.join(os.tmpdir(), 'webmcpcss-assets');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /**
   * Resuelve una referencia (ruta, URL o data-URI) a un archivo local.
   * @param ref Referencia del archivo.
   * @throws Error si no existe, supera el tamaño máximo o no se puede descargar.
   */
  async resolve(ref: string): Promise<ResolvedAsset> {
    const source = classifySource(ref.trim());
    switch (source) {
      case 'local':
        return this.resolveLocal(ref.trim());
      case 'url':
        return this.resolveUrl(ref.trim());
      case 'data':
        return this.resolveData(ref.trim());
      default:
        throw new Error(`Origen de archivo no soportado: ${ref}`);
    }
  }

  /** Resuelve varias referencias (en orden). */
  async resolveAll(refs: string[]): Promise<ResolvedAsset[]> {
    const out: ResolvedAsset[] = [];
    for (const ref of refs) out.push(await this.resolve(ref));
    return out;
  }

  /** Elimina los archivos temporales creados por este gestor. */
  cleanup(): void {
    for (const p of this.created.splice(0)) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ya no existe */
      }
    }
  }

  private resolveLocal(ref: string): ResolvedAsset {
    const abs = expandLocal(ref);
    if (!fs.existsSync(abs)) throw new Error(`El archivo no existe: ${ref}`);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error(`No es un archivo: ${ref}`);
    this.checkSize(stat.size, ref);
    return {
      path: abs,
      name: path.basename(abs),
      mimeType: detectMime(abs),
      size: stat.size,
      source: 'local',
      temporary: false,
    };
  }

  private async resolveUrl(url: string): Promise<ResolvedAsset> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`URL inválida: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Solo se admiten URLs http(s): ${url}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { signal: controller.signal, redirect: 'follow' });
    } catch (err) {
      clearTimeout(timer);
      throw new Error(
        `No se pudo descargar ${url}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      if (!res.ok) throw new Error(`No se pudo descargar ${url}: HTTP ${res.status}`);
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared) this.checkSize(declared, url);
      const buf = Buffer.from(await res.arrayBuffer());
      this.checkSize(buf.length, url);
      const headerMime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
      const mime =
        (headerMime && headerMime !== 'application/octet-stream' ? headerMime : '') ||
        sniffMime(buf) ||
        MIME_BY_EXT[path.extname(parsed.pathname).toLowerCase()] ||
        'application/octet-stream';
      const name = safeName(path.basename(parsed.pathname) || 'download', mime);
      const dest = this.tmpPath(name);
      fs.writeFileSync(dest, buf);
      return {
        path: dest,
        name,
        mimeType: mime,
        size: buf.length,
        source: 'url',
        temporary: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveData(uri: string): ResolvedAsset {
    const m = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,(.*)$/is.exec(uri);
    if (!m) throw new Error('data-URI inválido');
    const mime = (m[1] || 'text/plain').toLowerCase();
    const isBase64 = Boolean(m[3]);
    const payload = m[4];
    const buf = isBase64
      ? Buffer.from(payload.replace(/\s+/g, ''), 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8');
    if (buf.length === 0) throw new Error('data-URI vacío');
    this.checkSize(buf.length, 'data-URI');
    // Nombre opcional: data:image/png;name=foto.png;base64,...
    const nameParam = /;name=([^;,]+)/i.exec(m[2] ?? '');
    const name = safeName(nameParam ? decodeURIComponent(nameParam[1]) : 'inline', mime);
    const dest = this.tmpPath(name);
    fs.writeFileSync(dest, buf);
    return {
      path: dest,
      name,
      mimeType: mime,
      size: buf.length,
      source: 'data',
      temporary: true,
    };
  }

  private checkSize(size: number, ref: string): void {
    if (size > this.maxBytes) {
      throw new Error(
        `${ref} supera el tamaño máximo (${(size / 1024 / 1024).toFixed(1)} MB > ${(
          this.maxBytes /
          1024 /
          1024
        ).toFixed(0)} MB)`,
      );
    }
  }

  private tmpPath(name: string): string {
    fs.mkdirSync(this.tmpDir, { recursive: true });
    const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${name}`;
    const dest = path.join(this.tmpDir, unique);
    this.created.push(dest);
    return dest;
  }
}
