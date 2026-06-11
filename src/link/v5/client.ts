// Phantasma Link v5 - the cohesive client (spec §6/§9). This IS the v5 entry point: there is
// NO separate "EasyConnect"-style wrapper. Transport selection, the connect handshake, and the
// typed `pha_*` methods are all part of this one client. Build it directly with any transport,
// or use the `loopback()` factory for the desktop case.

import { LinkMethod } from './protocol.js';
import {
  LinkTransport,
  LinkSessionClient,
  LinkSessionClientOptions,
  LinkEventHandler,
} from './transport.js';
import {
  ConnectParams,
  ConnectResult,
  DappMetadata,
  LinkAccountV5,
  WalletCapabilities,
} from './capabilities.js';
import {
  DisconnectResult,
  GetAccountsResult,
  GetChainsResult,
  GetWalletInfoResult,
  SignMessageParams,
  SignMessageResult,
  SignTransactionParams,
  SignTransactionResult,
  SendTransactionParams,
  SendTransactionResult,
  InvokeScriptParams,
  InvokeScriptResult,
} from './methods.js';
import { LoopbackTransport, LoopbackTransportOptions } from './loopback-transport.js';
import { DeeplinkTransport, DeeplinkTransportOptions } from './deeplink.js';
import { LinkError, LinkErrorCode } from './errors.js';

/** Options for {@link PhantasmaLink5}. */
export type PhantasmaLink5Options = LinkSessionClientOptions;

/**
 * The v5 client. `connect()` runs the capability handshake and stores the session; the typed
 * methods then forward to the wallet and return validated-by-contract results. Events
 * (account/chain/session changes) are delivered via {@link onEvent}.
 */
export class PhantasmaLink5 {
  private readonly transport: LinkTransport;
  private readonly session: LinkSessionClient;
  private lastConnect?: ConnectResult;

  constructor(transport: LinkTransport, options: PhantasmaLink5Options = {}) {
    this.transport = transport;
    this.session = new LinkSessionClient(transport, options);
  }

  /** Build a client over the desktop loopback transport (plaintext, trusted-local). */
  static loopback(options: LoopbackTransportOptions = {}): PhantasmaLink5 {
    return new PhantasmaLink5(new LoopbackTransport(options));
  }

  /** Build a client over the deeplink transport (spec §19). The channel key from pairing is
   * MANDATORY here: deeplink URLs are interceptable, so plaintext frames are never allowed. */
  static deeplink(
    options: DeeplinkTransportOptions & { sessionKey: Uint8Array; requestTimeoutMs?: number }
  ): PhantasmaLink5 {
    if (!options.sessionKey || options.sessionKey.length !== 32) {
      throw new LinkError(
        LinkErrorCode.InvalidParams,
        'Deeplink requires the 32-byte pairing session key'
      );
    }
    return new PhantasmaLink5(new DeeplinkTransport(options), {
      sessionKey: options.sessionKey,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /** Feed an OS-delivered URL into a deeplink-backed client; see DeeplinkTransport.deliverUrl. */
  deliverUrl(url: string): boolean {
    return this.transport instanceof DeeplinkTransport && this.transport.deliverUrl(url);
  }

  /** The account from the last successful {@link connect}, if any. */
  get account(): LinkAccountV5 | undefined {
    return this.lastConnect?.account;
  }

  /** The capabilities granted at the last successful {@link connect}, if any. */
  get capabilities(): WalletCapabilities | undefined {
    return this.lastConnect?.capabilities;
  }

  /** Pair/resume and run the capability handshake. The wallet MAY grant a subset of the
   * requested capabilities; inspect the returned {@link ConnectResult}. */
  async connect(
    dapp: DappMetadata,
    extra: Omit<ConnectParams, 'dapp'> = {}
  ): Promise<ConnectResult> {
    const result = await this.request<ConnectResult>(LinkMethod.Connect, { dapp, ...extra });
    this.lastConnect = result;
    this.session.setSessionId(result.session.id);
    return result;
  }

  getAccounts(): Promise<GetAccountsResult> {
    return this.request<GetAccountsResult>(LinkMethod.GetAccounts);
  }

  getChains(): Promise<GetChainsResult> {
    return this.request<GetChainsResult>(LinkMethod.GetChains);
  }

  getWalletInfo(): Promise<GetWalletInfoResult> {
    return this.request<GetWalletInfoResult>(LinkMethod.GetWalletInfo);
  }

  signMessage(params: SignMessageParams): Promise<SignMessageResult> {
    return this.request<SignMessageResult>(LinkMethod.SignMessage, params);
  }

  /** Sign a transaction without broadcasting; the dApp submits the returned signed tx. */
  signTransaction(params: SignTransactionParams): Promise<SignTransactionResult> {
    return this.request<SignTransactionResult>(LinkMethod.SignTransaction, params);
  }

  /** Sign AND broadcast a transaction via the format's RPC endpoint. */
  sendTransaction(params: SendTransactionParams): Promise<SendTransactionResult> {
    return this.request<SendTransactionResult>(LinkMethod.SendTransaction, params);
  }

  /** Read-only VM invoke (no keys, no approval). */
  invokeScript(params: InvokeScriptParams): Promise<InvokeScriptResult> {
    return this.request<InvokeScriptResult>(LinkMethod.InvokeScript, params);
  }

  disconnect(): Promise<DisconnectResult> {
    return this.request<DisconnectResult>(LinkMethod.Disconnect);
  }

  /** Subscribe to wallet->dApp events; returns an unsubscribe function. */
  onEvent(handler: LinkEventHandler): () => void {
    return this.session.onEvent(handler);
  }

  /** Close the underlying transport and reject any in-flight requests. */
  close(): void {
    this.session.close();
  }

  // The wallet's result is `unknown` on the wire; we cast to the method's contract type. The
  // shapes are validated structurally at the envelope layer (§4); per-field validation can be
  // layered on later without changing call sites. `params` is `object` so typed param
  // interfaces (which lack an index signature) are accepted, then forwarded as a plain record.
  private request<T>(method: string, params?: object): Promise<T> {
    return this.session.request(
      method,
      params as Record<string, unknown> | undefined
    ) as Promise<T>;
  }
}
