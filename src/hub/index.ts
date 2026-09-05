/**
 * Component Hub (v1.2.0): catálogo IA-First de componentes con contrato
 * `.webmcp.css`, generador del sitio estático, cliente (list/import/update),
 * publicación por PR y herramientas MCP.
 */
export * from './types';
export {
  DEFAULT_HUB_URL,
  META_FILE,
  bundledHubDir,
  buildHubIndex,
  filterEntries,
  hubIndexSchema,
  importCommandFor,
  loadComponent,
  loadHub,
  shortHash,
  slugOf,
  sortForCatalog,
  toIndexEntry,
  validateMeta,
  type HubFilter,
  type HubLoadResult,
} from './loader';
export {
  LOCK_FILE,
  fetchComponent,
  fetchHubIndex,
  importComponent,
  listComponents,
  loadBundledIndex,
  mergeIntoCss,
  mergeMarker,
  prepareComponent,
  readLock,
  resolveHubUrl,
  slugFromName,
  updateComponents,
  writeLock,
  type ComponentFiles,
  type FetchLike,
  type HubClientOptions,
  type ImportOptions,
  type ImportResult,
  type PreparedComponent,
  type PrepareComponentOptions,
  type ResolvedIndex,
  type UpdateStatus,
} from './client';
export {
  publishComponent,
  type PublishComponentOptions,
  type PublishComponentResult,
} from './publish';
export { buildDemoSite, type DemoOptions, type DemoResult } from './demo';
export {
  LIBRARY_ASSETS,
  buildHubSite,
  checkHubSite,
  type BuildSiteOptions,
  type BuildSiteResult,
} from './site';
export {
  HUB_TOOL_NAMES,
  HUB_TOOL_SCHEMAS,
  callHubTool,
  isHubTool,
  type HubCallResult,
  type HubMcpOptions,
  type HubToolName,
} from './mcp-tools';
export { renderMarkdownDoc, renderInline, escapeHtml, slugify } from './markdown';
