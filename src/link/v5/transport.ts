// Phantasma Link v5 - transport abstraction + session client (spec §6). The SAME envelope
// rides over any transport (injected / loopback / deeplink / relay); a transport only moves
// opaque frame strings. The session client owns request/response correlation by `id`, event
// dispatch, optional channel encryption, and timeouts - so each concrete transport stays
// tiny.

import { PLV } from './protocol.js';
import { LinkError, LinkErrorCode } from './errors.js';
import {
  LinkRequest,
  LinkResponse,
  LinkMessage,
  LinkEventMessage,
  encodeEnvelope,
  decodeEnvelope,
  isLinkEvent,
  isLinkErrorResponse,
  isLinkSuccessResponse,
} from './envelope.js';
import {
  EncryptedFrame,
  sealEnvelopeText,
  openEnvelopeText,
  randomToken,
} from './session-crypto.js';
import { walletAnswerError } from './wallet-answer.js';
import { DEEPLINK_REQUEST_TIMEOUT_MS } from './deeplink.js';

/** The transports of spec §6, named as in `maxPayloadBytes` (spec §5). */
export type TransportKind = 'injected' | 'loopback' | 'deeplink' | 'relay';

/** How long a client remembers the id of an answer it handled. The relay hands its frames
 * again to every new subscription for its TTL (spec §16), so a repeat must be recognized. */
const ANSWER_MEMORY_MS = 10 * 60 * 1000;

/** How long a client remembers the session of a request it sent, so that an answer which comes
 * after the timeout is told apart from an answer to a request of an earlier page load. */
const REQUEST_MEMORY_MS = 10 * 60 * 1000;

/** What a request asks of the transport that carries it. */
export interface SendOptions {
  /** The request carries a payload larger than the wallet takes over a deeplink (spec §6.3,
   * §11). A transport that can choose sends it over the relay. */
  needsRelay?: boolean;
  /** Called each time a part of the request has left the device: for the relay, each frame
   * that the relay acknowledged. The request timeout starts again then, so the upload of a
   * large request does not use up the time the wallet has to answer (spec §10: `5005` means
   * that the wallet was reached). A transport that sends at once need not call it. */
  onProgress?: () => void;
}

/** A duplex channel that carries opaque frame strings between dApp and wallet. */
export interface LinkTransport {
  /** Which transport this is. The client uses it to find the wallet's size limit for this
   * transport (spec §11). A custom transport may leave it out. */
  readonly kind?: TransportKind;
  send(frame: string, options?: SendOptions): void | Promise<void>;
  onMessage(handler: (frame: string) => void): void;
  onClose?(handler: (reason?: string) => void): void;
  close(): void;
}

export type LinkEventHandler = (event: string, data: unknown, session?: string) => void;

export interface LinkSessionClientOptions {
  /** 32-byte session key. When omitted, frames are PLAINTEXT envelope JSON - appropriate
   * ONLY for a trusted local transport (loopback/injected); deeplink and relay MUST set a
   * key (spec §8). */
  sessionKey?: Uint8Array;
  /** Refuse to SEND until a session key is set (see {@link LinkSessionClient.setSessionKey}).
   * Used by the ecdh pairing flow, where the key is derived only after the wallet's
   * public key arrives - plaintext must never leave the client in the meantime. */
  requireSessionKey?: boolean;
  /** Session id attached to outgoing requests after connect/pairing. */
  sessionId?: string;
  /** Per-request timeout in ms, counted from the last part of the request that left the
   * device (`SendOptions.onProgress`); 0 disables. Default {@link DEEPLINK_REQUEST_TIMEOUT_MS},
   * 5 minutes, on every transport. */
  requestTimeoutMs?: number;
  /** Sink for responses with no matching in-flight request: the request timed out (`5005`)
   * before its answer came, or an earlier load of the page sent it (the wallet's callback
   * reloaded the page, or the relay hands its held answers to the new subscription, spec §16).
   * Without it such responses are dropped. */
  onUnmatchedResponse?: (response: UnmatchedResponse) => void;
  /** Ids of the answers handled before, each with the Unix milliseconds it came, for example by an
   * earlier load of the same page. The relay hands its held answers again to every new
   * subscription (spec §16), so an answer handled before is dropped as a repeat. */
  handledAnswers?: ReadonlyArray<readonly [string, number]>;
  /** Called with the ids of the answers handled in the last 10 minutes, oldest first, each with
   * the Unix milliseconds it came, whenever the client handles a new answer, so that an embedder
   * can keep them across page loads ({@link handledAnswers}). */
  onAnswerHandled?: (handled: Array<[string, number]>) => void;
  /** Optional diagnostic sink for the receive path: frames dropped (undecodable / wrong key) and
   * events received. Mirrors the relay transport's `log` seam so a host can trace the otherwise
   * silent deeplink/relay receive path. METADATA ONLY - never receives secrets or plaintext
   * payloads. Default: no-op. */
  log?: (message: string) => void;
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: LinkError) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** A wallet response that arrived with no in-flight request to match it: its request timed out
 * before the answer came, or an earlier load of the page sent it. Surfaced via
 * {@link LinkSessionClientOptions.onUnmatchedResponse} so a persistence layer can still present
 * the result instead of dropping it. */
export interface UnmatchedResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: unknown;
  /** Present when this client sent the request and its answer came after the timeout: the
   * session the request named, if it named one. Absent for a request of an earlier page load. */
  request?: { session?: string };
}

/**
 * Drives a v5 session over a {@link LinkTransport}. `request()` sends a typed envelope and
 * resolves with the wallet's `result` (or rejects with a {@link LinkError}); incoming events
 * are dispatched to {@link onEvent} handlers. Encryption is transparent: when a session key
 * is set, every outgoing envelope is sealed and every incoming frame is opened.
 */
export class LinkSessionClient {
  private readonly transport: LinkTransport;
  private sessionKey?: Uint8Array;
  private readonly requireSessionKey: boolean;
  private sessionId?: string;
  private readonly requestTimeoutMs: number;
  private readonly onUnmatchedResponse?: (response: UnmatchedResponse) => void;
  private readonly onAnswerHandled?: (handled: Array<[string, number]>) => void;
  private readonly log?: (message: string) => void;
  private readonly pending = new Map<string, Pending>();
  // Ids of the answers handled, oldest first, with the time they came.
  private readonly answered = new Map<string, number>();
  // The session each request named, by request id, oldest first, with the time it was sent. A
  // late answer of a request that timed out is then told apart from an answer to a request of
  // an earlier page load.
  private readonly sentIn = new Map<string, { session?: string; at: number }>();
  private readonly eventHandlers = new Set<LinkEventHandler>();
  private closed = false;
  private closeReason?: string;

  constructor(transport: LinkTransport, options: LinkSessionClientOptions = {}) {
    this.transport = transport;
    this.sessionKey = options.sessionKey;
    this.requireSessionKey = options.requireSessionKey ?? false;
    this.sessionId = options.sessionId;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEEPLINK_REQUEST_TIMEOUT_MS;
    this.onUnmatchedResponse = options.onUnmatchedResponse;
    this.onAnswerHandled = options.onAnswerHandled;
    this.log = options.log;
    // Oldest first, as the memory keeps them: the pruning in isRepeat stops at the first id that
    // is still young.
    const handled = [...(options.handledAnswers ?? [])].sort((a, b) => a[1] - b[1]);
    for (const [id, at] of handled) {
      this.answered.set(id, at);
    }
    transport.onMessage((frame) => this.handleFrame(frame));
    transport.onClose?.((reason) => this.handleClose(reason));
  }

  /** Set/refresh the session id sent on subsequent requests (e.g. after `pha_connect`),
   * or clear it with `undefined` (e.g. after `pha_disconnect`). */
  setSessionId(id: string | undefined): void {
    this.sessionId = id;
  }

  /** The current session id, if a session is established. */
  getSessionId(): string | undefined {
    return this.sessionId;
  }

  /** Install the channel key once it is established (ecdh pairing derives it only after
   * the wallet's ephemeral public key arrives, spec §18.1). From here on every frame is
   * sealed/opened with it, exactly as if it had been passed at construction. */
  setSessionKey(key: Uint8Array): void {
    if (key.length !== 32) {
      throw new LinkError(LinkErrorCode.InternalError, 'Invalid session key length');
    }
    this.sessionKey = key;
  }

  /** True once the session client is closed: by {@link close} or by its transport. */
  get isClosed(): boolean {
    return this.closed;
  }

  /** Subscribe to wallet->dApp events; returns an unsubscribe function. */
  onEvent(handler: LinkEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  /** Send a request and await its result. Rejects with {@link LinkError}. */
  request(
    method: string,
    params?: Record<string, unknown>,
    options?: SendOptions
  ): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new LinkError(
          LinkErrorCode.Disconnected,
          this.closeReason ?? 'Phantasma Link transport is closed'
        )
      );
    }
    // The ecdh flow forbids plaintext: until the wallet's key hop arrives there is no
    // channel key, and nothing may be sent (spec §8: relay payloads are always sealed). The
    // wallet cannot be reached yet, which the client reports as 4900 (spec §10).
    if (this.requireSessionKey && !this.sessionKey) {
      return Promise.reject(
        new LinkError(
          LinkErrorCode.Disconnected,
          'Channel key not established yet; complete the pairing first'
        )
      );
    }

    const id = randomToken();
    // The send time travels sealed with the request. A copy of the request carries the same
    // time, so a wallet can refuse to sign it without a prompt once it is old (spec §9.8).
    const envelope: LinkRequest = {
      plv: PLV,
      id,
      method,
      ...(this.sessionId ? { session: this.sessionId } : {}),
      sentAt: Date.now(),
      ...(params ? { params } : {}),
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.rememberRequest(id, this.sessionId);
    this.startTimeout(id, method);

    // Send after registering the pending entry so a synchronous transport error settles it.
    // A LinkError from the transport keeps its code: the transport knows the reason, as with
    // a frame too large for the relay (5001). Any other failure means the wallet is out of
    // reach.
    let sent: void | Promise<void>;
    try {
      sent = this.transport.send(this.encodeOutgoing(envelope), {
        ...options,
        // Spec §10: 5005 means that the wallet was reached and did not answer in time, so the
        // upload of a large request does not count.
        onProgress: () => this.startTimeout(id, method),
      });
    } catch (err) {
      // A refusal at once (a deeplink above the URL budget, a closed transport) settles this
      // request like a later rejection; otherwise its timer would fire on a promise nobody holds.
      sent = Promise.reject(err);
    }
    Promise.resolve(sent).catch((err: unknown) => {
      this.settleError(
        id,
        err instanceof LinkError
          ? err
          : new LinkError(
              LinkErrorCode.Disconnected,
              err instanceof Error ? err.message : 'Failed to send request to wallet'
            )
      );
    });

    return promise;
  }

  /** Close the session, rejecting all in-flight requests and later ones with `reason`. The
   * channel key is dropped: nothing is sealed or opened after this. */
  close(reason?: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeReason = reason;
    this.sessionKey = undefined;
    // Reject before closing the transport, whose close notice would reject with its own reason.
    this.rejectAll(reason ?? 'Phantasma Link transport closed');
    this.transport.close();
  }

  private encodeOutgoing(message: LinkMessage): string {
    const json = encodeEnvelope(message);
    if (!this.sessionKey) {
      return json;
    }
    return JSON.stringify(sealEnvelopeText(json, this.sessionKey));
  }

  private decodeIncoming(frame: string): LinkMessage {
    if (!this.sessionKey) {
      // Mirror of the sending guard: a key-requiring channel must not accept plaintext
      // either - anything arriving before the key hop is forged by definition.
      if (this.requireSessionKey) {
        throw new LinkError(LinkErrorCode.Unauthorized, 'Channel key not established yet');
      }
      return decodeEnvelope(frame);
    }
    let parsed: EncryptedFrame;
    try {
      parsed = JSON.parse(frame) as EncryptedFrame;
    } catch {
      throw new LinkError(LinkErrorCode.ParseError, 'Encrypted frame is not valid JSON');
    }
    return decodeEnvelope(openEnvelopeText(parsed, this.sessionKey));
  }

  private handleFrame(frame: string): void {
    // A closed client has no key, and a frame must never be read as plaintext for want of one.
    if (this.closed) {
      return;
    }
    let message: LinkMessage;
    try {
      message = this.decodeIncoming(frame);
    } catch {
      // Drop undecodable/forged frames; a real authenticated peer never sends these. Log the drop
      // (no payload) so a wrong-key channel - e.g. a deeplink return after the pairing was
      // regenerated - is visible instead of silently vanishing.
      this.log?.('frame dropped: undecodable or wrong session key');
      return;
    }

    if (isLinkEvent(message)) {
      this.emitEvent(message);
      return;
    }

    const id = (message as LinkResponse).id;
    if (typeof id !== 'string') {
      return;
    }
    if (this.isRepeat(id)) {
      this.log?.('frame dropped: an answer already handled');
      return;
    }
    const request = this.sentIn.get(id);
    this.sentIn.delete(id);
    const pending = this.pending.get(id);
    if (!pending) {
      // No in-flight request matches this id: the request timed out before its answer came, or
      // an earlier load of the page sent it and its promise was lost with that page. Hand the
      // answer to the optional sink instead of dropping it.
      if (this.onUnmatchedResponse) {
        const sent = request === undefined ? {} : { request: { session: request.session } };
        if (isLinkErrorResponse(message)) {
          this.onUnmatchedResponse({ id, ok: false, error: message.error, ...sent });
        } else if (isLinkSuccessResponse(message)) {
          this.onUnmatchedResponse({ id, ok: true, result: message.result, ...sent });
        }
      }
      return;
    }
    this.pending.delete(id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    if (isLinkErrorResponse(message)) {
      pending.reject(walletAnswerError(message.error));
    } else if (isLinkSuccessResponse(message)) {
      pending.resolve(message.result);
    } else {
      pending.reject(
        new LinkError(LinkErrorCode.InternalError, 'Malformed Phantasma Link response')
      );
    }
  }

  /** Remembers the session that request `id` named, for as long as its answer may come. */
  private rememberRequest(id: string, session: string | undefined): void {
    const now = Date.now();
    for (const [sent, entry] of this.sentIn) {
      if (now - entry.at < REQUEST_MEMORY_MS) {
        break;
      }
      this.sentIn.delete(sent);
    }
    this.sentIn.set(id, { session, at: now });
  }

  /** True when an answer with this id was handled before; otherwise remembers it. */
  private isRepeat(id: string): boolean {
    const now = Date.now();
    for (const [seen, at] of this.answered) {
      if (now - at < ANSWER_MEMORY_MS) {
        break;
      }
      this.answered.delete(seen);
    }
    if (this.answered.has(id)) {
      return true;
    }
    this.answered.set(id, now);
    try {
      this.onAnswerHandled?.([...this.answered]);
    } catch {
      // A failing embedder hook must not lose the answer.
    }
    return false;
  }

  private emitEvent(message: LinkEventMessage): void {
    this.log?.(`event received: ${message.event}`);
    for (const handler of this.eventHandlers) {
      try {
        handler(message.event, message.data, message.session);
      } catch {
        // Isolate handler exceptions so one bad listener can't break dispatch.
      }
    }
  }

  private handleClose(reason?: string): void {
    this.closed = true;
    this.rejectAll(reason ?? 'Phantasma Link transport closed');
  }

  /** Starts the timeout of request `id` again, unless the request is settled. On expiry it
   * fails with 5005 (spec §10), so a dApp can tell a user who has not decided yet from a
   * wallet that cannot be reached (4900). */
  private startTimeout(id: string, method: string): void {
    const pending = this.pending.get(id);
    if (pending === undefined || this.requestTimeoutMs <= 0) {
      return;
    }
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      this.pending.delete(id);
      pending.reject(
        new LinkError(LinkErrorCode.Timeout, `Phantasma Link request "${method}" timed out`)
      );
    }, this.requestTimeoutMs);
  }

  private settleError(id: string, err: LinkError): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.reject(err);
  }

  private rejectAll(reason: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new LinkError(LinkErrorCode.Disconnected, reason));
      this.pending.delete(id);
    }
  }
}
