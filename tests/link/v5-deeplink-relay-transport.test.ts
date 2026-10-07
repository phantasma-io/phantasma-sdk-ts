import { DeeplinkRelayTransport } from '../../src/link/v5/deeplink-relay-transport.js';
import { LinkSessionClient, SendOptions } from '../../src/link/v5/transport.js';
import { PhantasmaLink5 } from '../../src/link/v5/client.js';
import { LinkErrorCode } from '../../src/link/v5/errors.js';
import { WebSocketLike } from '../../src/link/v5/loopback-transport.js';
import { buildResponseUrl } from '../../src/link/v5/deeplink.js';
import { bytesToBase64 } from '../../src/link/v5/encoding.js';
import { generateSessionKey } from '../../src/link/v5/session-crypto.js';

/** A relay socket double; tests play the relay server. */
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
  publishes(): Array<{ id: string; payload: unknown }> {
    return this.sent
      .map((text) => JSON.parse(text) as { op: string; id: string; payload: unknown })
      .filter((frame) => frame.op === 'publish');
  }
}

// Every transport a test builds is closed after it, so no publish waits for an ack.
const built: DeeplinkRelayTransport[] = [];
afterEach(() => {
  for (const transport of built.splice(0)) {
    transport.close();
  }
});

function harness(
  prefer: 'relay' | 'deeplink',
  urlBudgetChars = 100,
  log?: (message: string) => void
) {
  const opened: string[] = [];
  const sockets: FakeSocket[] = [];
  const transport = new DeeplinkRelayTransport({
    topic: 'topic-1',
    opener: (url) => opened.push(url),
    urlBudgetChars,
    prefer,
    log,
    relay: {
      webSocketFactory: (url) => {
        const socket = new FakeSocket(url);
        sockets.push(socket);
        return socket;
      },
    },
  });
  built.push(transport);
  const received: string[] = [];
  transport.onMessage((frame) => received.push(frame));
  /** Sends and ignores the outcome: these tests look at where the frame went. */
  const send = (frame: string, options?: SendOptions) => {
    void Promise.resolve(transport.send(frame, options)).catch(() => undefined);
  };
  return { transport, send, opened, socket: sockets[0], received };
}

const SMALL = 'x'.repeat(30); // 40 characters in a URL
const LARGE = 'x'.repeat(90); // 120 characters: above the budget of 100

describe('DeeplinkRelayTransport', () => {
  // Spec §6.3: a web page sends over the relay while it is connected, and the wake link
  // (spec §6.4) brings the wallet app to the front.
  it('prefers the relay for a web page and wakes the wallet', () => {
    const { send, opened, socket } = harness('relay');
    socket.open();
    send(SMALL);
    expect(socket.publishes().map((p) => p.payload)).toEqual([SMALL]);
    expect(opened).toEqual(['phantasma://v5/wake']);
  });

  it('falls back to the deeplink while the relay is not connected', () => {
    const { send, opened, socket } = harness('relay');
    send(SMALL);
    expect(opened).toHaveLength(1);
    expect(opened[0].startsWith('phantasma://v5/req#t=topic-1&f=')).toBe(true);
    expect(socket.publishes()).toEqual([]);
  });

  // A native app keeps the deeplink for what fits a URL.
  it('prefers the deeplink for a native app', () => {
    const { send, opened, socket } = harness('deeplink');
    socket.open();
    send(SMALL);
    expect(opened[0].startsWith('phantasma://v5/req#')).toBe(true);
    expect(socket.publishes()).toEqual([]);
  });

  // Spec §6.3: what does not fit the URL budget, or carries a transaction above the wallet's
  // deeplink limit, goes over the relay whatever the preference.
  it('sends over the relay what a deeplink cannot carry', () => {
    const { send, opened, socket } = harness('deeplink');
    socket.open();
    send(LARGE);
    send(SMALL, { needsRelay: true });
    expect(socket.publishes().map((p) => p.payload)).toEqual([LARGE, SMALL]);
    expect(opened).toEqual(['phantasma://v5/wake', 'phantasma://v5/wake']);
  });

  it('refuses what a deeplink cannot carry once the relay is gone', () => {
    const { transport, send, opened, socket } = harness('relay');
    socket.open();
    socket.receive({ op: 'error', code: 'topic_limit', message: 'too many topics' });

    expect(() => transport.send(LARGE)).toThrow(
      expect.objectContaining({ code: LinkErrorCode.Disconnected })
    );
    send(SMALL);
    expect(opened).toHaveLength(1);
    expect(opened[0].startsWith('phantasma://v5/req#')).toBe(true);
  });

  // Spec §10, §16: the wallet answers on the path a request came on. When the relay refuses the
  // topic, a request that went over the relay fails at once with 4900, even after the relay
  // acknowledged it; a request that went over a deeplink still waits for its answer.
  it('fails the requests sent over the relay when the relay refuses the topic', async () => {
    const logged: string[] = [];
    const { transport, socket } = harness('deeplink', 4000, (message) => logged.push(message));
    const session = new LinkSessionClient(transport, { requestTimeoutMs: 300_000 });
    socket.open();
    const overRelay = session.request('pha_signTransaction', undefined, { needsRelay: true });
    const overDeeplink = session.request('pha_getChains');
    const [publish] = socket.publishes();
    socket.receive({ op: 'ack', id: publish.id });

    socket.receive({ op: 'error', code: 'topic_limit', message: 'too many topics' });
    await expect(overRelay).rejects.toMatchObject({ code: LinkErrorCode.Disconnected });
    expect(logged).toEqual(['relay error code=topic_limit: too many topics']);
    const waiting = await Promise.race([
      overDeeplink.then(
        () => 'settled',
        () => 'settled'
      ),
      new Promise((resolve) => setTimeout(() => resolve('waiting'), 10)),
    ]);
    expect(waiting).toBe('waiting');
  });

  // The wallet answers on the path the request came on; both reach the session.
  it('delivers frames from both paths', () => {
    const { transport, socket, received } = harness('relay');
    socket.open();
    socket.receive({ op: 'deliver', topic: 'topic-1.wallet', payload: 'from-relay' });
    expect(
      transport.deliverUrl(buildResponseUrl('https://dapp.example', 'topic-1', 'from-url'))
    ).toBe(true);
    expect(received).toEqual(['from-relay', 'from-url']);
  });

  it('closes both paths once', () => {
    const { transport, socket } = harness('relay');
    const reasons: Array<string | undefined> = [];
    transport.onClose((reason) => reasons.push(reason));
    transport.close();
    transport.close();
    expect(reasons).toHaveLength(1);
    expect(socket.readyState).toBe(3);
    expect(() => transport.send(SMALL)).toThrow(
      expect.objectContaining({ code: LinkErrorCode.Disconnected })
    );
    expect(transport.deliverUrl(buildResponseUrl('https://dapp.example', 'topic-1', 'x'))).toBe(
      false
    );
  });

  // A native client with the pairing's relay sends a transaction too large for a URL there.
  it('backs the native deeplink client when the pairing has a relay', async () => {
    const opened: string[] = [];
    const sockets: FakeSocket[] = [];
    const client = PhantasmaLink5.deeplink({
      topic: 'topic-2',
      sessionKey: generateSessionKey(),
      opener: (url) => opened.push(url),
      relay: {
        webSocketFactory: (url) => {
          const socket = new FakeSocket(url);
          sockets.push(socket);
          return socket;
        },
      },
    });
    sockets[0].open();
    const signing = client.signTransaction({
      format: 'carbon',
      tx: bytesToBase64(new Uint8Array(20_000)),
    });
    expect(sockets[0].publishes()).toHaveLength(1);
    expect(opened).toEqual(['phantasma://v5/wake']);
    client.close();
    await expect(signing).rejects.toMatchObject({ code: LinkErrorCode.Disconnected });
  });
});
