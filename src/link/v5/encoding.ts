// Phantasma Link v5 - encoding helpers. The transport carries binary (ciphertext, nonces,
// keys, serialized txs) as base64 (spec §4 / §18), which halves the wire size vs the
// v1-v4 hex. Implemented dependency-free and environment-agnostic (browser + Node), since
// the SDK ships to both and `Buffer`/`btoa` are not uniformly available.

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Reverse lookup table: byte value of each base64 character, or -1 if not a base64 char.
const B64_LOOKUP: Int8Array = (() => {
  const table = new Int8Array(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/** Encode bytes as standard base64 (with `=` padding). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += hasB1 ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : '=';
    out += hasB2 ? B64_ALPHABET[b2 & 0x3f] : '=';
  }
  return out;
}

/** Decode standard or url-safe base64 (padding optional) to bytes. Throws on invalid input
 * so a malformed frame fails loudly rather than silently producing garbage. */
export function base64ToBytes(input: string): Uint8Array {
  // Normalize url-safe alphabet and drop padding; we recompute length from content.
  let clean = '';
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '-') {
      clean += '+';
    } else if (c === '_') {
      clean += '/';
    } else if (c !== '=') {
      clean += c;
    }
  }

  const fullGroups = Math.floor(clean.length / 4);
  const remainder = clean.length % 4;
  if (remainder === 1) {
    throw new Error('Invalid base64 string: dangling character');
  }
  const outLength = fullGroups * 3 + (remainder === 0 ? 0 : remainder - 1);
  const out = new Uint8Array(outLength);

  let o = 0;
  let acc = 0;
  let accBits = 0;
  for (let i = 0; i < clean.length; i++) {
    const v = B64_LOOKUP[clean.charCodeAt(i)];
    if (v < 0) {
      throw new Error('Invalid base64 character');
    }
    acc = (acc << 6) | v;
    accBits += 6;
    if (accBits >= 8) {
      accBits -= 8;
      out[o++] = (acc >> accBits) & 0xff;
    }
  }
  return out;
}

/** Encode bytes as url-safe base64 without padding (for use in URL fragments, spec §15). */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode url-safe (or standard) base64 to bytes; alias of {@link base64ToBytes}, which
 * already accepts both alphabets. */
export function base64UrlToBytes(input: string): Uint8Array {
  return base64ToBytes(input);
}

/** UTF-8 encode a string to bytes (uses TextEncoder, present in all supported runtimes). */
export function utf8ToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** UTF-8 decode bytes to a string. */
export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}
