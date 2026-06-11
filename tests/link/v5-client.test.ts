import { PhantasmaLink5 } from '../../src/link/v5/client.js';
import { LoopbackTransport, WebSocketLike } from '../../src/link/v5/loopback-transport.js';
import { LinkTransport } from '../../src/link/v5/transport.js';
import { PLV } from '../../src/link/v5/protocol.js';

/** In-memory transport: captures outgoing plaintext envelopes, lets a test inject responses. */
class MockTransport implements LinkTransport {
  sent: string[] = [];
  private messageHandler?: (frame: string) => void;
  send(frame: string): void {
    this.sent.push(frame);
  }
  onMessage(handler: (frame: string) => void): void {
    this.messageHandler = handler;
  }
  close(): void {}
  inject(frame: string): void {
    this.messageHandler?.(frame);
  }
  lastEnvelope(): {
    id: string;
    method?: string;
    session?: string;
    params?: Record<string, unknown>;
  } {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

describe('PhantasmaLink5 (cohesive v5 client)', () => {
  // connect runs the handshake, exposes the account, and tags later requests with the session.
  it('connects, stores the session, and forwards the session id on later calls', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport);

    const connectPromise = client.connect({ name: 'dApp', url: 'https://d.app' });
    const connectEnvelope = transport.lastEnvelope();
    expect(connectEnvelope.method).toBe('pha_connect');
    expect(connectEnvelope.params?.dapp).toEqual({ name: 'dApp', url: 'https://d.app' });

    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: connectEnvelope.id,
        result: {
          wallet: { name: 'PGL', version: '1.0' },
          capabilities: {
            plvVersions: [5],
            methods: [],
            chains: [],
            txFormats: [],
            signatureKinds: [],
          },
          account: { address: 'P2K...' },
          session: { id: 'sess-1' },
        },
      })
    );

    const result = await connectPromise;
    expect(result.session.id).toBe('sess-1');
    expect(client.account?.address).toBe('P2K...');

    // A subsequent request must carry the established session id.
    const chainsPromise = client.getChains();
    expect(transport.lastEnvelope().session).toBe('sess-1');
    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: transport.lastEnvelope().id,
        result: { chains: ['phantasma:mainnet'], current: 'phantasma:mainnet', nexus: 'mainnet' },
      })
    );
    await expect(chainsPromise).resolves.toMatchObject({ nexus: 'mainnet' });
  });

  // sendTransaction forwards the typed params and resolves the hash.
  it('forwards sendTransaction params and resolves the hash', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport);
    const promise = client.sendTransaction({ format: 'carbon', tx: 'AAEC' });
    const envelope = transport.lastEnvelope();
    expect(envelope.method).toBe('pha_sendTransaction');
    expect(envelope.params).toEqual({ format: 'carbon', tx: 'AAEC' });
    transport.inject(JSON.stringify({ plv: PLV, id: envelope.id, result: { hash: '0xabc' } }));
    await expect(promise).resolves.toEqual({ hash: '0xabc' });
  });

  // Resume (spec §7): a stored session id rides in connect params so the wallet can skip the
  // consent prompt; the client then adopts whatever session id the wallet returns.
  it('forwards a resume session id and adopts the returned session', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport);

    const promise = client.connect({ name: 'dApp', url: 'https://d.app' }, { session: 'old-sess' });
    const envelope = transport.lastEnvelope();
    expect(envelope.method).toBe('pha_connect');
    expect(envelope.params?.session).toBe('old-sess');

    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: envelope.id,
        result: {
          wallet: { name: 'PGL', version: '1.0' },
          capabilities: {
            plvVersions: [5],
            methods: [],
            chains: [],
            txFormats: [],
            signatureKinds: [],
          },
          account: { address: 'P2K...' },
          session: { id: 'old-sess' },
        },
      })
    );
    await expect(promise).resolves.toMatchObject({ session: { id: 'old-sess' } });

    const next = client.getChains();
    expect(transport.lastEnvelope().session).toBe('old-sess');
    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: transport.lastEnvelope().id,
        result: { chains: [], current: '', nexus: 'x' },
      })
    );
    await next;
  });

  // Every typed forwarder must emit the right method name and pass params through verbatim -
  // a wrong method string here would silently hit MethodNotFound on the wallet.
  it('maps every typed method to its pha_* wire name with verbatim params', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport);

    const calls: Array<{ run: () => Promise<unknown>; method: string; params?: unknown }> = [
      { run: () => client.getAccounts(), method: 'pha_getAccounts' },
      { run: () => client.getChains(), method: 'pha_getChains' },
      { run: () => client.getWalletInfo(), method: 'pha_getWalletInfo' },
      {
        run: () => client.signMessage({ message: 'AA==' }),
        method: 'pha_signMessage',
        params: { message: 'AA==' },
      },
      {
        run: () => client.signTransaction({ format: 'script', tx: 'AA==' }),
        method: 'pha_signTransaction',
        params: { format: 'script', tx: 'AA==' },
      },
      {
        run: () => client.invokeScript({ chain: 'main', script: 'AA==' }),
        method: 'pha_invokeScript',
        params: { chain: 'main', script: 'AA==' },
      },
      { run: () => client.disconnect(), method: 'pha_disconnect' },
    ];

    for (const call of calls) {
      const promise = call.run();
      const envelope = transport.lastEnvelope();
      expect(envelope.method).toBe(call.method);
      if (call.params !== undefined) {
        expect(envelope.params).toEqual(call.params);
      }
      transport.inject(JSON.stringify({ plv: PLV, id: envelope.id, result: {} }));
      await promise;
    }
  });

  // Events reach subscribers through the client facade, and close() makes further calls fail.
  it('forwards events and fails fast after close', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport);
    const events: string[] = [];
    client.onEvent((event) => events.push(event));

    transport.inject(
      JSON.stringify({ plv: PLV, type: 'event', event: 'pha_accountsChanged', data: {} })
    );
    expect(events).toEqual(['pha_accountsChanged']);

    client.close();
    await expect(client.getChains()).rejects.toMatchObject({ name: 'LinkError' });
  });

  // The loopback factory builds a working client over an injected WebSocket.
  it('builds via the loopback factory', () => {
    const sockets: FakeSocket[] = [];
    const client = PhantasmaLink5.loopback({
      webSocketFactory: (url) => {
        const s = new FakeSocket(url);
        sockets.push(s);
        return s;
      },
    });
    expect(client).toBeInstanceOf(PhantasmaLink5);
    expect(sockets[0].url).toBe('ws://localhost:7090/phantasma/v5');
  });
});

/** A controllable WebSocket double for the loopback transport. */
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
    this.onclose?.({ reason: 'closed', wasClean: true });
  }
  fireOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  fireMessage(data: string): void {
    this.onmessage?.({ data });
  }
}

describe('LoopbackTransport', () => {
  // Frames sent before the socket opens are buffered, then flushed in order on open.
  it('buffers sends until open, then flushes', () => {
    let socket!: FakeSocket;
    const transport = new LoopbackTransport({
      webSocketFactory: (url) => (socket = new FakeSocket(url)),
    });
    transport.send('a');
    transport.send('b');
    expect(socket.sent).toEqual([]); // not open yet
    socket.fireOpen();
    expect(socket.sent).toEqual(['a', 'b']); // flushed in order
    transport.send('c');
    expect(socket.sent).toEqual(['a', 'b', 'c']); // immediate after open
  });

  // Non-string socket payloads (binary frames) are ignored rather than crashing the handler.
  it('ignores non-string message data', () => {
    let socket!: FakeSocket;
    const transport = new LoopbackTransport({
      webSocketFactory: (url) => (socket = new FakeSocket(url)),
    });
    const messages: string[] = [];
    transport.onMessage((frame) => messages.push(frame));
    socket.fireOpen();
    socket.onmessage?.({ data: 12345 });
    expect(messages).toEqual([]);
  });

  // Incoming string messages reach the registered handler; close reaches the close handler.
  it('delivers messages and close to handlers', () => {
    let socket!: FakeSocket;
    const transport = new LoopbackTransport({
      webSocketFactory: (url) => (socket = new FakeSocket(url)),
    });
    const messages: string[] = [];
    let closedReason: string | undefined = 'unset';
    transport.onMessage((frame) => messages.push(frame));
    transport.onClose((reason) => {
      closedReason = reason;
    });
    socket.fireOpen();
    socket.fireMessage('hello');
    expect(messages).toEqual(['hello']);
    transport.close();
    expect(closedReason).toBe('closed');
  });
});
