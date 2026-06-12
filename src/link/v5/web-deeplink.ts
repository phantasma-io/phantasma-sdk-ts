// Phantasma Link v5 - web-dApp deeplink glue (spec §17/§19). A web page that talks to the
// wallet over deeplink needs the same few pieces every time: pairing material (topic +
// session key), a pairing URI to show, persistence that survives the page being unloaded
// while the wallet is in the foreground, and intake of the response URLs the wallet opens
// back at the page. This module holds those pieces; the orchestration is the
// `PhantasmaLink5.webDeeplink()` factory (client.ts), NOT a separate wrapper class.
//
// Everything platform-specific is injectable so the flow is fully testable without a
// browser; the defaults bind to the real browser surface (localStorage, location.href,
// hashchange, history.replaceState).

import { LinkError, LinkErrorCode } from './errors.js';
import { DappMetadata, ConnectResult } from './capabilities.js';
import { bytesToBase64Url, base64UrlToBytes } from './encoding.js';
import { generateSessionKey, randomToken, SESSION_KEY_LENGTH } from './session-crypto.js';

/** The subset of the Web Storage API the web-deeplink flow needs (localStorage-shaped). */
export interface WebDeeplinkStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Default storage key for the persisted {@link WebDeeplinkRecord}. */
export const WEB_DEEPLINK_STORAGE_KEY = 'phantasma.link.v5.webdeeplink';

/** Options for `PhantasmaLink5.webDeeplink()`. Only `dapp` is required in a browser; every
 * platform hook has a browser default and exists so tests/embedders can inject fakes. */
export interface WebDeeplinkOptions {
  /** dApp identity: shown in wallet consent UIs and embedded in the pairing URI meta. */
  dapp: DappMetadata;
  /** Persistence for the pairing/session record; default `localStorage`. */
  storage?: WebDeeplinkStorage;
  /** Storage key for the record; default {@link WEB_DEEPLINK_STORAGE_KEY}. */
  storageKey?: string;
  /** Opens a URL at the wallet; default assigns `location.href`. */
  opener?: (url: string) => void;
  /** Reads the current page URL; default `location.href`. */
  pageUrl?: () => string;
  /** Subscribes to page-URL changes and returns an unsubscribe; default listens to
   * `hashchange` (wallet responses arrive as fragment-only navigations on the callback). */
  onUrlChange?: (handler: () => void) => () => void;
  /** Replaces the page URL after a response fragment is consumed (history.replaceState by
   * default) so reload/back does not re-deliver it and ciphertext leaves the address bar. */
  replaceUrl?: (url: string) => void;
  /** Wallet base for request URLs (DeeplinkTransport); default the `phantasma://` scheme. */
  walletBase?: string;
  /** Universal-link host for the pairing URI; default `link.phantasma.info`. */
  host?: string;
  /** Where the wallet opens responses. Default: the current page URL without its fragment.
   * Baked into the wallet-side pairing at consent time - changing it later needs a re-pair. */
  callback?: string;
  /** Per-request timeout; the web default is 5 minutes (an app switch + human consent). */
  requestTimeoutMs?: number;
}

/** The persisted pairing/session state of one web dApp <-> wallet deeplink channel. */
export interface WebDeeplinkRecord {
  /** Record format version (for forward migration of stored state). */
  v: 1;
  /** Pairing topic routing frames on both sides (32 random bytes, base64url). */
  topic: string;
  /** The 32-byte symmetric session key, base64url. Lives in the dApp origin's storage -
   * the same trust domain as the dApp code that uses it. */
  key: string;
  /** Response callback URL the wallet opens; fixed at pairing consent. */
  callback: string;
  /** Established session id (spec §7), set after a successful connect. */
  sessionId?: string;
  /** Cache of the last ConnectResult so a reloaded page can show the account without a
   * URL hop; refreshed by every successful connect, dropped on disconnect. */
  lastConnect?: ConnectResult;
}

/** Resolved platform hooks (options merged with browser defaults). */
export interface WebDeeplinkHooks {
  storage: WebDeeplinkStorage;
  storageKey: string;
  opener: (url: string) => void;
  pageUrl: () => string;
  onUrlChange?: (handler: () => void) => () => void;
  replaceUrl?: (url: string) => void;
}

// Narrow view of the browser globals we may bind to. The SDK compiles without the DOM lib
// (it also targets Node), so these are typed locally instead of relying on `lib.dom`.
interface BrowserLikeGlobals {
  localStorage?: WebDeeplinkStorage;
  location?: { href: string };
  history?: { replaceState(data: unknown, unused: string, url: string): void };
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/** Merge options with browser defaults; throw a clear error when a required hook has no
 * default in the current environment (e.g. running outside a browser without injection). */
export function resolveWebDeeplinkHooks(options: WebDeeplinkOptions): WebDeeplinkHooks {
  const browser = globalThis as BrowserLikeGlobals;

  // Reading `localStorage` itself can throw in some privacy modes; treat that as absent.
  let defaultStorage: WebDeeplinkStorage | undefined;
  try {
    defaultStorage = browser.localStorage;
  } catch {
    defaultStorage = undefined;
  }
  const storage = options.storage ?? defaultStorage;
  if (!storage) {
    throw new LinkError(
      LinkErrorCode.InvalidParams,
      'webDeeplink requires `storage` when localStorage is unavailable'
    );
  }

  const location = browser.location;
  const opener =
    options.opener ??
    (location
      ? (url: string) => {
          location.href = url;
        }
      : undefined);
  if (!opener) {
    throw new LinkError(
      LinkErrorCode.InvalidParams,
      'webDeeplink requires `opener` when location is unavailable'
    );
  }

  const pageUrl = options.pageUrl ?? (location ? () => location.href : undefined);
  if (!pageUrl) {
    throw new LinkError(
      LinkErrorCode.InvalidParams,
      'webDeeplink requires `pageUrl` when location is unavailable'
    );
  }

  // Optional hooks: missing defaults degrade features (no automatic intake / no URL
  // cleanup) instead of failing - a non-browser embedder can drive deliverUrl() manually.
  let onUrlChange = options.onUrlChange;
  if (!onUrlChange && browser.addEventListener && browser.removeEventListener) {
    const add = browser.addEventListener.bind(globalThis);
    const remove = browser.removeEventListener.bind(globalThis);
    onUrlChange = (handler: () => void) => {
      add('hashchange', handler);
      return () => remove('hashchange', handler);
    };
  }

  let replaceUrl = options.replaceUrl;
  const history = browser.history;
  if (!replaceUrl && history) {
    replaceUrl = (url: string) => history.replaceState(null, '', url);
  }

  return {
    storage,
    storageKey: options.storageKey ?? WEB_DEEPLINK_STORAGE_KEY,
    opener,
    pageUrl,
    onUrlChange,
    replaceUrl,
  };
}

/** A URL with its fragment removed (the callback base / the cleaned page URL). */
export function stripUrlFragment(url: string): string {
  const hashIndex = url.indexOf('#');
  return hashIndex < 0 ? url : url.slice(0, hashIndex);
}

/** Generate fresh pairing material for a new channel (spec §17: 32-byte topic + key). */
export function createWebDeeplinkRecord(callback: string): WebDeeplinkRecord {
  return {
    v: 1,
    topic: randomToken(32),
    key: bytesToBase64Url(generateSessionKey()),
    callback,
  };
}

/** Load and validate the persisted record; any malformed/corrupt state is discarded (the
 * caller re-pairs fresh) rather than surfaced as an error - storage is self-healing. */
export function loadWebDeeplinkRecord(
  storage: WebDeeplinkStorage,
  storageKey: string
): WebDeeplinkRecord | null {
  const raw = storage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Partial<WebDeeplinkRecord>;
  if (record.v !== 1) {
    return null;
  }
  if (typeof record.topic !== 'string' || record.topic.length === 0) {
    return null;
  }
  if (typeof record.callback !== 'string' || record.callback.length === 0) {
    return null;
  }
  if (record.sessionId !== undefined && typeof record.sessionId !== 'string') {
    return null;
  }
  // The key must decode to exactly one secretbox key, or nothing sealed with it could
  // ever be opened - regenerating the pairing is the only way forward.
  if (typeof record.key !== 'string') {
    return null;
  }
  try {
    if (base64UrlToBytes(record.key).length !== SESSION_KEY_LENGTH) {
      return null;
    }
  } catch {
    return null;
  }
  return record as WebDeeplinkRecord;
}

/** Persist the record (single JSON blob under the storage key). */
export function saveWebDeeplinkRecord(
  storage: WebDeeplinkStorage,
  storageKey: string,
  record: WebDeeplinkRecord
): void {
  storage.setItem(storageKey, JSON.stringify(record));
}
