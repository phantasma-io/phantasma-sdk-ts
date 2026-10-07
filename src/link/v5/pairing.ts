// Phantasma Link v5 - pairing URI build/parse (spec §15). The pairing material rides in the
// URL FRAGMENT (never sent to the server). Two channels decide the key-establishment mode:
//   - `sym`  : a 32-byte session key in the fragment - ONLY for safe channels (a
//              domain-verified universal link, or a QR). Simplest + MITM-proof.
//   - `ecdh` : only the dApp's ephemeral X25519 PUBLIC key - for the hijackable
//              custom-scheme fallback, where no secret may appear.

import { PLV, DEFAULT_LINK_HOST } from './protocol.js';
import { LinkError, LinkErrorCode } from './errors.js';
import { DappMetadata } from './capabilities.js';
import { bytesToBase64Url, base64UrlToBytes, utf8ToBytes, bytesToUtf8 } from './encoding.js';

export type PairingMode = 'sym' | 'ecdh';

// Spec §15: `t` is 32 random bytes in base64url without padding.
const PAIRING_TOPIC = /^[A-Za-z0-9_-]{43}$/;

/** Length in bytes of the symmetric key `sk` and of the X25519 public key `pk` (spec §15, §18). */
const PAIRING_KEY_LENGTH = 32;

/** Returns true if `url` is a `wss://` URL, the only form a pairing relay takes (spec §15). */
function isRelayUrl(url: string): boolean {
  return /^wss:\/\//i.test(url);
}

/** Decodes a base64url key of the pairing URI, or throws `-32600` when it is not 32 bytes. */
function readPairingKey(value: string, name: string): Uint8Array {
  let key: Uint8Array;
  try {
    key = base64UrlToBytes(value);
  } catch {
    throw new LinkError(LinkErrorCode.InvalidRequest, `Pairing URI has a malformed ${name}`);
  }
  if (key.length !== PAIRING_KEY_LENGTH) {
    throw new LinkError(LinkErrorCode.InvalidRequest, `Pairing ${name} must be 32 bytes`);
  }
  return key;
}

/** Reads the `meta` field: base64url of the UTF-8 JSON of the dApp metadata (spec §15). Throws
 * `-32600` when it does not decode to an object with a string `name` and `url`. */
function readPairingMeta(value: string): DappMetadata {
  let meta: unknown;
  try {
    meta = JSON.parse(bytesToUtf8(base64UrlToBytes(value)));
  } catch {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing URI has malformed meta');
  }
  const record = (typeof meta === 'object' && meta !== null ? meta : {}) as Record<string, unknown>;
  if (typeof record['name'] !== 'string' || typeof record['url'] !== 'string') {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing meta needs a name and a url');
  }
  return meta as DappMetadata;
}

/** Returns true if `topic` has the form of a pairing topic: 32 bytes in base64url without
 * padding, 43 characters (spec §15). The relay topics of a pairing are built from it (§16). */
export function isPairingTopic(topic: string): boolean {
  return PAIRING_TOPIC.test(topic);
}

/** Parsed pairing material. */
export interface PairingParams {
  version: number;
  topic: string;
  relay?: string;
  mode: PairingMode;
  /** Present when `mode === 'sym'`. */
  symKey?: Uint8Array;
  /** Present when `mode === 'ecdh'`. */
  dappPublicKey?: Uint8Array;
  /** Where the wallet opens response deeplinks for this pairing (spec §17). */
  callback?: string;
  meta?: DappMetadata;
}

/** Input to {@link buildPairingUri}. */
export interface BuildPairingUriInput {
  topic: string;
  mode: PairingMode;
  symKey?: Uint8Array;
  dappPublicKey?: Uint8Array;
  relay?: string;
  /** dApp URL the wallet opens to deliver deeplink responses (required for deeplink use). */
  callback?: string;
  meta?: DappMetadata;
  /** `universal` (default) => `https://<host>/v5/pair`; `scheme` => `phantasma://v5/pair`. */
  scheme?: 'universal' | 'scheme';
  /** Universal-link host; defaults to {@link DEFAULT_LINK_HOST}. */
  host?: string;
}

/** Build a pairing URI. Refuses every pairing that a wallet would refuse (spec §15): a topic of
 * another form, a relay that is not a `wss://` URL, a key that is not 32 bytes, a symmetric key
 * (a secret) in a hijackable custom-scheme URL, an ecdh pairing without a relay or without
 * `meta`, and a pairing with no way back to the dApp. */
export function buildPairingUri(input: BuildPairingUriInput): string {
  const scheme = input.scheme ?? 'universal';
  if (!isPairingTopic(input.topic)) {
    throw new LinkError(
      LinkErrorCode.InvalidParams,
      'A pairing topic is 32 bytes in base64url (43 characters)'
    );
  }
  if (input.relay !== undefined && !isRelayUrl(input.relay)) {
    throw new LinkError(LinkErrorCode.InvalidParams, 'A pairing relay is a wss:// URL');
  }

  const params = new URLSearchParams();
  params.set('v', String(PLV));
  params.set('t', input.topic);
  if (input.relay) {
    params.set('relay', input.relay);
  }
  if (input.callback) {
    params.set('cb', input.callback);
  }

  if (input.mode === 'sym') {
    if (!input.symKey || input.symKey.length !== PAIRING_KEY_LENGTH) {
      throw new LinkError(LinkErrorCode.InvalidParams, 'sym pairing requires a 32-byte symKey');
    }
    if (scheme === 'scheme') {
      // A scheme-squatting app could read this URL; never expose a secret there.
      throw new LinkError(
        LinkErrorCode.InvalidParams,
        'A symmetric key must not be placed in a custom-scheme URL; use a universal link or QR'
      );
    }
    // Spec §15: the wallet answers over the relay or by opening the callback. Without either
    // the session could never reach the dApp.
    if (!input.relay && !input.callback) {
      throw new LinkError(LinkErrorCode.InvalidParams, 'A pairing needs a relay or a callback');
    }
    params.set('sk', bytesToBase64Url(input.symKey));
  } else {
    if (!input.dappPublicKey || input.dappPublicKey.length !== PAIRING_KEY_LENGTH) {
      throw new LinkError(
        LinkErrorCode.InvalidParams,
        'ecdh pairing requires a 32-byte dappPublicKey'
      );
    }
    // Spec §15: the wallet's public key travels back over the relay, beside the first sealed
    // frame, and the wallet sends that frame only after the user saw the dApp named in `meta`.
    // Without either the dApp would never get the session key.
    if (!input.relay) {
      throw new LinkError(LinkErrorCode.InvalidParams, 'An ecdh pairing needs a relay');
    }
    if (!input.meta) {
      throw new LinkError(LinkErrorCode.InvalidParams, 'An ecdh pairing needs the dApp meta');
    }
    params.set('pk', bytesToBase64Url(input.dappPublicKey));
  }

  if (input.meta) {
    params.set('meta', bytesToBase64Url(utf8ToBytes(JSON.stringify(input.meta))));
  }

  const base =
    scheme === 'scheme'
      ? 'phantasma://v5/pair'
      : `https://${input.host ?? DEFAULT_LINK_HOST}/v5/pair`;

  return `${base}#${params.toString()}`;
}

/** Parse a pairing URI (universal-link or custom-scheme) into {@link PairingParams}. Refuses
 * what spec §15 tells a wallet to refuse: a `v` other than the text `5`, a topic that is not 32
 * bytes in base64url, a `relay` that is not a `wss://` URL, an empty `cb`, both `sk` and `pk` or
 * neither, a key that is not 32 bytes, a symmetric key in a `phantasma://` URL, which a
 * scheme-squatting app could read, an ecdh pairing without a relay or without `meta`, and a
 * pairing with neither a relay nor a callback. */
export function parsePairingUri(uri: string): PairingParams {
  const hashIndex = uri.indexOf('#');
  if (hashIndex < 0) {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing URI has no fragment');
  }
  const params = new URLSearchParams(uri.slice(hashIndex + 1));

  // Spec §15: `v` is the text `5`, so `5.0` or ` 5` is no pairing of this version.
  if (params.get('v') !== String(PLV)) {
    throw new LinkError(
      LinkErrorCode.InvalidRequest,
      `Unsupported pairing version: ${params.get('v')}`
    );
  }
  const version = PLV;

  const topic = params.get('t');
  if (!topic) {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing URI is missing topic');
  }
  // Spec §15: `t` is the bearer capability of the pairing, and the relay topics are built from
  // it. A longer one makes relay topics that a relay refuses, and the relay then closes the
  // connection that a wallet shares between its pairings (§7).
  if (!isPairingTopic(topic)) {
    throw new LinkError(
      LinkErrorCode.InvalidRequest,
      'Pairing topic must be 32 bytes in base64url (43 characters)'
    );
  }

  const relay = params.get('relay') ?? undefined;
  if (relay !== undefined && !isRelayUrl(relay)) {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing relay must be a wss:// URL');
  }
  const callback = params.get('cb') ?? undefined;
  // An empty callback is no way back to the dApp (spec §15).
  if (callback === '') {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing callback is empty');
  }

  const metaRaw = params.get('meta');
  const meta = metaRaw ? readPairingMeta(metaRaw) : undefined;

  const sk = params.get('sk');
  const pk = params.get('pk');
  // Spec §15: a pairing carries exactly one of the two keys; with both, which key the session
  // uses would depend on the reader.
  if (sk !== null && pk !== null) {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing URI carries both sk and pk');
  }
  if (sk) {
    if (/^phantasma:/i.test(uri)) {
      throw new LinkError(
        LinkErrorCode.InvalidRequest,
        'A custom-scheme pairing URI must not carry a symmetric key'
      );
    }
    const symKey = readPairingKey(sk, 'sk');
    if (relay === undefined && callback === undefined) {
      throw new LinkError(
        LinkErrorCode.InvalidRequest,
        'Pairing has neither a relay nor a callback'
      );
    }
    return { version, topic, relay, callback, mode: 'sym', symKey, meta };
  }
  if (pk) {
    const dappPublicKey = readPairingKey(pk, 'pk');
    if (relay === undefined) {
      throw new LinkError(LinkErrorCode.InvalidRequest, 'An ecdh pairing needs a relay');
    }
    if (meta === undefined) {
      throw new LinkError(LinkErrorCode.InvalidRequest, 'An ecdh pairing needs the dApp meta');
    }
    return { version, topic, relay, callback, mode: 'ecdh', dappPublicKey, meta };
  }
  throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing URI carries neither sk nor pk');
}
