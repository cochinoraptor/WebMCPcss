/**
 * Tests de Design-to-WebMCP (v1.0.0): análisis de imágenes (cabeceras +
 * visión LLM simulada), Figma (fetch simulado), descripciones textuales,
 * generación, validación contra una sonda de página y optimización.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
  analyzeDescription,
  analyzeFigma,
  analyzeImage,
  figmaTreeToElements,
  generateFromDesign,
  iaFriendlyScore,
  normalizeElements,
  optimizeToolMap,
  readImageInfo,
  similarity,
  validateDesign,
  type DesignPageProbe,
  type DesignStructure,
} from '../src/design-to-webmcp';
import { parseWebMCP } from '../src/parser';
import type { LlmClient, LlmRequest } from '../src/prompt/types';

/** PNG 1×1 válido (cabecera IHDR) para pruebas de cabeceras. */
function pngBuffer(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4);
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(height, 12);
  return Buffer.concat([sig, ihdr, Buffer.alloc(64)]);
}

function jpegBuffer(width: number, height: number): Buffer {
  // SOI + SOF0 con altura/anchura.
  const sof = Buffer.from([
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03,
  ]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(32)]);
}

const tmpFile = (name: string, buf: Buffer) => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webmcp-design-')), name);
  fs.writeFileSync(p, buf);
  return p;
};

const mockLlm = (answer: (req: LlmRequest) => string): LlmClient => ({
  provider: 'openai',
  model: 'vision-test',
  complete: async (req) => answer(req),
});

describe('design · readImageInfo', () => {
  it('lee dimensiones de PNG y JPEG y detecta GIF/WebP/desconocido', () => {
    expect(readImageInfo(pngBuffer(1280, 800))).toMatchObject({
      format: 'png',
      width: 1280,
      height: 800,
      mime: 'image/png',
    });
    expect(readImageInfo(jpegBuffer(640, 480))).toMatchObject({
      format: 'jpeg',
      width: 640,
      height: 480,
    });
    const gif = Buffer.concat([
      Buffer.from('GIF89a'),
      Buffer.from([0x10, 0x00, 0x20, 0x00]),
      Buffer.alloc(8),
    ]);
    expect(readImageInfo(gif)).toMatchObject({ format: 'gif', width: 16, height: 32 });
    const webp = Buffer.concat([
      Buffer.from('RIFF'),
      Buffer.alloc(4),
      Buffer.from('WEBPVP8 '),
      Buffer.alloc(20),
    ]);
    expect(readImageInfo(webp).format).toBe('webp');
    expect(readImageInfo(Buffer.from('hola')).format).toBe('unknown');
  });
});

describe('design · analyzeImage', () => {
  it('sin LLM devuelve estructura vacía con nota explicativa', async () => {
    const file = tmpFile('home.png', pngBuffer(800, 600));
    const s = await analyzeImage(file, null);
    expect(s.method).toBe('empty');
    expect(s.source).toMatchObject({
      type: 'image',
      width: 800,
      height: 600,
      format: 'png',
    });
    expect(s.notes.join(' ')).toMatch(/visión|vision/i);
  });

  it('con LLM de visión envía la imagen como data-URL y normaliza los elementos', async () => {
    const file = tmpFile('checkout.png', pngBuffer(1280, 800));
    let received: LlmRequest | null = null;
    const llm = mockLlm((req) => {
      received = req;
      return JSON.stringify({
        title: 'Checkout',
        elements: [
          { id: 'Form Pago', kind: 'form', label: 'Pago', confidence: 0.9 },
          {
            id: 'card',
            kind: 'input',
            label: 'Tarjeta',
            parent: 'form-pago',
            fieldName: 'card number',
            confidence: 0.8,
          },
          {
            id: 'pay',
            kind: 'button',
            label: 'Pagar ahora',
            intent: 'submit',
            parent: 'form-pago',
            box: { x: 10, y: 20, width: 100, height: 40 },
            confidence: 1.4,
          },
          { id: 'pay', kind: 'weird', label: 'dup' },
          null,
        ],
      });
    });
    const s = await analyzeImage(file, llm);
    expect(received!.images?.[0]).toMatch(/^data:image\/png;base64,/);
    expect(s.method).toBe('llm-vision');
    expect(s.title).toBe('Checkout');
    expect(s.elements.map((e) => e.id)).toEqual(['form-pago', 'card', 'pay', 'pay-4']);
    expect(s.elements[1].fieldName).toBe('cardnumber');
    expect(s.elements[2].confidence).toBe(1);
    expect(s.elements[3].kind).toBe('other');
  });

  it('rechaza formatos desconocidos', async () => {
    const file = tmpFile('x.bin', Buffer.from('not an image'));
    await expect(analyzeImage(file, null)).rejects.toThrow(/no reconocido/);
  });

  it('normalizeElements tolera entradas no válidas', () => {
    expect(normalizeElements(null)).toEqual([]);
    expect(normalizeElements('x')).toEqual([]);
    expect(normalizeElements([{ kind: 'button' }])[0].id).toBe('button-1');
  });
});

describe('design · analyzeFigma', () => {
  const tree = {
    id: '0:1',
    name: 'Home',
    type: 'FRAME',
    absoluteBoundingBox: { x: 0, y: 0, width: 1440, height: 900 },
    children: [
      {
        id: '1:1',
        name: 'Header / Nav',
        type: 'FRAME',
        children: [
          { id: '1:2', name: 'Link Inicio', type: 'TEXT', characters: 'Inicio' },
          { id: '1:3', name: 'Link Tienda', type: 'TEXT', characters: 'Tienda' },
        ],
      },
      {
        id: '2:1',
        name: 'Form Login',
        type: 'FRAME',
        children: [
          {
            id: '2:2',
            name: 'Input Email',
            type: 'INSTANCE',
            children: [
              {
                id: '2:3',
                name: 'placeholder',
                type: 'TEXT',
                characters: 'tu@email.com',
              },
            ],
          },
          { id: '2:4', name: 'Input Password', type: 'INSTANCE' },
          {
            id: '2:5',
            name: 'Button Entrar',
            type: 'INSTANCE',
            children: [{ id: '2:6', name: 'label', type: 'TEXT', characters: 'Entrar' }],
          },
        ],
      },
      { id: '3:1', name: 'Price', type: 'TEXT', characters: '€ 19,99' },
      { id: '4:1', name: 'Decor', type: 'RECTANGLE' },
    ],
  };

  it('figmaTreeToElements clasifica nav/link/form/input/button/price y respeta la jerarquía', () => {
    const els = figmaTreeToElements(tree);
    const byKind = (k: string) => els.filter((e) => e.kind === k);
    expect(byKind('nav')).toHaveLength(1);
    expect(byKind('link')).toHaveLength(2);
    expect(byKind('form')).toHaveLength(1);
    expect(byKind('input')).toHaveLength(2);
    expect(byKind('button')).toHaveLength(1);
    expect(byKind('price')).toHaveLength(1);
    const email = byKind('input')[0];
    expect(email.parent).toBe(byKind('form')[0].id);
    expect(email.placeholder).toBe('tu@email.com');
    expect(email.fieldName).toBe('email');
    expect(byKind('button')[0].intent).toBe('submit');
    expect(byKind('button')[0].confidence).toBeGreaterThan(byKind('nav')[0].confidence);
  });

  it('analyzeFigma llama a la API con el token y acepta URLs de archivo con node-id', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string> });
      return new Response(
        JSON.stringify({ name: 'Diseño tienda', nodes: { '0:1': { document: tree } } }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const s = await analyzeFigma(
      'https://www.figma.com/design/ABC123xyz/Tienda?node-id=0-1',
      'figd_token',
      fetchImpl,
    );
    expect(calls[0].url).toContain('/v1/files/ABC123xyz/nodes?ids=0%3A1');
    expect(calls[0].headers['X-Figma-Token']).toBe('figd_token');
    expect(s.method).toBe('figma-api');
    expect(s.title).toBe('Diseño tienda');
    expect(s.elements.length).toBeGreaterThan(5);

    const bad = (async () =>
      new Response('nope', { status: 403 })) as unknown as typeof fetch;
    await expect(analyzeFigma('ABC', 't', bad)).rejects.toThrow(/403|Figma/);
  });
});

describe('design · analyzeDescription + generateFromDesign', () => {
  it('heurística: buscador, login, botón de carrito y precio → tools y contexto coherentes', async () => {
    const s = await analyzeDescription(
      'Página de tienda con buscador arriba, login con email y contraseña, lista de productos con precio y botón añadir al carrito',
      null,
    );
    expect(s.method).toBe('heuristic');
    const gen = generateFromDesign(s);
    const map = parseWebMCP(gen.css);
    expect(Object.keys(map.tools)).toEqual(
      expect.arrayContaining(['buscar', 'iniciarSesion', 'anadirAlCarrito']),
    );
    expect(map.tools.buscar.params.query.source).toBe('value');
    expect(Object.keys(map.tools.iniciarSesion.params)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
    expect(map.tools.iniciarSesion.meta?.confirmation).toBe('needed');
    expect(map.tools.buscar.meta?.confirmation).toBe('none');
    expect(map.context.precio.format).toBe('currency');
    expect(gen.scaffoldHtml).toContain('data-tool="buscar-submit"');
    expect(gen.scaffoldHtml).toContain('type="password"');
    expect(gen.mapping.find((m) => m.tool === 'buscar')?.elementId).toBe('form-search');
    // Todo selector generado aparece en el andamiaje.
    for (const t of Object.values(map.tools)) {
      const m = /\[data-tool="([^"]+)"\]/.exec(t.selector);
      expect(gen.scaffoldHtml).toContain(`data-tool="${m![1]}"`);
    }
  });

  it('con LLM de texto usa la estructura devuelta', async () => {
    const llm = mockLlm(() =>
      JSON.stringify({
        title: 'Reservas',
        elements: [
          { id: 'form-reserva', kind: 'form', label: 'Reserva' },
          {
            id: 'fecha',
            kind: 'input',
            label: 'Fecha',
            parent: 'form-reserva',
            fieldName: 'date',
          },
          {
            id: 'btn',
            kind: 'button',
            label: 'Reservar',
            intent: 'submit',
            parent: 'form-reserva',
          },
        ],
      }),
    );
    const s = await analyzeDescription('formulario de reserva', llm);
    expect(s.method).toBe('llm-text');
    const gen = generateFromDesign(s);
    const map = parseWebMCP(gen.css);
    const [name, tool] = Object.entries(map.tools)[0];
    expect(name).toBe('reservar');
    expect(tool.params.date).toBeDefined();
  });

  it('un diseño sin elementos interactivos produce avisos y un contrato vacío', () => {
    const s: DesignStructure = {
      source: { type: 'text', ref: 'x' },
      title: 'Vacío',
      elements: [{ id: 'h', kind: 'heading', label: 'Hola', confidence: 1 }],
      method: 'heuristic',
      notes: [],
    };
    const gen = generateFromDesign(s);
    expect(Object.keys(gen.toolMap.tools)).toEqual([]);
    expect(gen.warnings.length).toBeGreaterThan(0);
  });
});

describe('design · validateDesign', () => {
  const design: DesignStructure = {
    source: { type: 'image', ref: 'home.png', width: 1000, height: 1000 },
    title: 'Home',
    elements: [
      { id: 'form-search', kind: 'form', label: 'Buscar', confidence: 1 },
      {
        id: 'q',
        kind: 'input',
        label: 'Buscar',
        parent: 'form-search',
        fieldName: 'query',
        confidence: 1,
      },
      {
        id: 'btn-search',
        kind: 'button',
        label: 'Buscar',
        intent: 'submit',
        parent: 'form-search',
        box: { x: 100, y: 100, width: 100, height: 40 },
        confidence: 1,
      },
      {
        id: 'btn-buy',
        kind: 'button',
        label: 'Comprar ahora',
        intent: 'action',
        box: { x: 500, y: 800, width: 120, height: 40 },
        confidence: 1,
      },
      { id: 'btn-help', kind: 'button', label: 'Ayuda', intent: 'action', confidence: 1 },
    ],
    method: 'llm-vision',
    notes: [],
  };

  it('clasifica ok / relabeled / moved / missing y puntúa', async () => {
    const gen = generateFromDesign(design);
    const found: Record<
      string,
      {
        text: string;
        box?: { x: number; y: number; width: number; height: number };
        visible: boolean;
      }
    > = {
      '[data-tool="buscar-submit"]': {
        text: 'Buscar',
        box: { x: 100, y: 100, width: 100, height: 40 },
        visible: true,
      },
      '[data-tool="comprar-ahora"]': {
        text: 'Comprar ahora',
        box: { x: 50, y: 50, width: 120, height: 40 },
        visible: true,
      },
    };
    const probe: DesignPageProbe = {
      probe: async (selector) => found[selector] ?? null,
      viewport: async () => ({ width: 1000, height: 1000 }),
    };
    const report = await validateDesign(
      gen.toolMap,
      probe,
      design,
      'https://tienda.test',
    );
    const status = Object.fromEntries(report.checks.map((c) => [c.tool, c.status]));
    expect(status.buscar).toBe('ok');
    expect(status.comprarAhora).toBe('moved');
    expect(status.ayuda).toBe('missing');
    expect(report.missing).toBe(1);
    expect(report.moved).toBe(1);
    expect(report.score).toBeGreaterThan(0);
    expect(report.score).toBeLessThan(100);
  });

  it('detecta etiquetas cambiadas', async () => {
    const gen = generateFromDesign(design);
    const probe: DesignPageProbe = {
      probe: async (selector) =>
        selector.includes('buscar')
          ? { text: 'Search products', visible: true }
          : { text: 'Comprar ahora', visible: true },
    };
    const report = await validateDesign(gen.toolMap, probe, design);
    expect(report.checks.find((c) => c.tool === 'buscar')?.status).toBe('relabeled');
    expect(report.checks.find((c) => c.tool === 'comprarAhora')?.status).toBe('ok');
    // «Ayuda» también encuentra un texto distinto → relabeled.
    expect(report.relabeled).toBe(2);
  });

  it('similarity es 1 para textos equivalentes y baja para distintos', () => {
    expect(similarity('Añadir al carrito', 'anadir al carrito')).toBe(1);
    expect(similarity('Buscar', 'Search')).toBeLessThan(0.5);
  });
});

describe('design · optimizeToolMap', () => {
  const css = `
    #b1 { webmcp-tool: "tool1"; webmcp-param-query: value(#q); }
    div > div > div:nth-child(3) > button.btn { webmcp-tool: "deleteAccount"; webmcp-description: "Elimina la cuenta"; }
    #ok { webmcp-tool: "buscar"; webmcp-description: "Busca productos por texto"; webmcp-param-query: value(#q); webmcp-confirmation: "none"; webmcp-accessibility: "aria-label: Buscar"; }
    .price { webmcp-context: "x"; }
  `;

  it('propone y aplica correcciones subiendo la puntuación IA-friendly', () => {
    const map = parseWebMCP(css);
    const before = iaFriendlyScore(map);
    const report = optimizeToolMap(map, { apply: false });
    expect(report.applied).toBe(0);
    expect(
      report.suggestions.some((s) => s.tool === 'tool1' && s.kind === 'naming'),
    ).toBe(true);
    expect(
      report.suggestions.some((s) => s.tool === 'tool1' && s.kind === 'description'),
    ).toBe(true);
    expect(
      report.suggestions.some(
        (s) => s.tool === 'deleteAccount' && s.kind === 'confirmation',
      ),
    ).toBe(true);
    expect(
      report.suggestions.some((s) => s.tool === 'deleteAccount' && s.kind === 'selector'),
    ).toBe(true);
    expect(report.suggestions.some((s) => s.tool === 'x' && s.kind === 'format')).toBe(
      true,
    );
    const applied = optimizeToolMap(map, { apply: true });
    expect(applied.applied).toBeGreaterThan(0);
    expect(applied.scoreAfter).toBeGreaterThan(before);
    expect(applied.scoreBefore).toBe(before);
    const out = parseWebMCP(applied.css);
    expect(out.tools.deleteAccount.meta?.confirmation).toBe('needed');
    expect(out.tools.buscar.meta?.accessibility).toBe('aria-label: Buscar');
    expect(out.context.x.format).toBe('currency');
  });

  it('un contrato ya optimizado no genera sugerencias de error', () => {
    const map = parseWebMCP(
      '#ok { webmcp-tool: "buscar"; webmcp-description: "Busca productos por texto"; webmcp-param-query: value(#q); webmcp-confirmation: "none"; webmcp-accessibility: "aria-label: Buscar"; }',
    );
    const report = optimizeToolMap(map);
    expect(report.suggestions.filter((s) => s.severity === 'error')).toEqual([]);
    expect(iaFriendlyScore(map)).toBeGreaterThanOrEqual(90);
  });
});
