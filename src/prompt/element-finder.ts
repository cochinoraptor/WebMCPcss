/**
 * Buscador de elementos por descripción semántica.
 *
 * Búsqueda progresiva (se detiene en la primera estrategia con éxito):
 * 1. **selector**: la descripción (o el `selector` propuesto por el
 *    intérprete) ya es un selector CSS que existe en la página.
 * 2. **tool**: la descripción coincide con una herramienta del
 *    `.webmcp.css` (`botón de añadir al carrito` ≈ `addToCart`); se usa su
 *    selector y se recuerda la herramienta para delegar la ejecución (con
 *    auto-reparación incluida).
 * 3. **llm**: el modelo elige un selector entre los candidatos de la
 *    página; se verifica que exista antes de aceptarlo.
 * 4. **text**: coincidencia por texto visible / atributos (equivalente a
 *    `//*[contains(text(), '...')]` pero sobre las instantáneas).
 * 5. **vision**: puntuación de candidatos con `src/core/vision.ts`
 *    (mismo motor que la auto-reparación).
 * 6. **probe**: selectores genéricos por tipo de elemento (`.carousel`,
 *    `input[type="search"]`, `footer`...).
 * 7. Sin resultado: sugerencias para que el usuario sea más específico.
 *
 * Solo requiere un {@link PageAdapter}, así que funciona igual con
 * Puppeteer (navegador real) que con jsdom (tests).
 */
import type { PageAdapter } from '../adapters/page-adapter';
import { findBestCandidate, humanize, tokenSimilarity } from '../core/vision';
import type { ElementSnapshot, ToolMap } from '../types';
import { logger } from '../utils/logger';
import { extractJsonObject } from './llm-client';
import type { DomMutator } from './dom-mutator';
import type { ElementMatch, FindResult, FindStrategy, LlmClient } from './types';
import { detectKinds, fold, keywords, looksLikeSelector } from './vocabulary';

/** Opciones del buscador. */
/** Preferencias de búsqueda que dependen de la acción a ejecutar. */
export interface FindOptions {
  /**
   * `field`: la descripción se refiere a un campo de formulario (acciones
   * `fill`/`upload`); se resuelven etiquetas `<label>` y placeholders.
   */
  prefer?: 'field';
}

export interface ElementFinderOptions {
  /** Tool map del `.webmcp.css` (habilita la estrategia `tool`). */
  toolMap?: ToolMap;
  /** Cliente LLM (habilita la estrategia `llm`). */
  llm?: LlmClient | null;
  /** Umbral mínimo para aceptar una coincidencia por texto/visión. */
  threshold?: number;
  /** Máximo de candidatos enviados al LLM. */
  maxLlmCandidates?: number;
}

/** System prompt para la selección de elementos por LLM. */
export const FINDER_SYSTEM_PROMPT = [
  'Eres un asistente que localiza elementos en una página web.',
  'Recibes la descripción de un elemento y una lista de candidatos con su selector CSS.',
  'Responde SOLO con JSON: {"selector": "<selector de la lista o null>", "confidence": 0.0-1.0}.',
  'Elige únicamente selectores que aparezcan en la lista. Si ninguno encaja, devuelve null.',
].join('\n');

/** Etiquetas que suelen ser objetivo de acciones (para desempatar). */
const ACTIONABLE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea']);

/** Buscador de elementos con estrategias progresivas. */
export class ElementFinder {
  private readonly threshold: number;
  private snapshotCache: ElementSnapshot[] | null = null;

  /**
   * @param adapter Adaptador de la página.
   * @param options Tool map, LLM y umbrales.
   */
  constructor(
    private readonly adapter: PageAdapter,
    private readonly options: ElementFinderOptions = {},
  ) {
    this.threshold = options.threshold ?? 0.45;
  }

  /** Invalida la caché de instantáneas (tras modificar la página). */
  invalidate(): void {
    this.snapshotCache = null;
  }

  /** Instantáneas de la página (cacheadas hasta `invalidate()`). */
  async candidates(): Promise<ElementSnapshot[]> {
    if (!this.snapshotCache) this.snapshotCache = await this.adapter.snapshot();
    return this.snapshotCache;
  }

  /**
   * Localiza un elemento a partir de su descripción.
   *
   * @param description Descripción en lenguaje natural o selector CSS.
   * @param hintSelector Selector propuesto por el intérprete (se verifica).
   * @returns Mejor coincidencia, sugerencias y estrategias intentadas.
   */
  async find(
    description: string,
    hintSelector?: string,
    options: FindOptions = {},
  ): Promise<FindResult> {
    const tried: FindStrategy[] = [];
    const desc = description.trim();

    // 1) Selector explícito (descripción o pista del intérprete).
    tried.push('selector');
    for (const candidate of [hintSelector, desc]) {
      if (candidate && looksLikeSelector(candidate) && (await this.exists(candidate))) {
        return {
          match: await this.describe(candidate, 'selector', 1),
          suggestions: [],
          tried,
        };
      }
    }
    if (!desc)
      return { match: null, suggestions: ['Indica qué elemento modificar.'], tried };

    // 2) Herramienta del .webmcp.css.
    if (this.options.toolMap) {
      tried.push('tool');
      const byTool = await this.findByTool(desc);
      if (byTool) return { match: byTool, suggestions: [], tried };
    }

    // 3) LLM sobre los candidatos.
    if (this.options.llm) {
      tried.push('llm');
      const byLlm = await this.findByLlm(desc);
      if (byLlm) return { match: byLlm, suggestions: [], tried };
    }

    // 4) Texto visible / atributos.
    tried.push('text');
    const byText = await this.findByText(desc, options.prefer);
    if (byText) return { match: await this.attachTool(byText), suggestions: [], tried };

    // 5) Visión (mismo motor que la auto-reparación).
    tried.push('vision');
    const byVision = await this.findByVision(desc);
    if (byVision)
      return { match: await this.attachTool(byVision), suggestions: [], tried };

    // 6) Sondeo por tipo de elemento.
    tried.push('probe');
    const byProbe = await this.findByProbe(desc);
    if (byProbe) return { match: await this.attachTool(byProbe), suggestions: [], tried };

    return { match: null, suggestions: await this.suggest(desc), tried };
  }

  /* ---------------------------------------------------------------- */
  /* Estrategias                                                        */
  /* ---------------------------------------------------------------- */

  /** Coincidencia con herramientas del tool map por nombre/descripción. */
  private async findByTool(desc: string): Promise<ElementMatch | null> {
    const map = this.options.toolMap;
    if (!map) return null;
    const kw = keywords(desc) || fold(desc);
    let best: { name: string; score: number } | null = null;
    for (const [name, tool] of Object.entries(map.tools)) {
      const hay = [humanize(name), tool.description ?? '', tool.fingerprint?.text ?? '']
        .filter(Boolean)
        .join(' ');
      // Texto visible del elemento real de la herramienta (robusto ante idiomas:
      // "añadir al carrito" ≈ botón de `addToCart` aunque el nombre esté en inglés).
      const liveText = (await this.safeText(tool.selector)) ?? '';
      const score = Math.max(
        tokenSimilarity(kw, humanize(name)),
        tokenSimilarity(kw, hay),
        liveText ? tokenSimilarity(kw, liveText) : 0,
        fold(desc) === fold(name) ? 1 : 0,
      );
      if (score >= 0.5 && (!best || score > best.score)) best = { name, score };
    }
    if (!best) return null;
    const selector = map.tools[best.name].selector;
    const exists = await this.exists(selector);
    logger.debug(`finder: herramienta "${best.name}" (score ${best.score.toFixed(2)})`);
    return {
      ...(exists
        ? await this.describe(selector, 'tool', best.score)
        : { selector, strategy: 'tool' as const, confidence: best.score * 0.8 }),
      tool: best.name,
    };
  }

  /** El LLM elige un selector entre los candidatos. */
  private async findByLlm(desc: string): Promise<ElementMatch | null> {
    const llm = this.options.llm;
    if (!llm) return null;
    const all = await this.candidates();
    if (all.length === 0) return null;
    const max = this.options.maxLlmCandidates ?? 80;
    // Prefiltro léxico para no enviar toda la página.
    const kw = keywords(desc, true);
    const scored = all
      .map((c) => ({
        c,
        s: tokenSimilarity(kw, `${c.text} ${c.tag} ${Object.values(c.attrs).join(' ')}`),
      }))
      .sort((a, b) => b.s - a.s || Number(b.c.visible) - Number(a.c.visible))
      .slice(0, max)
      .map((x) => x.c);
    const list = scored
      .map(
        (c) =>
          `${c.selector} | ${c.tag} | ${c.text.slice(0, 50)} | ${Object.entries(c.attrs)
            .filter(([k]) => k !== 'href')
            .map(([k, v]) => `${k}=${v.slice(0, 30)}`)
            .join(' ')}`,
      )
      .join('\n');
    try {
      const raw = await llm.complete({
        system: FINDER_SYSTEM_PROMPT,
        user: `Elemento buscado: ${desc}\n\nCandidatos (selector | tag | texto | atributos):\n${list}`,
        json: true,
        temperature: 0,
      });
      const obj = extractJsonObject(raw);
      const selector = typeof obj?.selector === 'string' ? obj.selector.trim() : '';
      if (!selector || !scored.some((c) => c.selector === selector)) return null;
      if (!(await this.exists(selector))) return null;
      const confidence =
        typeof obj?.confidence === 'number'
          ? Math.max(0, Math.min(1, obj.confidence))
          : 0.75;
      return this.describe(selector, 'llm', confidence);
    } catch (err) {
      logger.warn(
        `finder: LLM falló (${err instanceof Error ? err.message : String(err)}); continúo sin él.`,
      );
      return null;
    }
  }

  /**
   * Coincidencia por texto visible y atributos. Prioriza la inclusión de la
   * frase completa, luego la similitud de tokens; desempata por etiqueta
   * accionable y visibilidad.
   */
  private async findByText(
    desc: string,
    prefer?: FindOptions['prefer'],
  ): Promise<ElementMatch | null> {
    const all = await this.candidates();
    const kinds = detectKinds(fold(desc));
    const kw = keywords(desc);
    if (!kw) return null;
    const wantedTags = new Set(kinds.flatMap((k) => k.tags ?? []));
    // Etiquetas que el tipo de elemento excluye por completo (un "campo" nunca
    // es un botón; un "botón" nunca es un input de texto).
    const fieldKinds = new Set([
      'field',
      'email',
      'password',
      'search',
      'phone',
      'textarea',
      'checkbox',
      'select',
      'file',
    ]);
    const wantsField = prefer === 'field' || kinds.some((k) => fieldKinds.has(k.id));
    const wantsContainer = kinds.some((k) =>
      [
        'form',
        'section',
        'card',
        'carousel',
        'banner',
        'modal',
        'nav',
        'header',
        'footer',
        'sidebar',
        'table',
        'list',
      ].includes(k.id),
    );
    let best: { c: ElementSnapshot; score: number } | null = null;
    for (const c of all) {
      if (wantsField && !['input', 'textarea', 'select'].includes(c.tag)) {
        // Un campo descrito por su etiqueta visible ("campo cupón") suele
        // tener el texto en el <label>, no en el input: lo resolvemos abajo.
        continue;
      }
      if (wantsContainer && ACTIONABLE_TAGS.has(c.tag) && !wantedTags.has(c.tag))
        continue;
      const text = fold(c.text);
      const attrText = fold(
        Object.entries(c.attrs)
          .filter(([k]) => k !== 'href' && k !== 'type')
          .map(([, v]) => humanize(v))
          .join(' '),
      );
      let score = 0;
      if (text && text === kw) score = 1;
      else if (text && text.includes(kw))
        score = 0.9 - Math.min(0.3, (text.length - kw.length) / 200);
      else if (attrText.includes(kw)) score = 0.8;
      else
        score = Math.max(tokenSimilarity(kw, text), tokenSimilarity(kw, attrText) * 0.9);
      if (score < this.threshold) continue;
      if (wantedTags.size > 0) score += wantedTags.has(c.tag) ? 0.1 : -0.15;
      else if (ACTIONABLE_TAGS.has(c.tag)) score += 0.05;
      if (!c.visible) score -= 0.2;
      if (!best || score > best.score) best = { c, score };
    }
    if ((!best || best.score < this.threshold) && wantsField) {
      const byLabel = await this.fieldByLabel(kw);
      if (byLabel) return byLabel;
    }
    if (!best || best.score < this.threshold) return null;
    if (!(await this.exists(best.c.selector))) return null;
    return {
      selector: best.c.selector,
      strategy: 'text',
      confidence: Math.min(1, best.score),
      tag: best.c.tag,
      text: best.c.text,
      attrs: best.c.attrs,
    };
  }

  /**
   * Campo de formulario cuya etiqueta visible (`<label>`), placeholder,
   * aria-label o name coincide con las palabras clave.
   */
  private async fieldByLabel(kw: string): Promise<ElementMatch | null> {
    const all = await this.candidates();
    // 1) Por placeholder / aria-label / name / id del propio input.
    let best: { c: ElementSnapshot; s: number } | null = null;
    for (const c of all) {
      if (!['input', 'textarea', 'select'].includes(c.tag)) continue;
      const hay = fold(
        ['placeholder', 'aria-label', 'name', 'id']
          .map((k) => humanize(c.attrs[k] ?? ''))
          .join(' '),
      );
      const s = hay.includes(kw) ? 0.85 : tokenSimilarity(kw, hay);
      if (s >= this.threshold && (!best || s > best.s)) best = { c, s };
    }
    if (best && (await this.exists(best.c.selector))) {
      return {
        selector: best.c.selector,
        strategy: 'text',
        confidence: best.s,
        tag: best.c.tag,
        text: best.c.text,
        attrs: best.c.attrs,
      };
    }
    // 2) Por <label for="..."> cuyo texto coincide.
    const labels = all.filter((c) => c.tag === 'label' && c.text);
    for (const label of labels) {
      const s = fold(label.text).includes(kw) ? 0.8 : tokenSimilarity(kw, label.text);
      if (s < this.threshold) continue;
      const forId = await this.adapter.readAttr(label.selector, 'for').catch(() => null);
      if (forId) {
        const sel = `#${forId.replace(/([^\w-])/g, '\\$1')}`;
        if (await this.exists(sel)) return this.describe(sel, 'text', s);
      }
      const inner = `${label.selector} input, ${label.selector} textarea, ${label.selector} select`;
      if (await this.exists(inner)) return this.describe(inner, 'text', s);
    }
    return null;
  }

  /** Puntuación de candidatos con el módulo de visión. */
  private async findByVision(desc: string): Promise<ElementMatch | null> {
    const all = await this.candidates();
    const kinds = detectKinds(fold(desc));
    const kw = keywords(desc) || fold(desc);
    const tags = kinds.flatMap((k) => k.tags ?? []);
    const best = findBestCandidate(
      all,
      {
        text: kw,
        toolName: kw.replace(/\s+/g, '-'),
        tags: tags.length > 0 ? tags : undefined,
      },
      this.threshold,
    );
    if (!best || !(await this.exists(best.candidate.selector))) return null;
    return {
      selector: best.candidate.selector,
      strategy: 'vision',
      confidence: best.score,
      tag: best.candidate.tag,
      text: best.candidate.text,
      attrs: best.candidate.attrs,
    };
  }

  /** Sondeo de selectores genéricos según el tipo de elemento descrito. */
  private async findByProbe(desc: string): Promise<ElementMatch | null> {
    const kinds = detectKinds(fold(desc));
    if (kinds.length === 0) return null;
    const kw = keywords(desc);
    // Tipo "principal": el último mencionado suele ser el sustantivo núcleo
    // ("botón del formulario" → formulario? no: en español el núcleo va primero).
    for (const kind of kinds) {
      for (const probe of kind.probes) {
        if (!(await this.exists(probe))) continue;
        // Si hay palabras clave, intenta refinar entre los que casan el sondeo.
        if (kw) {
          const refined = await this.refineProbe(probe, kw);
          if (refined) return refined;
        }
        return this.describe(probe, 'probe', kw ? 0.5 : 0.65);
      }
    }
    return null;
  }

  /** Entre los candidatos que casan un sondeo, elige el más parecido a `kw`. */
  private async refineProbe(probe: string, kw: string): Promise<ElementMatch | null> {
    const all = await this.candidates();
    const kindTags = new Set(
      probe
        .replace(/\[.*$/, '')
        .split(',')
        .map((s) => s.trim()),
    );
    let best: { c: ElementSnapshot; s: number } | null = null;
    for (const c of all) {
      if (!kindTags.has(c.tag) && !probe.startsWith('[') && !probe.startsWith('.'))
        continue;
      const s = Math.max(
        tokenSimilarity(kw, c.text),
        tokenSimilarity(kw, humanize(Object.values(c.attrs).join(' '))),
      );
      if (s > 0.3 && (!best || s > best.s)) best = { c, s };
    }
    if (!best || !(await this.exists(best.c.selector))) return null;
    return {
      selector: best.c.selector,
      strategy: 'probe',
      confidence: 0.5 + best.s * 0.4,
      tag: best.c.tag,
      text: best.c.text,
      attrs: best.c.attrs,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Utilidades                                                         */
  /* ---------------------------------------------------------------- */

  /**
   * Si el elemento localizado es el mismo que el de una herramienta del tool
   * map, asocia la herramienta (permite delegar la ejecución con
   * auto-reparación y confirmación).
   */
  private async attachTool(match: ElementMatch): Promise<ElementMatch> {
    const map = this.options.toolMap;
    if (!map || match.tool) return match;
    for (const [name, tool] of Object.entries(map.tools)) {
      if (tool.selector === match.selector) return { ...match, tool: name };
      if (!(await this.exists(tool.selector))) continue;
      // Mismo elemento aunque el selector difiera: comparamos texto + atributos clave.
      const toolText = await this.safeText(tool.selector);
      const sameText = toolText && match.text && fold(toolText) === fold(match.text);
      if (!sameText) continue;
      const attr = Object.keys(match.attrs ?? {}).find(
        (k) => k.startsWith('data-') || k === 'id',
      );
      if (!attr) {
        if (await this.sameElement(tool.selector, match.selector))
          return { ...match, tool: name };
        continue;
      }
      const toolAttr = await this.adapter.readAttr(tool.selector, attr).catch(() => null);
      if (toolAttr !== null && toolAttr === match.attrs?.[attr])
        return { ...match, tool: name };
    }
    return match;
  }

  /** ¿Dos selectores apuntan al mismo primer elemento? (vía DomMutator.count si existe) */
  private async sameElement(a: string, b: string): Promise<boolean> {
    const counter = this.adapter as Partial<DomMutator>;
    if (typeof counter.count !== 'function') return false;
    try {
      const both = await counter.count(`${a}, ${b}`);
      const onlyA = await counter.count(a);
      const onlyB = await counter.count(b);
      return both === 1 && onlyA === 1 && onlyB === 1;
    } catch {
      return false;
    }
  }

  /** `adapter.exists` tolerante a selectores inválidos. */
  private async exists(selector: string): Promise<boolean> {
    try {
      return await this.adapter.exists(selector);
    } catch {
      return false;
    }
  }

  /** Enriquece una coincidencia con la instantánea del elemento, si la hay. */
  private async describe(
    selector: string,
    strategy: FindStrategy,
    confidence: number,
  ): Promise<ElementMatch> {
    let snap = (await this.candidates()).find((c) => c.selector === selector);
    if (!snap) {
      // El selector no coincide literalmente con ninguna instantánea (p. ej. el
      // de una herramienta): identifica el elemento por texto + atributo clave.
      const text = await this.safeText(selector);
      const sameText = (await this.candidates()).filter(
        (c) => text !== undefined && c.text && fold(c.text) === fold(text),
      );
      if (sameText.length === 1) snap = sameText[0];
      else if (sameText.length > 1) {
        for (const c of sameText) {
          if (await this.sameElement(selector, c.selector)) {
            snap = c;
            break;
          }
        }
      }
    }
    return {
      selector,
      strategy,
      confidence,
      tag: snap?.tag ?? (await this.safeTag(selector)),
      text: snap?.text ?? (await this.safeText(selector)),
      attrs: snap?.attrs,
    };
  }

  /**
   * Etiqueta del elemento cuando no hay instantánea: comprueba
   * `selector:is(tag)` para las etiquetas habituales (sin ampliar PageAdapter).
   */
  private async safeTag(selector: string): Promise<string | undefined> {
    const TAGS = [
      'button',
      'a',
      'input',
      'select',
      'textarea',
      'img',
      'h1',
      'h2',
      'h3',
      'p',
      'div',
      'span',
      'section',
      'form',
      'nav',
      'header',
      'footer',
      'ul',
      'li',
    ];
    for (const tag of TAGS) {
      if (await this.exists(`${selector}:is(${tag})`)) return tag;
    }
    return undefined;
  }

  private async safeText(selector: string): Promise<string | undefined> {
    try {
      const t = await this.adapter.readText(selector);
      return t ? t.slice(0, 120) : undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Sugerencias cuando no hay coincidencia: elementos parecidos de la
   * página y consejos para precisar la descripción.
   */
  private async suggest(desc: string): Promise<string[]> {
    const all = await this.candidates();
    const kw = keywords(desc, true) || fold(desc);
    const similar = all
      .filter((c) => c.text || Object.keys(c.attrs).length > 0)
      .map((c) => ({
        c,
        s: Math.max(
          tokenSimilarity(kw, c.text),
          tokenSimilarity(kw, humanize(Object.values(c.attrs).join(' '))),
        ),
      }))
      .filter((x) => x.s > 0.15)
      .sort((a, b) => b.s - a.s)
      .slice(0, 5);
    const out: string[] = [];
    if (similar.length > 0) {
      out.push('Elementos parecidos en la página:');
      for (const { c } of similar) {
        out.push(
          `  ${c.selector}  (${c.tag}${c.text ? `: "${c.text.slice(0, 40)}"` : ''})`,
        );
      }
    }
    out.push(
      'Sé más específico: incluye el texto visible del elemento ("el botón Comprar ahora"),',
      'su tipo (botón, enlace, campo, imagen…) o un selector CSS (#id, .clase).',
    );
    if (this.options.toolMap && Object.keys(this.options.toolMap.tools).length > 0) {
      out.push(
        `Herramientas WebMCP disponibles: ${Object.keys(this.options.toolMap.tools).join(', ')}.`,
      );
    }
    return out;
  }
}

/**
 * Atajo funcional: localiza un elemento con un buscador temporal.
 * @see ElementFinder.find
 */
export async function findElement(
  adapter: PageAdapter,
  description: string,
  options: ElementFinderOptions = {},
): Promise<FindResult> {
  return new ElementFinder(adapter, options).find(description);
}
