// Phantasma Link v5 - session channel cryptography (spec §8, §18).
//
// Construction (AGREED, FINAL): NaCl `secretbox` (XSalsa20-Poly1305) for every session
// message, under one 32-byte session key, with a 24-byte random nonce per message
// (XSalsa20's 192-bit nonce makes random nonces collision-safe - no counter coordination).
// The session key is either delivered directly as a symmetric key over a safe channel
// (universal link / QR) or derived via X25519 ECDH (NaCl `box.before`) on the
// custom-scheme fallback. Either way the channel is uniform `secretbox` afterwards.
//
// These are EPHEMERAL channel keys only; they are never the account signing key
// (Ed25519/ECDSA stay strictly for signing). All primitives are tweetnacl, already a SDK
// dependency and wire-interoperable with crypto_box / x/crypto/nacl / libsodium / NaCl.Net.

import nacl from 'tweetnacl';
import { LinkError, LinkErrorCode } from './errors.js';
import {
  bytesToBase64,
  base64ToBytes,
  bytesToBase64Url,
  utf8ToBytes,
  bytesToUtf8,
} from './encoding.js';

/** Session/channel key length (32 bytes). */
export const SESSION_KEY_LENGTH = nacl.secretbox.keyLength;
/** Per-message nonce length (24 bytes). */
export const NONCE_LENGTH = nacl.secretbox.nonceLength;
/** X25519 public-key length (32 bytes). */
export const PUBLIC_KEY_LENGTH = nacl.box.publicKeyLength;

/** Domain separator prepended before signing a message. It can never be the prefix of a
 * valid serialized Phantasma transaction, so a `signMessage` signature can never be
 * replayed as a transaction signature (spec §8). */
export const SIGN_MESSAGE_DOMAIN_TAG: Uint8Array = utf8ToBytes('PHANTASMA_LINK_V5_MSG\n');
/** Length of the CSPRNG random the wallet prepends in `signMessage` (spec §8). */
export const SIGN_MESSAGE_RANDOM_LENGTH = 32;

/** An encrypted, on-the-wire frame: the nonce + ciphertext, both base64. */
export interface EncryptedFrame {
  nonce: string;
  ct: string;
}

/** An X25519 keypair for the custom-scheme ECDH pairing path. */
export interface EphemeralKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Generate a fresh 32-byte symmetric session key (primary universal-link / QR path). */
export function generateSessionKey(): Uint8Array {
  return nacl.randomBytes(SESSION_KEY_LENGTH);
}

/** Generate a random url-safe token (default 16 bytes), used for request `id`s and pairing
 * topics. Crypto-random so ids are unguessable as well as unique. */
export function randomToken(byteLength = 16): string {
  return bytesToBase64Url(nacl.randomBytes(byteLength));
}

/** Generate an ephemeral X25519 keypair (custom-scheme ECDH fallback path). */
export function generateEphemeralKeyPair(): EphemeralKeyPair {
  const pair = nacl.box.keyPair();
  return { publicKey: pair.publicKey, secretKey: pair.secretKey };
}

/** Derive the 32-byte session key from the peer's X25519 public key and our secret key
 * (ECDH; NaCl `box.before`). The result is directly usable as a `secretbox` key. */
export function deriveSessionKey(theirPublicKey: Uint8Array, mySecretKey: Uint8Array): Uint8Array {
  if (theirPublicKey.length !== PUBLIC_KEY_LENGTH || mySecretKey.length !== PUBLIC_KEY_LENGTH) {
    throw new LinkError(LinkErrorCode.InternalError, 'Invalid X25519 key length');
  }
  return nacl.box.before(theirPublicKey, mySecretKey);
}

function assertKey(key: Uint8Array): void {
  if (key.length !== SESSION_KEY_LENGTH) {
    throw new LinkError(LinkErrorCode.InternalError, 'Invalid session key length');
  }
}

/** Encrypt arbitrary plaintext bytes into a frame with a fresh random nonce. */
export function seal(plaintext: Uint8Array, key: Uint8Array): EncryptedFrame {
  assertKey(key);
  const nonce = nacl.randomBytes(NONCE_LENGTH);
  const ct = nacl.secretbox(plaintext, nonce, key);
  return { nonce: bytesToBase64(nonce), ct: bytesToBase64(ct) };
}

/** Decrypt a frame back to plaintext bytes. Throws on any tampering/wrong-key (authenticated
 * encryption: `secretbox.open` returns null, which we surface as an error). */
export function open(frame: EncryptedFrame, key: Uint8Array): Uint8Array {
  assertKey(key);
  const nonce = base64ToBytes(frame.nonce);
  if (nonce.length !== NONCE_LENGTH) {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Invalid frame nonce length');
  }
  const ct = base64ToBytes(frame.ct);
  const plaintext = nacl.secretbox.open(ct, nonce, key);
  if (plaintext === null) {
    throw new LinkError(LinkErrorCode.InvalidRequest, 'Failed to decrypt Phantasma Link frame');
  }
  return plaintext;
}

/** Encrypt an envelope's JSON text into a frame. */
export function sealEnvelopeText(json: string, key: Uint8Array): EncryptedFrame {
  return seal(utf8ToBytes(json), key);
}

/** Decrypt a frame back into the envelope's JSON text. */
export function openEnvelopeText(frame: EncryptedFrame, key: Uint8Array): string {
  return bytesToUtf8(open(frame, key));
}

/** Generate the 32 random bytes a wallet prepends in `signMessage`. */
export function generateSignMessageRandom(): Uint8Array {
  return nacl.randomBytes(SIGN_MESSAGE_RANDOM_LENGTH);
}

/**
 * Build the exact byte string a wallet signs for `pha_signMessage`:
 * `DOMAIN_TAG || random || message` (spec §8). A verifier reconstructs the same bytes from
 * the returned `random` + the original `message`. Keeping this in one place guarantees the
 * wallet and any verifier agree on the layout.
 */
export function buildSignMessagePayload(message: Uint8Array, random: Uint8Array): Uint8Array {
  if (random.length !== SIGN_MESSAGE_RANDOM_LENGTH) {
    throw new LinkError(
      LinkErrorCode.InvalidParams,
      `signMessage random must be ${SIGN_MESSAGE_RANDOM_LENGTH} bytes`
    );
  }
  const out = new Uint8Array(SIGN_MESSAGE_DOMAIN_TAG.length + random.length + message.length);
  out.set(SIGN_MESSAGE_DOMAIN_TAG, 0);
  out.set(random, SIGN_MESSAGE_DOMAIN_TAG.length);
  out.set(message, SIGN_MESSAGE_DOMAIN_TAG.length + random.length);
  return out;
}
