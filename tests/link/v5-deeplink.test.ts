import {
  buildRequestUrl,
  parseRequestUrl,
  buildResponseUrl,
  parseResponseUrl,
  DeeplinkTransport,
} from '../../src/link/v5/deeplink.js';
import { PhantasmaLink5 } from '../../src/link/v5/client.js';
import { LinkError } from '../../src/link/v5/errors.js';
import { PLV } from '../../src/link/v5/protocol.js';
import {
  generateSessionKey,
  sealEnvelopeText,
  openEnvelopeText,
  EncryptedFrame,
} from '../../src/link/v5/session-crypto.js';

describe('v5 deeplink URLs', () => {
  // Request and response URLs must round-trip the topic and the exact frame string.
  it('round-trips request and response URLs', () => {
    const frame = '{"nonce":"AA==","ct":"AAEC"}';

    const requestUrl = buildRequestUrl('phantasma://', 'topic-1', frame);
    expect(requestUrl.startsWith('phantasma://v5/req#')).toBe(true);
    expect(parseRequestUrl(requestUrl)).toEqual({ topic: 'topic-1', frame });

    const responseUrl = buildResponseUrl('https://dapp.example/play?x=1', 'topic-1', frame);
    expect(responseUrl.startsWith('https://dapp.example/play?x=1#plv=5&')).toBe(true);
    expect(parseResponseUrl(responseUrl)).toEqual({ topic: 'topic-1', frame });
  });

  // A response URL replaces any existing fragment on the callback instead of appending to it.
  it('replaces an existing fragment on the callback', () => {
    const url = buildResponseUrl('https://dapp.example/app#old-route', 't', 'F');
    expect(url).not.toContain('old-route');
    expect(parseResponseUrl(url)?.frame).toBe('F');
  });

  // Foreign URLs are ignored (null), not errors: the dApp feeds EVERY incoming URL here.
  it('returns null for non-v5 URLs', () => {
    expect(parseRequestUrl('https://example.com/other#t=x&f=AA')).toBeNull();
    expect(parseResponseUrl('https://dapp.example/#utm=1')).toBeNull();
    expect(parseResponseUrl('https://dapp.example/#plv=4&t=x&f=AA')).toBeNull();
    expect(parseResponseUrl('https://dapp.example/#plv=5&t=x&f=%%%')).toBeNull();
  });
});

describe('DeeplinkTransport', () => {
  it('sends frames as wallet request URLs and dispatches matching responses', () => {
    const opened: string[] = [];
    const transport = new DeeplinkTransport({ topic: 'top', opener: (url) => opened.push(url) });
    const received: string[] = [];
    transport.onMessage((frame) => received.push(frame));

    transport.send('FRAME-1');
    expect(opened).toHaveLength(1);
    expect(parseRequestUrl(opened[0])).toEqual({ topic: 'top', frame: 'FRAME-1' });

    // A response for ANOTHER topic is left for other handlers; ours is dispatched.
    expect(transport.deliverUrl(buildResponseUrl('https://d.app/', 'other', 'X'))).toBe(false);
    expect(transport.deliverUrl(buildResponseUrl('https://d.app/', 'top', 'R-1'))).toBe(true);
    expect(received).toEqual(['R-1']);
  });

  it('fails fast after close', () => {
    const transport = new DeeplinkTransport({ topic: 't', opener: () => {} });
    transport.close();
    expect(() => transport.send('x')).toThrow(LinkError);
    expect(transport.deliverUrl(buildResponseUrl('https://d.app/', 't', 'F'))).toBe(false);
  });
});

describe('PhantasmaLink5.deeplink (encrypted end-to-end over a fake OS hop)', () => {
  it('requires the pairing session key', () => {
    expect(() =>
      PhantasmaLink5.deeplink({ topic: 't', opener: () => {}, sessionKey: new Uint8Array(8) })
    ).toThrow(LinkError);
  });

  // Full loop: the client seals the envelope, the "wallet" opens it with the pairing key,
  // answers sealed, and the response URL delivers the result back through deliverUrl.
  it('runs a sealed request/response round-trip', async () => {
    const sessionKey = generateSessionKey();
    const urls: string[] = [];
    const client = PhantasmaLink5.deeplink({
      topic: 'topic-9',
      sessionKey,
      opener: (url) => urls.push(url),
    });

    const promise = client.getChains();

    // "Wallet" side: receive the request URL, unseal, answer.
    const request = parseRequestUrl(urls[0])!;
    const envelope = JSON.parse(
      openEnvelopeText(JSON.parse(request.frame) as EncryptedFrame, sessionKey)
    );
    expect(envelope.method).toBe('pha_getChains');
    // Plaintext never appears in the URL.
    expect(urls[0]).not.toContain('pha_getChains');

    const responseEnvelope = JSON.stringify({
      plv: PLV,
      id: envelope.id,
      result: { chains: ['phantasma:simnet'], current: 'phantasma:simnet', nexus: 'simnet' },
    });
    const responseFrame = JSON.stringify(sealEnvelopeText(responseEnvelope, sessionKey));
    const delivered = client.deliverUrl(
      buildResponseUrl('https://dapp.example/', 'topic-9', responseFrame)
    );

    expect(delivered).toBe(true);
    await expect(promise).resolves.toMatchObject({ nexus: 'simnet' });
  });
});
