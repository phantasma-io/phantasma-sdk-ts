// Phantasma Link v5 - relay transport (spec §6.4/§16). dApp and wallet meet on an
// E2E-blind pub/sub server: both subscribe to the pairing topic; every frame is
// published as OPAQUE payload (the NaCl-sealed envelope text - the relay never sees
// plaintext, enforced by PhantasmaLink5.relay() requiring the session key). Unlike
// deeplink this transport is persistent and bidirectional, so it carries big payloads,
// cross-device sessions, and wallet->dApp events.
//
// Mobile-network reality shapes this file: the socket reconnects with backoff and
// re-subscribes; publishes are tracked until the relay acks them and are re-sent after
// a reconnect (the wallet de-duplicates by envelope id, spec §18.2, so at-least-once
// is safe); frames above the relay's per-frame cap are chunked as
// {msgId, seq, total, chunk}, sent one chunk at a time, and reassembled before the
// session layer ever sees them (spec §16). Keepalive needs nothing here: the relay
// SERVER pings, browsers auto-pong.

import { LinkError, LinkErrorCode } from './errors.js';
import { LinkTransport } from './transport.js';
import { DEFAULT_LINK_HOST } from './protocol.js';
import { WebSocketLike, WebSocketFactory } from './loopback-transport.js';
import { randomToken } from './session-crypto.js';

/** Default relay endpoint on the universal-link host (spec §17). */
export const DEFAULT_RELAY_URL = `wss://${DEFAULT_LINK_HOST}/relay`;

/** Outgoing chunk threshold. The relay caps a whole frame at 1 MiB; this leaves room
 * for the publish envelope around the payload. */
export const RELAY_CHUNK_BYTES = 900_000;

/** The slowest uplink that the ack timeout of a publish allows for, in bytes per second: 16 KiB/s,
 * a weak mobile connection. A whole chunk then takes about 55 s to leave the device. */
const SLOW_UPLINK_BYTES_PER_S = 16 * 1024;

/** The largest transaction the relay carries: the chain maximum (spec §11). */
const MAX_TX_BYTES = 32 * 1024 * 1024;

/** Room for the envelope around the transaction: the method, the ids, the other params,
 * and the signatures that a signed transaction adds. */
const ENVELOPE_ALLOWANCE_BYTES = 64 * 1024;

/** Returns the length of the base64 text of `byteLength` bytes. */
function base64Length(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3);
}

// The longest sealed frame (spec §16). It holds two base64 layers: the transaction is
// base64 inside the envelope JSON, and the sealed envelope (plus the 16-byte
// authenticator) is base64 again in the frame object, which adds the nonce and the field
// names (128 characters cover them). Counting one layer only gives about 30.9 MiB
// instead of 32 MiB.
const MAX_SEALED_FRAME_CHARS =
  base64Length(base64Length(MAX_TX_BYTES) + ENVELOPE_ALLOWANCE_BYTES + 16) + 128;

// Reassembly bounds (spec §16: enforce total and per-message ceilings so a peer cannot
// balloon our memory). The chunk count is the same both ways: 67 at the default chunk size.
const MAX_CHUNKS_PER_MESSAGE = Math.ceil(MAX_SEALED_FRAME_CHARS / RELAY_CHUNK_BYTES);
const MAX_CONCURRENT_PARTIALS = 8;
const PARTIAL_STALE_MS = 120_000;

export interface RelayTransportOptions {
  /** The pairing topic both sides subscribe to (bearer capability, spec §16). */
  topic: string;
  /** Relay WebSocket URL; default {@link DEFAULT_RELAY_URL}. */
  url?: string;
  /** Override the WebSocket implementation (Node / tests). Defaults to global WebSocket. */
  webSocketFactory?: WebSocketFactory;
  /** Chunking threshold for outgoing frames; default {@link RELAY_CHUNK_BYTES}. */
  maxPayloadBytes?: number;
  /** Ceiling for one reassembled incoming message; default 64 MB of frame text. */
  maxAssembledBytes?: number;
  /** How long to wait for the relay's ack of one publish, beyond the time its frame needs to leave
   * the device on a slow uplink of 16 KiB/s; default 15 s. Each chunk of a chunked frame is its
   * own publish, and its timer starts when the chunk is handed to the socket. */
  publishAckTimeoutMs?: number;
  /** Reconnect backoff ladder; the last entry repeats. Default 0.5/1/2/5/15 s. */
  reconnectDelaysMs?: number[];
  /** ecdh pairing (spec §18.1): called ONCE with the wallet's ephemeral X25519 public key
   * (base64url) when the key hop arrives; the caller derives the session key before any
   * sealed frame embedded in the same payload is forwarded. */
  onWalletKey?: (publicKeyB64Url: string) => void;
  /** Optional sink for diagnostics the transport cannot attribute to a caller - notably relay
   * `error` frames that match no in-flight publish (spec §16: clients MUST surface error frames,
   * not drop them). Defaults to console.warn; wire this to redirect or silence. */
  log?: (message: string) => void;
}

interface PendingPublish {
  resolve: () => void;
  reject: (err: LinkError) => void;
  timer: ReturnType<typeof setTimeout>;
  /** The exact publish text, kept so a reconnect can re-send it unchanged. */
  text: string;
}

interface Partial {
  total: number;
  received: Map<number, string>;
  bytes: number;
  touchedAt: number;
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

/**
 * {@link LinkTransport} over the Phantasma Link relay. `send` resolves once the relay
 * acknowledged the publish (or rejects on timeout/close); incoming `deliver` frames are
 * surfaced to the session client after chunk reassembly. Transient socket drops are
 * absorbed by reconnection - the session layer only learns about an explicit close().
 */
export class RelayTransport implements LinkTransport {
  private readonly topic: string;
  private readonly url: string;
  private readonly factory: WebSocketFactory;
  private readonly maxPayloadBytes: number;
  private readonly maxAssembledBytes: number;
  private readonly publishAckTimeoutMs: number;
  private readonly reconnectDelaysMs: number[];

  private socket?: WebSocketLike;
  private messageHandler?: (frame: string) => void;
  private closeHandler?: (reason?: string) => void;
  private readonly onWalletKey?: (publicKeyB64Url: string) => void;
  private readonly log?: (message: string) => void;
  private walletKeySeen = false;
  private readonly pending = new Map<string, PendingPublish>();
  private readonly partials = new Map<string, Partial>();
  private publishSeq = 0;
  private reconnectAttempt = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private closed = false;

  constructor(options: RelayTransportOptions) {
    if (!options.topic) {
      throw new LinkError(LinkErrorCode.InvalidParams, 'Relay transport requires a topic');
    }
    this.topic = options.topic;
    this.url = options.url ?? DEFAULT_RELAY_URL;
    this.factory = options.webSocketFactory ?? defaultWebSocketFactory;
    this.maxPayloadBytes = options.maxPayloadBytes ?? RELAY_CHUNK_BYTES;
    this.maxAssembledBytes = options.maxAssembledBytes ?? 64 * 1024 * 1024;
    this.publishAckTimeoutMs = options.publishAckTimeoutMs ?? 15_000;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [500, 1000, 2000, 5000, 15000];
    this.onWalletKey = options.onWalletKey;
    this.log = options.log;
    this.connect();
  }

  async send(frame: string): Promise<void> {
    if (this.closed) {
      throw new LinkError(LinkErrorCode.Disconnected, 'Relay transport is closed');
    }
    if (frame.length <= this.maxPayloadBytes) {
      await this.publish(frame);
      return;
    }
    // Chunked send: split the opaque frame TEXT; the chunks travel as ordinary
    // publishes and only the receiver reassembles (the relay stays blind).
    const total = Math.ceil(frame.length / this.maxPayloadBytes);
    if (total > MAX_CHUNKS_PER_MESSAGE) {
      // Spec §10/§11: a payload above the budget fails with 5001 and the limit, before
      // anything is sent.
      throw new LinkError(
        LinkErrorCode.PayloadTooLarge,
        'Frame exceeds the relay transport size ceiling',
        { maxPayloadBytes: MAX_TX_BYTES }
      );
    }
    const msgId = randomToken();
    // Chunks go out one at a time: the next one is handed to the socket after the relay
    // acknowledged the previous one (spec §16). A socket queues whatever it is given,
    // without backpressure. If every chunk were handed over at once, every ack timer
    // would start at that moment, and on a slow uplink the timers of the later chunks
    // would expire before those chunks had left the device.
    for (let seq = 0; seq < total; seq++) {
      const chunk = frame.slice(seq * this.maxPayloadBytes, (seq + 1) * this.maxPayloadBytes);
      await this.publish({ msgId, seq, total, chunk });
    }
  }

  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.rejectAllPending('Relay transport closed');
    try {
      this.socket?.close();
    } catch {
      // Closing an already-closed socket is harmless.
    }
    // The session layer learns about closure exactly once, and only for an explicit
    // close - transient drops are hidden behind reconnection.
    this.closeHandler?.('Relay transport closed');
  }

  // --- connection lifecycle -------------------------------------------------------

  private connect(): void {
    const socket = this.factory(this.url);
    this.socket = socket;

    socket.onopen = () => {
      if (this.closed) {
        socket.close();
        return;
      }
      this.reconnectAttempt = 0;
      socket.send(JSON.stringify({ op: 'subscribe', topic: this.topic }));
      // Re-send publishes the previous socket never got acked for (at-least-once;
      // the wallet de-duplicates by envelope id). Order by publish sequence so a
      // chunked message keeps its relative order.
      const texts = [...this.pending.entries()]
        .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
        .map(([, entry]) => entry.text);
      for (const text of texts) {
        socket.send(text);
      }
    };

    socket.onmessage = (event) => {
      if (typeof event.data === 'string') {
        this.handleRaw(event.data);
      }
    };

    socket.onclose = () => {
      if (!this.closed) {
        this.scheduleReconnect();
      }
    };

    // Errors surface as a subsequent close; nothing actionable here.
    socket.onerror = () => {};
  }

  private scheduleReconnect(): void {
    const ladder = this.reconnectDelaysMs;
    const delay = ladder[Math.min(this.reconnectAttempt, ladder.length - 1)];
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  // --- outgoing -------------------------------------------------------------------

  private publish(payload: unknown): Promise<void> {
    const id = `p${++this.publishSeq}`;
    const text = JSON.stringify({ op: 'publish', topic: this.topic, id, payload });
    // The socket takes the text at once and sends it as fast as the uplink allows, so the timer
    // also gives the frame the time it needs to leave the device.
    const timeoutMs =
      this.publishAckTimeoutMs + Math.ceil((text.length * 1000) / SLOW_UPLINK_BYTES_PER_S);
    return new Promise<void>((resolve, reject) => {
      // The ack timeout is the delivery guarantee's outer bound: it spans reconnect
      // attempts (the entry survives them), so it must comfortably exceed the ladder.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new LinkError(LinkErrorCode.Disconnected, 'Relay did not acknowledge the publish'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, text });
      if (this.socket && this.socket.readyState === 1) {
        this.socket.send(text);
      }
      // Not open: the publish stays pending and goes out in onopen's re-send pass.
    });
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new LinkError(LinkErrorCode.Disconnected, reason));
      this.pending.delete(id);
    }
  }

  // --- incoming -------------------------------------------------------------------

  private handleRaw(text: string): void {
    let frame: { op?: unknown; topic?: unknown; id?: unknown; payload?: unknown };
    try {
      frame = JSON.parse(text) as typeof frame;
    } catch {
      return; // not a relay frame; ignore
    }

    switch (frame.op) {
      case 'deliver': {
        if (frame.topic !== this.topic) {
          return;
        }
        const payload = frame.payload;
        if (typeof payload === 'string') {
          this.messageHandler?.(payload);
        } else if (payload && typeof payload === 'object') {
          const record = payload as Record<string, unknown>;
          // ecdh key hop (spec §18.1): the wallet's public key plus the first sealed
          // envelope in one payload. The key callback runs FIRST so the session layer
          // can already open the embedded frame; repeats are ignored (one hop per
          // pairing - a second wpk on a live channel is noise or forgery).
          if (typeof record.wpk === 'string') {
            if (this.onWalletKey && !this.walletKeySeen) {
              this.walletKeySeen = true;
              this.onWalletKey(record.wpk);
              if (typeof record.nonce === 'string' && typeof record.ct === 'string') {
                this.messageHandler?.(JSON.stringify({ nonce: record.nonce, ct: record.ct }));
              }
            }
            return;
          }
          this.acceptChunk(record);
        }
        return;
      }
      case 'ack': {
        const entry = typeof frame.id === 'string' ? this.pending.get(frame.id) : undefined;
        if (entry) {
          this.pending.delete(frame.id as string);
          clearTimeout(entry.timer);
          entry.resolve();
        }
        return;
      }
      case 'error': {
        const entry = typeof frame.id === 'string' ? this.pending.get(frame.id) : undefined;
        const message = (frame as { message?: unknown }).message;
        if (entry) {
          // A publish-scoped error settles that one publish. The relay refused the frame, so the
          // wallet cannot be reached through it: 4900 (spec §10).
          this.pending.delete(frame.id as string);
          clearTimeout(entry.timer);
          entry.reject(
            new LinkError(
              LinkErrorCode.Disconnected,
              typeof message === 'string' ? message : 'Relay rejected the publish'
            )
          );
          return;
        }
        // No publish matches this error (e.g. a subscribe refusal like topic_limit, which carries
        // no publish id). Spec §16 requires clients to surface error frames, not drop them - a
        // silent drop is exactly what let a refused subscribe hang. We do NOT force a close here
        // (a fatal error is followed by the server closing, which the reconnect path handles);
        // surfacing keeps the failure visible instead of invisible.
        const code = (frame as { code?: unknown }).code;
        const detail = `relay error${typeof code !== 'undefined' ? ` code=${String(code)}` : ''}${typeof message === 'string' ? `: ${message}` : ''}`;
        (this.log ?? ((m: string) => console.warn(`[phantasma-link relay] ${m}`)))(detail);
        return;
      }
      default:
        return; // unknown server op; ignore for forward compatibility
    }
  }

  /** Collect one chunk; emit the reassembled frame when complete. Bounds: chunk count,
   * total bytes, concurrent partial messages, and a staleness GC - a hostile peer can
   * waste its own topic, but not this client's memory (spec §16). */
  private acceptChunk(raw: Record<string, unknown>): void {
    const msgId = raw.msgId;
    const seq = raw.seq;
    const total = raw.total;
    const chunk = raw.chunk;
    if (
      typeof msgId !== 'string' ||
      typeof seq !== 'number' ||
      typeof total !== 'number' ||
      typeof chunk !== 'string' ||
      !Number.isInteger(seq) ||
      !Number.isInteger(total) ||
      total < 1 ||
      total > MAX_CHUNKS_PER_MESSAGE ||
      seq < 0 ||
      seq >= total
    ) {
      return;
    }

    // Staleness GC runs lazily on arrival; an abandoned partial cannot linger forever.
    const now = Date.now();
    for (const [key, partial] of this.partials) {
      if (now - partial.touchedAt > PARTIAL_STALE_MS) {
        this.partials.delete(key);
      }
    }

    let partial = this.partials.get(msgId);
    if (!partial) {
      if (this.partials.size >= MAX_CONCURRENT_PARTIALS) {
        return; // refuse new assemblies rather than grow without bound
      }
      partial = { total, received: new Map(), bytes: 0, touchedAt: now };
      this.partials.set(msgId, partial);
    }
    if (partial.total !== total || partial.received.has(seq)) {
      return; // inconsistent or duplicate chunk; ignore
    }
    partial.bytes += chunk.length;
    if (partial.bytes > this.maxAssembledBytes) {
      this.partials.delete(msgId);
      return;
    }
    partial.received.set(seq, chunk);
    partial.touchedAt = now;

    if (partial.received.size === total) {
      this.partials.delete(msgId);
      let joined = '';
      for (let i = 0; i < total; i++) {
        joined += partial.received.get(i);
      }
      this.messageHandler?.(joined);
    }
  }
}
