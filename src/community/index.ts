/**
 * Módulo comunitario: publicación de definiciones `.webmcp.css` vía PR.
 * (El descubrimiento vive en `src/proxy/` desde v0.1.0.)
 */
export {
  publishToCommunity,
  validateForPublish,
  communityPathFor,
  UPSTREAM,
  type PublishOptions,
  type PublishResult,
} from './publish';
export {
  buildCommunityIndex,
  writeCommunityIndex,
  type CommunityIndex,
  type CommunityIndexEntry,
} from './index-builder';
