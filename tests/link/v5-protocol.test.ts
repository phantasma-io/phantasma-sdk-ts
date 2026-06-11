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
  // The symmetric (universal-link) path carries the session key in the fragment.
  it('round-trips a sym universal-link pairing', () => {
    const symKey = new Uint8Array(32).fill(5);
    const uri = buildPairingUri({
      topic: 'topic-123',
      mode: 'sym',
      symKey,
      relay: 'link.phantasma.info',
      meta: { name: 'dApp', url: 'https://d.app' },
    });
    expect(uri.startsWith('https://link.phantasma.info/v5/pair#')).toBe(true);

    const parsed: PairingParams = parsePairingUri(uri);
    expect(parsed.version).toBe(PLV);
    expect(parsed.topic).toBe('topic-123');
    expect(parsed.mode).toBe('sym');
    expect(Array.from(parsed.symKey!)).toEqual(Array.from(symKey));
    expect(parsed.meta?.name).toBe('dApp');
  });

  // The custom-scheme fallback carries only the dApp public key (no secret).
  it('round-trips an ecdh custom-scheme pairing', () => {
    const pk = new Uint8Array(32).fill(9);
    const uri = buildPairingUri({ topic: 't', mode: 'ecdh', dappPublicKey: pk, scheme: 'scheme' });
    expect(uri.startsWith('phantasma://v5/pair#')).toBe(true);
    const parsed = parsePairingUri(uri);
    expect(parsed.mode).toBe('ecdh');
    expect(Array.from(parsed.dappPublicKey!)).toEqual(Array.from(pk));
  });

  // Security rule (spec §17/§20): never place a secret in a hijackable custom-scheme URL.
  it('refuses to put a symmetric key in a custom-scheme URL', () => {
    expect(() =>
      buildPairingUri({ topic: 't', mode: 'sym', symKey: new Uint8Array(32), scheme: 'scheme' })
    ).toThrow(LinkError);
  });

  it('rejects a pairing URI with the wrong version', () => {
    expect(() => parsePairingUri('https://link.phantasma.info/v5/pair#v=4&t=x&sk=AA')).toThrow(
      LinkError
    );
  });

  // Malformed pairing URIs must fail loudly with LinkError, not half-parse.
  it('rejects pairing URIs missing fragment, topic, key material, or with bad meta', () => {
    expect(() => parsePairingUri('https://link.phantasma.info/v5/pair')).toThrow(LinkError);
    expect(() => parsePairingUri('https://link.phantasma.info/v5/pair#v=5&sk=AA')).toThrow(
      LinkError
    );
    expect(() => parsePairingUri('https://link.phantasma.info/v5/pair#v=5&t=x')).toThrow(LinkError);
    expect(() =>
      parsePairingUri('https://link.phantasma.info/v5/pair#v=5&t=x&sk=AA&meta=%%%')
    ).toThrow(LinkError);
  });
});
