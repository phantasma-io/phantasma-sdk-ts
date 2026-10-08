// Phantasma Link v5 - the cohesive client (spec §6/§9). This IS the v5 entry point: there is
// NO separate "EasyConnect"-style wrapper. Transport selection, the connect handshake, and the
// typed `pha_*` methods are all part of this one client. Build it directly with any transport,
// or use the `loopback()` factory for the desktop case.

import { LinkMethod, LinkEvent, MAX_TX_BYTES, SESSION_IDLE_TTL_MS } from './protocol.js';
import {
  LinkTransport,
  LinkSessionClient,
  LinkSessionClientOptions,
  LinkEventHandler,
  SendOptions,
  UnmatchedResponse,
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
  RequestSigningPermissionParams,
  RequestSigningPermissionResult,
  GetSigningPermissionResult,
  RevokeSigningPermissionParams,
  RevokeSigningPermissionResult,
} from './methods.js';
import { LoopbackTransport, LoopbackTransportOptions } from './loopback-transport.js';
import { InjectedTransport, InjectedTransportOptions } from './injected-transport.js';
import {
  DeeplinkTransport,
  DeeplinkTransportOptions,
  DEEPLINK_MAX_PAYLOAD_BYTES,
  DEEPLINK_REQUEST_TIMEOUT_MS,
} from './deeplink.js';
import { RelayTransport, RelayTransportOptions, DEFAULT_RELAY_URL } from './relay-transport.js';
import { DeeplinkRelayTransport } from './deeplink-relay-transport.js';
import { LinkError, LinkErrorCode } from './errors.js';
import { buildPairingUri } from './pairing.js';
import { base64DecodedLength, base64UrlToBytes } from './encoding.js';
import {
  WebDeeplinkOptions,
  resolveWebDeeplinkHooks,
  loadWebDeeplinkRecord,
  WEB_DEEPLINK_STORED_ANSWERS,
  saveWebDeeplinkRecord,
  createWebDeeplinkRecord,
  stripUrlFragment,
} from './web-deeplink.js';
import {
  deriveSessionKey,
  generateEphemeralKeyPair,
  openEnvelopeText,
  randomToken,
  EncryptedFrame,
  EphemeralKeyPair,
} from './session-crypto.js';
import { isWalletAnswer, walletAnswerError } from './wallet-answer.js';

/** Options for {@link PhantasmaLink5}. */
export interface PhantasmaLink5Options extends LinkSessionClientOptions {
  /** Default dApp identity used by {@link PhantasmaLink5.connect} when none is passed. */
  dapp?: DappMetadata;
  /** Notified on session-state changes: the {@link ConnectResult} after every successful
   * connect/resume and after the wallet pushes new details of the session's account,
   * `undefined` when the session ends. Lets an embedder persist session state (the
   * web-deeplink factory stores it; a custom host could keep it elsewhere). */
  onSessionChange?: (connect: ConnectResult | undefined) => void;
  /** How long a session may go without an answer from the wallet before the client ends it, in
   * milliseconds (spec §7); default {@link SESSION_IDLE_TTL_MS}. Every session ends by inactivity,
   * so anything but a positive finite number is refused with `-32602`. */
  idleTtlMs?: number;
}

/** Wallet answers that say the session the request carried no longer lives (spec §7). */
const SESSION_ENDED_CODES: ReadonlySet<number> = new Set([
  LinkErrorCode.SessionExpired,
  LinkErrorCode.SessionRevoked,
  LinkErrorCode.Unauthorized,
]);

/** Why requests fail on a client whose pairing ended with its session (spec §18.3). */
const PAIRING_ENDED = 'The session ended, and its pairing with it; pair again';

/**
 * The v5 client. `connect()` runs the capability handshake and stores the session; the typed
 * methods then forward to the wallet and return validated-by-contract results. Events
 * (account/chain/session changes) are delivered via {@link onEvent}.
 *
 * The client ends a session it holds on {@link disconnect} and {@link forgetSession}, when the
 * wallet says the session ended (an event, or `5100`/`5101`/`4100` to a request made in it), and
 * when the session's lifetime or the inactivity limit is over (spec §7). A client with a channel
 * key (deeplink, relay) ends its pairing with the session (spec §18.3): the key is dropped, the
 * client closes ({@link isClosed}) and later requests fail with `4900`, so build a new client to
 * pair again. Injected and loopback have no pairing and stay open.
 */
export class PhantasmaLink5 {
  private readonly transport: LinkTransport;
  private readonly session: LinkSessionClient;
  private readonly defaultDapp?: DappMetadata;
  private readonly onSessionChange?: (connect: ConnectResult | undefined) => void;
  // A channel key belongs to one pairing, and the pairing ends with its session (spec §18.3).
  private readonly keyed: boolean;
  private readonly idleTtlMs: number;
  // Cleanup callbacks registered by factories (e.g. the web-deeplink URL listener);
  // run once on close() so a discarded client does not keep page hooks alive.
  private readonly disposers: Array<() => void> = [];
  private lastConnect?: ConnectResult;
  // Unix milliseconds of the last answer from the wallet in the current session (spec §7).
  private lastSeenAt?: number;
  // Set by the web-deeplink factory to store lastSeenAt whenever it moves.
  private onActivity?: () => void;
  private lastUnmatched?: UnmatchedResponse;
  private pairingUriValue?: string;

  constructor(transport: LinkTransport, options: PhantasmaLink5Options = {}) {
    this.transport = transport;
    // Capture responses that arrive with no in-flight request: an earlier load of the page sent
    // the request, or it timed out before its answer came. The web-deeplink factory delivers a
    // response found in the page URL during construction, so a caller can recover it via
    // takeUnmatchedResponse() right after building the client. The relay hands its held answers
    // again to the new page's subscription after the factory returned (spec §16); every such
    // answer also reaches the caller's onUnmatchedResponse.
    const onUnmatchedResponse = options.onUnmatchedResponse;
    this.session = new LinkSessionClient(transport, {
      ...options,
      onUnmatchedResponse: (response) => {
        this.lastUnmatched = response;
        // The session the request went out in: the one it named, when this client sent it. A
        // request of an earlier page load went out on this channel's pairing, which carries one
        // session (spec §18.3). Over injected and loopback such an answer ends no session, because
        // a later session of the same page must not end on the answer to an older one.
        const sentSession =
          response.request !== undefined
            ? response.request.session
            : this.keyed
              ? this.session.getSessionId()
              : undefined;
        this.noteAnswer(sentSession, response.ok ? undefined : walletAnswerError(response.error));
        onUnmatchedResponse?.(response);
      },
    });
    this.defaultDapp = options.dapp;
    this.onSessionChange = options.onSessionChange;
    this.keyed = options.sessionKey !== undefined || options.requireSessionKey === true;
    this.idleTtlMs = readIdleTtl(options.idleTtlMs);
    // One-tap pairing (spec §15 step 3): the wallet may push the connect result as an
    // unsolicited event right after the pairing approval, instead of waiting for an
    // explicit pha_connect. Adopt it exactly like a connect result so the session is
    // live (and persisted via onSessionChange) the moment the event arrives.
    this.session.onEvent((event, data, session) => {
      if (event === LinkEvent.SessionEstablished && isConnectResult(data)) {
        this.adoptConnectResult(data);
      } else if (event === LinkEvent.AccountsChanged) {
        this.adoptAccountDetails(data, session);
      } else if (event === LinkEvent.SessionDeleted || event === LinkEvent.SessionExpired) {
        // The wallet tore a session down (user revoke / LRU evict / idle expiry) and notified us
        // over the channel, so it ends here too and a reload cannot resume a dead one. The ended
        // id rides the envelope `session` field or `data.session` (spec §9.5). A notice for
        // another session (an older one on the same channel) must not end the live one; a notice
        // that names no session is ours, because it decrypted with this channel's key.
        const ended = session ?? sessionOf(data);
        if (ended === undefined || ended === this.session.getSessionId()) {
          this.endSession();
        }
      }
    });
  }

  /** Build a client over the desktop loopback transport (plaintext, trusted-local). */
  static loopback(options: LoopbackTransportOptions = {}): PhantasmaLink5 {
    return new PhantasmaLink5(new LoopbackTransport(options));
  }

  /** A browser-extension wallet on this page (spec §6.1): frames go through the provider
   * `window.phantasmaLink`. Trusted-local, plaintext. Throws `4900` when no v5 provider is
   * present; check {@link findInjectedProvider} first to fall back to another transport.
   * Consents run in the extension UI, so the request timeout is the same generous default
   * as deeplink and relay. */
  static injected(
    options: InjectedTransportOptions & { requestTimeoutMs?: number } = {}
  ): PhantasmaLink5 {
    return new PhantasmaLink5(new InjectedTransport(options), {
      requestTimeoutMs: options.requestTimeoutMs ?? DEEPLINK_REQUEST_TIMEOUT_MS,
    });
  }

  /** Build a client over the deeplink transport (spec §17), for a native app on the wallet's
   * device. The channel key from pairing is MANDATORY here: deeplink URLs are interceptable, so
   * plaintext frames are never allowed. With `relay` (the pairing's relay) a request that does
   * not fit a URL goes over the relay (spec §6.3); without it such a request fails with 5001. */
  static deeplink(
    options: DeeplinkTransportOptions & {
      sessionKey: Uint8Array;
      requestTimeoutMs?: number;
      relay?: Omit<RelayTransportOptions, 'topic' | 'side' | 'onWalletKey'>;
    }
  ): PhantasmaLink5 {
    if (!options.sessionKey || options.sessionKey.length !== 32) {
      throw new LinkError(
        LinkErrorCode.InvalidParams,
        'Deeplink requires the 32-byte pairing session key'
      );
    }
    const relay = options.relay;
    const transport =
      relay === undefined
        ? new DeeplinkTransport(options)
        : new DeeplinkRelayTransport({ ...options, relay, prefer: 'deeplink' });
    return new PhantasmaLink5(transport, {
      sessionKey: options.sessionKey,
      // Deeplink round-trips include an app switch + human consent; see the constant.
      requestTimeoutMs: options.requestTimeoutMs ?? DEEPLINK_REQUEST_TIMEOUT_MS,
    });
  }

  /** Build a client over the relay transport (spec §6.4/§16). The channel key from
   * pairing is MANDATORY: relay payloads are ALWAYS encrypted (spec §8) - the relay is
   * E2E-blind and must stay that way. */
  static relay(
    options: Omit<RelayTransportOptions, 'side'> & {
      sessionKey: Uint8Array;
      requestTimeoutMs?: number;
    }
  ): PhantasmaLink5 {
    if (!options.sessionKey || options.sessionKey.length !== 32) {
      throw new LinkError(
        LinkErrorCode.InvalidParams,
        'Relay requires the 32-byte pairing session key'
      );
    }
    return new PhantasmaLink5(new RelayTransport({ ...options, side: 'dapp' }), {
      sessionKey: options.sessionKey,
      // Relay round-trips include human consents too; same generous default.
      requestTimeoutMs: options.requestTimeoutMs ?? DEEPLINK_REQUEST_TIMEOUT_MS,
    });
  }

  /**
   * Build a client for the ecdh pairing fallback (spec §15/§18.1): the custom-scheme
   * channel is hijackable, so NO secret rides the pairing URI - only the dApp's
   * ephemeral X25519 PUBLIC key. The wallet answers over the relay with its own public
   * key plus the sealed connect result; the session key is derived on arrival and the
   * client refuses to send (or accept) anything before that. Show {@link pairingUri}
   * (a phantasma:// URI) to start; the session then arrives one-tap. `dapp` is required: the
   * wallet sends its key only after the user saw the dApp named in the URI (spec §15).
   */
  static relayEcdh(
    options: Omit<RelayTransportOptions, 'topic' | 'side' | 'onWalletKey'> & {
      topic?: string;
      dapp: DappMetadata;
      keyPair?: EphemeralKeyPair;
      requestTimeoutMs?: number;
    }
  ): PhantasmaLink5 {
    const topic = options.topic ?? randomToken(32);
    const pair = options.keyPair ?? generateEphemeralKeyPair();
    const relayUrl = options.url ?? DEFAULT_RELAY_URL;
    // Built before the transport: it refuses a topic of the wrong form before a socket opens.
    const pairingUri = buildPairingUri({
      topic,
      mode: 'ecdh',
      dappPublicKey: pair.publicKey,
      relay: relayUrl,
      meta: options.dapp,
      // The whole point of ecdh is the hijackable custom scheme; a safe channel
      // (universal link / QR) should use the simpler sym mode instead.
      scheme: 'scheme',
    });

    const transport = new RelayTransport({
      ...options,
      topic,
      side: 'dapp',
      url: relayUrl,
      onWalletKey: (publicKeyB64Url, sealedFrame) => {
        // Fires only when a wallet hop arrives, long after `client` below exists. The key is
        // installed only when the hop's own sealed frame opens with it (spec §15).
        try {
          const walletPublicKey = base64UrlToBytes(publicKeyB64Url);
          const key = deriveSessionKey(walletPublicKey, pair.secretKey);
          openEnvelopeText(JSON.parse(sealedFrame) as EncryptedFrame, key);
          client.session.setSessionKey(key);
          return true;
        } catch {
          return false;
        }
      },
    });
    const client = new PhantasmaLink5(transport, {
      dapp: options.dapp,
      requireSessionKey: true,
      requestTimeoutMs: options.requestTimeoutMs ?? DEEPLINK_REQUEST_TIMEOUT_MS,
    });
    client.pairingUriValue = pairingUri;
    return client;
  }

  /**
   * Build a ready-to-use client for a WEB dApp on the wallet's device (spec §6.3, §6.4, §17),
   * bundling the per-dApp glue: pairing material generation, the pairing URI with its relay,
   * persistence (localStorage by default), restore + session resume across page loads, and
   * intake of the response URLs the wallet opens back at the page (initial URL + `hashchange`).
   * Requests go over the relay, so answers reach the page without a reload, and the wake link
   * brings the wallet app to the front; while the relay is not connected, a request that fits a
   * URL goes over the deeplink instead.
   *
   * The factory itself never opens a URL: mobile browsers only allow app-opening
   * navigation from a user gesture. The dApp drives the hops - show {@link pairingUri}
   * (link/QR) for the one-time pairing consent, then call {@link connect} and the typed
   * methods from click handlers; an established session resumes promptlessly (spec §7).
   * The stored pairing goes with its session (spec §18.3): once the session ends, the
   * client closes and the next factory call pairs afresh.
   */
  static async webDeeplink(options: WebDeeplinkOptions): Promise<PhantasmaLink5> {
    const hooks = resolveWebDeeplinkHooks(options);
    const idleTtlMs = readIdleTtl(options.idleTtlMs);

    let record = loadWebDeeplinkRecord(hooks.storage, hooks.storageKey);
    if (
      record?.sessionId !== undefined &&
      sessionLapsed(record.lastConnect?.session.expiresAt, record.lastSeenAt, idleTtlMs)
    ) {
      // Spec §7, §18.3: the stored session is over, and its pairing key with it.
      record = null;
    }
    if (!record) {
      const relayUrl = options.relayUrl ?? DEFAULT_RELAY_URL;
      if (!/^wss:\/\//i.test(relayUrl)) {
        // Spec §15: a wallet refuses a pairing whose relay is not a wss:// URL.
        throw new LinkError(LinkErrorCode.InvalidParams, 'relayUrl must be a wss:// URL');
      }
      // Persist BEFORE any URL hop: opening the wallet may unload this page, and the
      // pairing key must already be on disk to decrypt responses after it comes back.
      record = createWebDeeplinkRecord(
        options.callback ?? stripUrlFragment(hooks.pageUrl()),
        relayUrl
      );
      saveWebDeeplinkRecord(hooks.storage, hooks.storageKey, record);
    }
    // The record is the source of truth from here on (a snapshot for the closures below).
    const stored = record;
    const sessionKey = base64UrlToBytes(stored.key);
    // Set once the session ended and the record was deleted with its key: nothing writes it again.
    let deleted = false;

    const client = new PhantasmaLink5(
      new DeeplinkRelayTransport({
        topic: stored.topic,
        opener: hooks.opener,
        walletBase: options.walletBase,
        log: options.log,
        relay: { url: stored.relay, webSocketFactory: options.webSocketFactory },
        prefer: 'relay',
      }),
      {
        dapp: options.dapp,
        sessionKey,
        sessionId: stored.sessionId,
        requestTimeoutMs: options.requestTimeoutMs ?? DEEPLINK_REQUEST_TIMEOUT_MS,
        idleTtlMs,
        log: options.log,
        onUnmatchedResponse: options.onUnmatchedResponse,
        handledAnswers: stored.answered,
        onAnswerHandled: (handled) => {
          // The answer to pha_disconnect comes after the record was deleted.
          if (deleted) {
            return;
          }
          stored.answered = handled.slice(-WEB_DEEPLINK_STORED_ANSWERS);
          saveWebDeeplinkRecord(hooks.storage, hooks.storageKey, stored);
        },
        onSessionChange: (connect) => {
          if (connect === undefined) {
            // Spec §18.3: the pairing key goes with the session.
            deleted = true;
            hooks.storage.removeItem(hooks.storageKey);
            return;
          }
          stored.sessionId = connect.session.id;
          stored.lastConnect = connect;
          stored.lastSeenAt = client.lastSeenAt;
          saveWebDeeplinkRecord(hooks.storage, hooks.storageKey, stored);
        },
      }
    );
    client.onActivity = () => {
      stored.lastSeenAt = client.lastSeenAt;
      saveWebDeeplinkRecord(hooks.storage, hooks.storageKey, stored);
    };

    // The pairing URI is always available (idempotent to re-show); `sym` requires the
    // domain-verified universal link - a symmetric key never rides a custom scheme (§15).
    client.pairingUriValue = buildPairingUri({
      topic: stored.topic,
      mode: 'sym',
      symKey: sessionKey,
      relay: stored.relay,
      callback: stored.callback,
      meta: options.dapp,
      scheme: 'universal',
      host: options.host,
    });

    // Hop-free hydration: a reloaded page shows the cached account immediately; the next
    // real request (or a connect()) proves liveness and refreshes it.
    client.lastConnect = stored.lastConnect;
    client.lastSeenAt = stored.lastSeenAt;

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
    if (client.isClosed) {
      // That response ended the session, and the pairing with it: pair afresh, and keep the
      // response for takeUnmatchedResponse().
      const fresh = await PhantasmaLink5.webDeeplink(options);
      fresh.lastUnmatched = client.lastUnmatched;
      return fresh;
    }
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
    return (
      (this.transport instanceof DeeplinkTransport ||
        this.transport instanceof DeeplinkRelayTransport) &&
      this.transport.deliverUrl(url)
    );
  }

  /** Take (and clear) the last wallet response that arrived with no in-flight request to match
   * it: an earlier load of the page sent the request, or it timed out before its answer came. The
   * web-deeplink factory delivers an answer found in the page URL during construction, so read it
   * right after building the client. Returns undefined when there is nothing to recover. */
  takeUnmatchedResponse(): UnmatchedResponse | undefined {
    const response = this.lastUnmatched;
    this.lastUnmatched = undefined;
    return response;
  }

  /** The pairing URI for this client's channel (set by pairing-capable factories such as
   * {@link webDeeplink}); render it as a link/QR for the one-time wallet pairing consent. */
  get pairingUri(): string | undefined {
    return this.pairingUriValue;
  }

  /** True once the client is closed: by {@link close}, by its transport, or because its
   * pairing ended with the session. A closed client fails every request with `4900`. */
  get isClosed(): boolean {
    return this.session.isClosed;
  }

  /** The session's account from the last successful {@link connect}, with the details the
   * wallet pushed since then in {@link LinkEvent.AccountsChanged}, if any. */
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
    // A held session id rides in the envelope `session` field of every request, this one
    // included, so the wallet resumes it without a prompt (spec §4, §9.5). For a session that
    // ended or that it does not know, a wallet runs the full approval over injected and
    // loopback, and answers 5100 or 4100 over deeplink and relay.
    const result = await this.request<ConnectResult>(LinkMethod.Connect, params);
    // The client reads these fields later, for example the capabilities before every transaction.
    // A wallet that left one out gets a clear error here instead of a TypeError on a later call.
    if (!isConnectResult(result)) {
      throw new LinkError(
        LinkErrorCode.InternalError,
        'The wallet sent a malformed connect result'
      );
    }
    this.adoptConnectResult(result);
    return result;
  }

  /** Make a connect result the live session state (used by both the explicit connect and
   * the wallet-pushed {@link LinkEvent.SessionEstablished} one-tap pairing path). */
  private adoptConnectResult(result: ConnectResult): void {
    this.lastConnect = result;
    this.lastSeenAt = Date.now();
    this.session.setSessionId(result.session.id);
    this.onSessionChange?.(result);
  }

  /** Takes the new details of the session's account (name, avatar, balances) from a
   * {@link LinkEvent.AccountsChanged} event, so {@link account} shows them and an embedder can
   * persist them. A session holds one account (spec §7), so an entry with another address is
   * ignored, and so is an event that names another session. An event that names no session is
   * this client's, because only its channel delivers it. */
  private adoptAccountDetails(data: unknown, session: string | undefined): void {
    const current = this.lastConnect;
    if (current === undefined) {
      return;
    }
    if (session !== undefined && session !== this.session.getSessionId()) {
      return;
    }
    const accounts =
      data && typeof data === 'object' ? (data as { accounts?: unknown }).accounts : undefined;
    if (!Array.isArray(accounts)) {
      return;
    }
    const account = accounts.find(
      (item): item is LinkAccountV5 =>
        !!item &&
        typeof item === 'object' &&
        (item as { address?: unknown }).address === current.account.address
    );
    if (account === undefined) {
      return;
    }
    // A new object: an observer that compares references (a React or MobX store) sees the change.
    this.lastConnect = { ...current, account };
    this.onSessionChange?.(this.lastConnect);
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
    return this.requestWithPayload<SignMessageResult>(
      LinkMethod.SignMessage,
      params,
      params.message
    );
  }

  /** Sign a transaction without broadcasting; the dApp submits the returned signed tx. */
  signTransaction(params: SignTransactionParams): Promise<SignTransactionResult> {
    return this.requestWithPayload<SignTransactionResult>(
      LinkMethod.SignTransaction,
      params,
      params.tx
    );
  }

  /** Sign AND broadcast a transaction via the format's RPC endpoint. */
  sendTransaction(params: SendTransactionParams): Promise<SendTransactionResult> {
    return this.requestWithPayload<SendTransactionResult>(
      LinkMethod.SendTransaction,
      params,
      params.tx
    );
  }

  /** Sends a request that carries a payload in base64: a transaction, a message or a script.
   * Spec §11: the client refuses a payload above the chain maximum or above the limit the
   * wallet advertised for this transport with `5001` before sending, so the dApp gets a clear
   * error instead of a failure somewhere on the way. Without a connect result or a transport
   * kind only the chain maximum applies. */
  private requestWithPayload<T>(method: string, params: object, payload: string): Promise<T> {
    const size = base64DecodedLength(payload);
    const kind = this.transport.kind;
    const advertised = kind ? this.lastConnect?.capabilities.maxPayloadBytes?.[kind] : undefined;
    const limit = advertised === undefined ? MAX_TX_BYTES : Math.min(advertised, MAX_TX_BYTES);
    if (size > limit) {
      return Promise.reject(
        new LinkError(
          LinkErrorCode.PayloadTooLarge,
          `${method}: payload of ${size} bytes exceeds the limit of ${limit} bytes`,
          { maxPayloadBytes: limit }
        )
      );
    }
    return this.request<T>(method, params, this.sendOptionsFor(size));
  }

  /** Spec §6.3: a payload above the wallet's deeplink limit goes over the relay. */
  private sendOptionsFor(size: number): SendOptions {
    const deeplinkLimit =
      this.lastConnect?.capabilities.maxPayloadBytes?.deeplink ?? DEEPLINK_MAX_PAYLOAD_BYTES;
    return { needsRelay: size > deeplinkLimit };
  }

  /** Read-only VM invoke (no keys, no approval). */
  invokeScript(params: InvokeScriptParams): Promise<InvokeScriptResult> {
    return this.requestWithPayload<InvokeScriptResult>(
      LinkMethod.InvokeScript,
      params,
      params.script
    );
  }

  /** Ask the wallet once for the permission to sign the session's transactions that call only the
   * given contract methods, without a prompt, for `duration` seconds (spec §9.8). The user approves
   * it in one prompt; a rejection is `4001`. A new permission replaces the session's previous one. */
  requestSigningPermission(
    params: RequestSigningPermissionParams
  ): Promise<RequestSigningPermissionResult> {
    return this.request<RequestSigningPermissionResult>(
      LinkMethod.RequestSigningPermission,
      params
    );
  }

  /** The session's signing permission in force, or null (spec §9.8). */
  getSigningPermission(): Promise<GetSigningPermissionResult> {
    return this.request<GetSigningPermissionResult>(LinkMethod.GetSigningPermission);
  }

  /** End the session's signing permission; succeeds without one (spec §9.8). Pass the `id` of the
   * permission to end, so that a copy of this request delivered later cannot end a newer one. */
  revokeSigningPermission(
    params: RevokeSigningPermissionParams = {}
  ): Promise<RevokeSigningPermissionResult> {
    return this.request<RevokeSigningPermissionResult>(LinkMethod.RevokeSigningPermission, params);
  }

  /** End the session: tell the wallet (`pha_disconnect`) and end it on this side, whatever the
   * wallet answers. A client with a channel key closes once the answer is in (spec §18.3). */
  async disconnect(): Promise<DisconnectResult> {
    const answer = this.request<DisconnectResult>(LinkMethod.Disconnect);
    // The request above is already sealed and sent. Clear the session before the answer: on
    // deeplink the hop to the wallet may unload this page, and the stored session and key must
    // be gone by then.
    this.clearSession();
    try {
      return await answer;
    } finally {
      if (this.keyed) {
        this.shutDown(PAIRING_ENDED);
      }
    }
  }

  /** End the session on this side WITHOUT notifying the wallet. Use when a wallet round-trip is
   * undesirable - notably deeplink, where pha_disconnect would navigate to the wallet and reload
   * this page. The wallet's side lapses on its own session TTL (spec §7). A client with a channel
   * key closes (spec §18.3). */
  forgetSession(): void {
    this.endSession();
  }

  /** Subscribe to wallet->dApp events; returns an unsubscribe function. */
  onEvent(handler: LinkEventHandler): () => void {
    return this.session.onEvent(handler);
  }

  /** Close the underlying transport and reject any in-flight requests. */
  close(): void {
    this.shutDown();
  }

  private shutDown(reason?: string): void {
    // Release factory-registered hooks first (e.g. the web page-URL listener) so nothing
    // can deliver into a closing client; disposers must never block the close itself.
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose();
      } catch {
        // A failing disposer must not prevent the transport from closing.
      }
    }
    this.session.close(reason);
  }

  /** Ends the session on this side; a client with a channel key ends its pairing with it. */
  private endSession(): void {
    this.clearSession();
    if (this.keyed) {
      this.shutDown(PAIRING_ENDED);
    }
  }

  /** Drops the session state; the embedder hears `undefined` and deletes what it stored. */
  private clearSession(): void {
    this.lastConnect = undefined;
    this.lastSeenAt = undefined;
    this.session.setSessionId(undefined);
    this.onSessionChange?.(undefined);
  }

  /** Keeps the session in step with the outcome of a request made in `sentSession`. Every answer
   * from the wallet is activity (spec §7), an error answer too, and some errors say the session is
   * over. An error the client reports itself (spec §10) is no answer and changes nothing. */
  private noteAnswer(sentSession: string | undefined, error?: unknown): void {
    if (sentSession === undefined || sentSession !== this.session.getSessionId()) {
      return;
    }
    if (error !== undefined && !isWalletAnswer(error)) {
      return;
    }
    if (error instanceof LinkError && SESSION_ENDED_CODES.has(error.code)) {
      this.endSession();
      return;
    }
    this.lastSeenAt = Date.now();
    this.onActivity?.();
  }

  // The wallet's result is `unknown` on the wire; we cast to the method's contract type. The
  // shapes are validated structurally at the envelope layer (§4); per-field validation can be
  // layered on later without changing call sites. `params` is `object` so typed param
  // interfaces (which lack an index signature) are accepted, then forwarded as a plain record.
  private async request<T>(method: string, params?: object, options?: SendOptions): Promise<T> {
    // Spec §7: a session past its lifetime or the inactivity limit is over on this side too. On
    // a keyed channel the wallet dropped the pairing as well, so nothing would ever answer.
    if (
      this.session.getSessionId() !== undefined &&
      sessionLapsed(this.lastConnect?.session.expiresAt, this.lastSeenAt, this.idleTtlMs)
    ) {
      this.endSession();
    }
    // Everything up to the first await runs at once: the frame is sealed and sent before the
    // caller's next statement (disconnect() relies on it).
    const sentSession = this.session.getSessionId();
    try {
      const result = await this.session.request(
        method,
        params as Record<string, unknown> | undefined,
        options
      );
      this.noteAnswer(sentSession);
      return result as T;
    } catch (error) {
      this.noteAnswer(sentSession, error);
      throw error;
    }
  }
}

/** Returns the inactivity limit of the options, or throws `-32602` for a value that is no positive
 * finite number: spec §7 ends every session by inactivity, and a limit of 0 would end it at the
 * next request. */
function readIdleTtl(value: number | undefined): number {
  const idleTtlMs = value ?? SESSION_IDLE_TTL_MS;
  if (typeof idleTtlMs !== 'number' || !Number.isFinite(idleTtlMs) || idleTtlMs <= 0) {
    throw new LinkError(
      LinkErrorCode.InvalidParams,
      'idleTtlMs must be a positive number of milliseconds'
    );
  }
  return idleTtlMs;
}

/** Whether a session is over by the client's clock (spec §7): its lifetime ended at `expiresAt`,
 * or `idleTtlMs` passed since the last answer from the wallet. An unknown time sets no limit. */
function sessionLapsed(
  expiresAt: number | null | undefined,
  lastSeenAt: number | undefined,
  idleTtlMs: number
): boolean {
  const now = Date.now();
  return (
    (typeof expiresAt === 'number' && now >= expiresAt) ||
    (lastSeenAt !== undefined && now - lastSeenAt >= idleTtlMs)
  );
}

/** Returns the session id that an event's `data` names, or undefined. */
function sessionOf(data: unknown): string | undefined {
  if (data && typeof data === 'object') {
    const value = (data as { session?: unknown }).session;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

/** Returns true if `data` has the fields of a connect result that the client reads, and those that
 * spec §5 requires: the session id and its end (a number, or null for no fixed end), the
 * account's address, and the capabilities with their features and size limits. A connect result
 * comes from the wallet, so this guards against a malformed answer of a faulty wallet. */
function isConnectResult(data: unknown): data is ConnectResult {
  if (!data || typeof data !== 'object') {
    return false;
  }
  const record = data as {
    session?: { id?: unknown; expiresAt?: unknown } | null;
    account?: { address?: unknown } | null;
    capabilities?: { features?: unknown; maxPayloadBytes?: unknown } | null;
  };
  const session = record.session;
  const account = record.account;
  const capabilities = record.capabilities;
  return (
    typeof session === 'object' &&
    session !== null &&
    typeof session.id === 'string' &&
    session.id.length > 0 &&
    (session.expiresAt === null || typeof session.expiresAt === 'number') &&
    typeof account === 'object' &&
    account !== null &&
    typeof account.address === 'string' &&
    typeof capabilities === 'object' &&
    capabilities !== null &&
    Array.isArray(capabilities.features) &&
    (capabilities.maxPayloadBytes === undefined ||
      (typeof capabilities.maxPayloadBytes === 'object' && capabilities.maxPayloadBytes !== null))
  );
}
