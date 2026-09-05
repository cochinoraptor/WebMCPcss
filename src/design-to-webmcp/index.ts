/** Design-to-WebMCP (v1.0.0): de diseños (imagen, Figma, texto) a `.webmcp.css`. */
export {
  analyzeDescription,
  analyzeFigma,
  analyzeImage,
  classifyFigmaNode,
  figmaTreeToElements,
  normalizeElements,
  readImageInfo,
  toDataUrl,
  type DesignElement,
  type DesignElementKind,
  type DesignStructure,
  type ImageInfo,
} from './analyzer';
export { generateFromDesign, type DesignGeneration } from './generator';
export {
  compareVisually,
  similarity,
  validateDesign,
  type DesignCheck,
  type DesignPageProbe,
  type DesignValidationReport,
} from './validator';
export { iaFriendlyScore, optimizeToolMap, type OptimizationResult, type OptimizationSuggestion } from './optimizer';
