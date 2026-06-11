// Phantasma Link v5 - loopback transport (spec §6.2). Desktop browser/app -> the wallet's
// local WebSocket server. This is the TRUSTED-LOCAL path: frames are plaintext v5 envelopes
// (no channel encryption needed; see LinkSessionClient with no session key). Default host is
// `localhost` (never the literal `127.0.0.1`).

import { LinkTransport } from './transport.js';
import { LinkError, LinkErrorCode } from './errors.js';

/** Minimal WebSocket surface the transport needs - satisfied by the browser `WebSocket`,
 * the Node `ws` package, or a test double. */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { reason?: string; wasClean?: boolean }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

export interface LoopbackTransportOptions {
  /** Default `localhost`. */
  host?: string;
  /** Default `7090` (the wallet link port). */
  port?: number;
  /** Default `/phantasma/v5` (separate from the legacy `/phantasma`). */
  path?: string;
  /** Override the WebSocket implementation (Node / tests). Defaults to global `WebSocket`. */
  webSocketFactory?: WebSocketFactory;
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  const globalWithWs = globalThis as { WebSocket?: new (url: string) => WebSocketLike };
  if (!globalWithWs.WebSocket) {
    throw new LinkError(
      LinkErrorCode.Disconnected,
      'No WebSocket implementation available; pass options.webSocketFactory'
    );
  }
  return new globalWithWs.WebSocket(url);
}

/** A {@link LinkTransport} over a local WebSocket to the wallet. Sends are buffered until the
 * socket opens, then flushed, so callers can issue requests immediately after construction. */
export class LoopbackTransport implements LinkTransport {
  private readonly socket: WebSocketLike;
  private messageHandler?: (frame: string) => void;
  private closeHandler?: (reason?: string) => void;
  private readonly outbox: string[] = [];
  private isOpen = false;

  constructor(options: LoopbackTransportOptions = {}) {
    const host = options.host ?? 'localhost';
    const port = options.port ?? 7090;
    const path = options.path ?? '/phantasma/v5';
    const url = `ws://${host}:${port}${path}`;
    const factory = options.webSocketFactory ?? defaultWebSocketFactory;

    this.socket = factory(url);
    this.socket.onopen = () => {
      this.isOpen = true;
      for (const frame of this.outbox) {
        this.socket.send(frame);
      }
      this.outbox.length = 0;
    };
    this.socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.messageHandler?.(event.data);
      }
    };
    this.socket.onclose = (event) => {
      this.isOpen = false;
      this.closeHandler?.(event?.reason);
    };
    // Errors surface as a subsequent close; nothing actionable to do here.
    this.socket.onerror = () => {};
  }

  send(frame: string): void {
    if (this.isOpen) {
      this.socket.send(frame);
    } else {
      this.outbox.push(frame);
    }
  }

  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // Closing an already-closed socket is harmless.
    }
  }
}
