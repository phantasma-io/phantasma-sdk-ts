// Phantasma Link v5 - typed params/results for every `pha_*` method and event (spec §9.5).
// Binary fields (tx bytes, scripts, signatures, messages) are base64 strings.

import { TxFormat, SignatureKind } from './protocol.js';
import { LinkAccountV5, WalletCapabilities } from './capabilities.js';

export type Base64 = string;

// `pha_connect` params/result live in `./capabilities.js` (ConnectParams / ConnectResult).

/** {@link LinkMethod.Disconnect}: idempotent - closing an unknown session still succeeds. */
export type DisconnectParams = Record<string, never>;
export interface DisconnectResult {
  ok: true;
}

/** {@link LinkMethod.GetAccounts}: only the account(s) authorized for THIS session. */
export type GetAccountsParams = Record<string, never>;
export interface GetAccountsResult {
  accounts: LinkAccountV5[];
}

/** {@link LinkMethod.GetChains}. */
export type GetChainsParams = Record<string, never>;
export interface GetChainsResult {
  /** Supported chains as CAIP-2-like ids. */
  chains: string[];
  /** Currently selected chain id. */
  current: string;
  /** The Phantasma nexus name (domain term kept as a field). */
  nexus: string;
}

/** {@link LinkMethod.GetWalletInfo}. */
export type GetWalletInfoParams = Record<string, never>;
/** The result of {@link LinkMethod.GetWalletInfo}, field for field as spec §9.5 lists it. */
export interface GetWalletInfoResult {
  name: string;
  version: string;
  /** The capabilities granted to this session, the same object as in the connect result
   * (spec §5, §9.5). */
  capabilities: WalletCapabilities;
  /** The RPC node URL the wallet is configured with. */
  rpc: string;
}

/** {@link LinkMethod.SignMessage}: non-transaction-forgeable (spec §8). The wallet signs with
 * the account's Ed25519 key only (spec §9.5). */
export interface SignMessageParams {
  /** The message bytes to sign, base64. */
  message: Base64;
  /** Optional human-readable hint the wallet may show instead of raw bytes. */
  display?: string;
}
export interface SignMessageResult {
  /** The signature, base64. */
  signature: Base64;
  /** The 32 random bytes the wallet prepended (base64); needed to reconstruct the signed
   * payload `DOMAIN_TAG || random || message` for verification. */
  random: Base64;
}

/** Common fields for the two transaction methods. `format` selects the RPC endpoint
 * (spec §9.4). The wallet signs the transaction exactly as built here (spec §9.5). */
export interface TransactionParams {
  format: TxFormat;
  /** The serialized (unsigned) transaction bytes, base64. */
  tx: Base64;
  signatureKind?: SignatureKind;
}

/** {@link LinkMethod.SignTransaction}: sign only, return the assembled signed tx. */
export type SignTransactionParams = TransactionParams;
export interface SignTransactionResult {
  /** The signed transaction bytes, base64; the dApp broadcasts it itself. */
  signedTx: Base64;
}

/** {@link LinkMethod.SendTransaction}: sign AND broadcast via the format's RPC endpoint. */
export type SendTransactionParams = TransactionParams;
export interface SendTransactionResult {
  /** The broadcast transaction hash. */
  hash: string;
}

/** {@link LinkMethod.InvokeScript}: read-only VM invoke (no keys, no approval). */
export interface InvokeScriptParams {
  /** The name of a chain of the nexus, for example `main`. */
  chain: string;
  /** The raw VM script bytes, base64. */
  script: Base64;
}
export interface InvokeScriptResult {
  /** One VM result object per element, serialized as the chain serializes it, in base64
   * (spec §9.5). */
  results: Base64[];
}

// ----- Signing permission (spec §9.8) -----

/** The methods of one contract that a signing permission lets the wallet sign without a prompt. */
export interface SigningPermissionCall {
  /** The contract name, as a script loads it. */
  contract: string;
  /** The method names. */
  methods: string[];
}

/** {@link LinkMethod.RequestSigningPermission}. */
export interface RequestSigningPermissionParams {
  /** The name of the chain of the nexus whose contracts `calls` names; default `main`. */
  chain?: string;
  /** The contracts and their methods: 1 to 8 contracts, 1 to 32 methods each. */
  calls: SigningPermissionCall[];
  /** How long the permission lasts, in seconds: 60 to 86 400. */
  duration: number;
  /** The most gas the account may pay in total for the transactions signed under the permission:
   * the sum of `price × limit` of their `AllowGas` calls, as a decimal string in the smallest
   * unit of KCAL (`"10000000000"` is 1 KCAL). `"0"`, the default, means the account pays no gas
   * under the permission, so only transactions whose gas another address pays are signed
   * without a prompt. */
  gasLimit?: string;
}

/** The signing permission of a session, as the wallet holds it. */
export interface SigningPermission {
  /** The wallet's id of the permission. */
  id: string;
  /** The chain whose contracts `calls` names. */
  chain: string;
  calls: SigningPermissionCall[];
  /** The end of the permission, Unix milliseconds. */
  expiresAt: number;
  /** The gas budget of the account, as granted: a decimal string in the smallest unit of KCAL. */
  gasLimit: string;
  /** The gas reserved so far by the transactions signed under the permission that the account
   * pays: the sum of their `price × limit`, the most each can cost, as a decimal string in the
   * smallest unit of KCAL. The chain usually charges less, and the reservation stays
   * (spec §9.8). */
  gasReserved: string;
}
export interface RequestSigningPermissionResult {
  permission: SigningPermission;
}

/** {@link LinkMethod.GetSigningPermission}. */
export type GetSigningPermissionParams = Record<string, never>;
export interface GetSigningPermissionResult {
  /** The permission in force, or null. */
  permission: SigningPermission | null;
}

/** {@link LinkMethod.RevokeSigningPermission}: idempotent - a session without a permission still
 * succeeds. */
export interface RevokeSigningPermissionParams {
  /** The id of the permission to end (spec §9.5). The wallet ends the session's permission only
   * when it has this id, so a copy of an old revoke delivered later cannot end a newer permission.
   * Without it, the permission in force ends. */
  id?: string;
}
export interface RevokeSigningPermissionResult {
  ok: true;
}

// ----- Event payloads (wallet -> dApp) -----

export interface AccountsChangedData {
  accounts: LinkAccountV5[];
}
export interface ChainChangedData {
  chain: string;
}
export interface SessionLifecycleData {
  session: string;
}
/** {@link LinkEvent.SigningPermissionChanged}. */
export interface SigningPermissionChangedData {
  /** The permission in force, or null when it ended. */
  permission: SigningPermission | null;
}
