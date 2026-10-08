import { jest } from '@jest/globals';

import { LinkSessionClient, LinkTransport, SendOptions } from '../../src/link/v5/transport.js';
import { LinkError, LinkErrorCode } from '../../src/link/v5/errors.js';
import { PLV } from '../../src/link/v5/protocol.js';
import {
  generateSessionKey,
  sealEnvelopeText,
  openEnvelopeText,
} from '../../src/link/v5/session-crypto.js';

/** A controllable in-memory transport: captures outgoing frames and lets a test inject
 * incoming frames / a close event. */
class MockTransport implements LinkTransport {
  sent: string[] = [];
  private msgHandler?: (frame: string) => void;
  private closeHandler?: (reason?: string) => void;

  send(frame: string): void {
    this.sent.push(frame);
  }
  onMessage(handler: (frame: string) => void): void {
    this.msgHandler = handler;
  }
  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
  }
  close(): void {}

  inject(frame: string): void {
    this.msgHandler?.(frame);
  }
  triggerClose(reason?: string): void {
    this.closeHandler?.(reason);
  }
}

/** Read the request id of the last outgoing PLAINTEXT envelope. */
function lastRequestId(transport: MockTransport): string {
  const parsed = JSON.parse(transport.sent[transport.sent.length - 1]) as { id: string };
  return parsed.id;
}

describe('LinkSessionClient (plaintext / trusted-local transport)', () => {
  // A success response with the matching id resolves the request's promise with `result`.
  it('correlates a response to its request by id', async () => {
    const transport = new MockTransport();
    const client = new LinkSessionClient(transport);
    const promise = client.request('pha_getChains');
    const id = lastRequestId(transport);
    transport.inject(JSON.stringify({ plv: PLV, id, result: { chains: ['phantasma:mainnet'] } }));
    await expect(promise).resolves.toEqual({ chains: ['phantasma:mainnet'] });
  });

  // An error response rejects with a LinkError carrying the numeric code.
  it('rejects with a LinkError on an error response', async () => {
    const transport = new MockTransport();
    const client = new LinkSessionClient(transport);
    const promise = client.request('pha_sendTransaction', { format: 'carbon', tx: 'AA' });
    const id = lastRequestId(transport);
    transport.inject(
      JSON.stringify({ plv: PLV, id, error: { code: LinkErrorCode.UserRejected, message: 'no' } })
    );
    await expect(promise).rejects.toMatchObject({ code: LinkErrorCode.UserRejected });
  });

  // Spec §4, §9.8: every request carries the time it was sent, so a wallet can tell an old copy
  // of a request from a new one.
  it('stamps each request with the time it was sent', () => {
    const transport = new MockTransport();
    const client = new LinkSessionClient(transport);
    const before = Date.now();
    void client.request('pha_getChains').catch(() => undefined);
    const after = Date.now();
    const sent = JSON.parse(transport.sent[0]) as { sentAt?: unknown };
    expect(typeof sent.sentAt).toBe('number');
    expect(sent.sentAt as number).toBeGreaterThanOrEqual(before);
    expect(sent.sentAt as number).toBeLessThanOrEqual(after);
    client.close();
  });

  // Responses for an unknown id must be ignored without throwing.
  it('ignores responses with an unknown id', () => {
    const transport = new MockTransport();
    new LinkSessionClient(transport);
    expect(() =>
      transport.inject(JSON.stringify({ plv: PLV, id: 'nope', result: 1 }))
    ).not.toThrow();
  });

  // Events are delivered to subscribers (and only valid events).
  it('dispatches events to handlers', () => {
    const transport = new MockTransport();
    const client = new LinkSessionClient(transport);
    const seen: Array<{ event: string; data: unknown }> = [];
    client.onEvent((event, data) => seen.push({ event, data }));
    transport.inject(
      JSON.stringify({ plv: PLV, type: 'event', event: 'pha_chainChanged', data: { chain: 'x' } })
    );
    expect(seen).toEqual([{ event: 'pha_chainChanged', data: { chain: 'x' } }]);
  });

  // Closing the transport rejects everything still in flight.
  it('rejects pending requests when the transport closes', async () => {
    const transport = new MockTransport();
    const client = new LinkSessionClient(transport);
    const promise = client.request('pha_getAccounts');
    transport.triggerClose('gone');
    await expect(promise).rejects.toBeInstanceOf(LinkError);
  });

  // A request after close fails fast rather than hanging.
  it('fails fast when used after close', async () => {
    const transport = new MockTransport();
    const client = new LinkSessionClient(transport);
    client.close();
    await expect(client.request('pha_getChains')).rejects.toMatchObject({
      code: LinkErrorCode.Disconnected,
    });
  });

  // A request that is never answered times out with 5005 (spec §10), the code that tells a
  // waiting user from a lost connection (fake timers keep the test instant).
  it('times out an unanswered request with 5005', async () => {
    jest.useFakeTimers();
    try {
      const transport = new MockTransport();
      const client = new LinkSessionClient(transport, { requestTimeoutMs: 1000 });
      const promise = client.request('pha_getChains');
      const assertion = expect(promise).rejects.toMatchObject({ code: LinkErrorCode.Timeout });
      jest.advanceTimersByTime(1000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  // Spec §10: 5005 means that the wallet was reached and did not answer in time. The upload of
  // a large request here takes longer than the timeout, which counts from its last part.
  it('counts the request timeout from the last part that left the device', async () => {
    jest.useFakeTimers();
    try {
      const transport = new MockTransport();
      let progress: (() => void) | undefined;
      transport.send = (frame: string, options?: SendOptions) => {
        transport.sent.push(frame);
        progress = options?.onProgress;
      };
      const client = new LinkSessionClient(transport, { requestTimeoutMs: 1000 });
      let outcome: unknown;
      client.request('pha_signTransaction').then(
        () => (outcome = 'answered'),
        (error: LinkError) => (outcome = error.code)
      );
      for (let part = 0; part < 5; part++) {
        await jest.advanceTimersByTimeAsync(600);
        progress?.();
      }
      await jest.advanceTimersByTimeAsync(999);
      expect(outcome).toBeUndefined();
      await jest.advanceTimersByTimeAsync(1);
      expect(outcome).toBe(LinkErrorCode.Timeout);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('LinkSessionClient robustness', () => {
  // Garbage incoming frames are dropped without crashing or settling pending requests; the
  // real response afterwards still resolves them.
  it('survives undecodable frames and still resolves the real response', async () => {
    const transport = new MockTransport();
    const client = new LinkSessionClient(transport);
    const promise = client.request('pha_getChains');
    const id = lastRequestId(transport);

    expect(() => transport.inject('complete garbage')).not.toThrow();
    expect(() => transport.inject('{"plv":9,"id":"zzz"}')).not.toThrow();

    transport.inject(JSON.stringify({ plv: PLV, id, result: { ok: 1 } }));
    await expect(promise).resolves.toEqual({ ok: 1 });
  });

  // A transport whose send() rejects must settle the request with Disconnected, not hang it.
  it('settles the pending request when send() rejects', async () => {
    const transport = new MockTransport();
    transport.send = () => Promise.reject(new Error('net down'));
    const client = new LinkSessionClient(transport);

    await expect(client.request('pha_getChains')).rejects.toMatchObject({
      code: LinkErrorCode.Disconnected,
      message: 'net down',
    });
  });

  // A transport that knows why it failed says so with a LinkError, and the caller gets
  // that code and its data, for example 5001 for a frame above the relay budget.
  it('keeps the code of a LinkError that send() rejects with', async () => {
    const transport = new MockTransport();
    transport.send = () =>
      Promise.reject(
        new LinkError(LinkErrorCode.PayloadTooLarge, 'too big', { maxPayloadBytes: 1 })
      );
    const client = new LinkSessionClient(transport);

    await expect(client.request('pha_getChains')).rejects.toMatchObject({
      code: LinkErrorCode.PayloadTooLarge,
      data: { maxPayloadBytes: 1 },
    });
  });

  // A transport that refuses at once (a deeplink above the URL budget) settles the request
  // with its error, and no timer is left to fire on a promise that nobody holds.
  it('settles the pending request when send() throws', async () => {
    jest.useFakeTimers();
    try {
      const transport = new MockTransport();
      transport.send = () => {
        throw new LinkError(LinkErrorCode.PayloadTooLarge, 'too long', { maxPayloadBytes: 3072 });
      };
      const client = new LinkSessionClient(transport, { requestTimeoutMs: 1000 });

      const request = client.request('pha_getChains');
      await expect(request).rejects.toMatchObject({ code: LinkErrorCode.PayloadTooLarge });
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  // The relay hands its frames again to every new subscription (spec §16): an answer that
  // comes twice is handled once.
  it('handles a repeated answer once', async () => {
    const transport = new MockTransport();
    const unmatched: string[] = [];
    const client = new LinkSessionClient(transport, {
      onUnmatchedResponse: (response) => unmatched.push(response.id),
    });
    const promise = client.request('pha_getChains');
    const answer = JSON.stringify({ plv: PLV, id: lastRequestId(transport), result: { n: 1 } });
    transport.inject(answer);
    transport.inject(answer);
    await expect(promise).resolves.toEqual({ n: 1 });

    const late = JSON.stringify({ plv: PLV, id: 'lost-page', result: { n: 2 } });
    transport.inject(late);
    transport.inject(late);
    expect(unmatched).toEqual(['lost-page']);
  });

  // One throwing event handler must not prevent other handlers from receiving the event.
  it('isolates exceptions thrown by event handlers', () => {
    const transport = new MockTransport();
    const client = new LinkSessionClient(transport);
    const seen: string[] = [];
    client.onEvent(() => {
      throw new Error('bad handler');
    });
    client.onEvent((event) => seen.push(event));

    transport.inject(JSON.stringify({ plv: PLV, type: 'event', event: 'pha_chainChanged' }));

    expect(seen).toEqual(['pha_chainChanged']);
  });
});

describe('LinkSessionClient (encrypted channel)', () => {
  // With a session key set, outgoing envelopes are sealed and incoming frames are opened -
  // the request/response correlation must still work end-to-end through encryption.
  it('seals outgoing and opens incoming frames', async () => {
    const key = generateSessionKey();
    const transport = new MockTransport();
    const client = new LinkSessionClient(transport, { sessionKey: key, sessionId: 's1' });

    const promise = client.request('pha_getWalletInfo');

    // The wire frame must be ciphertext, not the plaintext envelope.
    const wireFrame = transport.sent[transport.sent.length - 1];
    expect(wireFrame).not.toContain('pha_getWalletInfo');
    const envelopeJson = openEnvelopeText(JSON.parse(wireFrame), key);
    const sentEnvelope = JSON.parse(envelopeJson) as { id: string; session?: string };
    expect(sentEnvelope.session).toBe('s1');

    // Inject a correctly-sealed response addressed to the same id.
    const responseFrame = sealEnvelopeText(
      JSON.stringify({ plv: PLV, id: sentEnvelope.id, result: { name: 'Wallet' } }),
      key
    );
    transport.inject(JSON.stringify(responseFrame));

    await expect(promise).resolves.toEqual({ name: 'Wallet' });
  });
});
