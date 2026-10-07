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
import { bytesToBase64Url } from '../../src/link/v5/encoding.js';

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
      scheme: 'scheme',
    });
    expect(uri.startsWith('phantasma://v5/pair#')).toBe(true);
    const parsed = parsePairingUri(uri);
    expect(parsed.mode).toBe('ecdh');
    expect(Array.from(parsed.dappPublicKey!)).toEqual(Array.from(pk));
  });

  // Spec §15: a wallet refuses a `t` that is not 32 bytes in base64url, and the dApp side
  // refuses to build such a pairing.
  it('refuses a topic that is not 32 bytes in base64url', () => {
    const codeOf = (action: () => unknown): number | undefined => {
      try {
        action();
        return undefined;
      } catch (error) {
        return (error as LinkError).code;
      }
    };
    const uri = (topic: string) =>
      `https://link.phantasma.info/v5/pair#v=5&t=${encodeURIComponent(topic)}&sk=AA`;
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
      codeOf(() => buildPairingUri({ topic: 'x', mode: 'sym', symKey: new Uint8Array(32) }))
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
    const base = `https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&sk=AA&relay=`;
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
      parsePairingUri(`https://link.phantasma.info/v5/pair#v=4&t=${TOPIC}&sk=AA`)
    ).toThrow(LinkError);
  });

  // Malformed pairing URIs must fail loudly with LinkError, not half-parse.
  it('rejects pairing URIs missing fragment, topic, key material, or with bad meta', () => {
    expect(() => parsePairingUri('https://link.phantasma.info/v5/pair')).toThrow(LinkError);
    expect(() => parsePairingUri('https://link.phantasma.info/v5/pair#v=5&sk=AA')).toThrow(
      LinkError
    );
    expect(() => parsePairingUri(`https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}`)).toThrow(
      LinkError
    );
    expect(() =>
      parsePairingUri(`https://link.phantasma.info/v5/pair#v=5&t=${TOPIC}&sk=AA&meta=%%%`)
    ).toThrow(LinkError);
  });
});
