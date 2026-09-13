/**
 * Script inyectable para agentes de navegación (Atlas, Operator, Mariner…):
 * expone `window.__WEBMCP_TRUST__` con las políticas de confianza por
 * herramienta, la URL del verificador (API REST) y helpers para pedir una
 * prueba de permiso a la billetera del usuario (EIP-712 en EVM, mensaje
 * personal en Sui) sin dependencias.
 */
import { PERMISSION_TYPES, TRUST_DEFAULTS } from './config/defaults';
import type { TrustPolicyMap } from './parser/trust-parser';

/** Opciones del script. */
export interface TrustBrowserScriptOptions {
  /** URL base de la API (`http://localhost:8090`). */
  apiBase?: string;
  /** Origen que se incluirá en las pruebas de permiso. */
  origin?: string;
  /** chainId EVM por defecto para el dominio EIP-712. */
  chainId?: number;
}

/**
 * Genera el script `window.__WEBMCP_TRUST__`.
 * @param policies Políticas por herramienta.
 * @param opts Opciones.
 */
export function buildTrustBrowserScript(
  policies: TrustPolicyMap,
  opts: TrustBrowserScriptOptions = {},
): string {
  const payload = {
    version: 1,
    apiBase: opts.apiBase ?? '',
    origin: opts.origin ?? '',
    chainId: opts.chainId ?? 8453,
    eip712: {
      domain: { name: TRUST_DEFAULTS.eip712Name, version: TRUST_DEFAULTS.eip712Version },
      types: PERMISSION_TYPES,
    },
    policies,
  };
  return `/* WebMCPcss trust layer — window.__WEBMCP_TRUST__ */
(function () {
  var T = ${JSON.stringify(payload, null, 2)};
  T.policyFor = function (tool) { return T.policies[tool] || null; };
  T.requires = function (tool) {
    var p = T.policyFor(tool); if (!p) return { trust: false };
    return { trust: true, identity: p.auth !== 'none', proof: p.auth !== 'none', payment: p.payment !== 'none', human: !!p.requiresHumanProof, chain: p.chain, network: p.network || null, spendingLimit: p.spendingLimit || null, rateLimit: p.rateLimit || null };
  };
  T.randomNonce = function () { var a = new Uint8Array(32); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.fill(1); return '0x' + Array.from(a).map(function (b) { return b.toString(16).padStart(2, '0'); }).join(''); };
  T.buildProof = function (agentId, signer, scope, ttlSeconds, extra) {
    var now = Math.floor(Date.now() / 1000); extra = extra || {};
    return { agentId: agentId, signer: signer, scope: Array.isArray(scope) ? scope : [scope], nonce: T.randomNonce(), issuedAt: now, expiresAt: now + (ttlSeconds || 900), maxSpend: extra.maxSpend || '', allowedContracts: extra.allowedContracts || [], origin: T.origin || location.origin };
  };
  /* EVM: firma EIP-712 con la billetera inyectada (MetaMask, Coinbase Wallet…). */
  T.signProofEvm = async function (proof, chainId) {
    if (!window.ethereum) throw new Error('No hay billetera EVM (window.ethereum)');
    var msg = { agentId: proof.agentId, signer: proof.signer, scope: proof.scope.join(','), nonce: proof.nonce, issuedAt: proof.issuedAt || 0, expiresAt: proof.expiresAt, maxSpend: proof.maxSpend || '', allowedContracts: (proof.allowedContracts || []).join(','), origin: proof.origin || '' };
    var typed = { types: Object.assign({ EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }] }, T.eip712.types), primaryType: 'Permission', domain: Object.assign({}, T.eip712.domain, { chainId: chainId || T.chainId }), message: msg };
    var sig = await window.ethereum.request({ method: 'eth_signTypedData_v4', params: [proof.signer, JSON.stringify(typed)] });
    return Object.assign({}, proof, { signature: sig, chain: 'evm', chainId: chainId || T.chainId });
  };
  /* Sui: mensaje personal con una billetera compatible con Wallet Standard. */
  T.suiMessage = function (proof) {
    return ['WebMCPcss Trust Permission', 'agentId: ' + proof.agentId, 'signer: ' + proof.signer, 'scope: ' + proof.scope.join(','), 'nonce: ' + proof.nonce, 'issuedAt: ' + (proof.issuedAt || 0), 'expiresAt: ' + proof.expiresAt, 'maxSpend: ' + (proof.maxSpend || ''), 'allowedContracts: ' + (proof.allowedContracts || []).join(','), 'origin: ' + (proof.origin || '')].join('\\n');
  };
  T.signProofSui = async function (proof, wallet, account) {
    var feature = wallet && wallet.features && wallet.features['sui:signPersonalMessage'];
    if (!feature) throw new Error('La billetera Sui no soporta sui:signPersonalMessage');
    var res = await feature.signPersonalMessage({ message: new TextEncoder().encode(T.suiMessage(proof)), account: account });
    return Object.assign({}, proof, { signature: res.signature, chain: 'sui' });
  };
  T.verify = async function (tool, ctx) {
    if (!T.apiBase) throw new Error('apiBase no configurado');
    var res = await fetch(T.apiBase.replace(/\\/$/, '') + '/api/trust/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ tool: tool }, ctx || {})) });
    return res.json();
  };
  T.tools = Object.keys(T.policies);
  window.__WEBMCP_TRUST__ = T;
  try { window.dispatchEvent(new CustomEvent('webmcp:trust-ready', { detail: { tools: T.tools } })); } catch (e) {}
})();
`;
}
