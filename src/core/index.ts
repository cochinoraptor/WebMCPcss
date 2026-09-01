/**
 * Núcleo de WebMCPcss: ejecución, visión, reparación y validación.
 */
export { WebMCPcss } from './WebMCPcss';
export type { WebMCPcssOptions } from './WebMCPcss';
export { repairTool, repairContext } from './repair';
export type { RepairOutcome, RepairOptions } from './repair';
export { validateToolMap } from './validate';
export {
  ACTIONABLE_SELECTOR,
  findCandidates,
  hintsFromTool,
  inferStableSelector,
  scoreCandidate,
} from './vision';
export type { VisionCandidate, VisionHints } from './vision';
