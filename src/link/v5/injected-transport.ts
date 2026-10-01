// Phantasma Link v5 - injected transport (spec §6.1). A browser-extension wallet defines the
// provider object `window.phantasmaLink` before any page script runs; this transport moves
// plaintext envelope frames through it. Trusted-local path, like loopback: no channel
// encryption (LinkSessionClient without a session key). The page origin is known to the
// wallet from its own runtime, so the session is bound to it on the wallet side.

import { LinkTransport } from './transport.js';
import { LinkError, LinkErrorCode } from './errors.js';
import { PLV } from './protocol.js';

/** The provider object a browser-extension wallet defines on the page (spec §6.1). */
export interface PhantasmaLinkProvider {
  /** Protocol generations the wallet speaks. Contains 5. */
  readonly plvVersions: readonly number[];
  /** Sends one request envelope and returns its response envelope. Rejects only when the
   * bridge to the extension fails; wallet and protocol errors arrive as error envelopes. */
  request(frame: string): Promise<string>;
  /** Subscribes to event envelopes. Returns the function that unsubscribes. */
  onEvent(handler: (frame: string) => void): () => void;
}

declare global {
  interface Window {
    phantasmaLink?: PhantasmaLinkProvider;
  }
}

/** Where the provider is looked up: the page's global object by default. */
export interface ProviderHost {
  phantasmaLink?: unknown;
}

/**
 * Returns the page's provider when one that speaks v5 is present, otherwise `undefined`.
 * The spec §6.1 detection rule: the object exists, `request` is a function, and
 * `plvVersions` contains 5. The check is synchronous; the extension defines the provider
 * before the page's scripts run, so there is no readiness event to wait for.
 */
export function findInjectedProvider(
  host: ProviderHost = globalThis as ProviderHost
): PhantasmaLinkProvider | undefined {
  const candidate = host.phantasmaLink;
  if (typeof candidate !== 'object' || candidate === null) {
    return undefined;
  }
  const provider = candidate as Partial<PhantasmaLinkProvider>;
  if (typeof provider.request !== 'function' || typeof provider.onEvent !== 'function') {
    return undefined;
  }
  if (!Array.isArray(provider.plvVersions) || !provider.plvVersions.includes(PLV)) {
    return undefined;
  }
  return provider as PhantasmaLinkProvider;
}

export interface InjectedTransportOptions {
  /** The provider to use. Default: the page's `window.phantasmaLink`. Tests pass a fake. */
  provider?: PhantasmaLinkProvider;
}

/**
 * A {@link LinkTransport} over the page provider of a browser-extension wallet. Each `send`
 * is one `request` call on the provider; the response envelope is handed to the message
 * handler, where the session client matches it by `id`. Event envelopes arrive through the
 * provider's subscription. A failed bridge call rejects `send`, which the session client
 * reports to the caller as `4900` (spec §6.1).
 */
export class InjectedTransport implements LinkTransport {
  private readonly provider: PhantasmaLinkProvider;
  private messageHandler?: (frame: string) => void;
  private closeHandler?: (reason?: string) => void;
  private readonly unsubscribe: () => void;
  private closed = false;

  constructor(options: InjectedTransportOptions = {}) {
    const provider = options.provider ?? findInjectedProvider();
    if (!provider) {
      throw new LinkError(
        LinkErrorCode.Disconnected,
        'No Phantasma Link provider on this page; the wallet extension is not installed'
      );
    }
    this.provider = provider;
    this.unsubscribe = provider.onEvent((frame) => {
      // Frames are JSON text (spec §6.1); anything else is not a frame and is dropped.
      if (!this.closed && typeof frame === 'string') {
        this.messageHandler?.(frame);
      }
    });
  }

  async send(frame: string): Promise<void> {
    if (this.closed) {
      throw new LinkError(LinkErrorCode.Disconnected, 'Phantasma Link transport is closed');
    }
    let response: unknown;
    try {
      response = await this.provider.request(frame);
    } catch (error) {
      throw new LinkError(
        LinkErrorCode.Disconnected,
        `Wallet extension unreachable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (typeof response !== 'string') {
      throw new LinkError(
        LinkErrorCode.Disconnected,
        'Wallet extension answered with something that is not a frame'
      );
    }
    if (!this.closed) {
      this.messageHandler?.(response);
    }
  }

  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }

  /** Stops delivering frames. The provider itself stays on the page for the next client. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.unsubscribe();
    this.closeHandler?.('Phantasma Link transport closed');
  }
}
