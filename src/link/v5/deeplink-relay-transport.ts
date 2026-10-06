// Phantasma Link v5 - one same-device pairing over the relay and the deeplink together (spec
// §6.3, §6.4). A web page on the phone sends requests over the relay, so the wallet's answer
// reaches the page without reloading it, and falls back to the deeplink while the relay is not
// connected. A native app sends over the deeplink and keeps the relay for what does not fit a
// URL. Whatever the preference, a request that a deeplink cannot carry goes over the relay.
// After a request goes over the relay, the wake link brings the wallet app to the front so that
// it reads the relay. The wallet answers over the path the request came on; both paths feed the
// same session (one topic, one key).

import { LinkError, LinkErrorCode } from './errors.js';
import { LinkTransport, SendOptions } from './transport.js';
import {
  DeeplinkTransport,
  DeeplinkTransportOptions,
  DEEPLINK_REQUEST_TIMEOUT_MS,
} from './deeplink.js';
import { RelayTransport, RelayTransportOptions } from './relay-transport.js';

export interface DeeplinkRelayTransportOptions extends DeeplinkTransportOptions {
  /** The relay of the pairing. The topic is the pairing's, and `log` defaults to the one above. */
  relay: Omit<RelayTransportOptions, 'topic' | 'onWalletKey'>;
  /** Where a request that fits a URL goes while the relay is connected: `relay` for a web page
   * (spec §6.3: no page reload), `deeplink` for a native app. */
  prefer: 'relay' | 'deeplink';
}

/** A request sent over the relay that may still wait for its answer. */
interface RelayRequest {
  sentAt: number;
  fail: (error: LinkError) => void;
  release: () => void;
}

/** {@link LinkTransport} over the relay and the deeplink of one pairing (spec §6.3, §6.4). */
export class DeeplinkRelayTransport implements LinkTransport {
  // The relay's limit: a transaction that a deeplink cannot take goes over the relay (spec §11).
  readonly kind = 'relay';
  private readonly relay: RelayTransport;
  private readonly deeplink: DeeplinkTransport;
  private readonly prefer: 'relay' | 'deeplink';
  private closeHandler?: (reason?: string) => void;
  private relayClosed = false;
  private closed = false;
  // The requests sent over the relay that may still wait for their answer. The wallet answers on
  // the path a request came on, so once the relay refuses the topic none of them can get an
  // answer, and they fail at once with 4900 instead of at the timeout (spec §10, §16).
  private readonly overRelay = new Set<RelayRequest>();

  constructor(options: DeeplinkRelayTransportOptions) {
    this.deeplink = new DeeplinkTransport(options);
    // The relay connects and subscribes to the topic now (spec §15 step 1), so that whatever the
    // wallet publishes, the session after the pairing approval included, reaches this page.
    this.relay = new RelayTransport({ log: options.log, ...options.relay, topic: options.topic });
    this.prefer = options.prefer;
    // The relay closes for good only on close() or when it refuses the topic. The deeplink still
    // works then; the client closes only on close().
    this.relay.onClose((reason) => {
      this.relayClosed = true;
      const error = new LinkError(LinkErrorCode.Disconnected, reason ?? 'The relay closed');
      for (const request of this.overRelay) {
        request.fail(error);
      }
      this.overRelay.clear();
    });
  }

  /** Sends `frame` over the deeplink or the relay (spec §6.3). For the relay the returned promise
   * rejects when the relay refuses the frame, or later the topic, and resolves only once the
   * deeplink request timeout has passed. */
  send(frame: string, options?: SendOptions): void | Promise<void> {
    if (this.closed) {
      throw new LinkError(LinkErrorCode.Disconnected, 'Transport is closed');
    }
    // Spec §6.3: a request that does not fit the URL budget, or whose payload is above the
    // wallet's deeplink limit, goes over the relay.
    const needsRelay = options?.needsRelay === true || !this.deeplink.fits(frame);
    if (!needsRelay && (this.prefer === 'deeplink' || !this.relay.isOpen)) {
      this.deeplink.send(frame);
      return;
    }
    if (this.relayClosed) {
      throw new LinkError(
        LinkErrorCode.Disconnected,
        'The relay cannot be reached, and the request does not fit a deeplink'
      );
    }
    // The publish leaves now (a large frame: its first chunk), and so does the wake link: a
    // browser opens an app only from the user's gesture, which ends with this call. A publish
    // made while the relay reconnects goes out on the reconnect, and the relay keeps it for the
    // wallet (spec §16).
    const sent = this.relay.send(frame);
    this.deeplink.wake();
    return this.waitOverRelay(sent);
  }

  onMessage(handler: (frame: string) => void): void {
    this.relay.onMessage(handler);
    this.deeplink.onMessage(handler);
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }

  /** Feed an OS-delivered URL into the deeplink side; see {@link DeeplinkTransport.deliverUrl}. */
  deliverUrl(url: string): boolean {
    return !this.closed && this.deeplink.deliverUrl(url);
  }

  /** The outcome of a request sent over the relay: it fails when the relay refuses the frame, or
   * later when the relay refuses the topic while the request may still wait for its answer. It
   * settles without an error once the deeplink request timeout has passed, when the request has
   * its answer or its timeout. */
  private waitOverRelay(sent: Promise<void>): Promise<void> {
    const now = Date.now();
    for (const request of this.overRelay) {
      if (now - request.sentAt >= DEEPLINK_REQUEST_TIMEOUT_MS) {
        this.overRelay.delete(request);
        request.release();
      }
    }
    return new Promise<void>((resolve, reject) => {
      const request: RelayRequest = { sentAt: now, fail: reject, release: resolve };
      this.overRelay.add(request);
      sent.catch((error: unknown) => {
        this.overRelay.delete(request);
        reject(error);
      });
    });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.relay.close();
    this.deeplink.close();
    this.closeHandler?.('Transport closed');
  }
}
