/**
 * Punto de entrada principal de WebMCPcss.
 *
 * @example
 * ```ts
 * import { parseWebMCP, WebMCPcss, PuppeteerAdapter } from 'webmcpcss';
 * import puppeteer from 'puppeteer';
 * import * as fs from 'fs';
 *
 * const css = fs.readFileSync('webmcp.css', 'utf8');
 * const toolMap = parseWebMCP(css);
 *
 * const browser = await puppeteer.launch();
 * const page = await browser.newPage();
 * await page.goto('https://mi-tienda.com/producto/123');
 *
 * const webmcp = new WebMCPcss(toolMap, new PuppeteerAdapter(page));
 * const result = await webmcp.execute('addToCart', { quantity: '2' });
 * console.log(result); // { success: true, data: { ... } }
 * ```
 */

export * from './types';
export {
  parseWebMCP,
  serializeToolMap,
  parseParamValue,
  parseTriggerValue,
  WebMCPParseError,
} from './parser';
export { WebMCPcss, type WebMCPcssOptions } from './core';
export { repairSelector, repairToolMap, buildHints } from './core/repair';
export {
  findBestCandidate,
  scoreCandidate,
  tokenSimilarity,
  normalizeText,
  humanize,
  type VisionHints,
} from './core/vision';
export type { PageAdapter } from './adapters/page-adapter';
export { DomAdapter } from './adapters/dom-adapter';
export { PuppeteerAdapter } from './adapters/puppeteer-adapter';
export {
  findCommunityStyle,
  applyCommunityStyles,
  injectWebMCP,
  buildInjectionScript,
  normalizeDomain,
  domainChain,
} from './proxy';
export { collectCandidatesInPage, captureFingerprint } from './utils/dom-utils';
export { logger, setVerbose } from './utils/logger';

// --- v0.2.0: API imperativa de WebMCP, generador, descubrimiento y dashboard ---
export {
  getRegisteredTools,
  installModelContextShim,
  readRegisteredTools,
  invokeRegisteredTool,
} from './webmcp-api';
export { WebMCPApiAdapter } from './adapters/webmcp-api-adapter';
export { hasApiTools, type ApiToolSource } from './adapters/page-adapter';
export {
  generateApiScript,
  buildInputSchema,
  getAiConfig,
  parseAiSuggestions,
  applyAiSuggestions,
  enhanceToolMapWithAi,
  type JsGeneratorOptions,
  type AiToolSuggestion,
} from './generator';
export {
  discoverWebMCP,
  extractDeclaredStylesheet,
  parseWellKnown,
  resolveWebMCPStyles,
  type DiscoveryResult,
  type ResolvedStyles,
} from './proxy';
export { parseWebMCPFile, substituteVars, resolveSelector } from './parser';
export { createDashboardServer, startDashboard } from './dashboard/server';
export {
  appendHistory,
  readHistory,
  computeStats,
  type HistoryEvent,
} from './utils/history';
export * as tailwind from './tailwind';
export {
  inspectClassList,
  inspectElement,
  classifyClass,
  isTailwindClass,
  scanDocument,
  TailwindEditor,
  ChangeHistory,
  generateTailwindTools,
  buildTailwindToolsScript,
  registerTailwindTools,
  scanPage,
  formatForFramework,
  type TailwindCategory,
  type TailwindClasses,
  type TailwindScanEntry,
  type TailwindToolDescriptor,
  type Framework,
} from './tailwind';
export * as graph from './graph';
export {
  buildGraph,
  analyzeFragility,
  generateObsidianVault,
  buildGraphHtml,
  serveGraphDashboard,
  type Graph,
  type GraphNode,
  type GraphEdge,
  type NodeType,
  type EdgeType,
  type FragilityScore,
  type ParsedFile as GraphParsedFile,
  type StatusResult as GraphStatusResult,
} from './graph';
