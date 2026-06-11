// Phantasma Link v5 - capability handshake + session/account/chain types (spec §5, §7, §9).
// Capability negotiation replaces the v1-v4 "magic version int": a dApp learns up front
// which methods, chains, tx formats, signature kinds, and payload sizes the wallet
// supports, instead of guessing from a single number.

import { TxFormat, SignatureKind } from './protocol.js';

/** dApp identity shown in the wallet's approval UI and bound to the session (spec §7). */
export interface DappMetadata {
  name: string;
  url: string;
  icon?: string;
  description?: string;
}

/** Per-transport maximum encrypted payload size, in bytes (spec §11). Lets a dApp check a
 * large (image-bearing) transaction against the wallet's real limit before sending. */
export interface MaxPayloadBytes {
  relay?: number;
  deeplink?: number;
  loopback?: number;
  injected?: number;
}

/** Wallet identity + node info (result of {@link LinkMethod.GetWalletInfo}). */
export interface WalletInfo {
  name: string;
  version: string;
  icon?: string;
  /** The wallet's configured RPC node URL (informational; old `getPeer`). */
  rpc?: string;
}

/** A token balance entry on an account (NFT ids included when present). */
export interface LinkBalance {
  symbol: string;
  value: string;
  decimals: number;
  ids?: string[];
}

/** An account authorized for the session. */
export interface LinkAccountV5 {
  address: string;
  name?: string;
  avatar?: string;
  balances?: LinkBalance[];
}

/** Capabilities the wallet advertises in the {@link ConnectResult} (spec §5). */
export interface WalletCapabilities {
  /** Protocol versions the wallet speaks (always includes 5 for this generation). */
  plvVersions: number[];
  /** Supported request methods (`pha_*`). */
  methods: string[];
  /** Supported chains as CAIP-2-like ids, e.g. `phantasma:mainnet`. */
  chains: string[];
  /** Supported transaction formats (spec §9.4). */
  txFormats: TxFormat[];
  /** Supported signature schemes (spec §9.7). */
  signatureKinds: SignatureKind[];
  /** Optional feature flags, e.g. `batch`, `events`. */
  features?: string[];
  maxPayloadBytes?: MaxPayloadBytes;
}

/** An established session (persistent on both sides; spec §7). */
export interface Session {
  id: string;
  /** Unix milliseconds at which the session expires (absent = until revoked). */
  expiresAt?: number;
}

/** Params of {@link LinkMethod.Connect}. The dApp requests a set of capabilities; the
 * wallet MAY grant a subset (spec §9.5 partial approval). */
export interface ConnectParams {
  dapp: DappMetadata;
  /** dApp ephemeral X25519 public key (base64), present on the custom-scheme ECDH path. */
  pubkey?: string;
  chains?: string[];
  methods?: string[];
  features?: string[];
  /** An existing session id to resume without a new prompt. */
  session?: string;
}

/** Result of {@link LinkMethod.Connect}: the GRANTED capabilities + account + session. */
export interface ConnectResult {
  wallet: WalletInfo;
  capabilities: WalletCapabilities;
  account: LinkAccountV5;
  session: Session;
}
