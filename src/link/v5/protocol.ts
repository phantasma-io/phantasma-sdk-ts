// Phantasma Link v5 - protocol constants (the new generation; runs in parallel with the
// legacy v1-v4 string protocol in `../phantasma-link.ts`). See the design spec:
// codex-pha `.codex/context/link/phantasma-link-v5-spec.md`.

/** Protocol version carried in every v5 envelope (`plv`). A peer that does not recognize
 * this value rejects the message with {@link LinkErrorCode.InvalidRequest}. */
export const PLV = 5 as const;

/** Default subdomain that hosts the universal links + AASA/assetlinks + relay (spec §19).
 * NEVER `phantasma.io` (hostile). */
export const DEFAULT_LINK_HOST = 'link.phantasma.info';

/** Request methods (dApp -> wallet). Namespaced `pha_*`, EIP-1193-aligned (spec §9). */
export const LinkMethod = {
  /** Pair or resume a session; returns the capability handshake + account + session. */
  Connect: 'pha_connect',
  /** End the session. */
  Disconnect: 'pha_disconnect',
  /** Account(s) authorized for this session. */
  GetAccounts: 'pha_getAccounts',
  /** Supported chains (CAIP-2) + current; `nexus` as a field. */
  GetChains: 'pha_getChains',
  /** Wallet name/version/capabilities/rpc. */
  GetWalletInfo: 'pha_getWalletInfo',
  /** Sign an arbitrary, non-transaction-forgeable message. */
  SignMessage: 'pha_signMessage',
  /** Sign a transaction only (do NOT broadcast); the dApp submits it. */
  SignTransaction: 'pha_signTransaction',
  /** Sign AND broadcast a transaction via the format's RPC endpoint. */
  SendTransaction: 'pha_sendTransaction',
  /** Read-only VM invoke (no keys, no approval). */
  InvokeScript: 'pha_invokeScript',
} as const;
export type LinkMethod = (typeof LinkMethod)[keyof typeof LinkMethod];

/** Event names pushed wallet -> dApp on a persistent transport (spec §9.5 events caveat). */
export const LinkEvent = {
  AccountsChanged: 'pha_accountsChanged',
  ChainChanged: 'pha_chainChanged',
  SessionDeleted: 'pha_sessionDeleted',
  SessionExpired: 'pha_sessionExpired',
  /** Unsolicited connect result pushed right after a pairing approval (spec §17 step 3),
   * letting the first connection complete in one user gesture. Unlike the other events it
   * also rides the deeplink transport: the wallet is foreground at the approval moment, so
   * it CAN open the callback (this is a reply to the pairing, not a spontaneous push).
   * `data` carries the same shape as a `pha_connect` result. */
  SessionEstablished: 'pha_sessionEstablished',
} as const;
export type LinkEvent = (typeof LinkEvent)[keyof typeof LinkEvent];

/** Transaction serialization format. Selects which RPC submission endpoint the wallet uses
 * (spec §9.4): `script` -> SendRawTransaction (classic `Transaction`), `carbon` ->
 * SendCarbonTransaction (Carbon `SignedTxMsg`). Routing is by serialization envelope, NOT
 * by "contains a script" (a Carbon tx may also wrap a script). */
export const TxFormat = {
  Script: 'script',
  Carbon: 'carbon',
} as const;
export type TxFormat = (typeof TxFormat)[keyof typeof TxFormat];

/** Signature scheme used to sign a Phantasma payload (spec §9.7). Selects the key:
 * `Ed25519` = the Phantasma key, `ECDSA` = the secp256k1 (ETH/BSC-interop) key. This is
 * NOT native foreign-chain signing - the wallet always targets Phantasma. */
export const SignatureKind = {
  Ed25519: 'Ed25519',
  ECDSA: 'ECDSA',
} as const;
export type SignatureKind = (typeof SignatureKind)[keyof typeof SignatureKind];
