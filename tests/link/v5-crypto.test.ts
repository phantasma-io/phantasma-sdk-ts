import nacl from 'tweetnacl';

import {
  bytesToBase64,
  base64ToBytes,
  bytesToBase64Url,
  base64UrlToBytes,
  utf8ToBytes,
  bytesToUtf8,
} from '../../src/link/v5/encoding.js';
import {
  generateSessionKey,
  generateEphemeralKeyPair,
  deriveSessionKey,
  seal,
  open,
  sealEnvelopeText,
  openEnvelopeText,
  buildSignMessagePayload,
  randomToken,
  SIGN_MESSAGE_DOMAIN_TAG,
  SIGN_MESSAGE_RANDOM_LENGTH,
  SESSION_KEY_LENGTH,
  NONCE_LENGTH,
} from '../../src/link/v5/session-crypto.js';
import { LinkError } from '../../src/link/v5/errors.js';

describe('v5 encoding (base64 / base64url)', () => {
  // Round-trips must be exact for the byte ranges the channel actually carries.
  it('round-trips arbitrary bytes through standard base64', () => {
    for (let len = 0; len < 40; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
      expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
    }
  });

  // Known-answer vectors anchor the implementation so other SDKs can match it.
  it('matches known base64 vectors', () => {
    expect(bytesToBase64(utf8ToBytes(''))).toBe('');
    expect(bytesToBase64(utf8ToBytes('f'))).toBe('Zg==');
    expect(bytesToBase64(utf8ToBytes('fo'))).toBe('Zm8=');
    expect(bytesToBase64(utf8ToBytes('foo'))).toBe('Zm9v');
    expect(bytesToBase64(utf8ToBytes('foobar'))).toBe('Zm9vYmFy');
    expect(bytesToUtf8(base64ToBytes('Zm9vYmFy'))).toBe('foobar');
  });

  // base64url must be URL-fragment-safe (no +, /, or = padding).
  it('produces url-safe base64url and decodes it back', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0xbf, 0x00, 0x10]);
    const url = bytesToBase64Url(bytes);
    expect(url).not.toMatch(/[+/=]/);
    expect(Array.from(base64UrlToBytes(url))).toEqual(Array.from(bytes));
  });

  // Malformed input must fail loudly rather than silently yield garbage.
  it('throws on invalid base64', () => {
    expect(() => base64ToBytes('A')).toThrow();
    expect(() => base64ToBytes('====')).not.toThrow(); // all padding -> empty
    expect(() => base64ToBytes('Zm9v!')).toThrow();
  });
});

describe('v5 session-crypto: secretbox channel', () => {
  // The core confidentiality+integrity property: a sealed frame decrypts back exactly.
  it('seals and opens a round-trip with a random nonce', () => {
    const key = generateSessionKey();
    expect(key.length).toBe(SESSION_KEY_LENGTH);
    const plaintext = utf8ToBytes('{"plv":5,"id":"abc","method":"pha_getChains"}');
    const frame = seal(plaintext, key);
    expect(base64ToBytes(frame.nonce).length).toBe(NONCE_LENGTH);
    expect(Array.from(open(frame, key))).toEqual(Array.from(plaintext));
  });

  it('round-trips envelope JSON text', () => {
    const key = generateSessionKey();
    const json = '{"plv":5,"id":"x","result":{"ok":true}}';
    expect(openEnvelopeText(sealEnvelopeText(json, key), key)).toBe(json);
  });

  // Authenticated encryption: tampering or a wrong key must be rejected, not silently
  // accepted - this is what stops a relay/MITM from altering frames.
  it('rejects tampered ciphertext', () => {
    const key = generateSessionKey();
    const frame = seal(utf8ToBytes('hello'), key);
    const ctBytes = base64ToBytes(frame.ct);
    ctBytes[0] ^= 0xff;
    const tampered = { nonce: frame.nonce, ct: bytesToBase64(ctBytes) };
    expect(() => open(tampered, key)).toThrow(LinkError);
  });

  it('rejects a wrong key', () => {
    const frame = seal(utf8ToBytes('hello'), generateSessionKey());
    expect(() => open(frame, generateSessionKey())).toThrow(LinkError);
  });

  // Interop check: a frame produced with a fixed nonce via raw tweetnacl must open with our
  // helper, proving our wire shape equals plain NaCl secretbox (portable to other SDKs).
  it('opens a raw-nacl secretbox frame (cross-impl interop)', () => {
    const key = new Uint8Array(SESSION_KEY_LENGTH).fill(7);
    const nonce = new Uint8Array(NONCE_LENGTH).fill(9);
    const msg = utf8ToBytes('interop');
    const ct = nacl.secretbox(msg, nonce, key);
    const frame = { nonce: bytesToBase64(nonce), ct: bytesToBase64(ct) };
    expect(bytesToUtf8(open(frame, key))).toBe('interop');
  });
});

describe('v5 session-crypto: ECDH (custom-scheme fallback)', () => {
  // Both parties must derive the IDENTICAL session key from each other's public key -
  // this is the NaCl box.before agreement that backs the fallback pairing path.
  it('derives the same session key on both sides', () => {
    const dapp = generateEphemeralKeyPair();
    const wallet = generateEphemeralKeyPair();
    const keyOnDapp = deriveSessionKey(wallet.publicKey, dapp.secretKey);
    const keyOnWallet = deriveSessionKey(dapp.publicKey, wallet.secretKey);
    expect(Array.from(keyOnDapp)).toEqual(Array.from(keyOnWallet));
    expect(keyOnDapp.length).toBe(SESSION_KEY_LENGTH);
    // A frame sealed with the dApp-derived key opens with the wallet-derived key.
    const frame = seal(utf8ToBytes('ok'), keyOnDapp);
    expect(bytesToUtf8(open(frame, keyOnWallet))).toBe('ok');
  });

  it('rejects wrong-length X25519 keys', () => {
    expect(() => deriveSessionKey(new Uint8Array(31), new Uint8Array(32))).toThrow(LinkError);
  });
});

describe('v5 randomToken', () => {
  // Request ids / topics must be url-safe (they ride in URL fragments) and unguessable-unique.
  it('produces url-safe, distinct tokens', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(20);
    expect(a).not.toBe(b);
  });
});

describe('v5 signMessage payload construction', () => {
  // The signed bytes are exactly DOMAIN_TAG || random || message, in that order. This is a
  // deterministic conformance vector other SDKs must reproduce byte-for-byte.
  it('lays out DOMAIN_TAG || random || message', () => {
    expect(bytesToUtf8(SIGN_MESSAGE_DOMAIN_TAG)).toBe('PHANTASMA_LINK_V5_MSG\n');
    const random = new Uint8Array(SIGN_MESSAGE_RANDOM_LENGTH).fill(1);
    const message = new Uint8Array([0xaa, 0xbb]);
    const payload = buildSignMessagePayload(message, random);

    const tagLen = SIGN_MESSAGE_DOMAIN_TAG.length;
    expect(payload.length).toBe(tagLen + SIGN_MESSAGE_RANDOM_LENGTH + message.length);
    expect(Array.from(payload.slice(0, tagLen))).toEqual(Array.from(SIGN_MESSAGE_DOMAIN_TAG));
    expect(Array.from(payload.slice(tagLen, tagLen + SIGN_MESSAGE_RANDOM_LENGTH))).toEqual(
      Array.from(random)
    );
    expect(Array.from(payload.slice(tagLen + SIGN_MESSAGE_RANDOM_LENGTH))).toEqual([0xaa, 0xbb]);
  });

  it('rejects a wrong-length random', () => {
    expect(() => buildSignMessagePayload(new Uint8Array(1), new Uint8Array(16))).toThrow(LinkError);
  });
});
