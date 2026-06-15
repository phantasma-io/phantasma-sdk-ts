// Phantasma Link v5 - transport abstraction + session client (spec §6). The SAME envelope
// rides over any transport (injected / loopback / deeplink / relay); a transport only moves
// opaque frame strings. The session client owns request/response correlation by `id`, event
// dispatch, optional channel encryption, and timeouts - so each concrete transport stays
// tiny. Concrete transports are implemented in later phases.

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

/** A duplex channel that carries opaque frame strings between dApp and wallet. */
export interface LinkTransport {
  send(frame: string): void | Promise<void>;
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
  /** Per-request timeout in ms; 0 disables. Default 60000. */
  requestTimeoutMs?: number;
  /** Sink for responses with no matching in-flight request (the deeplink page reloaded while
   * the wallet was open, discarding the original request promise). Without it such responses
   * are dropped. Never fires on same-page flows - those always have a pending entry. */
  onUnmatchedResponse?: (response: UnmatchedResponse) => void;
}

interface Pending {
  resolve: (result: unknown) => void;
  reject: (err: LinkError) => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** A wallet response that arrived with no in-flight request to match it - the deeplink reload
 * case, where the page that issued the request was discarded before the answer came back.
 * Surfaced via {@link LinkSessionClientOptions.onUnmatchedResponse} so a persistence layer can
 * still present the result instead of dropping it. */
export interface UnmatchedResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: unknown;
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
  private readonly pending = new Map<string, Pending>();
  private readonly eventHandlers = new Set<LinkEventHandler>();
  private closed = false;

  constructor(transport: LinkTransport, options: LinkSessionClientOptions = {}) {
    this.transport = transport;
    this.sessionKey = options.sessionKey;
    this.requireSessionKey = options.requireSessionKey ?? false;
    this.sessionId = options.sessionId;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60000;
    this.onUnmatchedResponse = options.onUnmatchedResponse;
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

  /** Subscribe to wallet->dApp events; returns an unsubscribe function. */
  onEvent(handler: LinkEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  /** Send a request and await its result. Rejects with {@link LinkError}. */
  request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(
        new LinkError(LinkErrorCode.Disconnected, 'Phantasma Link transport is closed')
      );
    }
    // The ecdh flow forbids plaintext: until the wallet's key hop arrives there is no
    // channel key, and nothing may be sent (spec §8: relay payloads are always sealed).
    if (this.requireSessionKey && !this.sessionKey) {
      return Promise.reject(
        new LinkError(
          LinkErrorCode.Unauthorized,
          'Channel key not established yet; complete the pairing first'
        )
      );
    }

    const id = randomToken();
    const envelope: LinkRequest = {
      plv: PLV,
      id,
      method,
      ...(this.sessionId ? { session: this.sessionId } : {}),
      ...(params ? { params } : {}),
    };

    const promise = new Promise<unknown>((resolve, reject) => {
      const pending: Pending = { resolve, reject };
      if (this.requestTimeoutMs > 0) {
        pending.timer = setTimeout(() => {
          this.pending.delete(id);
          reject(
            new LinkError(
              LinkErrorCode.InternalError,
              `Phantasma Link request "${method}" timed out`
            )
          );
        }, this.requestTimeoutMs);
      }
      this.pending.set(id, pending);
    });

    // Send after registering the pending entry so a synchronous transport error settles it.
    Promise.resolve(this.transport.send(this.encodeOutgoing(envelope))).catch((err: unknown) => {
      this.settleError(
        id,
        new LinkError(
          LinkErrorCode.Disconnected,
          err instanceof Error ? err.message : 'Failed to send request to wallet'
        )
      );
    });

    return promise;
  }

  /** Close the session, rejecting all in-flight requests. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.transport.close();
    this.rejectAll('Phantasma Link transport closed');
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
    let message: LinkMessage;
    try {
      message = this.decodeIncoming(frame);
    } catch {
      // Drop undecodable/forged frames; a real authenticated peer never sends these.
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
    const pending = this.pending.get(id);
    if (!pending) {
      // No in-flight request matches this id. On deeplink this means the page reloaded while
      // the wallet was open, so the original request promise was lost with the old page. Hand
      // the answer to the optional sink instead of dropping it; same-page flows always have a
      // pending entry, so this path is reload-only.
      if (this.onUnmatchedResponse) {
        if (isLinkErrorResponse(message)) {
          this.onUnmatchedResponse({ id, ok: false, error: message.error });
        } else if (isLinkSuccessResponse(message)) {
          this.onUnmatchedResponse({ id, ok: true, result: message.result });
        }
      }
      return;
    }
    this.pending.delete(id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    if (isLinkErrorResponse(message)) {
      pending.reject(LinkError.fromObject(message.error));
    } else if (isLinkSuccessResponse(message)) {
      pending.resolve(message.result);
    } else {
      pending.reject(
        new LinkError(LinkErrorCode.InternalError, 'Malformed Phantasma Link response')
      );
    }
  }

  private emitEvent(message: LinkEventMessage): void {
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
