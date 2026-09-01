/**
 * Proxy comunitario: auto-descubrimiento, estilos comunitarios e inyección.
 */
export { discoverWebMCP, findCommunityStyle, resolveWebMCPStyles } from './discovery';
export type { DiscoveryOptions, DiscoveryResult, FetchLike } from './discovery';
export { injectWebMCP } from './inject';
export type { InjectOptions, InjectResult } from './inject';
