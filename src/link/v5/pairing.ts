// Phantasma Link v5 - pairing URI build/parse (spec §17). The pairing material rides in the
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
  /** Where the wallet opens response deeplinks for this pairing (spec §19). */
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

/** Build a pairing URI. Enforces the security rule that a symmetric key (a secret) must
 * NOT be placed in a hijackable custom-scheme URL (spec §17/§20). */
export function buildPairingUri(input: BuildPairingUriInput): string {
  const scheme = input.scheme ?? 'universal';

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
    if (!input.symKey) {
      throw new LinkError(LinkErrorCode.InvalidParams, 'sym pairing requires symKey');
    }
    if (scheme === 'scheme') {
      // A scheme-squatting app could read this URL; never expose a secret there.
      throw new LinkError(
        LinkErrorCode.InvalidParams,
        'A symmetric key must not be placed in a custom-scheme URL; use a universal link or QR'
      );
    }
    params.set('sk', bytesToBase64Url(input.symKey));
  } else {
    if (!input.dappPublicKey) {
      throw new LinkError(LinkErrorCode.InvalidParams, 'ecdh pairing requires dappPublicKey');
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

/** Parse a pairing URI (universal-link or custom-scheme) into {@link PairingParams}. */
export function parsePairingUri(uri: string): PairingParams {
  const hashIndex = uri.indexOf('#');
  if (hashIndex < 0) {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing URI has no fragment');
  }
  const params = new URLSearchParams(uri.slice(hashIndex + 1));

  const version = Number(params.get('v'));
  if (version !== PLV) {
    throw new LinkError(
      LinkErrorCode.InvalidRequest,
      `Unsupported pairing version: ${params.get('v')}`
    );
  }

  const topic = params.get('t');
  if (!topic) {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing URI is missing topic');
  }

  const relay = params.get('relay') ?? undefined;
  const callback = params.get('cb') ?? undefined;

  let meta: DappMetadata | undefined;
  const metaRaw = params.get('meta');
  if (metaRaw) {
    try {
      meta = JSON.parse(bytesToUtf8(base64UrlToBytes(metaRaw))) as DappMetadata;
    } catch {
      throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing URI has malformed meta');
    }
  }

  const sk = params.get('sk');
  const pk = params.get('pk');
  if (sk) {
    return { version, topic, relay, callback, mode: 'sym', symKey: base64UrlToBytes(sk), meta };
  }
  if (pk) {
    return {
      version,
      topic,
      relay,
      callback,
      mode: 'ecdh',
      dappPublicKey: base64UrlToBytes(pk),
      meta,
    };
  }
  throw new LinkError(LinkErrorCode.InvalidRequest, 'Pairing URI carries neither sk nor pk');
}
