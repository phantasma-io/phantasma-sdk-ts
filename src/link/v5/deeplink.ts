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

/** Default custom-scheme base of the wallet ("phantasma://v5/req"). */
export const WALLET_SCHEME_BASE = 'phantasma://';

/** Default per-request timeout on deeplink transports. A round-trip spans an app switch
 * plus a human consent, so the generic 60 s session default is far too tight here - it
 * would expire the money path while the user is still reading the wallet's Send screen. */
export const DEEPLINK_REQUEST_TIMEOUT_MS = 300000;

export interface DeeplinkUrls {
  topic: string;
  frame: string;
}

/** Build the dApp->wallet request URL. `walletBase` is e.g. `phantasma:/` (custom scheme) or
 * `https://link.phantasma.info` (universal link); the path is fixed to /v5/req. */
export function buildRequestUrl(walletBase: string, topic: string, frame: string): string {
  const base = walletBase.endsWith('/') ? walletBase : `${walletBase}/`;
  return `${base}v5/req#t=${encodeURIComponent(topic)}&f=${bytesToBase64Url(utf8ToBytes(frame))}`;
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
  /** Wallet base; defaults to the custom scheme {@link WALLET_SCHEME_BASE}. */
  walletBase?: string;
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
  private readonly topic: string;
  private readonly opener: (url: string) => void;
  private readonly walletBase: string;
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
    this.walletBase = options.walletBase ?? WALLET_SCHEME_BASE;
    this.log = options.log;
  }

  send(frame: string): void {
    if (this.closed) {
      throw new LinkError(LinkErrorCode.Disconnected, 'Deeplink transport is closed');
    }
    this.opener(buildRequestUrl(this.walletBase, this.topic, frame));
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
      this.log?.('deliverUrl: v5 response for a different topic, ignored (pairing likely regenerated)');
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
