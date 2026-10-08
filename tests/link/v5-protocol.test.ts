import {
  encodeEnvelope,
  decodeEnvelope,
  isLinkRequest,
  isLinkEvent,
  isLinkErrorResponse,
  isLinkSuccessResponse,
  LinkRequest,
} from '../../src/link/v5/envelope.js';
import { LinkError, LinkErrorCode } from '../../src/link/v5/errors.js';
import { PLV } from '../../src/link/v5/protocol.js';
import { buildPairingUri, parsePairingUri, PairingParams } from '../../src/link/v5/pairing.js';
import { bytesToBase64Url, utf8ToBytes } from '../../src/link/v5/encoding.js';

describe('v5 envelope encode/decode', () => {
  // A request envelope must survive a JSON round-trip and be recognized as a request.
  it('round-trips a request and classifies it', () => {
    const request: LinkRequest = {
      plv: PLV,
      id: 'r1',
      session: 's1',
      method: 'pha_signTransaction',
      params: { format: 'carbon', tx: 'AAAA' },
    };
    const decoded = decodeEnvelope(encodeEnvelope(request));
    expect(isLinkRequest(decoded)).toBe(true);
    expect(decoded).toEqual(request);
  });

  it('classifies success, error, and event messages', () => {
    expect(isLinkSuccessResponse(decodeEnvelope('{"plv":5,"id":"a","result":{"x":1}}'))).toBe(true);
    expect(
      isLinkErrorResponse(decodeEnvelope('{"plv":5,"id":"a","error":{"code":4001,"message":"no"}}'))
    ).toBe(true);
    expect(
      isLinkEvent(decodeEnvelope('{"plv":5,"type":"event","event":"pha_chainChanged","data":{}}'))
    ).toBe(true);
  });

  // Validation happens once, in decode, so downstream code can trust the shape.
  it('rejects non-JSON with ParseError', () => {
    expect.assertions(2);
    try {
      decodeEnvelope('not json');
    } catch (err) {
      expect(err).toBeInstanceOf(LinkError);
      expect((err as LinkError).code).toBe(LinkErrorCode.ParseError);
    }
  });

  it('rejects a wrong protocol version', () => {
    expect(() => decodeEnvelope('{"plv":4,"id":"a","result":1}')).toThrow(LinkError);
  });

  it('rejects a non-event envelope without an id', () => {
    expect(() => decodeEnvelope('{"plv":5,"method":"pha_getChains"}')).toThrow(LinkError);
  });

  it('rejects a shape that is neither request, response, nor event', () => {
    expect(() => decodeEnvelope('{"plv":5,"id":"a"}')).toThrow(LinkError);
  });

  // Spec §4: an id holds at most 128 characters, because the wallet keeps the ids it saw.
  it('refuses an id longer than 128 characters with -32600', () => {
    const request = (id: string) => `{"plv":5,"id":"${id}","method":"pha_getChains"}`;
    expect((decodeEnvelope(request('i'.repeat(128))) as LinkRequest).id).toHaveLength(128);
    let code: number | undefined;
    try {
      decodeEnvelope(request('i'.repeat(129)));
    } catch (error) {
      code = (error as LinkError).code;
    }
    expect(code).toBe(LinkErrorCode.InvalidRequest);
  });
});

describe('v5 request send time', () => {
  // Spec §4: `sentAt` is Unix milliseconds. A request with another value is malformed; a request
  // without it stays valid and only never qualifies for a signature without a prompt (§9.8).
  it('accepts a numeric sentAt or none and refuses any other value', () => {
    const request = (sentAt: string) =>
      `{"plv":5,"id":"a","method":"pha_getChains"${sentAt === '' ? '' : `,"sentAt":${sentAt}`}}`;
    expect((decodeEnvelope(request('1800000000000')) as LinkRequest).sentAt).toBe(
      1_800_000_000_000
    );
    expect((decodeEnvelope(request('')) as LinkRequest).sentAt).toBeUndefined();
    for (const value of ['"1800000000000"', '{}']) {
      expect(() => decodeEnvelope(request(value))).toThrow(LinkError);
    }
  });

  // Spec §4: in a request, a field of the envelope or of `params` set to null counts as absent.
  it('reads a request field set to null as absent', () => {
    const decoded = decodeEnvelope(
      '{"plv":5,"id":"a","method":"pha_signTransaction","session":null,"sentAt":null,' +
        '"params":{"format":"script","tx":"AA==","signatureKind":null}}'
    ) as LinkRequest;
    expect(decoded).toEqual({
      plv: 5,
      id: 'a',
      method: 'pha_signTransaction',
      params: { format: 'script', tx: 'AA==' },
    });
    expect(
      decodeEnvelope('{"plv":5,"id":"a","method":"pha_getChains","params":null}')
    ).not.toHaveProperty('params');
  });
});

describe('v5 LinkError serialization', () => {
  // The wire object carries the numeric code so callers branch on it, not on text.
  it('omits data when undefined and preserves it otherwise', () => {
    expect(new LinkError(4001, 'rejected').toObject()).toEqual({ code: 4001, message: 'rejected' });
    expect(new LinkError(5001, 'too big', { max: 10 }).toObject()).toEqual({
      code: 5001,
      message: 'too big',
      data: { max: 10 },
    });
  });

  it('reconstructs from a received object and tolerates garbage', () => {
    const err = LinkError.fromObject({ code: 5100, message: 'expired' });
    expect(err).toBeInstanceOf(LinkError);
    expect(err.code).toBe(5100);
    expect(LinkError.fromObject(null).code).toBe(LinkErrorCode.InternalError);
  });
});

describe('v5 pairing URI', () => {
  // A topic of the form spec §15 gives `t`: 32 bytes in base64url, 43 characters.
  const TOPIC = bytesToBase64Url(new Uint8Array(32).fill(3));
  // A 32-byte key, as `sk` and `pk` must be (spec §15), and a relay for the hand-built URIs.
  const KEY = bytesToBase64Url(new Uint8Array(32).fill(7));
  const RELAY = encodeURIComponent('wss://relay.example');
  const META = bytesToBase64Url(
    utf8ToBytes(JSON.stringify({ name: 'dApp', url: 'https://d.app' }))
  );

  /** Returns the code of the LinkError that `action` throws, or undefined when it throws none. */
  const codeOf = (action: () => unknown): number | undefined => {
    try {
      action();
      return undefined;
    } catch (error) {
      return (error as LinkError).code;
    }
  };

  // The symmetric (universal-link) path carries the session key in the fragment.
  it('round-trips a sym universal-link pairing', () => {
    const symKey = new Uint8Array(32).fill(5);
    const uri = buildPairingUri({
      topic: TOPIC,
      mode: 'sym',
      symKey,
      relay: 'wss://link.phantasma.info/relay',
      meta: { name: 'dApp', url: 'https://d.app' },
    });
    expect(uri.startsWith('https://link.phantasma.info/v5/pair#')).toBe(true);

    const parsed: PairingParams = parsePairingUri(uri);
    expect(parsed.version).toBe(PLV);
    expect(parsed.topic).toBe(TOPIC);
    expect(parsed.relay).toBe('wss://link.phantasma.info/relay');
    expect(parsed.mode).toBe('sym');
    expect(Array.from(parsed.symKey!)).toEqual(Array.from(symKey));
    expect(parsed.meta?.name).toBe('dApp');
  });

  // The custom-scheme fallback carries only the dApp public key (no secret).
  it('round-trips an ecdh custom-scheme pairing', () => {
    const pk = new Uint8Array(32).fill(9);
    const uri = buildPairingUri({
      topic: TOPIC,
      mode: 'ecdh',
      dappPublicKey: pk,
      relay: 'wss://relay.example',
      meta: { name: 'dApp', url: 'https://d.app' },
      scheme: 'scheme',
    });
    expect(uri.startsWith('phantasma://v5/pair#')).toBe(true);
    const parsed = parsePairingUri(uri);
    expect(parsed.mode).toBe('ecdh');
    expect(Array.from(parsed.dappPublicKey!)).toEqual(Array.from(pk));
    expect(parsed.meta).toEqual({ name: 'dApp', url: 'https://d.app' });
  });

  // Spec §15: the wallet returns its key over the relay, after the user saw the dApp named in
  // `meta`. An ecdh pairing without either could never finish, so neither side accepts one.
  it('refuses an ecdh pairing without a relay or without meta', () => {
    const pk = new Uint8Array(32).fill(9);
    const meta = { name: 'dApp', url: 'https://d.app' };
    const relay = 'wss://relay.example';
    expect(
      codeOf(() => buildPairingUri({ topic: TOPIC, mode: 'ecdh', dappPublicKey: pk, meta }))
    ).toBe(LinkErrorCode.InvalidParams);
    expect(
      codeOf(() => buildPairingUri({ topic: TOPIC, mode: 'ecdh', dappPublicKey: pk, relay }))
    ).toBe(LinkErrorCode.InvalidParams);
    const uri = (fragment: string) => `phantasma://v5/pair#v=5&t=${TOPIC}&pk=${KEY}${fragment}`;
    expect(codeOf(() => parsePairingUri(uri(`&meta=${META}`)))).toBe(LinkErrorCode.InvalidRequest);
    expect(codeOf(() => parsePairingUri(uri(`&relay=${RELAY}`)))).toBe(
      LinkErrorCode.InvalidRequest
    );
    expect(parsePairingUri(uri(`&relay=${RELAY}&meta=${META}`)).mode).toBe('ecdh');
  });

  // Spec §15: the wallet answers over the relay or by opening the callback; a pairing with
  // neither has no way back to the dApp.
  it('refuses a pairing with neither a relay nor a callback', () => {
    const symKey = new Uint8Array(32).fill(5);
    expect(codeOf(() => buildPairingUri({ topic: TOPIC, mode: 'sym', symKey }))).toBe(
      LinkErrorCode.InvalidParams
    );
    const base = `https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&sk=${KEY}`;
    expect(codeOf(() => parsePairingUri(base))).toBe(LinkErrorCode.InvalidRequest);
    expect(parsePairingUri(`${base}&cb=${encodeURIComponent('https://d.app/')}`).mode).toBe('sym');
  });

  // Spec §15: `sk` and `pk` are 32 bytes. A key of another length, or text that is no base64,
  // fails as a LinkError before any key is used.
  it('refuses a key that is not 32 bytes in either direction', () => {
    const short = new Uint8Array(31);
    expect(
      codeOf(() =>
        buildPairingUri({ topic: TOPIC, mode: 'sym', symKey: short, relay: 'wss://relay.example' })
      )
    ).toBe(LinkErrorCode.InvalidParams);
    const base = `https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&relay=${RELAY}`;
    expect(codeOf(() => parsePairingUri(`${base}&sk=AA`))).toBe(LinkErrorCode.InvalidRequest);
    expect(codeOf(() => parsePairingUri(`${base}&sk=%3F%3F`))).toBe(LinkErrorCode.InvalidRequest);
    expect(
      codeOf(() =>
        parsePairingUri(`phantasma://v5/pair#v=5&t=${TOPIC}&relay=${RELAY}&meta=${META}&pk=AA`)
      )
    ).toBe(LinkErrorCode.InvalidRequest);
  });

  // Spec §15: the dApp builds only a pairing that a wallet accepts, so a plain relay is refused
  // when the URI is built, too.
  it('refuses to build a pairing whose relay is not a wss URL', () => {
    expect(
      codeOf(() =>
        buildPairingUri({
          topic: TOPIC,
          mode: 'sym',
          symKey: new Uint8Array(32),
          relay: 'ws://relay.example',
        })
      )
    ).toBe(LinkErrorCode.InvalidParams);
  });

  // Spec §15: `meta` is the base64url of the UTF-8 JSON of the dApp metadata, with a name and
  // a url; anything else is refused.
  it('refuses meta without a name and a url', () => {
    const noName = bytesToBase64Url(utf8ToBytes(JSON.stringify({ url: 'https://d.app' })));
    const base = `https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&sk=${KEY}&relay=${RELAY}`;
    expect(codeOf(() => parsePairingUri(`${base}&meta=${noName}`))).toBe(
      LinkErrorCode.InvalidRequest
    );
    expect(parsePairingUri(`${base}&meta=${META}`).meta?.name).toBe('dApp');
  });

  // Spec §15: a wallet refuses a `t` that is not 32 bytes in base64url, and the dApp side
  // refuses to build such a pairing.
  it('refuses a topic that is not 32 bytes in base64url', () => {
    const uri = (topic: string) =>
      `https://link.phantasma.info/v5/pair#v=5&t=${encodeURIComponent(topic)}&sk=${KEY}&relay=${RELAY}`;
    expect(parsePairingUri(uri(TOPIC)).topic).toBe(TOPIC);
    for (const topic of [
      TOPIC.slice(1),
      `${TOPIC}A`,
      `${TOPIC.slice(1)}=`,
      `${TOPIC.slice(1)}.`,
      'x'.repeat(122),
    ]) {
      expect(codeOf(() => parsePairingUri(uri(topic)))).toBe(LinkErrorCode.InvalidRequest);
    }
    expect(
      codeOf(() =>
        buildPairingUri({
          topic: 'x',
          mode: 'sym',
          symKey: new Uint8Array(32),
          relay: 'wss://relay.example',
        })
      )
    ).toBe(LinkErrorCode.InvalidParams);
  });

  // Security rule (spec §17/§20): never place a secret in a hijackable custom-scheme URL.
  it('refuses to put a symmetric key in a custom-scheme URL', () => {
    expect(() =>
      buildPairingUri({ topic: TOPIC, mode: 'sym', symKey: new Uint8Array(32), scheme: 'scheme' })
    ).toThrow(LinkError);
  });

  // Spec §15: a wallet refuses a secret in a custom-scheme URL even when a dApp built one by hand.
  it('rejects a custom-scheme pairing URI that carries a symmetric key', () => {
    const sk = bytesToBase64Url(new Uint8Array(32));
    expect(() => parsePairingUri(`phantasma://v5/pair#v=5&t=${TOPIC}&sk=${sk}`)).toThrow(LinkError);
  });

  // Spec §15: the relay is a wss:// URL; a plain ws:// relay would expose the topic and the frames.
  it('rejects a pairing URI whose relay is not a wss URL', () => {
    const base = `https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&sk=${KEY}&relay=`;
    expect(() => parsePairingUri(`${base}${encodeURIComponent('ws://relay.example')}`)).toThrow(
      LinkError
    );
    expect(() => parsePairingUri(`${base}relay.example`)).toThrow(LinkError);
    expect(parsePairingUri(`${base}${encodeURIComponent('wss://relay.example')}`).relay).toBe(
      'wss://relay.example'
    );
  });

  it('rejects a pairing URI with the wrong version', () => {
    expect(() =>
      parsePairingUri(`https://link.phantasma.info/v5/pair#v=4&t=${TOPIC}&sk=${KEY}&relay=${RELAY}`)
    ).toThrow(LinkError);
    // Spec §15: `v` is the text `5`; a number that only reads as 5 is another version.
    expect(() =>
      parsePairingUri(
        `https://link.phantasma.info/v5/pair#v=5.0&t=${TOPIC}&sk=${KEY}&relay=${RELAY}`
      )
    ).toThrow(LinkError);
  });

  // Spec §15: a pairing carries exactly one of `sk` and `pk`, and a `cb` that is present is not
  // empty. Readers that picked one key, or took an empty callback as a way back, would disagree.
  it('rejects a pairing URI with both keys or with an empty callback', () => {
    const both = `https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&sk=${KEY}&pk=${KEY}&relay=${RELAY}&meta=${META}`;
    expect(codeOf(() => parsePairingUri(both))).toBe(LinkErrorCode.InvalidRequest);
    const emptyCb = `https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&sk=${KEY}&cb=`;
    expect(codeOf(() => parsePairingUri(emptyCb))).toBe(LinkErrorCode.InvalidRequest);
    expect(codeOf(() => parsePairingUri(`${emptyCb}&relay=${RELAY}`))).toBe(
      LinkErrorCode.InvalidRequest
    );
  });

  // Malformed pairing URIs must fail loudly with LinkError, not half-parse.
  it('rejects pairing URIs missing fragment, topic, key material, or with bad meta', () => {
    expect(() => parsePairingUri('https://link.phantasma.info/v5/pair')).toThrow(LinkError);
    expect(() =>
      parsePairingUri(`https://link.phantasma.info/v5/pair#v=5&sk=${KEY}&relay=${RELAY}`)
    ).toThrow(LinkError);
    expect(() =>
      parsePairingUri(`https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&relay=${RELAY}`)
    ).toThrow(LinkError);
    expect(() =>
      parsePairingUri(
        `https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&sk=${KEY}&relay=${RELAY}&meta=%%%`
      )
    ).toThrow(LinkError);
  });
});
