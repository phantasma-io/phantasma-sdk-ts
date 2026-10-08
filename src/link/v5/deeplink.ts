// Phantasma Link v5 - deeplink transport (spec §17). dApp and wallet live in separate apps on
// the SAME device and talk by opening URLs at each other:
//   request:  {walletBase}/v5/req#t=<topic>&f=<base64url(frame)>   (dApp opens the wallet)
//   response: {callback}#plv=5&t=<topic>&f=<base64url(frame)>      (wallet opens the dApp back)
// One request = one URL hop each way ("ping-pong"), sized for SMALL operations; big payloads go
// over the relay (spec §16). Frames on this transport are ALWAYS the encrypted envelope
// {nonce, ct} sealed with the pairing session key - custom-scheme URLs are interceptable, so
// plaintext is never allowed here (enforced by PhantasmaLink5.deeplink()).
//
// The transport cannot "listen": responses arrive when the OS (re)opens the dApp with a new
// URL. The dApp wires that OS event into deliverUrl() (page load / visibilitychange /
// appUrlOpen, depending on platform).

import { LinkError, LinkErrorCode } from './errors.js';
import { LinkTransport } from './transport.js';
import { bytesToBase64Url, base64UrlToBytes, utf8ToBytes, bytesToUtf8 } from './encoding.js';
import { DEFAULT_LINK_HOST } from './protocol.js';

/** Default base of the request and wake links: the universal link (spec §6.3, §17). The phone
 * opens it only in an app that the host lists, so no other app can take the request. */
export const WALLET_LINK_BASE = `https://${DEFAULT_LINK_HOST}`;

/** Custom-scheme base of the wallet ("phantasma://v5/req"), the fallback of spec §6.3. Any app can
 * register the scheme, so it is never the default. */
export const WALLET_SCHEME_BASE = 'phantasma://';

/** Default per-request timeout on deeplink transports. A round-trip spans an app switch
 * plus a human consent, so the generic 60 s session default is far too tight here - it
 * would expire the money path while the user is still reading the wallet's Send screen. */
export const DEEPLINK_REQUEST_TIMEOUT_MS = 300000;

/** Default URL budget for the `f` value of a request URL, in characters (spec §6.3). */
export const DEEPLINK_URL_BUDGET_CHARS = 8192;

/** Default `maxPayloadBytes.deeplink`: the largest payload whose request fits the default URL
 * budget, because the payload is encoded three times on this path (spec §11). */
export const DEEPLINK_MAX_PAYLOAD_BYTES = 3072;

export interface DeeplinkUrls {
  topic: string;
  frame: string;
}

/** Build the dApp->wallet request URL. `walletBase` is `https://link.phantasma.info` (universal
 * link) or `phantasma://` (custom scheme); the path is fixed to /v5/req. */
export function buildRequestUrl(walletBase: string, topic: string, frame: string): string {
  const base = walletBase.endsWith('/') ? walletBase : `${walletBase}/`;
  return `${base}v5/req#t=${encodeURIComponent(topic)}&f=${bytesToBase64Url(utf8ToBytes(frame))}`;
}

/** Build the wake link (spec §6.4, §17). It carries nothing: it only brings the wallet app to
 * the front, so that the wallet reconnects to the relay and reads its pairings' mailboxes. */
export function buildWakeUrl(walletBase: string): string {
  const base = walletBase.endsWith('/') ? walletBase : `${walletBase}/`;
  return `${base}v5/wake`;
}

/** Parse a dApp->wallet request URL; null when the URL is not a v5 request deeplink. */
export function parseRequestUrl(url: string): DeeplinkUrls | null {
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0 || !url.slice(0, hashIndex).endsWith('/v5/req')) {
    return null;
  }
  return parseFragment(url.slice(hashIndex + 1), false);
}

/** Build the wallet->dApp response URL onto the dApp's pairing callback. */
export function buildResponseUrl(callback: string, topic: string, frame: string): string {
  const hashIndex = callback.indexOf('#');
  const base = hashIndex < 0 ? callback : callback.slice(0, hashIndex);
  return `${base}#plv=5&t=${encodeURIComponent(topic)}&f=${bytesToBase64Url(utf8ToBytes(frame))}`;
}

/** Parse a wallet->dApp response URL; null when the URL is not a v5 response deeplink. */
export function parseResponseUrl(url: string): DeeplinkUrls | null {
  const hashIndex = url.indexOf('#');
  if (hashIndex < 0) {
    return null;
  }
  return parseFragment(url.slice(hashIndex + 1), true);
}

/** Length of the `f` value of a request URL that carries `frame`. The frame is ASCII, so its
 * base64url text is 4/3 of its length. */
function encodedFrameChars(frame: string): number {
  return Math.ceil((frame.length * 4) / 3);
}

function parseFragment(fragment: string, requirePlvMarker: boolean): DeeplinkUrls | null {
  const params = new URLSearchParams(fragment);
  if (requirePlvMarker && params.get('plv') !== '5') {
    return null;
  }
  const topic = params.get('t');
  const f = params.get('f');
  if (!topic || !f) {
    return null;
  }
  try {
    return { topic, frame: bytesToUtf8(base64UrlToBytes(f)) };
  } catch {
    return null;
  }
}

export interface DeeplinkTransportOptions {
  /** The pairing topic; routes frames to the right channel on both sides. */
  topic: string;
  /** Opens a URL at the wallet (platform hook: location.href, anchor click, native intent). */
  opener: (url: string) => void;
  /** Wallet base; defaults to the universal link {@link WALLET_LINK_BASE}. The custom scheme
   * {@link WALLET_SCHEME_BASE} is the fallback of spec §6.3. */
  walletBase?: string;
  /** Largest `f` value of a request URL, in characters; default
   * {@link DEEPLINK_URL_BUDGET_CHARS}. */
  urlBudgetChars?: number;
  /** Optional diagnostic sink for inbound response URLs: whether a delivered URL matched this
   * channel's topic or was ignored (foreign topic / not a v5 response). METADATA ONLY - never the
   * sealed `f` payload. Default: no-op. */
  log?: (message: string) => void;
}

/**
 * {@link LinkTransport} over deeplink ping-pong. `send` opens a wallet URL carrying the frame;
 * the dApp feeds OS-delivered URLs into {@link deliverUrl}, which dispatches frames for this
 * transport's topic to the session client.
 */
export class DeeplinkTransport implements LinkTransport {
  readonly kind = 'deeplink';
  private readonly topic: string;
  private readonly opener: (url: string) => void;
  private readonly walletBase: string;
  private readonly urlBudgetChars: number;
  private readonly log?: (message: string) => void;
  private messageHandler?: (frame: string) => void;
  private closeHandler?: (reason?: string) => void;
  private closed = false;

  constructor(options: DeeplinkTransportOptions) {
    if (!options.topic) {
      throw new LinkError(LinkErrorCode.InvalidParams, 'Deeplink transport requires a topic');
    }
    this.topic = options.topic;
    this.opener = options.opener;
    this.walletBase = options.walletBase ?? WALLET_LINK_BASE;
    this.urlBudgetChars = options.urlBudgetChars ?? DEEPLINK_URL_BUDGET_CHARS;
    this.log = options.log;
  }

  /** Whether `frame` fits the URL budget of a request (spec §6.3). */
  fits(frame: string): boolean {
    return encodedFrameChars(frame) <= this.urlBudgetChars;
  }

  send(frame: string): void {
    if (this.closed) {
      throw new LinkError(LinkErrorCode.Disconnected, 'Deeplink transport is closed');
    }
    // Spec §6.3: a request whose `f` value exceeds the URL budget never goes out as a URL,
    // because the OS or the browser may cut it. This transport has no relay to fall back to,
    // so it refuses with 5001; a pairing with a relay sends such a request there
    // (DeeplinkRelayTransport).
    const encodedChars = encodedFrameChars(frame);
    if (encodedChars > this.urlBudgetChars) {
      throw new LinkError(
        LinkErrorCode.PayloadTooLarge,
        `Request of ${encodedChars} characters exceeds the deeplink budget of ${this.urlBudgetChars}`,
        { maxUrlChars: this.urlBudgetChars }
      );
    }
    this.opener(buildRequestUrl(this.walletBase, this.topic, frame));
  }

  /** Opens the wake link at the wallet (spec §6.4). */
  wake(): void {
    if (this.closed) {
      throw new LinkError(LinkErrorCode.Disconnected, 'Deeplink transport is closed');
    }
    this.opener(buildWakeUrl(this.walletBase));
  }

  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }

  /**
   * Feed an OS-delivered URL into the transport. Returns true when the URL was a v5 response
   * for THIS transport's topic and was dispatched; false lets the caller try other handlers.
   */
  deliverUrl(url: string): boolean {
    if (this.closed) {
      return false;
    }
    const parsed = parseResponseUrl(url);
    if (!parsed) {
      return false; // not a v5 response URL: a foreign navigation, not ours - stay silent
    }
    if (parsed.topic !== this.topic) {
      // A v5 response for a DIFFERENT channel. The usual cause is a regenerated pairing (the page
      // reloaded or opened in another tab with a fresh topic), so the wallet's answer can never
      // match. Log it: this is the silent drop that makes a "nothing happened" deeplink return so
      // hard to diagnose.
      this.log?.(
        'deliverUrl: v5 response for a different topic, ignored (pairing likely regenerated)'
      );
      return false;
    }
    this.log?.('deliverUrl: v5 response matched this channel, dispatching');
    this.messageHandler?.(parsed.frame);
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.closeHandler?.('Deeplink transport closed');
  }
}
