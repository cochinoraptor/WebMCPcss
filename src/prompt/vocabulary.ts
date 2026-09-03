/**
 * Vocabulario compartido del módulo `prompt` (español e inglés):
 * colores, tipos de elemento, palabras vacías y utilidades de texto.
 *
 * Interno al módulo; el intérprete lo usa para extraer parámetros y el
 * buscador de elementos para inferir etiquetas y selectores de sondeo.
 */

/** Normaliza texto: minúsculas, sin tildes, espacios colapsados. */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza conservando la longitud (minúsculas y sin tildes, pero sin
 * colapsar espacios). Permite buscar con regex sobre el texto normalizado y
 * recortar el texto ORIGINAL en los mismos índices (los valores a escribir
 * conservan mayúsculas y acentos). Si el resultado cambiara de longitud
 * (caracteres exóticos), se degrada a `toLowerCase()`.
 *
 * @param s Texto original (ya con espacios colapsados).
 */
export function foldKeepLength(s: string): string {
  const folded = s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (folded.length === s.length) return folded;
  const lower = s.toLowerCase();
  return lower.length === s.length ? lower : s;
}

/** Convierte una frase en camelCase (`add to cart` → `addToCart`). */
export function camelCase(phrase: string): string {
  const words = fold(phrase)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(' ')
    .filter(Boolean);
  return words.map((w, i) => (i === 0 ? w : w[0].toUpperCase() + w.slice(1))).join('');
}

/** Nombres de color (es/en) → valor CSS. */
export const COLOR_NAMES: Record<string, string> = {
  rojo: 'red',
  roja: 'red',
  red: 'red',
  azul: 'blue',
  blue: 'blue',
  verde: 'green',
  green: 'green',
  amarillo: 'yellow',
  amarilla: 'yellow',
  yellow: 'yellow',
  negro: 'black',
  negra: 'black',
  black: 'black',
  blanco: 'white',
  blanca: 'white',
  white: 'white',
  gris: 'gray',
  gray: 'gray',
  grey: 'gray',
  naranja: 'orange',
  anaranjado: 'orange',
  orange: 'orange',
  morado: 'purple',
  morada: 'purple',
  violeta: 'violet',
  purpura: 'purple',
  purple: 'purple',
  violet: 'violet',
  rosa: 'pink',
  rosado: 'pink',
  rosada: 'pink',
  pink: 'pink',
  marron: 'brown',
  cafe: 'brown',
  brown: 'brown',
  celeste: 'skyblue',
  skyblue: 'skyblue',
  turquesa: 'turquoise',
  turquoise: 'turquoise',
  dorado: 'gold',
  gold: 'gold',
  plateado: 'silver',
  silver: 'silver',
  beige: 'beige',
  cian: 'cyan',
  cyan: 'cyan',
  magenta: 'magenta',
  lima: 'lime',
  lime: 'lime',
  oliva: 'olive',
  olive: 'olive',
  granate: 'maroon',
  maroon: 'maroon',
  coral: 'coral',
  salmon: 'salmon',
  transparente: 'transparent',
  transparent: 'transparent',
};

/** Modificadores de tono que preceden a un color (`azul oscuro`, `light blue`). */
const SHADE_PREFIX: Record<string, string> = {
  oscuro: 'dark',
  oscura: 'dark',
  dark: 'dark',
  claro: 'light',
  clara: 'light',
  light: 'light',
};

/** Colores CSS que admiten prefijo dark/light. */
const SHADEABLE = new Set([
  'red',
  'blue',
  'green',
  'gray',
  'orange',
  'cyan',
  'magenta',
  'violet',
  'salmon',
  'goldenrod',
  'khaki',
  'pink',
  'yellow',
  'coral',
  'turquoise',
  'skyblue',
  'seagreen',
  'slateblue',
  'slategray',
]);

/** Color extraído de un prompt. */
export interface ColorHit {
  /** Valor CSS normalizado. */
  value: string;
  /** Fragmento original (para eliminarlo del texto). */
  raw: string;
  /** Índice en el texto normalizado. */
  index: number;
}

/**
 * Busca un color en el texto (nombre es/en con modificador opcional,
 * `#hex`, `rgb()/rgba()/hsl()/hsla()`).
 *
 * @param folded Texto ya normalizado con {@link fold}.
 * @returns El primer color encontrado, o `null`.
 */
export function findColor(folded: string): ColorHit | null {
  const fn = /(?:rgba?|hsla?)\([^)]*\)/.exec(folded);
  const hex = /#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\b/.exec(folded);
  const hits: ColorHit[] = [];
  if (fn) hits.push({ value: fn[0], raw: fn[0], index: fn.index });
  if (hex) hits.push({ value: hex[0], raw: hex[0], index: hex.index });

  const words = folded.split(' ');
  let offset = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/[^a-z-]/g, '');
    const base = COLOR_NAMES[w];
    if (base) {
      let value = base;
      let raw = words[i];
      let index = offset;
      // Modificador antes (`dark blue`) o después (`azul oscuro`).
      const prev = words[i - 1] ? SHADE_PREFIX[words[i - 1].replace(/[^a-z]/g, '')] : '';
      const next = words[i + 1] ? SHADE_PREFIX[words[i + 1].replace(/[^a-z]/g, '')] : '';
      if (prev && SHADEABLE.has(base)) {
        value = prev + base;
        raw = `${words[i - 1]} ${words[i]}`;
        index = offset - words[i - 1].length - 1;
      } else if (next && SHADEABLE.has(base)) {
        value = next + base;
        raw = `${words[i]} ${words[i + 1]}`;
      }
      hits.push({ value, raw, index });
      break;
    }
    offset += words[i].length + 1;
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index);
  return hits[0];
}

/** Palabras vacías (artículos, preposiciones, pronombres) es/en. */
export const STOPWORDS = new Set([
  'el',
  'la',
  'los',
  'las',
  'un',
  'una',
  'unos',
  'unas',
  'de',
  'del',
  'al',
  'a',
  'en',
  'con',
  'por',
  'para',
  'que',
  'y',
  'o',
  'u',
  'e',
  'este',
  'esta',
  'esto',
  'ese',
  'esa',
  'eso',
  'mi',
  'mis',
  'tu',
  'su',
  'sus',
  'me',
  'te',
  'se',
  'le',
  'lo',
  'the',
  'a',
  'an',
  'of',
  'to',
  'in',
  'on',
  'at',
  'into',
  'onto',
  'with',
  'for',
  'and',
  'or',
  'this',
  'that',
  'my',
  'your',
  'its',
  'please',
  'porfavor',
  'favor',
  'quiero',
  'necesito',
  'puedes',
  'podrias',
  'want',
  'need',
  'can',
  'you',
]);

/** Tipo de elemento reconocido en el prompt. */
export interface ElementKind {
  /** Identificador (`button`, `carousel`...). */
  id: string;
  /** Palabras (ya normalizadas) que lo nombran. */
  words: string[];
  /** Etiquetas HTML típicas (pistas para visión). */
  tags?: string[];
  /** Selectores genéricos para sondear la página, en orden de preferencia. */
  probes: string[];
}

/** Catálogo de tipos de elemento (es/en). */
export const ELEMENT_KINDS: ElementKind[] = [
  {
    id: 'button',
    words: ['boton', 'botones', 'button', 'btn'],
    tags: ['button', 'a', 'input'],
    probes: ['button', '[role="button"]', 'input[type="submit"]', 'input[type="button"]'],
  },
  {
    id: 'link',
    words: ['enlace', 'link', 'vinculo', 'hipervinculo'],
    tags: ['a'],
    probes: ['a[href]'],
  },
  {
    id: 'email',
    words: ['email', 'correo', 'e-mail', 'mail'],
    tags: ['input'],
    probes: [
      'input[type="email"]',
      'input[name*="mail" i]',
      'input[id*="mail" i]',
      'input[placeholder*="mail" i]',
    ],
  },
  {
    id: 'password',
    words: ['contrasena', 'password', 'clave'],
    tags: ['input'],
    probes: ['input[type="password"]'],
  },
  {
    id: 'search',
    words: ['buscador', 'busqueda', 'buscar', 'search'],
    tags: ['input'],
    probes: [
      'input[type="search"]',
      'input[name="q"]',
      'input[name*="search" i]',
      'input[placeholder*="buscar" i]',
      'input[placeholder*="search" i]',
      'input[aria-label*="buscar" i]',
      'input[aria-label*="search" i]',
    ],
  },
  {
    id: 'phone',
    words: ['telefono', 'phone', 'celular', 'movil', 'tel'],
    tags: ['input'],
    probes: ['input[type="tel"]', 'input[name*="phone" i]', 'input[name*="tel" i]'],
  },
  {
    id: 'field',
    words: ['campo', 'input', 'caja', 'casilla', 'field', 'textbox', 'entrada', 'cuadro'],
    tags: ['input', 'textarea', 'select'],
    probes: ['input:not([type="hidden"])', 'textarea', 'select'],
  },
  {
    id: 'textarea',
    words: ['comentario', 'comentarios', 'mensaje', 'textarea', 'comment', 'message'],
    tags: ['textarea', 'input'],
    probes: ['textarea', 'input[name*="message" i]', 'input[name*="comment" i]'],
  },
  {
    id: 'checkbox',
    words: ['checkbox', 'casilla de verificacion', 'check'],
    tags: ['input'],
    probes: ['input[type="checkbox"]'],
  },
  {
    id: 'select',
    words: ['desplegable', 'selector', 'dropdown', 'select', 'combo'],
    tags: ['select'],
    probes: ['select'],
  },
  {
    id: 'file',
    words: ['archivo', 'fichero', 'adjunto', 'file', 'attachment', 'upload'],
    tags: ['input'],
    probes: ['input[type="file"]'],
  },
  {
    id: 'logo',
    words: ['logo', 'logotipo', 'isotipo'],
    tags: ['img', 'a', 'svg'],
    probes: [
      '.logo',
      '#logo',
      '[class*="logo" i]',
      '[id*="logo" i]',
      'header a[href="/"] img',
      'header img',
    ],
  },
  {
    id: 'image',
    words: ['imagen', 'imagenes', 'foto', 'fotos', 'image', 'photo', 'picture', 'img'],
    tags: ['img'],
    probes: ['img'],
  },
  {
    id: 'video',
    words: ['video', 'videos'],
    tags: ['video', 'iframe'],
    probes: ['video', 'iframe[src*="youtube" i]', 'iframe[src*="vimeo" i]'],
  },
  {
    id: 'header',
    words: ['header', 'cabecera', 'encabezado', 'topbar'],
    tags: ['header'],
    probes: ['header', '[role="banner"]', '.header', '#header'],
  },
  {
    id: 'footer',
    words: ['footer', 'pie', 'pie de pagina'],
    tags: ['footer'],
    probes: ['footer', '[role="contentinfo"]', '.footer', '#footer'],
  },
  {
    id: 'nav',
    words: ['menu', 'nav', 'navegacion', 'navigation', 'navbar', 'barra de navegacion'],
    tags: ['nav', 'ul'],
    probes: ['nav', '[role="navigation"]', '.navbar', '.nav', '.menu', '#menu'],
  },
  {
    id: 'carousel',
    words: [
      'carrusel',
      'carousel',
      'slider',
      'galeria',
      'gallery',
      'slideshow',
      'swiper',
    ],
    tags: ['div', 'section', 'ul'],
    probes: [
      '.carousel',
      '.slider',
      '.swiper',
      '.slick-slider',
      '[class*="carousel" i]',
      '[class*="slider" i]',
      '[class*="swiper" i]',
      '[class*="gallery" i]',
      '[id*="carousel" i]',
      '[id*="slider" i]',
    ],
  },
  {
    id: 'banner',
    words: ['banner', 'hero', 'portada', 'cabecero'],
    tags: ['div', 'section'],
    probes: [
      '.banner',
      '.hero',
      '[class*="banner" i]',
      '[id*="banner" i]',
      '[class*="hero" i]',
    ],
  },
  {
    id: 'modal',
    words: [
      'popup',
      'pop-up',
      'modal',
      'dialogo',
      'dialog',
      'ventana emergente',
      'overlay',
      'lightbox',
    ],
    tags: ['dialog', 'div'],
    probes: [
      'dialog[open]',
      '[role="dialog"]',
      '.modal',
      '.popup',
      '[class*="modal" i]',
      '[class*="popup" i]',
      '[class*="overlay" i]',
      '[class*="lightbox" i]',
    ],
  },
  {
    id: 'cookies',
    words: ['cookies', 'cookie', 'aviso de cookies', 'consentimiento'],
    tags: ['div', 'section', 'dialog'],
    probes: [
      '[class*="cookie" i]',
      '[id*="cookie" i]',
      '[aria-label*="cookie" i]',
      '[class*="consent" i]',
      '[id*="consent" i]',
    ],
  },
  {
    id: 'ad',
    words: ['anuncio', 'anuncios', 'publicidad', 'ad', 'ads', 'advert', 'advertisement'],
    tags: ['div', 'iframe', 'ins'],
    probes: [
      'ins.adsbygoogle',
      '.ad',
      '.ads',
      '.advert',
      '.advertisement',
      '.anuncio',
      '[class*="advert" i]',
      '[id*="advert" i]',
      '[class*="ad-" i]',
      '[class*="-ad" i]',
      '[id*="ad-" i]',
      '[data-ad]',
      '[data-ad-slot]',
    ],
  },
  {
    id: 'chat',
    words: ['chat', 'chatbot', 'widget de chat', 'burbuja'],
    tags: ['div', 'iframe'],
    probes: ['[class*="chat" i]', '[id*="chat" i]', 'iframe[title*="chat" i]'],
  },
  {
    id: 'heading',
    words: ['titulo', 'title', 'heading', 'headline', 'titular', 'h1'],
    tags: ['h1', 'h2'],
    probes: ['h1', '.title', '[class*="title" i]', 'h2'],
  },
  {
    id: 'subheading',
    words: ['subtitulo', 'subtitle', 'subheading', 'h2', 'h3'],
    tags: ['h2', 'h3'],
    probes: ['h2', 'h3', '.subtitle', '[class*="subtitle" i]'],
  },
  {
    id: 'paragraph',
    words: ['parrafo', 'paragraph', 'texto', 'text', 'descripcion', 'description'],
    tags: ['p', 'span', 'div'],
    probes: ['p'],
  },
  {
    id: 'form',
    words: ['formulario', 'form'],
    tags: ['form'],
    probes: ['form'],
  },
  {
    id: 'sidebar',
    words: ['sidebar', 'barra lateral', 'aside', 'lateral'],
    tags: ['aside'],
    probes: ['aside', '.sidebar', '[class*="sidebar" i]'],
  },
  {
    id: 'table',
    words: ['tabla', 'table'],
    tags: ['table'],
    probes: ['table'],
  },
  {
    id: 'list',
    words: ['lista', 'list', 'listado'],
    tags: ['ul', 'ol'],
    probes: ['ul', 'ol'],
  },
  {
    id: 'card',
    words: ['tarjeta', 'tarjetas', 'card', 'cards', 'ficha'],
    tags: ['div', 'article', 'li'],
    probes: ['.card', '[class*="card" i]', 'article'],
  },
  {
    id: 'price',
    words: ['precio', 'price', 'importe', 'total'],
    tags: ['span', 'div', 'p'],
    probes: ['.price', '[class*="price" i]', '[data-price]', '[class*="total" i]'],
  },
  {
    id: 'cart',
    words: ['carrito', 'cart', 'cesta', 'bolsa'],
    tags: ['a', 'button', 'div'],
    probes: ['.cart', '#cart', '[class*="cart" i]', '[id*="cart" i]'],
  },
  {
    id: 'icon',
    words: ['icono', 'icon'],
    tags: ['svg', 'i', 'span'],
    probes: ['svg', '.icon', 'i[class*="icon" i]'],
  },
  {
    id: 'section',
    words: [
      'seccion',
      'section',
      'bloque',
      'block',
      'area',
      'zona',
      'contenedor',
      'container',
    ],
    tags: ['section', 'div'],
    probes: ['section', 'main > div'],
  },
  {
    id: 'page',
    words: ['pagina', 'page', 'fondo', 'background', 'body', 'sitio', 'web', 'todo'],
    tags: ['body'],
    probes: ['body'],
  },
];

/** Índice palabra → tipo de elemento (una sola palabra o multipalabra). */
const KIND_BY_WORD = new Map<string, ElementKind>();
for (const kind of ELEMENT_KINDS) {
  for (const w of kind.words) KIND_BY_WORD.set(w, kind);
}

/** Todas las palabras de tipo de elemento (para filtrarlas del texto). */
export const KIND_WORDS = new Set(KIND_BY_WORD.keys());

/**
 * Detecta los tipos de elemento mencionados en una descripción.
 * @param folded Texto normalizado.
 * @returns Tipos en orden de aparición (sin duplicados).
 */
export function detectKinds(folded: string): ElementKind[] {
  const found: Array<{ kind: ElementKind; index: number }> = [];
  const seen = new Set<string>();
  // Multipalabra primero (p. ej. "pie de pagina", "barra lateral").
  for (const [word, kind] of KIND_BY_WORD) {
    if (!word.includes(' ')) continue;
    const idx = folded.indexOf(word);
    if (idx !== -1 && !seen.has(kind.id)) {
      seen.add(kind.id);
      found.push({ kind, index: idx });
    }
  }
  let offset = 0;
  for (const token of folded.split(' ')) {
    const w = token.replace(/[^a-z0-9-]/g, '');
    const kind = KIND_BY_WORD.get(w);
    if (kind && !seen.has(kind.id)) {
      seen.add(kind.id);
      found.push({ kind, index: offset });
    }
    offset += token.length + 1;
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.kind);
}

/**
 * Reduce una descripción a sus palabras clave: quita palabras vacías y
 * tipos de elemento, conservando el texto distintivo (`botón de comprar
 * ahora` → `comprar ahora`).
 *
 * @param description Descripción del objetivo.
 * @param keepKinds Si `true`, conserva las palabras de tipo de elemento.
 */
export function keywords(description: string, keepKinds = false): string {
  return fold(description)
    .replace(/[^a-z0-9@._\-\s]/g, ' ')
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w) && (keepKinds || !KIND_WORDS.has(w)))
    .join(' ')
    .trim();
}

/** Etiquetas HTML conocidas (para reconocer selectores escritos a mano). */
export const KNOWN_TAGS = new Set([
  'a',
  'abbr',
  'article',
  'aside',
  'b',
  'body',
  'button',
  'canvas',
  'dialog',
  'div',
  'em',
  'fieldset',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'html',
  'i',
  'iframe',
  'img',
  'input',
  'label',
  'li',
  'main',
  'nav',
  'ol',
  'option',
  'p',
  'picture',
  'section',
  'select',
  'span',
  'strong',
  'svg',
  'table',
  'tbody',
  'td',
  'textarea',
  'th',
  'thead',
  'tr',
  'ul',
  'video',
]);

/**
 * Heurística: ¿la cadena parece un selector CSS escrito por el usuario?
 * Acepta `#id`, `.clase`, `[attr]`, `tag.clase`, `tag#id`, `a > b`...
 * @param s Texto a evaluar.
 */
export function looksLikeSelector(s: string): boolean {
  const t = s.trim();
  if (!t || /\s{2,}/.test(t) || t.length > 200) return false;
  if (/[/\\]/.test(t)) return false; // rutas de archivo y URLs
  if (/^\.\.?$/.test(t)) return false;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) return false; // color hex
  if (/^[#.[]/.test(t) && !/\s[a-z]+\s/i.test(t)) return true;
  const m = /^([a-z][a-z0-9-]*)(.*)$/i.exec(t);
  if (!m) return false;
  const [, tag, rest] = m;
  if (!KNOWN_TAGS.has(tag.toLowerCase())) return false;
  return rest === '' || /^[#.[:>+~\s]/.test(rest);
}
