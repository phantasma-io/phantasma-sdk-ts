import { jest } from '@jest/globals';
import { RelayTransport, DEFAULT_RELAY_URL } from '../../src/link/v5/relay-transport.js';
import { WebSocketLike } from '../../src/link/v5/loopback-transport.js';
import { PhantasmaLink5 } from '../../src/link/v5/client.js';
import { LinkError, LinkErrorCode } from '../../src/link/v5/errors.js';
import { PLV } from '../../src/link/v5/protocol.js';
import {
  generateSessionKey,
  generateEphemeralKeyPair,
  deriveSessionKey,
  sealEnvelopeText,
  openEnvelopeText,
  EncryptedFrame,
} from '../../src/link/v5/session-crypto.js';
import { bytesToBase64, bytesToBase64Url } from '../../src/link/v5/encoding.js';
import { parsePairingUri } from '../../src/link/v5/pairing.js';

/** A controllable WebSocket double; tests play the relay server. */
class FakeSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { reason?: string; wasClean?: boolean }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  constructor(public url: string) {}
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.({});
  }
  sentJson(): Array<Record<string, unknown>> {
    return this.sent.map((text) => JSON.parse(text));
  }
}

/** Lets the transport's send loop run until it has handed the next chunk to the socket. */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function harness(options: Partial<ConstructorParameters<typeof RelayTransport>[0]> = {}) {
  const sockets: FakeSocket[] = [];
  const transport = new RelayTransport({
    topic: 'top-1',
    webSocketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    ...options,
  });
  const received: string[] = [];
  transport.onMessage((frame) => received.push(frame));
  return { transport, sockets, received };
}

describe('RelayTransport', () => {
  // The transport must announce itself on the topic the moment the socket opens, and a
  // publish resolves only when the relay acks it (the delivery guarantee callers rely on).
  it('subscribes on open and resolves sends on ack', async () => {
    const { transport, sockets } = harness();
    const socket = sockets[0];
    expect(socket.url).toBe(DEFAULT_RELAY_URL);

    socket.open();
    expect(socket.sentJson()[0]).toEqual({ op: 'subscribe', topic: 'top-1' });

    const sendPromise = transport.send('FRAME-1');
    const publish = socket.sentJson()[1];
    expect(publish).toEqual({ op: 'publish', topic: 'top-1', id: 'p1', payload: 'FRAME-1' });

    let settled = false;
    void sendPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false); // no ack yet

    socket.receive({ op: 'ack', topic: 'top-1', id: 'p1' });
    await expect(sendPromise).resolves.toBeUndefined();
  });

  // A publish the relay refuses (an error frame with the publish id) fails with 4900: the
  // wallet cannot be reached through the relay (spec §10). The relay's reason is kept.
  it('fails a refused publish with 4900', async () => {
    const { transport, sockets } = harness();
    const socket = sockets[0];
    socket.open();

    const sendPromise = transport.send('FRAME-1');
    socket.receive({ op: 'error', code: 'bad_topic', message: 'Invalid topic', id: 'p1' });
    await expect(sendPromise).rejects.toMatchObject({
      code: LinkErrorCode.Disconnected,
      message: 'Invalid topic',
    });
  });

  // A refused subscription (topic_limit, no publish id) means that no answer can ever arrive
  // on this topic: the transport ends, every request in flight fails with 4900, and the
  // session layer learns the reason (spec §16).
  it('ends the transport when the relay refuses the subscription', async () => {
    const { transport, sockets } = harness({ log: () => {} });
    const closed: Array<string | undefined> = [];
    transport.onClose((reason) => closed.push(reason));
    const socket = sockets[0];
    socket.open();

    const sendPromise = transport.send('FRAME-1');
    socket.receive({ op: 'error', code: 'topic_limit', message: 'Too many topics' });
    await expect(sendPromise).rejects.toMatchObject({ code: LinkErrorCode.Disconnected });
    expect(closed).toHaveLength(1);
    expect(closed[0]).toContain('topic_limit');
    await expect(transport.send('FRAME-2')).rejects.toMatchObject({
      code: LinkErrorCode.Disconnected,
    });
  });

  // Any other error without a publish id (here the rate limit) fails the publishes in flight
  // with 4900, so they are not re-sent into the same limit; the transport stays usable.
  it('fails the publishes in flight on a relay error without a publish id', async () => {
    const { transport, sockets } = harness({ log: () => {} });
    const socket = sockets[0];
    socket.open();

    const sendPromise = transport.send('FRAME-1');
    socket.receive({ op: 'error', code: 'rate_limited', message: 'Inbound frame rate exceeded' });
    await expect(sendPromise).rejects.toMatchObject({ code: LinkErrorCode.Disconnected });

    const next = transport.send('FRAME-2');
    socket.receive({ op: 'ack', topic: 'top-1', id: 'p2' });
    await expect(next).resolves.toBeUndefined();
  });

  // An error that names a publish this transport no longer waits for (it timed out, or it was
  // re-sent after a reconnect and acknowledged) is logged and fails nothing in flight.
  it('fails nothing in flight on an error for a publish it no longer waits for', async () => {
    const logged: string[] = [];
    const { transport, sockets } = harness({ log: (message) => logged.push(message) });
    const socket = sockets[0];
    socket.open();

    const sendPromise = transport.send('FRAME-1');
    socket.receive({ op: 'error', code: 'hold_limit', message: 'Held bytes', id: 'p99' });
    socket.receive({ op: 'ack', topic: 'top-1.dapp', id: 'p1' });
    await expect(sendPromise).resolves.toBeUndefined();
    expect(logged).toEqual(['relay error code=hold_limit: Held bytes']);
  });

  // Frames published before the socket opened must go out right after the subscribe.
  it('queues publishes until open, then flushes after the subscribe', async () => {
    const { transport, sockets } = harness();
    const socket = sockets[0];
    const sendPromise = transport.send('EARLY');

    socket.open();
    const sent = socket.sentJson();
    expect(sent[0].op).toBe('subscribe');
    expect(sent[1]).toMatchObject({ op: 'publish', payload: 'EARLY' });

    socket.receive({ op: 'ack', topic: 'top-1', id: sent[1].id });
    await expect(sendPromise).resolves.toBeUndefined();
  });

  // Incoming deliver frames for this topic reach the handler; everything else is noise.
  it('delivers payloads for its topic and ignores foreign frames', () => {
    const { sockets, received } = harness();
    const socket = sockets[0];
    socket.open();

    socket.receive({ op: 'deliver', topic: 'other', payload: 'NOPE' });
    socket.receive({ op: 'deliver', topic: 'top-1', payload: 'YES' });
    socket.receive({ op: 'ack', topic: 'top-1', id: 'p999' }); // unknown ack: ignored
    socket.onmessage?.({ data: 'not json' }); // garbage: ignored

    expect(received).toEqual(['YES']);
  });

  // Spec section 16 chunking: oversized frames split into {msgId, seq, total, chunk}
  // publishes, and incoming chunks reassemble (even out of order) into one frame.
  it('chunks oversized frames and reassembles incoming chunks', async () => {
    const { transport, sockets, received } = harness({ maxPayloadBytes: 10 });
    const socket = sockets[0];
    socket.open();

    const frame = 'ABCDEFGHIJ0123456789xyz'; // 23 chars -> 3 chunks of <= 10
    const sendPromise = transport.send(frame);
    // The relay acknowledges each chunk; the next one goes out after the ack.
    for (let i = 1; i <= 3; i++) {
      await settle();
      socket.receive({ op: 'ack', topic: 'top-1', id: socket.sentJson()[i].id });
    }
    await expect(sendPromise).resolves.toBeUndefined();

    const publishes = socket.sentJson().slice(1);
    expect(publishes).toHaveLength(3);
    const chunks = publishes.map((p) => p.payload as Record<string, unknown>);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(chunks.every((c) => c.msgId === chunks[0].msgId)).toBe(true);
    expect(chunks.map((c) => c.chunk).join('')).toBe(frame);

    // Incoming reassembly, deliberately out of order.
    socket.receive({
      op: 'deliver',
      topic: 'top-1',
      payload: { msgId: 'm1', seq: 1, total: 2, chunk: 'WORLD' },
    });
    socket.receive({
      op: 'deliver',
      topic: 'top-1',
      payload: { msgId: 'm1', seq: 0, total: 2, chunk: 'HELLO ' },
    });
    expect(received).toEqual(['HELLO WORLD']);
  });

  // A chunk leaves only after the relay acknowledged the one before it, so the socket
  // never holds more than one chunk of a message that is still waiting for its ack.
  it('sends the next chunk only after the previous one is acknowledged', async () => {
    const { transport, sockets } = harness({ maxPayloadBytes: 10 });
    const socket = sockets[0];
    socket.open();

    const sendPromise = transport.send('ABCDEFGHIJ0123456789xyz'); // 3 chunks
    await settle();
    expect(socket.sentJson()).toHaveLength(2); // the subscribe and chunk 0, nothing more

    socket.receive({ op: 'ack', topic: 'top-1', id: socket.sentJson()[1].id });
    await settle();
    expect(socket.sentJson()).toHaveLength(3);
    expect((socket.sentJson()[2].payload as Record<string, unknown>).seq).toBe(1);

    socket.receive({ op: 'ack', topic: 'top-1', id: socket.sentJson()[2].id });
    await settle();
    expect((socket.sentJson()[3].payload as Record<string, unknown>).seq).toBe(2);
    socket.receive({ op: 'ack', topic: 'top-1', id: socket.sentJson()[3].id });
    await expect(sendPromise).resolves.toBeUndefined();
  });

  // The ack timer of a chunk starts when that chunk is sent. A slow link that needs most
  // of the timeout for every chunk still delivers the whole frame. If every chunk were
  // sent at once, the timers of chunks 1 and 2 would expire at 1000 ms.
  it('times each chunk from its own send', async () => {
    jest.useFakeTimers();
    try {
      const { transport, sockets } = harness({ maxPayloadBytes: 10, publishAckTimeoutMs: 1000 });
      const socket = sockets[0];
      socket.open();

      const sendPromise = transport.send('ABCDEFGHIJ0123456789xyz'); // 3 chunks
      sendPromise.catch(() => {}); // observed below; avoid an unhandled rejection
      for (let i = 1; i <= 3; i++) {
        await jest.advanceTimersByTimeAsync(900); // each chunk takes 900 ms to arrive
        socket.receive({ op: 'ack', topic: 'top-1', id: socket.sentJson()[i].id });
      }
      await expect(sendPromise).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  // A receiver takes a message of up to 67 chunks, the sealed frame of a 32 MiB
  // transaction at the default chunk size, and drops a message that claims more.
  it('reassembles 67 chunks and drops a message of 68', () => {
    const { sockets, received } = harness();
    const socket = sockets[0];
    socket.open();
    const deliverAll = (msgId: string, total: number) => {
      for (let seq = 0; seq < total; seq++) {
        socket.receive({
          op: 'deliver',
          topic: 'top-1',
          payload: { msgId, seq, total, chunk: 'x' },
        });
      }
    };

    deliverAll('fits', 67);
    expect(received).toEqual(['x'.repeat(67)]);

    deliverAll('too-many', 68);
    expect(received).toHaveLength(1);
  });

  // A frame of more than 67 chunks is above the 32 MiB budget. The transport refuses it
  // with 5001 and the budget, and sends nothing, so the dApp learns at once.
  it('refuses a frame above the budget with 5001 before sending', async () => {
    const { transport, sockets } = harness();
    const socket = sockets[0];
    socket.open();

    await expect(transport.send('A'.repeat(67 * 900_000 + 1))).rejects.toMatchObject({
      code: LinkErrorCode.PayloadTooLarge,
      data: { maxPayloadBytes: 32 * 1024 * 1024 },
    });
    expect(socket.sentJson()).toEqual([{ op: 'subscribe', topic: 'top-1' }]);
  });

  // Reassembly is bounded: a stream exceeding the configured ceiling is discarded
  // entirely instead of growing client memory.
  it('drops chunk assemblies that exceed the byte ceiling', () => {
    const { sockets, received } = harness({ maxAssembledBytes: 8 });
    const socket = sockets[0];
    socket.open();
    socket.receive({
      op: 'deliver',
      topic: 'top-1',
      payload: { msgId: 'big', seq: 0, total: 2, chunk: 'AAAAAA' },
    });
    socket.receive({
      op: 'deliver',
      topic: 'top-1',
      payload: { msgId: 'big', seq: 1, total: 2, chunk: 'BBBBBB' },
    });
    expect(received).toEqual([]);
  });

  // Transient drops are invisible to the session layer: the transport reconnects with
  // backoff, re-subscribes, and re-sends unacknowledged publishes (the wallet dedupes
  // by envelope id, so at-least-once is safe).
  it('reconnects, resubscribes, and re-sends unacked publishes', async () => {
    jest.useFakeTimers();
    try {
      const { transport, sockets } = harness({ reconnectDelaysMs: [100] });
      const first = sockets[0];
      first.open();

      const sendPromise = transport.send('IMPORTANT');
      expect(first.sentJson()[1]).toMatchObject({ op: 'publish', payload: 'IMPORTANT' });

      first.drop(); // connection lost before the ack
      expect(sockets).toHaveLength(1);
      jest.advanceTimersByTime(100);
      expect(sockets).toHaveLength(2);

      const second = sockets[1];
      second.open();
      const sent = second.sentJson();
      expect(sent[0]).toEqual({ op: 'subscribe', topic: 'top-1' });
      expect(sent[1]).toMatchObject({ op: 'publish', payload: 'IMPORTANT', id: 'p1' });

      second.receive({ op: 'ack', topic: 'top-1', id: 'p1' });
      await expect(sendPromise).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  // An unacknowledged publish cannot hang forever: the ack timeout settles it.
  it('rejects a publish when the relay never acks', async () => {
    jest.useFakeTimers();
    try {
      const { transport, sockets } = harness({ publishAckTimeoutMs: 1000 });
      sockets[0].open();
      const sendPromise = transport.send('LOST');
      sendPromise.catch(() => {}); // observed below; avoid an unhandled rejection
      jest.advanceTimersByTime(1010); // 1000 ms and the few ms that 80 characters need to leave
      await expect(sendPromise).rejects.toThrow(/acknowledge/);
    } finally {
      jest.useRealTimers();
    }
  });

  // A large frame needs time to leave the device before the relay can acknowledge it: on a slow
  // uplink of 16 KiB/s a frame of 160 000 characters takes about 10 s. The timer allows for that
  // time on top of the configured timeout.
  it('gives a large frame the time it needs to leave the device', async () => {
    jest.useFakeTimers();
    try {
      const { transport, sockets } = harness({ publishAckTimeoutMs: 1000 });
      const socket = sockets[0];
      socket.open();
      const sendPromise = transport.send('x'.repeat(160_000));
      sendPromise.catch(() => {}); // observed below; avoid an unhandled rejection
      jest.advanceTimersByTime(10_000);
      socket.receive({ op: 'ack', topic: 'top-1.dapp', id: socket.sentJson()[1].id });
      await expect(sendPromise).resolves.toBeUndefined();

      const lost = transport.send('y'.repeat(160_000));
      lost.catch(() => {});
      jest.advanceTimersByTime(11_000);
      await expect(lost).rejects.toThrow(/acknowledge/);
    } finally {
      jest.useRealTimers();
    }
  });

  // close() is the ONLY closure the session layer sees: pendings reject, the close
  // handler fires once, and no reconnect attempts follow.
  it('close() rejects pendings, notifies once, and stops reconnecting', async () => {
    jest.useFakeTimers();
    try {
      const { transport, sockets } = harness({ reconnectDelaysMs: [100] });
      sockets[0].open();
      const closeReasons: Array<string | undefined> = [];
      transport.onClose((reason) => closeReasons.push(reason));

      const sendPromise = transport.send('PENDING');
      sendPromise.catch(() => {});
      transport.close();
      await expect(sendPromise).rejects.toMatchObject({ name: 'LinkError' });
      expect(closeReasons).toEqual(['Relay transport closed']);

      jest.advanceTimersByTime(10_000);
      expect(sockets).toHaveLength(1); // no reconnects after an explicit close
      await expect(transport.send('x')).rejects.toThrow(LinkError);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('PhantasmaLink5.relayEcdh (custom-scheme pairing, key derived from the wallet hop)', () => {
  const DAPP = { name: 'ecdh dApp', url: 'https://dapp.example' };
  const CONNECT_RESULT = {
    wallet: { name: 'PGL', version: '1.0' },
    capabilities: { plvVersions: [5], methods: [], chains: [], txFormats: [], signatureKinds: [] },
    account: { address: 'P2KEcdh' },
    session: { id: 'ecdh-1' },
  };

  function buildEcdh() {
    const sockets: FakeSocket[] = [];
    const keyPair = generateEphemeralKeyPair();
    const client = PhantasmaLink5.relayEcdh({
      dapp: DAPP,
      keyPair,
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    return { client, sockets, keyPair };
  }

  // The hijackable custom scheme must carry NO secret, and the client must refuse to
  // speak (in either direction) until the wallet's key hop establishes the channel.
  it('puts only the public key in the URI and refuses to send before the key hop', async () => {
    const { client, sockets, keyPair } = buildEcdh();
    expect(client.pairingUri!.startsWith('phantasma://v5/pair#')).toBe(true);
    const pairing = parsePairingUri(client.pairingUri!);
    expect(pairing.mode).toBe('ecdh');
    expect(pairing.dappPublicKey).toEqual(keyPair.publicKey);
    expect(pairing.symKey).toBeUndefined();
    expect(pairing.relay).toBeDefined();

    await expect(client.getChains()).rejects.toMatchObject({ code: 4100 });
    sockets[0].open();
    // Nothing but the subscribe may have left the transport (no plaintext, no publish).
    expect(sockets[0].sentJson()).toEqual([{ op: 'subscribe', topic: pairing.topic }]);
  });

  // The full fallback handshake (spec §20.1): wallet pub + sealed connect result in one
  // payload; the client derives the key, adopts the session, and then talks sealed.
  it('derives the session key from the wallet hop and adopts the pushed session', async () => {
    const { client, sockets, keyPair } = buildEcdh();
    const socket = sockets[0];
    socket.open();
    const topic = parsePairingUri(client.pairingUri!).topic;

    // Wallet side: own ephemeral pair, box.before-derived key, sealed event.
    const walletPair = generateEphemeralKeyPair();
    const derived = deriveSessionKey(keyPair.publicKey, walletPair.secretKey);
    const eventEnvelope = JSON.stringify({
      plv: PLV,
      type: 'event',
      event: 'pha_sessionEstablished',
      session: 'ecdh-1',
      data: CONNECT_RESULT,
    });
    const sealedEvent = sealEnvelopeText(eventEnvelope, derived);
    socket.receive({
      op: 'deliver',
      topic,
      payload: { wpk: bytesToBase64Url(walletPair.publicKey), ...sealedEvent },
    });

    expect(client.account?.address).toBe('P2KEcdh');

    // Sealed round-trip with the derived key proves both sides hold the same secret.
    const promise = client.getChains();
    const publish = socket.sentJson().find((f) => f.op === 'publish')!;
    const envelope = JSON.parse(
      openEnvelopeText(JSON.parse(publish.payload as string) as EncryptedFrame, derived)
    );
    expect(envelope.method).toBe('pha_getChains');
    socket.receive({ op: 'ack', topic, id: publish.id });
    const response = JSON.stringify({
      plv: PLV,
      id: envelope.id,
      result: { chains: [], current: '', nexus: 'simnet' },
    });
    socket.receive({
      op: 'deliver',
      topic,
      payload: JSON.stringify(sealEnvelopeText(response, derived)),
    });
    await expect(promise).resolves.toMatchObject({ nexus: 'simnet' });
  });

  // A hop whose sealed frame is missing or does not open must not bind a key: the real hop
  // that follows still establishes the session (spec §15).
  it('ignores a key hop without a frame that opens', () => {
    const { client, sockets, keyPair } = buildEcdh();
    const socket = sockets[0];
    socket.open();
    const topic = parsePairingUri(client.pairingUri!).topic;

    const stranger = generateEphemeralKeyPair();
    socket.receive({
      op: 'deliver',
      topic,
      payload: { wpk: bytesToBase64Url(stranger.publicKey) },
    });
    socket.receive({
      op: 'deliver',
      topic,
      payload: { wpk: 'not base64url!', nonce: 'AAAA', ct: 'AAAA' },
    });
    expect(client.account).toBeUndefined();

    const walletPair = generateEphemeralKeyPair();
    const derived = deriveSessionKey(keyPair.publicKey, walletPair.secretKey);
    const sealedEvent = sealEnvelopeText(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionEstablished',
        data: CONNECT_RESULT,
      }),
      derived
    );
    socket.receive({
      op: 'deliver',
      topic,
      payload: { wpk: bytesToBase64Url(walletPair.publicKey), ...sealedEvent },
    });
    expect(client.account?.address).toBe('P2KEcdh');
  });

  // A second key hop must be ignored: the channel key is fixed at establishment, and a
  // late forged wpk must not be able to re-key a live session.
  it('ignores duplicate key hops and pre-key plaintext', () => {
    const { client, sockets, keyPair } = buildEcdh();
    const socket = sockets[0];
    socket.open();
    const topic = parsePairingUri(client.pairingUri!).topic;

    // Plaintext before the key: dropped silently (never parsed as an envelope).
    socket.receive({
      op: 'deliver',
      topic,
      payload: JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionEstablished',
        data: CONNECT_RESULT,
      }),
    });
    expect(client.account).toBeUndefined();

    const walletPair = generateEphemeralKeyPair();
    const derived = deriveSessionKey(keyPair.publicKey, walletPair.secretKey);
    const sealedEvent = sealEnvelopeText(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionEstablished',
        data: CONNECT_RESULT,
      }),
      derived
    );
    socket.receive({
      op: 'deliver',
      topic,
      payload: { wpk: bytesToBase64Url(walletPair.publicKey), ...sealedEvent },
    });
    expect(client.account?.address).toBe('P2KEcdh');

    // A forged re-key attempt with a different pair changes nothing: frames sealed with
    // the ORIGINAL derived key still open.
    const attacker = generateEphemeralKeyPair();
    socket.receive({
      op: 'deliver',
      topic,
      payload: { wpk: bytesToBase64Url(attacker.publicKey) },
    });
    const events: string[] = [];
    client.onEvent((event) => events.push(event));
    socket.receive({
      op: 'deliver',
      topic,
      payload: JSON.stringify(
        sealEnvelopeText(
          JSON.stringify({ plv: PLV, type: 'event', event: 'pha_chainChanged', data: {} }),
          derived
        )
      ),
    });
    expect(events).toEqual(['pha_chainChanged']);
  });
});

describe('PhantasmaLink5.relay (sealed end-to-end over a fake relay)', () => {
  it('requires the pairing session key', () => {
    expect(() =>
      PhantasmaLink5.relay({
        topic: 't',
        webSocketFactory: (url) => new FakeSocket(url),
        sessionKey: new Uint8Array(8),
      })
    ).toThrow(LinkError);
  });

  // Full loop: the client seals the envelope into a publish payload, the "wallet"
  // (played by the test) opens it with the pairing key and answers with a sealed
  // deliver - proving the relay path stays E2E-blind end to end.
  it('runs a sealed request/response round-trip', async () => {
    const sessionKey = generateSessionKey();
    const sockets: FakeSocket[] = [];
    const client = PhantasmaLink5.relay({
      topic: 'topic-r',
      sessionKey,
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    const socket = sockets[0];
    socket.open();

    const promise = client.getChains();
    const publish = socket.sentJson()[1];
    expect(publish.op).toBe('publish');
    const envelope = JSON.parse(
      openEnvelopeText(JSON.parse(publish.payload as string) as EncryptedFrame, sessionKey)
    );
    expect(envelope.method).toBe('pha_getChains');
    expect(publish.payload as string).not.toContain('pha_getChains'); // sealed on the wire

    socket.receive({ op: 'ack', topic: 'topic-r', id: publish.id });
    const responseEnvelope = JSON.stringify({
      plv: PLV,
      id: envelope.id,
      result: { chains: ['phantasma:simnet'], current: 'phantasma:simnet', nexus: 'simnet' },
    });
    socket.receive({
      op: 'deliver',
      topic: 'topic-r',
      payload: JSON.stringify(sealEnvelopeText(responseEnvelope, sessionKey)),
    });

    await expect(promise).resolves.toMatchObject({ nexus: 'simnet' });
    client.close();
  });

  // The largest transaction the chain accepts, 32 MiB, crosses the relay. The test builds
  // and seals a real request, so it measures the sealed frame instead of trusting the
  // arithmetic: two base64 layers make it about 59.7 million characters, 67 chunks. The
  // test plays the relay and acknowledges every chunk. It is slow by design.
  it('carries a sealed 32 MiB transaction', async () => {
    const sessionKey = generateSessionKey();
    const sockets: FakeSocket[] = [];
    const client = PhantasmaLink5.relay({
      topic: 'topic-big',
      sessionKey,
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    const socket = sockets[0];
    socket.open();

    const tx = new Uint8Array(32 * 1024 * 1024).fill(0x5a);
    const promise = client.signTransaction({ format: 'carbon', tx: bytesToBase64(tx) });

    // Only the newest publish is parsed: the earlier ones are already acknowledged.
    const chunks: string[] = [];
    let total = 0;
    do {
      await settle();
      const publish = JSON.parse(socket.sent[socket.sent.length - 1]) as Record<string, unknown>;
      const payload = publish.payload as { seq: number; total: number; chunk: string };
      expect(payload.seq).toBe(chunks.length);
      chunks.push(payload.chunk);
      total = payload.total;
      socket.receive({ op: 'ack', topic: 'topic-big', id: publish.id });
    } while (chunks.length < total);
    expect(total).toBe(67);

    const envelope = JSON.parse(
      openEnvelopeText(JSON.parse(chunks.join('')) as EncryptedFrame, sessionKey)
    );
    expect(envelope.method).toBe('pha_signTransaction');
    expect(envelope.params.tx).toHaveLength(44_739_244); // base64 of 32 MiB

    const response = JSON.stringify({ plv: PLV, id: envelope.id, result: { signedTx: 'AA==' } });
    socket.receive({
      op: 'deliver',
      topic: 'topic-big',
      payload: JSON.stringify(sealEnvelopeText(response, sessionKey)),
    });
    await expect(promise).resolves.toEqual({ signedTx: 'AA==' });
    client.close();
  }, 120_000);

  // A transaction above the chain maximum reaches the caller as 5001 with the budget,
  // the code the specification gives a payload that is too large.
  it('reports a transaction above 32 MiB as 5001', async () => {
    const sessionKey = generateSessionKey();
    const sockets: FakeSocket[] = [];
    const client = PhantasmaLink5.relay({
      topic: 'topic-huge',
      sessionKey,
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    });
    sockets[0].open();

    const tx = new Uint8Array(33 * 1024 * 1024).fill(0x5a);
    await expect(
      client.signTransaction({ format: 'carbon', tx: bytesToBase64(tx) })
    ).rejects.toMatchObject({
      code: LinkErrorCode.PayloadTooLarge,
      data: { maxPayloadBytes: 32 * 1024 * 1024 },
    });
    expect(sockets[0].sent).toHaveLength(1); // the subscribe only
    client.close();
  }, 120_000);
});
