/**
 * WebMCPcss — haz que cualquier sitio web sea nativo para agentes de IA.
 *
 * API pública de la librería.
 *
 * ```ts
 * import { parseWebMCP, WebMCPcss, DomAdapter } from 'webmcpcss';
 * ```
 */
export {
  parseWebMCP,
  parseWebMCPFile,
  parseParamSource,
  parseTrigger,
  stringifyWebMCP,
} from './parser';
export type { ParseOptions } from './parser';

export { WebMCPcss } from './core/WebMCPcss';
export type { WebMCPcssOptions } from './core/WebMCPcss';
export { repairTool, repairContext, validateToolMap } from './core';
export type { RepairOutcome, RepairOptions } from './core';
export {
  ACTIONABLE_SELECTOR,
  findCandidates,
  hintsFromTool,
  inferStableSelector,
  scoreCandidate,
} from './core/vision';
export { buildToolMapFromEvents, RECORDER_SHIM_SOURCE } from './core/recorder';

export { DomAdapter } from './adapters/DomAdapter';
export { PuppeteerAdapter } from './adapters/PuppeteerAdapter';
export type {
  ApiToolSource,
  ElementInfo,
  PageAdapter,
  PageElement,
} from './adapters/PageAdapter';

export { WebMCPApiAdapter } from './webmcp-api/WebMCPApiAdapter';
export { buildInputSchema, generateApiScript } from './webmcp-api/generator';
export { normalizeRegistered, WEBMCP_API_SHIM_SOURCE } from './webmcp-api/shim';

export {
  discoverWebMCP,
  findCommunityStyle,
  resolveWebMCPStyles,
  injectWebMCP,
} from './proxy';
export type {
  DiscoveryOptions,
  DiscoveryResult,
  InjectOptions,
  InjectResult,
} from './proxy';

export { startDashboard } from './dashboard/server';
export type { DashboardOptions } from './dashboard/server';

export { appendEvent, historyPath, historyStats, loadHistory } from './utils/history';
export type { HistoryEvent } from './utils/history';
export { loadAiConfig, suggestToolMetadata } from './utils/ai';
export type { AiConfig, AiSuggestion } from './utils/ai';

export type {
  ApiToolInfo,
  ContextDef,
  ExecuteResult,
  ParamSource,
  ToolDef,
  ToolMap,
  TriggerSpec,
  ValidationEntry,
  ValidationReport,
} from './types';
