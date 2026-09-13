/**
 * Tipos públicos del Módulo de Confianza Blockchain Gasless (v1.3.0).
 *
 * Una `TrustPolicy` se declara en `.webmcp.css` con propiedades
 * `webmcp-auth`, `webmcp-payment`, `webmcp-chain`, `webmcp-spending-limit`,
 * `webmcp-rate-limit`, `webmcp-requires-human-proof` y
 * `webmcp-allowed-contracts`; el `TrustEngine` la aplica antes de ejecutar la
 * herramienta y deja una entrada en el registro de auditoría.
 */

/** Familias de cadena soportadas. `base` y `skale` son EVM con configuración propia. */
export type ChainType = 'sui' | 'evm' | 'base' | 'skale';

/** Mecanismo de identidad exigido. */
export type AuthType = 'erc8004' | 'zk-proof' | 'session-key' | 'none';

/** Mecanismo de pago exigido. */
export type PaymentType = 'x402' | 'eip3009' | 'sponsored' | 'none';

/** Política de confianza de una herramienta. */
export interface TrustPolicy {
  auth: AuthType;
  payment: PaymentType;
  chain: ChainType;
  /** Red concreta (`sui-testnet`, `base-sepolia`, `skale-europa`…). */
  network?: string;
  /** Límite de gasto legible, p. ej. `"100 USDC/day"`. */
  spendingLimit?: string;
  /** Lista blanca de contratos/paquetes destino (minúsculas). */
  allowedContracts?: string[];
  /** Límite de frecuencia legible, p. ej. `"5 actions/minute"`. */
  rateLimit?: string;
  /** Exige prueba de humanidad (World ID, Self.xyz…) además de la identidad. */
  requiresHumanProof?: boolean;
  /** Ventana horaria permitida (`"09:00-18:00"`, hora UTC). */
  allowedHours?: string;
  /** Registro de identidad ERC-8004 a usar (por defecto el canónico de la red). */
  identityRegistry?: string;
  /** Receptor de pagos declarado en el CSS (`webmcp-pay-to`). */
  payTo?: string;
  /** Importe declarado (`webmcp-amount`). */
  amount?: string;
}

/** Límite de gasto normalizado. */
export interface SpendingLimit {
  amount: number;
  currency: string;
  /** Ventana temporal. `total` = sin ventana (acumulado). */
  per: 'tx' | 'hour' | 'day' | 'week' | 'month' | 'total';
  /** Duración de la ventana en ms (0 para `tx`/`total`). */
  windowMs: number;
}

/** Límite de frecuencia normalizado. */
export interface RateLimit {
  count: number;
  per: 'second' | 'minute' | 'hour' | 'day';
  windowMs: number;
}

/** Identidad de un agente verificada (o no) on-chain. */
export interface AgentIdentity {
  /** Identificador único: `eip155:<chainId>:<registry>#<agentId>` o `sui:<net>:<address>`. */
  agentId: string;
  /** Dirección del dueño humano/operador (owner del ERC-721 o dirección Sui). */
  ownerAddress: string;
  /** Billetera de cobro verificada (`agentWallet` en ERC-8004) si existe. */
  agentWallet?: string;
  /** Reputación 0–100 (resumen del Reputation Registry) si se pudo consultar. */
  reputation?: number;
  /** Número de feedbacks agregados. */
  feedbackCount?: number;
  /** URI del archivo de registro (ERC-8004 `agentURI`). */
  agentURI?: string;
  /** Nombre/descripcion del archivo de registro si se resolvió. */
  name?: string;
  verified: boolean;
  chain: ChainType;
  /** Cómo se verificó (`erc8004`, `zk-proof`, `session-key`, `cache`, `none`). */
  method?: string;
  /** Momento de verificación (epoch ms). */
  verifiedAt?: number;
  /** Motivo si `verified` es `false`. */
  reason?: string;
}

/** Prueba de permiso firmada (clave de sesión). */
export interface PermissionProof {
  /** Firma (EIP-712 en EVM: hex 65 bytes; Sui: base64 `flag||sig||pk`). */
  signature: string;
  /** Nonce único (hex `bytes32` en EVM; texto libre en Sui). */
  nonce: string;
  /** Expiración (epoch segundos). */
  expiresAt: number;
  /** Acciones permitidas (nombres de herramientas o `*`). */
  scope: string[];
  /** Identificador del agente al que se concede. */
  agentId: string;
  /** Dirección que firma (owner/operador o clave de sesión autorizada). */
  signer: string;
  /** Emisión (epoch segundos). */
  issuedAt?: number;
  /** Límite de gasto concedido por esta sesión (`"50 USDC"`). */
  maxSpend?: string;
  /** Contratos permitidos por la sesión (subconjunto de la política). */
  allowedContracts?: string[];
  /** Origen (URL del sitio) al que se limita el permiso. */
  origin?: string;
  /** Cadena en la que se firmó. */
  chain?: ChainType;
  /** chainId EVM del dominio EIP-712 (por defecto el de la red). */
  chainId?: number;
  /**
   * Delegación firmada por el owner/billetera del agente que autoriza a
   * `signer` (clave de sesión) a actuar en su nombre. Sin ella, `signer` debe
   * ser el propio owner/agentWallet cuando la identidad está verificada.
   */
  delegation?: SessionDelegation;
}

/** Delegación de una clave de sesión (firmada por el owner). */
export interface SessionDelegation {
  /** Dirección delegada (debe coincidir con `proof.signer`). */
  delegate: string;
  /** Quien delega (owner o agentWallet del agente). */
  delegator: string;
  /** Expiración de la delegación (epoch segundos). */
  expiresAt: number;
  /** Scope máximo delegado (vacío = el de la prueba). */
  scope?: string[];
  /** Firma del delegador (EIP-712 `Delegation` en EVM; mensaje personal en Sui). */
  signature: string;
}

/** Prueba de humanidad (ZK). */
export interface HumanProof {
  provider: 'worldid' | 'self' | 'custom';
  /** Identificador anónimo (nullifier hash). */
  nullifierHash: string;
  /** Prueba serializada (se delega a un verificador externo). */
  proof?: string;
  /** Raíz de Merkle / credencial. */
  merkleRoot?: string;
  /** Nivel (`orb`, `device`, `passport`…). */
  level?: string;
  /** Acción/scope firmado. */
  action?: string;
  /** Expiración (epoch segundos) si el verificador la emite. */
  expiresAt?: number;
}

/** Resultado de una verificación de confianza. */
export interface TrustVerificationResult {
  allowed: boolean;
  reason?: string;
  /** Código estable para agentes (`identity-unverified`, `rate-limited`…). */
  code?: string;
  identity?: AgentIdentity;
  /** Límite restante legible (`"75 USDC/day"`). */
  remainingLimit?: string;
  /** Detalle de cada comprobación. */
  checks?: TrustCheck[];
}

/** Resultado individual de una comprobación. */
export interface TrustCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

/** Acción a registrar en el audit log. */
export interface AuditAction {
  agentId: string;
  action: string;
  /** Resultado resumido (`ok`, `denied`, `failed`). */
  result: 'ok' | 'denied' | 'failed';
  timestamp?: number;
  /** Hash de la prueba que autorizó la acción. */
  proofHash?: string;
  /** Hash de la transacción on-chain asociada, si la hubo. */
  txHash?: string;
  /** Importe gastado (`"1.5 USDC"`). */
  amount?: string;
  reason?: string;
  chain?: ChainType;
  network?: string;
  /** Datos adicionales (no sensibles). */
  meta?: Record<string, string>;
}

/** Entrada de auditoría con integridad encadenada. */
export interface AuditEntry extends AuditAction {
  id: string;
  timestamp: number;
  /** Hash de la entrada anterior (cadena de integridad). */
  prevHash: string;
  /** keccak256 de la entrada canónica (incluye `prevHash`). */
  hash: string;
  /** Referencia on-chain (digest/txHash) si se ancló. */
  anchor?: string;
}

/** Transacción abstracta que ejecuta un adaptador. */
export interface Transaction {
  chain: ChainType;
  network?: string;
  /** `transfer` (stablecoin), `call` (contrato/Move) o `raw` (bytes ya construidos). */
  kind: 'transfer' | 'call' | 'raw';
  from?: string;
  to?: string;
  /** Importe legible (`"1.5 USDC"`) para `transfer`. */
  amount?: string;
  /** Token (dirección ERC-20 o tipo Move); por defecto USDC de la red. */
  token?: string;
  /** Contrato/paquete destino para `call`. */
  contract?: string;
  /** Datos hex (EVM) o `package::module::function` (Sui). */
  data?: string;
  /** Argumentos Move (Sui) o ABI (EVM). */
  args?: unknown[];
  /** Bytes/base64 de una transacción ya construida (`raw`). */
  raw?: string;
  /** Firmas ya calculadas (para `raw`). */
  signatures?: string[];
  /** Descripción para el audit log. */
  memo?: string;
}

/** Resultado de ejecutar una transacción. */
export interface TransactionResult {
  ok: boolean;
  /** Hash (EVM) o digest (Sui). */
  txHash?: string;
  chain: ChainType;
  network: string;
  /** `gasless` (0 gas nativo), `sponsored` (paga un tercero), `paid`, `dry-run`. */
  mode: 'gasless' | 'sponsored' | 'paid' | 'dry-run';
  explorerUrl?: string;
  /** Detalle del error. */
  error?: string;
  /** Carga útil sin enviar (dry-run) para que el agente la inspeccione/firme. */
  payload?: unknown;
  /** `true` si la autorización está firmada pero la liquidará un facilitador/relayer externo. */
  pending?: boolean;
}

/** Contexto de ejecución que aporta el agente. */
export interface ExecutionContext {
  agentId?: string;
  proof?: PermissionProof;
  humanProof?: HumanProof;
  /** Cabecera x402 (`X-PAYMENT`) o autorización EIP-3009 ya firmada. */
  paymentProof?: string | Record<string, unknown>;
  /** Transacción a ejecutar si la tool implica pago/contrato. */
  tx?: Transaction;
  /** Importe que se pretende gastar (`"1.5 USDC"`), para límites. */
  amount?: string;
  /** Contrato destino que se pretende invocar, para listas blancas. */
  target?: string;
  /** Origen (URL) desde el que se opera. */
  origin?: string;
  /**
   * Token de confianza emitido por `trust_check_permission`/`POST /api/trust/verify`.
   * Si es válido y cubre la herramienta, sustituye a la verificación de identidad y
   * de prueba de permiso (ya realizadas); las políticas de gasto/frecuencia y el
   * pago se siguen evaluando en cada acción.
   */
  trustToken?: string;
}

/** Token de confianza que se emite tras una verificación exitosa (API REST). */
export interface TrustToken {
  token: string;
  agentId: string;
  scope: string[];
  expiresAt: number;
}
