/**
 * Tests del índice comunitario (v0.6.x).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildCommunityIndex, writeCommunityIndex } from '../src/community';

const REPO_STYLES = path.join(__dirname, '..', 'community-styles');

describe('buildCommunityIndex (carpeta real del repo)', () => {
  const index = buildCommunityIndex(REPO_STYLES);

  it('indexa todos los .webmcp.css del repo', () => {
    const domains = index.styles.map((s) => s.domain);
    expect(domains).toContain('wikipedia.org');
    expect(domains).toContain('news.ycombinator.com');
    expect(domains).toContain('mercadolibre.com.co');
    expect(index.count).toBe(index.styles.length);
  });

  it('extrae herramientas con descripción y contextos', () => {
    const wiki = index.styles.find((s) => s.domain === 'wikipedia.org')!;
    expect(wiki.tools.map((t) => t.name)).toContain('search');
    expect(wiki.tools.find((t) => t.name === 'search')?.description).toMatch(/Wikipedia/);
    expect(wiki.context).toContain('siteTitle');
    const enwiki = index.styles.find((s) => s.domain === 'en.wikipedia.org')!;
    expect(enwiki.context).toContain('articleTitle');
    expect(enwiki.tools.map((t) => t.name)).toContain('openLanguageMenu');
  });

  it('captura @validate-url solo cuando existe de verdad', () => {
    const wiki = index.styles.find((s) => s.domain === 'wikipedia.org')!;
    const meli = index.styles.find((s) => s.domain === 'mercadolibre.com.co')!;
    expect(wiki.validateUrl).toBe('https://www.wikipedia.org');
    expect(meli.validateUrl).toBeNull();
  });

  it('el index.json versionado está al día', () => {
    expect(() => writeCommunityIndex(REPO_STYLES, true)).not.toThrow();
  });
});

describe('writeCommunityIndex (carpeta temporal)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-community-'));
  fs.writeFileSync(path.join(dir, 'demo.com.webmcp.css'), '#go { webmcp-tool: "go"; }\n');

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('escribe el índice y luego el check pasa', () => {
    const target = writeCommunityIndex(dir);
    expect(fs.existsSync(target)).toBe(true);
    expect(() => writeCommunityIndex(dir, true)).not.toThrow();
  });

  it('el check falla si se añade un estilo sin regenerar', () => {
    fs.writeFileSync(path.join(dir, 'otro.com.webmcp.css'), '#x { webmcp-tool: "x"; }\n');
    expect(() => writeCommunityIndex(dir, true)).toThrow(/desactualizado/);
  });

  it('lanza si un archivo es inválido (no indexa basura)', () => {
    fs.writeFileSync(path.join(dir, 'malo.com.webmcp.css'), 'esto no es css {{{');
    expect(() => buildCommunityIndex(dir)).toThrow();
  });
});
