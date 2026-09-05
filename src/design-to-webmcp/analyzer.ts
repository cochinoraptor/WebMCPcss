/**
 * Design-to-WebMCP (v1.0.0): analizador de diseños.
 *
 * Extrae una **estructura de diseño** (`DesignStructure`: regiones, elementos
 * interactivos, jerarquía) desde tres fuentes:
 *
 * 1. **Imágenes** (PNG/JPEG/WebP/GIF): se leen las dimensiones con un
 *    decodificador de cabeceras propio (sin `sharp`) y se envía la imagen a
 *    un LLM con visión (OpenAI/Anthropic/Ollama vía `LlmRequest.images`).
 *    Sin LLM se devuelve una estructura vacía con la imagen descrita, para
 *    que el usuario complete a mano o use `--describe`.
 * 2. **Figma**: `GET /v1/files/:key` con `FIGMA_TOKEN` (fetch nativo); se
 *    recorre el árbol de nodos y se detectan frames, botones, inputs y
 *    textos por nombre/tipo/propiedades.
 * 3. **Descripciones textuales**: heurísticas locales + LLM opcional.
 */
import * as fs from 'fs';
import * as path from 'path';
import { extractJsonObject } from '../prompt/llm-client';
import type { LlmClient } from '../prompt/types';

/** Tipo de elemento de diseño. */
export type DesignElementKind =
  | 'button'
  | 'link'
  | 'input'
  | 'textarea'
  | 'select'
  | 'checkbox'
  | 'form'
  | 'nav'
  | 'card'
  | 'hero'
  | 'list'
  | 'price'
  | 'heading'
  | 'text'
  | 'image'
  | 'other';

/** Elemento detectado en el diseño. */
export interface DesignElement {
  /** Identificador estable dentro del análisis (`btn-1`, `input-email`). */
  id: string;
  kind: DesignElementKind;
  /** Texto/etiqueta visible. */
  label: string;
  /** Intención inferida (submit, navigate, action, cancel, read). */
  intent?: 'submit' | 'cancel' | 'navigate' | 'action' | 'read';
  /** Región contenedora (id de otro elemento). */
  parent?: string;
  /** Caja aproximada en píxeles (o unidades del diseño). */
  box?: { x: number; y: number; width: number; height: number };
  /** Placeholder/valor por defecto (inputs). */
  placeholder?: string;
  /** Nombre de campo sugerido (inputs). */
  fieldName?: string;
  /** Confianza [0,1]. */
  confidence: number;
}

/** Estructura de diseño. */
export interface DesignStructure {
  source: {
    type: 'image' | 'figma' | 'text';
    ref: string;
    width?: number;
    height?: number;
    format?: string;
  };
  title: string;
  /** Todos los elementos (planos; `parent` da la jerarquía). */
  elements: DesignElement[];
  /** Cómo se obtuvo: `llm-vision`, `figma-api`, `heuristic`, `empty`. */
  method: 'llm-vision' | 'figma-api' | 'heuristic' | 'llm-text' | 'empty';
  notes: string[];
}

/** Metadatos de imagen. */
export interface ImageInfo {
  format: 'png' | 'jpeg' | 'gif' | 'webp' | 'unknown';
  width?: number;
  height?: number;
  bytes: number;
  mime: string;
}

/**
 * Lee formato y dimensiones de una imagen a partir de sus cabeceras.
 * Sin dependencias: PNG (IHDR), JPEG (SOFn), GIF (LSD), WebP (VP8/VP8L/VP8X).
 * @param buf Contenido del archivo.
 */
export function readImageInfo(buf: Buffer): ImageInfo {
  const bytes = buf.length;
  if (bytes >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return {
      format: 'png',
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      bytes,
      mime: 'image/png',
    };
  }
  if (bytes >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off + 9 < bytes) {
      if (buf[off] !== 0xff) {
        off++;
        continue;
      }
      const marker = buf[off + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return {
          format: 'jpeg',
          height: buf.readUInt16BE(off + 5),
          width: buf.readUInt16BE(off + 7),
          bytes,
          mime: 'image/jpeg',
        };
      }
      const len = buf.readUInt16BE(off + 2);
      off += 2 + len;
    }
    return { format: 'jpeg', bytes, mime: 'image/jpeg' };
  }
  if (bytes >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
    return {
      format: 'gif',
      width: buf.readUInt16LE(6),
      height: buf.readUInt16LE(8),
      bytes,
      mime: 'image/gif',
    };
  }
  if (
    bytes >= 30 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8 ')
      return {
        format: 'webp',
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
        bytes,
        mime: 'image/webp',
      };
    if (chunk === 'VP8L') {
      const b0 = buf[21],
        b1 = buf[22],
        b2 = buf[23],
        b3 = buf[24];
      return {
        format: 'webp',
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
        bytes,
        mime: 'image/webp',
      };
    }
    if (chunk === 'VP8X')
      return {
        format: 'webp',
        width: 1 + buf.readUIntLE(24, 3),
        height: 1 + buf.readUIntLE(27, 3),
        bytes,
        mime: 'image/webp',
      };
    return { format: 'webp', bytes, mime: 'image/webp' };
  }
  return { format: 'unknown', bytes, mime: 'application/octet-stream' };
}

/** Convierte una imagen a data-URL. */
export function toDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const VISION_SYSTEM = `Eres un analista de interfaces. Recibes la captura o mockup de una pantalla web y devuelves su estructura interactiva como JSON estricto:
{"title": string, "elements": [{"id": string, "kind": "button|link|input|textarea|select|checkbox|form|nav|card|hero|list|price|heading|text|image|other", "label": string, "intent": "submit|cancel|navigate|action|read", "parent": string|null, "box": {"x":0,"y":0,"width":0,"height":0}, "placeholder": string|null, "fieldName": string|null, "confidence": 0..1}]}
Reglas: ids cortos y únicos en kebab-case; agrupa inputs dentro de un elemento "form"; los enlaces de menú van dentro de "nav"; las coordenadas son píxeles aproximados de la imagen; fieldName en camelCase inglés (email, password, query…). No añadas texto fuera del JSON.`;

/** Valida y normaliza la salida del LLM a `DesignElement[]`. */
export function normalizeElements(raw: unknown): DesignElement[] {
  if (!Array.isArray(raw)) return [];
  const kinds: DesignElementKind[] = [
    'button',
    'link',
    'input',
    'textarea',
    'select',
    'checkbox',
    'form',
    'nav',
    'card',
    'hero',
    'list',
    'price',
    'heading',
    'text',
    'image',
    'other',
  ];
  const seen = new Set<string>();
  const out: DesignElement[] = [];
  raw.forEach((e, i) => {
    if (!e || typeof e !== 'object') return;
    const r = e as Record<string, unknown>;
    const kind = kinds.includes(r.kind as DesignElementKind)
      ? (r.kind as DesignElementKind)
      : 'other';
    let id =
      String(r.id ?? `${kind}-${i + 1}`)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || `${kind}-${i + 1}`;
    while (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    const box =
      r.box && typeof r.box === 'object' ? (r.box as Record<string, unknown>) : null;
    out.push({
      id,
      kind,
      label: String(r.label ?? '').slice(0, 120),
      intent: ['submit', 'cancel', 'navigate', 'action', 'read'].includes(
        String(r.intent),
      )
        ? (r.intent as DesignElement['intent'])
        : undefined,
      parent: r.parent ? String(r.parent) : undefined,
      box:
        box && ['x', 'y', 'width', 'height'].every((k) => typeof box[k] === 'number')
          ? {
              x: box.x as number,
              y: box.y as number,
              width: box.width as number,
              height: box.height as number,
            }
          : undefined,
      placeholder: r.placeholder ? String(r.placeholder) : undefined,
      fieldName: r.fieldName
        ? String(r.fieldName).replace(/[^a-zA-Z0-9]/g, '')
        : undefined,
      confidence:
        typeof r.confidence === 'number' ? Math.max(0, Math.min(1, r.confidence)) : 0.6,
    });
  });
  return out;
}

/**
 * Analiza una imagen de diseño (captura, mockup, wireframe).
 * @param imagePath Ruta de la imagen.
 * @param client LLM con visión (opcional).
 */
export async function analyzeImage(
  imagePath: string,
  client: LlmClient | null,
): Promise<DesignStructure> {
  const buf = fs.readFileSync(imagePath);
  const info = readImageInfo(buf);
  if (info.format === 'unknown')
    throw new Error(`Formato de imagen no reconocido: ${imagePath}`);
  const source: DesignStructure['source'] = {
    type: 'image',
    ref: imagePath,
    width: info.width,
    height: info.height,
    format: info.format,
  };
  const title = path.basename(imagePath, path.extname(imagePath));
  if (!client) {
    return {
      source,
      title,
      elements: [],
      method: 'empty',
      notes: [
        `Imagen ${info.format} ${info.width ?? '?'}×${info.height ?? '?'} (${Math.round(info.bytes / 1024)} KB).`,
        'No hay LLM con visión configurado (WEBMCP_LLM_PROVIDER=openai|anthropic|ollama). Usa --describe "…" para analizar desde texto o configura un proveedor.',
      ],
    };
  }
  const raw = await client.complete({
    system: VISION_SYSTEM,
    user: `Analiza esta pantalla (${info.width ?? '?'}×${info.height ?? '?'} px) y devuelve el JSON.`,
    json: true,
    images: [toDataUrl(buf, info.mime)],
    maxTokens: 4000,
  });
  const obj = extractJsonObject(raw);
  const elements = normalizeElements(obj?.elements);
  return {
    source,
    title: String(obj?.title ?? title),
    elements,
    method: 'llm-vision',
    notes: elements.length
      ? []
      : [
          'El modelo no devolvió elementos; prueba con una imagen más nítida o un modelo con visión.',
        ],
  };
}

/** Nodo del árbol de Figma (subconjunto). */
interface FigmaNode {
  id: string;
  name: string;
  type: string;
  characters?: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  children?: FigmaNode[];
  componentProperties?: Record<string, { value?: unknown }>;
}

/** Deduce el tipo de elemento de un nodo de Figma por nombre/tipo/contenido. */
export function classifyFigmaNode(node: FigmaNode): DesignElementKind | null {
  const name = node.name.toLowerCase();
  if (/button|btn|cta/.test(name)) return 'button';
  if (/input|field|textfield|text field/.test(name))
    return /textarea|multiline/.test(name) ? 'textarea' : 'input';
  if (/select|dropdown|combobox/.test(name)) return 'select';
  if (/checkbox|toggle|switch/.test(name)) return 'checkbox';
  if (/form/.test(name)) return 'form';
  if (/nav|menu|header|tabs/.test(name)) return 'nav';
  if (/hero|banner|jumbotron/.test(name)) return 'hero';
  if (/card|tile/.test(name)) return 'card';
  if (/list|grid|table|collection/.test(name)) return 'list';
  if (/price|precio|total|amount/.test(name)) return 'price';
  if (/link|anchor/.test(name)) return 'link';
  if (node.type === 'TEXT') {
    const text = node.characters ?? '';
    if (/^\s*[$€£]?\s?\d+([.,]\d+)?\s?[$€£]?\s*$/.test(text)) return 'price';
    return (node.absoluteBoundingBox?.height ?? 0) > 28 ? 'heading' : 'text';
  }
  if (node.type === 'RECTANGLE' && /image|img|photo|picture/.test(name)) return 'image';
  return null;
}

/** Recorre el árbol de Figma y produce elementos. */
export function figmaTreeToElements(root: FigmaNode, maxElements = 200): DesignElement[] {
  const out: DesignElement[] = [];
  const ids = new Set<string>();
  const walk = (node: FigmaNode, parent?: string): void => {
    if (out.length >= maxElements) return;
    const kind = classifyFigmaNode(node);
    let myId = parent;
    if (kind) {
      let id =
        node.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 40) || kind;
      let n = 2;
      const base = id;
      while (ids.has(id)) id = `${base}-${n++}`;
      ids.add(id);
      const labelNode = node.type === 'TEXT' ? node : findText(node);
      const label = (labelNode?.characters ?? node.name).trim().slice(0, 120);
      const el: DesignElement = {
        id,
        kind,
        label,
        parent,
        box: node.absoluteBoundingBox,
        intent:
          kind === 'button'
            ? /submit|send|enviar|buy|comprar|pay|pagar|save|guardar|login|sign|entrar|acceder|registr|reservar|book|confirmar|continuar|continue|next|siguiente/i.test(
                `${label} ${parent ?? ''}`,
              )
              ? 'submit'
              : /cancel|cancelar|close|cerrar/i.test(label)
                ? 'cancel'
                : 'action'
            : kind === 'link' || kind === 'nav'
              ? 'navigate'
              : undefined,
        placeholder:
          kind === 'input' || kind === 'textarea'
            ? labelNode?.characters?.trim()
            : undefined,
        // El nombre de campo sale del nombre de la capa («Input Email» →
        // email), no del placeholder («tu@email.com»).
        fieldName:
          kind === 'input' ||
          kind === 'textarea' ||
          kind === 'select' ||
          kind === 'checkbox'
            ? camelField(
                node.name
                  .replace(
                    /\b(input|field|textfield|text field|select|dropdown|combobox|checkbox|toggle|switch|textarea)\b/gi,
                    '',
                  )
                  .trim() || label,
              )
            : undefined,
        confidence: node.type === 'INSTANCE' || node.type === 'COMPONENT' ? 0.85 : 0.65,
      };
      out.push(el);
      myId = id;
      // Los componentes hoja (botón, input, texto…) no aportan hijos útiles.
      if (!['form', 'nav', 'card', 'hero', 'list'].includes(kind)) return;
    }
    for (const child of node.children ?? []) walk(child, myId);
  };
  walk(root);
  return out;
}

/** Primer nodo de texto descendiente. */
function findText(node: FigmaNode): FigmaNode | undefined {
  if (node.type === 'TEXT') return node;
  for (const c of node.children ?? []) {
    const t = findText(c);
    if (t) return t;
  }
  return undefined;
}

/** camelCase para nombres de campo. */
function camelField(text: string): string {
  const words = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 3);
  if (!words.length) return 'value';
  return words
    .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join('');
}

/**
 * Analiza un archivo de Figma por API REST.
 * @param fileRef URL de Figma o clave del archivo (opcionalmente `key#nodeId`).
 * @param token Token personal (`FIGMA_TOKEN`).
 * @param fetchImpl fetch (tests).
 */
export async function analyzeFigma(
  fileRef: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DesignStructure> {
  const m = /figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/.exec(fileRef);
  const key = m ? m[1] : fileRef.split('#')[0];
  const nodeId =
    /node-id=([^&]+)/.exec(fileRef)?.[1]?.replace('-', ':') ?? fileRef.split('#')[1];
  const url = nodeId
    ? `https://api.figma.com/v1/files/${key}/nodes?ids=${encodeURIComponent(nodeId)}`
    : `https://api.figma.com/v1/files/${key}?depth=6`;
  const res = await fetchImpl(url, { headers: { 'X-Figma-Token': token } });
  if (!res.ok)
    throw new Error(
      `Figma API ${res.status}: ${await res.text().catch(() => '')}`.trim(),
    );
  const body = (await res.json()) as {
    name?: string;
    document?: FigmaNode;
    nodes?: Record<string, { document: FigmaNode }>;
  };
  const root: FigmaNode | undefined =
    body.document ?? Object.values(body.nodes ?? {})[0]?.document;
  if (!root) throw new Error('Respuesta de Figma sin documento');
  const elements = figmaTreeToElements(root);
  return {
    source: {
      type: 'figma',
      ref: fileRef,
      width: root.absoluteBoundingBox?.width,
      height: root.absoluteBoundingBox?.height,
    },
    title: body.name ?? root.name,
    elements,
    method: 'figma-api',
    notes: elements.length
      ? []
      : [
          'No se detectaron elementos interactivos: nombra las capas (Button/Input/Nav…) o usa componentes.',
        ],
  };
}

/** Vocabulario para descripciones textuales. */
const TEXT_PATTERNS: Array<{
  re: RegExp;
  kind: DesignElementKind;
  label: string;
  intent?: DesignElement['intent'];
  fieldName?: string;
}> = [
  {
    re: /buscador|barra de b[uú]squeda|search/i,
    kind: 'input',
    label: 'Buscar',
    fieldName: 'query',
  },
  { re: /email|correo/i, kind: 'input', label: 'Email', fieldName: 'email' },
  {
    re: /contrase[ñn]a|password/i,
    kind: 'input',
    label: 'Contraseña',
    fieldName: 'password',
  },
  { re: /nombre|name/i, kind: 'input', label: 'Nombre', fieldName: 'name' },
  { re: /tel[eé]fono|phone/i, kind: 'input', label: 'Teléfono', fieldName: 'phone' },
  {
    re: /mensaje|comentario|message/i,
    kind: 'textarea',
    label: 'Mensaje',
    fieldName: 'message',
  },
  {
    re: /login|iniciar sesi[oó]n|acceder/i,
    kind: 'button',
    label: 'Iniciar sesión',
    intent: 'submit',
  },
  {
    re: /registr|crear cuenta|sign ?up/i,
    kind: 'button',
    label: 'Crear cuenta',
    intent: 'submit',
  },
  {
    re: /a[ñn]adir al carrito|add to cart|comprar/i,
    kind: 'button',
    label: 'Añadir al carrito',
    intent: 'action',
  },
  {
    re: /checkout|pagar|finalizar compra/i,
    kind: 'button',
    label: 'Pagar',
    intent: 'submit',
  },
  { re: /enviar|submit|contactar/i, kind: 'button', label: 'Enviar', intent: 'submit' },
  { re: /cancelar|cancel/i, kind: 'button', label: 'Cancelar', intent: 'cancel' },
  { re: /suscri|newsletter/i, kind: 'button', label: 'Suscribirme', intent: 'submit' },
  { re: /men[uú]|navegaci[oó]n|navbar|header/i, kind: 'nav', label: 'Navegación' },
  { re: /hero|portada|banner/i, kind: 'hero', label: 'Hero' },
  { re: /precio|price|total/i, kind: 'price', label: 'Precio' },
  {
    re: /lista|listado|cat[aá]logo|grid|productos|art[ií]culos/i,
    kind: 'list',
    label: 'Listado',
  },
  { re: /tarjeta|card/i, kind: 'card', label: 'Tarjeta' },
];

/**
 * Analiza una descripción textual del diseño (heurísticas + LLM opcional).
 * @param description Texto («landing con buscador, login y lista de productos con botón comprar»).
 * @param client LLM opcional.
 */
export async function analyzeDescription(
  description: string,
  client: LlmClient | null,
): Promise<DesignStructure> {
  if (client) {
    try {
      const raw = await client.complete({
        system: VISION_SYSTEM.replace(
          'la captura o mockup de una pantalla web',
          'la descripción textual de una pantalla web',
        ),
        user: description,
        json: true,
        maxTokens: 3000,
      });
      const obj = extractJsonObject(raw);
      const elements = normalizeElements(obj?.elements);
      if (elements.length)
        return {
          source: { type: 'text', ref: description.slice(0, 80) },
          title: String(obj?.title ?? 'Diseño'),
          elements,
          method: 'llm-text',
          notes: [],
        };
    } catch {
      /* cae a heurísticas */
    }
  }
  const elements: DesignElement[] = [];
  const ids = new Set<string>();
  const slug = (t: string) =>
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  let formId: string | undefined;
  let searchFormId: string | undefined;
  for (const p of TEXT_PATTERNS) {
    if (!p.re.test(description)) continue;
    const id = `${p.kind}-${slug(p.fieldName ?? p.label)}`;
    if (ids.has(id)) continue;
    ids.add(id);
    let parent: string | undefined;
    if (p.fieldName === 'query') {
      // El buscador es un formulario propio (input + botón).
      searchFormId = 'form-search';
      elements.push({
        id: searchFormId,
        kind: 'form',
        label: 'Buscar',
        confidence: 0.55,
      });
      parent = searchFormId;
    } else if (p.kind === 'input' || p.kind === 'textarea') {
      if (!formId) {
        formId = 'form-main';
        elements.push({ id: formId, kind: 'form', label: 'Formulario', confidence: 0.5 });
      }
      parent = formId;
    }
    elements.push({
      id,
      kind: p.kind,
      label: p.label,
      intent: p.intent ?? (p.kind === 'nav' ? 'navigate' : undefined),
      fieldName: p.fieldName,
      parent,
      confidence: 0.55,
    });
  }
  if (searchFormId)
    elements.push({
      id: 'button-search',
      kind: 'button',
      label: 'Buscar',
      intent: 'submit',
      parent: searchFormId,
      confidence: 0.55,
    });
  // Un botón submit dentro del form si hay campos pero ningún botón submit.
  if (formId) {
    const submit = elements.find(
      (e) => e.kind === 'button' && e.intent === 'submit' && !e.parent,
    );
    if (submit) submit.parent = formId;
    else
      elements.push({
        id: 'button-submit',
        kind: 'button',
        label: 'Enviar',
        intent: 'submit',
        parent: formId,
        confidence: 0.5,
      });
  }
  return {
    source: { type: 'text', ref: description.slice(0, 80) },
    title: 'Diseño',
    elements,
    method: 'heuristic',
    notes: elements.length ? [] : ['No se reconoció ningún elemento en la descripción.'],
  };
}
