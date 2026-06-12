// Phantasma Link v5 - the cohesive client (spec §6/§9). This IS the v5 entry point: there is
// NO separate "EasyConnect"-style wrapper. Transport selection, the connect handshake, and the
// typed `pha_*` methods are all part of this one client. Build it directly with any transport,
// or use the `loopback()` factory for the desktop case.

import { LinkMethod, LinkEvent } from './protocol.js';
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
import {
  DeeplinkTransport,
  DeeplinkTransportOptions,
  DEEPLINK_REQUEST_TIMEOUT_MS,
} from './deeplink.js';
import { LinkError, LinkErrorCode } from './errors.js';
import { buildPairingUri } from './pairing.js';
import { base64UrlToBytes } from './encoding.js';
import {
  WebDeeplinkOptions,
  resolveWebDeeplinkHooks,
  loadWebDeeplinkRecord,
  saveWebDeeplinkRecord,
  createWebDeeplinkRecord,
  stripUrlFragment,
} from './web-deeplink.js';

/** Options for {@link PhantasmaLink5}. */
export interface PhantasmaLink5Options extends LinkSessionClientOptions {
  /** Default dApp identity used by {@link PhantasmaLink5.connect} when none is passed. */
  dapp?: DappMetadata;
  /** Notified on session-state changes: the {@link ConnectResult} after every successful
   * connect/resume, `undefined` after disconnect. Lets an embedder persist session state
   * (the web-deeplink factory stores it; a custom host could keep it elsewhere). */
  onSessionChange?: (connect: ConnectResult | undefined) => void;
}

/**
 * The v5 client. `connect()` runs the capability handshake and stores the session; the typed
 * methods then forward to the wallet and return validated-by-contract results. Events
 * (account/chain/session changes) are delivered via {@link onEvent}.
 */
export class PhantasmaLink5 {
  private readonly transport: LinkTransport;
  private readonly session: LinkSessionClient;
  private readonly defaultDapp?: DappMetadata;
  private readonly onSessionChange?: (connect: ConnectResult | undefined) => void;
  // Cleanup callbacks registered by factories (e.g. the web-deeplink URL listener);
  // run once on close() so a discarded client does not keep page hooks alive.
  private readonly disposers: Array<() => void> = [];
  private lastConnect?: ConnectResult;
  private pairingUriValue?: string;

  constructor(transport: LinkTransport, options: PhantasmaLink5Options = {}) {
    this.transport = transport;
    this.session = new LinkSessionClient(transport, options);
    this.defaultDapp = options.dapp;
    this.onSessionChange = options.onSessionChange;
    // One-tap pairing (spec §17 step 3): the wallet may push the connect result as an
    // unsolicited event right after the pairing approval, instead of waiting for an
    // explicit pha_connect. Adopt it exactly like a connect result so the session is
    // live (and persisted via onSessionChange) the moment the event arrives.
    this.session.onEvent((event, data) => {
      if (event === LinkEvent.SessionEstablished && isConnectResult(data)) {
        this.adoptConnectResult(data);
      }
    });
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
      // Deeplink round-trips include an app switch + human consent; see the constant.
      requestTimeoutMs: options.requestTimeoutMs ?? DEEPLINK_REQUEST_TIMEOUT_MS,
    });
  }

  /**
   * Build a ready-to-use client for a WEB dApp over the deeplink transport (spec §19),
   * bundling the per-dApp glue: pairing material generation, the pairing URI, persistence
   * (localStorage by default), restore + session resume across page loads, and intake of
   * the response URLs the wallet opens back at the page (initial URL + `hashchange`).
   *
   * The factory itself never opens a URL: mobile browsers only allow app-opening
   * navigation from a user gesture. The dApp drives the hops - show {@link pairingUri}
   * (link/QR) for the one-time pairing consent, then call {@link connect} and the typed
   * methods from click handlers; an established session resumes promptlessly (spec §7).
   */
  static async webDeeplink(options: WebDeeplinkOptions): Promise<PhantasmaLink5> {
    const hooks = resolveWebDeeplinkHooks(options);

    let record = loadWebDeeplinkRecord(hooks.storage, hooks.storageKey);
    if (!record) {
      // Persist BEFORE any URL hop: opening the wallet may unload this page, and the
      // pairing key must already be on disk to decrypt responses after it comes back.
      record = createWebDeeplinkRecord(options.callback ?? stripUrlFragment(hooks.pageUrl()));
      saveWebDeeplinkRecord(hooks.storage, hooks.storageKey, record);
    }
    // The record is the source of truth from here on (a snapshot for the closures below).
    const stored = record;
    const sessionKey = base64UrlToBytes(stored.key);

    const client = new PhantasmaLink5(
      new DeeplinkTransport({
        topic: stored.topic,
        opener: hooks.opener,
        walletBase: options.walletBase,
      }),
      {
        dapp: options.dapp,
        sessionKey,
        sessionId: stored.sessionId,
        requestTimeoutMs: options.requestTimeoutMs ?? DEEPLINK_REQUEST_TIMEOUT_MS,
        onSessionChange: (connect) => {
          // Session layer only - the pairing material stays valid across disconnects.
          stored.sessionId = connect?.session.id;
          stored.lastConnect = connect;
          saveWebDeeplinkRecord(hooks.storage, hooks.storageKey, stored);
        },
      }
    );

    // The pairing URI is always available (idempotent to re-show); `sym` requires the
    // domain-verified universal link - a symmetric key never rides a custom scheme (§17).
    client.pairingUriValue = buildPairingUri({
      topic: stored.topic,
      mode: 'sym',
      symKey: sessionKey,
      callback: stored.callback,
      meta: options.dapp,
      scheme: 'universal',
      host: options.host,
    });

    // Hop-free hydration: a reloaded page shows the cached account immediately; the next
    // real request (or a connect()) proves liveness and refreshes it.
    client.lastConnect = stored.lastConnect;

    const consumePageUrl = () => {
      const href = hooks.pageUrl();
      if (client.deliverUrl(href)) {
        // Drop the consumed fragment so reload/back cannot re-deliver it and the
        // ciphertext does not linger in the address bar (or get copied with the URL).
        hooks.replaceUrl?.(stripUrlFragment(href));
      }
    };
    // A response may already sit in the page URL (the wallet's callback navigation
    // cold-loaded this page); consume it before subscribing to changes.
    consumePageUrl();
    const unsubscribe = hooks.onUrlChange?.(consumePageUrl);
    if (unsubscribe) {
      client.disposers.push(unsubscribe);
    }

    return client;
  }

  /** Feed an OS-delivered URL into a deeplink-backed client; see DeeplinkTransport.deliverUrl.
   * The web-deeplink factory wires this automatically; SPAs whose routing swallows
   * `hashchange` call it explicitly on route events. */
  deliverUrl(url: string): boolean {
    return this.transport instanceof DeeplinkTransport && this.transport.deliverUrl(url);
  }

  /** The pairing URI for this client's channel (set by pairing-capable factories such as
   * {@link webDeeplink}); render it as a link/QR for the one-time wallet pairing consent. */
  get pairingUri(): string | undefined {
    return this.pairingUriValue;
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
   * requested capabilities; inspect the returned {@link ConnectResult}. `dapp` falls back
   * to `options.dapp` (factories set it), so a configured client connects with no args. */
  async connect(
    dapp?: DappMetadata,
    extra: Omit<ConnectParams, 'dapp'> = {}
  ): Promise<ConnectResult> {
    const identity = dapp ?? this.defaultDapp;
    if (!identity) {
      throw new LinkError(
        LinkErrorCode.InvalidParams,
        'connect() needs dApp metadata: pass it here or set options.dapp'
      );
    }
    const params: ConnectParams = { dapp: identity, ...extra };
    // Default to resuming the current session (spec §7). Always safe: a matching wallet
    // resumes promptlessly, any mismatch silently falls back to a fresh consent prompt.
    if (params.session === undefined && this.session.getSessionId() !== undefined) {
      params.session = this.session.getSessionId();
    }
    const result = await this.request<ConnectResult>(LinkMethod.Connect, params);
    this.adoptConnectResult(result);
    return result;
  }

  /** Make a connect result the live session state (used by both the explicit connect and
   * the wallet-pushed {@link LinkEvent.SessionEstablished} one-tap pairing path). */
  private adoptConnectResult(result: ConnectResult): void {
    this.lastConnect = result;
    this.session.setSessionId(result.session.id);
    this.onSessionChange?.(result);
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

  async disconnect(): Promise<DisconnectResult> {
    const result = await this.request<DisconnectResult>(LinkMethod.Disconnect);
    // The wallet dropped the session; clear local state so later requests do not carry a
    // dead session id (and embedders can erase their persisted copy).
    this.lastConnect = undefined;
    this.session.setSessionId(undefined);
    this.onSessionChange?.(undefined);
    return result;
  }

  /** Subscribe to wallet->dApp events; returns an unsubscribe function. */
  onEvent(handler: LinkEventHandler): () => void {
    return this.session.onEvent(handler);
  }

  /** Close the underlying transport and reject any in-flight requests. */
  close(): void {
    // Release factory-registered hooks first (e.g. the web page-URL listener) so nothing
    // can deliver into a closing client; disposers must never block the close itself.
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        // A failing disposer must not prevent the transport from closing.
      }
    }
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

/** Structural check for a wallet-pushed connect result before adopting it as session state.
 * The frame already authenticated via the channel key, so this guards against a malformed
 * wallet payload, not an attacker; only the fields the client dereferences are checked. */
function isConnectResult(data: unknown): data is ConnectResult {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const record = data as { session?: { id?: unknown } | null; account?: unknown };
  return (
    typeof record.session === 'object' &&
    record.session !== null &&
    typeof record.session.id === 'string' &&
    record.session.id.length > 0 &&
    typeof record.account === 'object' &&
    record.account !== null
  );
}
