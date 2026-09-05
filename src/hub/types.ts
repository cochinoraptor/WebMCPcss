/**
 * Tipos del **Component Hub** (v1.2.0): catálogo IA-First de componentes
 * (`.webmcp.css` + HTML + metadatos) adaptados a Tailwind, Bootstrap, MUI y
 * shadcn/ui, descubrible por personas (sitio estático) y agentes
 * (`api/components.json`, herramientas MCP, CLI `webmcpcss components`).
 */

/** Categorías del catálogo. */
export const HUB_CATEGORIES = [
  'buttons',
  'cards',
  'forms',
  'layout',
  'animations',
  'intelligent',
] as const;
export type HubCategory = (typeof HUB_CATEGORIES)[number];

/** Librerías/adaptadores soportados (`core` = independiente de librería). */
export const HUB_LIBRARIES = ['core', 'tailwind', 'bootstrap', 'mui', 'shadcn'] as const;
export type HubLibrary = (typeof HUB_LIBRARIES)[number];

/** Metadatos de un componente (`component.json`). */
export interface ComponentMeta {
  /** Identificador único y estable: `<library>-<slug>` (p. ej. `tailwind-button-primary`). */
  id: string;
  /** Nombre legible. */
  name: string;
  category: HubCategory;
  library: HubLibrary;
  /** SemVer del componente (independiente de la versión del paquete). */
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  /**
   * Nombre del archivo `.webmcp.css` dentro de la carpeta del componente
   * (por defecto `<slug>.webmcp.css`).
   */
  css?: string;
  /** Nombre del archivo HTML de ejemplo (por defecto `<slug>.html`). */
  html?: string;
  /** Recursos externos que necesita la preview (CDN de Tailwind/Bootstrap…). */
  assets?: { stylesheets?: string[]; scripts?: string[] };
  /** Controles del editor en vivo (`--variable` CSS → tipo de control). */
  controls?: EditorControl[];
  /** Frases de ejemplo para `webmcpcss prompt`. */
  promptExamples?: string[];
  /** Frases de ejemplo para `webmcpcss animate`/prompt de animación. */
  animateExamples?: string[];
  /** Componentes relacionados (ids). */
  related?: string[];
}

/** Control del editor en vivo (mapea a una variable CSS del componente). */
export interface EditorControl {
  /** Variable CSS (`--btn-bg`). */
  variable: string;
  label: string;
  type: 'color' | 'range' | 'select' | 'text';
  /** Valor inicial (debe coincidir con el `:root`/`.component` del CSS). */
  default: string;
  /** Para `range`. */
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** Para `select`. */
  options?: string[];
}

/** Componente cargado (metadatos + contenidos + análisis). */
export interface HubComponent extends ComponentMeta {
  /** Carpeta relativa a la raíz del hub (`adapters/tailwind/button-primary`). */
  dir: string;
  /** Ruta relativa del `.webmcp.css` (`adapters/tailwind/button-primary/button-primary.webmcp.css`). */
  cssPath: string;
  /** Contenido del `.webmcp.css`. */
  cssSource: string;
  /** HTML de ejemplo. */
  htmlSource: string;
  /** Herramientas declaradas (nombre → resumen). */
  tools: Array<{
    name: string;
    selector: string;
    description?: string;
    params: string[];
    intent?: string;
    confirmation?: string;
  }>;
  /** Contextos declarados. */
  context: Array<{ name: string; selector: string; format?: string }>;
  /** Animaciones `webmcp-animation` declaradas. */
  animations: Array<{ name: string; type: string; selector: string }>;
  /** Hash sha256 corto del CSS (para `components update`). */
  hash: string;
  /** Comando de importación. */
  importCommand: string;
}

/** Entrada del índice público `components.json`. */
export interface HubIndexEntry {
  id: string;
  name: string;
  category: HubCategory;
  library: HubLibrary;
  version: string;
  description: string;
  tags: string[];
  tools: HubComponent['tools'];
  context: HubComponent['context'];
  animations: HubComponent['animations'];
  hash: string;
  /** URLs relativas a la raíz del hub. */
  files: { css: string; html: string; meta: string; page: string };
  importCommand: string;
  promptExamples: string[];
  animateExamples: string[];
}

/** Índice público (`api/components.json`). */
export interface HubIndex {
  /** Marca del formato. */
  $schema: 'https://cochinoraptor.github.io/WebMCPcss/api/schema/components.json';
  name: 'WebMCPcss Component Hub';
  version: string;
  generatedAt: string;
  /** URL base del hub (para resolver `files`). */
  baseUrl: string;
  categories: Array<{ id: HubCategory; label: string; count: number }>;
  libraries: Array<{ id: HubLibrary; label: string; count: number }>;
  components: HubIndexEntry[];
}

/** Etiquetas legibles. */
export const CATEGORY_LABELS: Record<HubCategory, string> = {
  buttons: 'Botones',
  cards: 'Tarjetas',
  forms: 'Formularios',
  layout: 'Layout',
  animations: 'Animaciones',
  intelligent: 'Inteligentes',
};

export const LIBRARY_LABELS: Record<HubLibrary, string> = {
  core: 'Core (sin librería)',
  tailwind: 'Tailwind CSS',
  bootstrap: 'Bootstrap',
  mui: 'Material UI',
  shadcn: 'shadcn/ui',
};

/** Estado de un componente importado (`.webmcpcss/components.lock.json`). */
export interface InstalledComponent {
  id: string;
  version: string;
  hash: string;
  /** Archivos escritos (relativos al cwd). */
  files: string[];
  installedAt: string;
  source: string;
}

export interface InstalledLock {
  version: 1;
  hub: string;
  components: Record<string, InstalledComponent>;
}
