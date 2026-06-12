import { jest } from '@jest/globals';
import { RelayTransport, DEFAULT_RELAY_URL } from '../../src/link/v5/relay-transport.js';
import { WebSocketLike } from '../../src/link/v5/loopback-transport.js';
import { PhantasmaLink5 } from '../../src/link/v5/client.js';
import { LinkError } from '../../src/link/v5/errors.js';
import { PLV } from '../../src/link/v5/protocol.js';
import {
  generateSessionKey,
  sealEnvelopeText,
  openEnvelopeText,
  EncryptedFrame,
} from '../../src/link/v5/session-crypto.js';

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

  // Spec section 18 chunking: oversized frames split into {msgId, seq, total, chunk}
  // publishes, and incoming chunks reassemble (even out of order) into one frame.
  it('chunks oversized frames and reassembles incoming chunks', async () => {
    const { transport, sockets, received } = harness({ maxPayloadBytes: 10 });
    const socket = sockets[0];
    socket.open();

    const frame = 'ABCDEFGHIJ0123456789xyz'; // 23 chars -> 3 chunks of <= 10
    const sendPromise = transport.send(frame);
    const publishes = socket.sentJson().slice(1);
    expect(publishes).toHaveLength(3);
    const chunks = publishes.map((p) => p.payload as Record<string, unknown>);
    expect(chunks.map((c) => c.seq)).toEqual([0, 1, 2]);
    expect(chunks.every((c) => c.msgId === chunks[0].msgId)).toBe(true);
    expect(chunks.map((c) => c.chunk).join('')).toBe(frame);

    for (const p of publishes) {
      socket.receive({ op: 'ack', topic: 'top-1', id: p.id });
    }
    await expect(sendPromise).resolves.toBeUndefined();

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
      jest.advanceTimersByTime(1001);
      await expect(sendPromise).rejects.toThrow(/acknowledge/);
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
});
