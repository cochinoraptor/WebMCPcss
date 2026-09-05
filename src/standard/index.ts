/**
 * `standard`: alineación de WebMCPcss con el estándar WebMCP del W3C
 * (v1.1.0).
 *
 * - {@link getModelContext} y compañía: localización canónica de la API
 *   imperativa (`document.modelContext`, con `navigator.modelContext` como
 *   alias obsoleto).
 * - Compilador bidireccional entre la **API declarativa** (`toolname`,
 *   `tooldescription`, `toolautosubmit`, `toolparamtitle`,
 *   `toolparamdescription`) y el `.webmcp.css`.
 */
export * from './model-context';
export * from './declarative';
