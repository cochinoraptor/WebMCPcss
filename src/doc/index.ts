/** Doc-MCP (v1.0.0): documentación interactiva desde `.webmcp.css`. */
export {
  buildDocModel,
  generateDocs,
  renderAgentsMd,
  renderHtml,
  renderLlmsTxt,
  renderMarkdown,
  type DocContext,
  type DocModel,
  type DocOptions,
  type DocParam,
  type DocTool,
  type GeneratedDocs,
} from './generator';
export { createDocServer, startDocServer, type DocServerOptions } from './server';
