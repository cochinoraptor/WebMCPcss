/**
 * Parser de confianza: extrae una `TrustPolicy` por herramienta a partir de las
 * propiedades `webmcp-auth*`, `webmcp-payment*`, `webmcp-chain*`,
 * `webmcp-spending-limit`, `webmcp-rate-limit`, `webmcp-requires-human-proof`
 * y `webmcp-allowed-contracts` que el parser principal conserva en `tool.meta`.
 *
 * También sabe escribir políticas de vuelta al CSS (`setPolicyInCss`) para el
 * comando `webmcpcss trust set-policy`.
 */
import { parseWebMCP } from '../../parser';
import type { ToolMap, ToolSpec } from '../../types';
import type { TrustPolicy } from '../types';
import { validateTrustPolicy } from './schema';

/** Propiedades CSS reconocidas (sin prefijo `webmcp-`) → clave de `TrustPolicy`. */
export const TRUST_CSS_PROPS: Record<string, keyof TrustPolicy> = {
  auth: 'auth',
  'auth-type': 'auth',
  'auth-method': 'auth',
  'payment-type': 'payment',
  'payment-method': 'payment',
  chain: 'chain',
  'chain-type': 'chain',
  'chain-network': 'network',
  network: 'network',
  'spending-limit': 'spendingLimit',
  'rate-limit': 'rateLimit',
  'requires-human-proof': 'requiresHumanProof',
  'human-proof': 'requiresHumanProof',
  'allowed-contracts': 'allowedContracts',
  'allowed-hours': 'allowedHours',
  'identity-registry': 'identityRegistry',
  'pay-to': 'payTo',
  amount: 'amount',
};

/** Valores de `webmcp-payment` del módulo Web3 (v1.0) que NO son tipos de pago de confianza. */
const WEB3_PAYMENT_POLICIES = new Set(['required', 'optional', 'none']);

/**
 * ¿La herramienta declara alguna propiedad de confianza?
 * Solo `auth*`/`payment*`/`chain*` activan la política (según la especificación);
 * el resto (`spending-limit`, `rate-limit`…) se leen cuando la política existe.
 */
export function hasTrustProps(tool: ToolSpec): boolean {
  const meta = tool.meta ?? {};
  return Object.keys(meta).some(
    (k) =>
      k === 'auth' ||
      k.startsWith('auth-') ||
      k === 'payment-type' ||
      k === 'payment-method' ||
      k === 'chain' ||
      k.startsWith('chain-') ||
      (k === 'payment' && !WEB3_PAYMENT_POLICIES.has(meta[k].toLowerCase())),
  );
}

/**
 * Construye la `TrustPolicy` de una herramienta (o `null` si no declara confianza).
 * @param tool Especificación parseada.
 */
export function policyFromTool(tool: ToolSpec): TrustPolicy | null {
  if (!hasTrustProps(tool)) return null;
  const meta = tool.meta ?? {};
  const raw: Record<string, unknown> = {};
  for (const [prop, key] of Object.entries(TRUST_CSS_PROPS)) {
    if (meta[prop] !== undefined && raw[key] === undefined) raw[key] = meta[prop];
  }
  // `webmcp-payment: x402|eip3009|sponsored|none` es tipo de pago; `required|optional`
  // pertenece al módulo Web3 y se traduce a x402 (su protocolo por defecto).
  if (meta.payment !== undefined && raw.payment === undefined) {
    const v = meta.payment.toLowerCase();
    raw.payment = WEB3_PAYMENT_POLICIES.has(v)
      ? v === 'none'
        ? 'none'
        : (meta['payment-protocol'] ?? 'x402').toLowerCase() === 'onchain'
          ? 'sponsored'
          : 'x402'
      : v;
  }
  // La red puede venir como `webmcp-chain: base-sepolia`: separa familia y red.
  if (typeof raw.chain === 'string') {
    const c = raw.chain.toLowerCase();
    if (!['sui', 'evm', 'base', 'skale'].includes(c)) {
      raw.network = raw.network ?? c;
      raw.chain = c.startsWith('sui')
        ? 'sui'
        : c.startsWith('base')
          ? 'base'
          : c.startsWith('skale')
            ? 'skale'
            : 'evm';
    }
  }
  return validateTrustPolicy(raw);
}

/** Mapa herramienta → política. */
export type TrustPolicyMap = Record<string, TrustPolicy>;

/**
 * Extrae las políticas de confianza de un tool map.
 * @param map Resultado de `parseWebMCP`.
 */
export function extractTrustPolicies(map: ToolMap): TrustPolicyMap {
  const out: TrustPolicyMap = {};
  for (const [name, tool] of Object.entries(map.tools)) {
    const policy = policyFromTool(tool);
    if (policy) out[name] = policy;
  }
  return out;
}

/**
 * Parsea CSS y extrae las políticas en un solo paso.
 * @param css Contenido `.webmcp.css`.
 */
export function parseTrustPolicies(css: string): TrustPolicyMap {
  return extractTrustPolicies(parseWebMCP(css));
}

/** Clave `TrustPolicy` → propiedad CSS canónica. */
const CANONICAL_PROP: Record<keyof TrustPolicy, string> = {
  auth: 'webmcp-auth',
  payment: 'webmcp-payment',
  chain: 'webmcp-chain',
  network: 'webmcp-network',
  spendingLimit: 'webmcp-spending-limit',
  rateLimit: 'webmcp-rate-limit',
  requiresHumanProof: 'webmcp-requires-human-proof',
  allowedContracts: 'webmcp-allowed-contracts',
  allowedHours: 'webmcp-allowed-hours',
  identityRegistry: 'webmcp-identity-registry',
  payTo: 'webmcp-pay-to',
  amount: 'webmcp-amount',
};

/** Serializa una política como declaraciones CSS (sin selector). */
export function policyToDeclarations(policy: TrustPolicy): string[] {
  const lines: string[] = [];
  for (const [key, prop] of Object.entries(CANONICAL_PROP) as Array<
    [keyof TrustPolicy, string]
  >) {
    const value = policy[key];
    if (value === undefined) continue;
    if (typeof value === 'boolean') lines.push(`  ${prop}: ${value};`);
    else if (Array.isArray(value)) lines.push(`  ${prop}: "${value.join(',')}";`);
    else lines.push(`  ${prop}: "${value}";`);
  }
  return lines;
}

/**
 * Inserta o actualiza propiedades de confianza en la regla que declara
 * `webmcp-tool: "<tool>"`. Trabaja sobre el texto para conservar comentarios
 * y formato del archivo original.
 * @param css CSS original.
 * @param tool Nombre de la herramienta.
 * @param patch Propiedades a fijar (claves de `TrustPolicy`).
 * @returns CSS modificado.
 */
export function setPolicyInCss(
  css: string,
  tool: string,
  patch: Partial<TrustPolicy>,
): string {
  const escaped = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ruleRe = new RegExp(
    `([^{}]*\\{)([^{}]*webmcp-tool\\s*:\\s*["']?${escaped}["']?\\s*;[^{}]*)(\\})`,
    'm',
  );
  const m = ruleRe.exec(css);
  if (!m) throw new Error(`No se encontró una regla con webmcp-tool: "${tool}"`);
  let body = m[2];
  const validated = validateTrustPolicy({ ...patch, chain: patch.chain ?? 'sui' });
  for (const [key, prop] of Object.entries(CANONICAL_PROP) as Array<
    [keyof TrustPolicy, string]
  >) {
    if (patch[key] === undefined) continue;
    const value = validated[key];
    const rendered =
      typeof value === 'boolean'
        ? `${prop}: ${value};`
        : Array.isArray(value)
          ? `${prop}: "${value.join(',')}";`
          : `${prop}: "${String(value)}";`;
    const declRe = new RegExp(`(^|\\n)([ \\t]*)${prop}\\s*:[^;]*;`, 'i');
    if (declRe.test(body)) body = body.replace(declRe, `$1$2${rendered}`);
    else {
      const indentMatch =
        /\n([ \t]*)webmcp-tool/.exec(body) ?? /^([ \t]*)webmcp-tool/.exec(body);
      const indent = indentMatch ? indentMatch[1] : '  ';
      const trimmed = body.replace(/\s+$/, '');
      body = `${trimmed}\n${indent}${rendered}\n`;
    }
  }
  return css.slice(0, m.index) + m[1] + body + m[3] + css.slice(m.index + m[0].length);
}
