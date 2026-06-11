// Phantasma Link v5 - typed params/results for every `pha_*` method and event (spec §9.5).
// Binary fields (tx bytes, scripts, signatures, messages) are base64 strings.

import { ProofOfWork } from '../interfaces/proof-of-work.js';
import { TxFormat, SignatureKind } from './protocol.js';
import { LinkAccountV5, WalletInfo } from './capabilities.js';

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
export type GetWalletInfoResult = WalletInfo;

/** {@link LinkMethod.SignMessage}: non-transaction-forgeable (spec §8). */
export interface SignMessageParams {
  /** The message bytes to sign, base64. */
  message: Base64;
  /** Optional human-readable hint the wallet may show instead of raw bytes. */
  display?: string;
  signatureKind?: SignatureKind;
}
export interface SignMessageResult {
  /** The signature, base64. */
  signature: Base64;
  /** The 32 random bytes the wallet prepended (base64); needed to reconstruct the signed
   * payload `DOMAIN_TAG || random || message` for verification. */
  random: Base64;
}

/** Common fields for the two transaction methods. `format` selects the RPC endpoint
 * (spec §9.4); `pow` is meaningful only for `format: "script"` (spec §9.5). */
export interface TransactionParams {
  format: TxFormat;
  /** The serialized (unsigned) transaction bytes, base64. */
  tx: Base64;
  signatureKind?: SignatureKind;
  pow?: ProofOfWork;
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
  chain: string;
  /** The raw VM script bytes, base64. */
  script: Base64;
}
export interface InvokeScriptResult {
  /** Decoded VM result objects (hex/encoded values, as the node returns them). */
  results: string[];
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
