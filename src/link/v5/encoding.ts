// Phantasma Link v5 - encoding helpers. The transport carries binary (ciphertext, nonces,
// keys, serialized txs) as base64 (spec §4 / §18), which halves the wire size vs the
// v1-v4 hex. Implemented dependency-free and environment-agnostic (browser + Node), since
// the SDK ships to both and `Buffer`/`btoa` are not uniformly available.

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Character codes of {@link B64_ALPHABET}. The encoder writes them into a byte array. */
const B64_CODES: Uint8Array = Uint8Array.from(B64_ALPHABET, (c) => c.charCodeAt(0));

/** Character code of the `=` padding. */
const PAD = 0x3d;

// Reverse lookup table: the 6-bit value of each base64 character, or -1 for any other
// character. The url-safe '-' and '_' map like '+' and '/', so one table decodes both
// alphabets.
const B64_LOOKUP: Int8Array = (() => {
  const table = new Int8Array(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  table[0x2d] = 62; // '-'
  table[0x5f] = 63; // '_'
  return table;
})();

/** Turns the ASCII bytes of the encoder into one string. */
const ASCII_DECODER = new TextDecoder();

/** Encode bytes as standard base64 (with `=` padding). */
export function bytesToBase64(bytes: Uint8Array): string {
  // The text is written as ASCII bytes and turned into a string once. Appending one
  // character at a time makes the engine keep a node per append: a 32 MiB transaction
  // then needed about 1.6 GB of memory.
  const out = new Uint8Array(4 * Math.ceil(bytes.length / 3));
  let o = 0;
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const hasB1 = i + 1 < bytes.length;
    const hasB2 = i + 2 < bytes.length;
    const b1 = hasB1 ? bytes[i + 1] : 0;
    const b2 = hasB2 ? bytes[i + 2] : 0;
    out[o++] = B64_CODES[b0 >> 2];
    out[o++] = B64_CODES[((b0 & 0x03) << 4) | (b1 >> 4)];
    out[o++] = hasB1 ? B64_CODES[((b1 & 0x0f) << 2) | (b2 >> 6)] : PAD;
    out[o++] = hasB2 ? B64_CODES[b2 & 0x3f] : PAD;
  }
  return ASCII_DECODER.decode(out);
}

/** Decode standard or url-safe base64 (padding optional) to bytes. Throws on invalid input
 * so a malformed frame fails loudly rather than silently producing garbage. */
export function base64ToBytes(input: string): Uint8Array {
  // Two passes over the text and no copy of it. The first pass counts the data
  // characters (every '=' is skipped), the second decodes them.
  let dataChars = 0;
  for (let i = 0; i < input.length; i++) {
    if (input.charCodeAt(i) !== PAD) {
      dataChars++;
    }
  }

  const fullGroups = Math.floor(dataChars / 4);
  const remainder = dataChars % 4;
  if (remainder === 1) {
    throw new Error('Invalid base64 string: dangling character');
  }
  const outLength = fullGroups * 3 + (remainder === 0 ? 0 : remainder - 1);
  const out = new Uint8Array(outLength);

  let o = 0;
  let acc = 0;
  let accBits = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === PAD) {
      continue;
    }
    const v = code < 256 ? B64_LOOKUP[code] : -1;
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
