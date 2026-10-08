import { jest } from '@jest/globals';
import { PhantasmaLink5 } from '../../src/link/v5/client.js';
import { DEEPLINK_REQUEST_TIMEOUT_MS } from '../../src/link/v5/deeplink.js';
import { LoopbackTransport, WebSocketLike } from '../../src/link/v5/loopback-transport.js';
import { LinkTransport } from '../../src/link/v5/transport.js';
import { PLV, MAX_TX_BYTES } from '../../src/link/v5/protocol.js';
import { LinkErrorCode } from '../../src/link/v5/errors.js';
import type { ConnectResult, LinkAccountV5 } from '../../src/link/v5/capabilities.js';

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

/** The same mock, named as a loopback transport so the client applies the loopback limit. */
class KindMockTransport extends MockTransport {
  readonly kind = 'loopback';
}

/** Makes `sessionId` the client's live session through a wallet-pushed connect result. */
function establish(transport: MockTransport, sessionId: string, account: LinkAccountV5): void {
  transport.inject(
    JSON.stringify({
      plv: PLV,
      type: 'event',
      event: 'pha_sessionEstablished',
      session: sessionId,
      data: {
        wallet: { name: 'Wallet', version: '1.0' },
        capabilities: {
          plvVersions: [5],
          methods: [],
          chains: [],
          txFormats: [],
          signatureKinds: [],
          features: [],
        },
        account,
        session: { id: sessionId, expiresAt: null },
      },
    })
  );
}

/** Delivers a wallet-pushed pha_accountsChanged event of `sessionId` with `accounts` as its data. */
function pushAccounts(transport: MockTransport, sessionId: string, accounts: unknown): void {
  transport.inject(
    JSON.stringify({
      plv: PLV,
      type: 'event',
      event: 'pha_accountsChanged',
      session: sessionId,
      data: { accounts },
    })
  );
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
            features: [],
          },
          account: { address: 'P2K...' },
          session: { id: 'sess-1', expiresAt: null },
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

  // Resume (spec §4, §9.5): a stored session id rides in the envelope `session` field of the
  // connect request, never in its params, so the wallet can skip the consent prompt; the client
  // then adopts whatever session id the wallet returns.
  it('sends a resume session id in the envelope and adopts the returned session', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport, { sessionId: 'old-sess' });

    const promise = client.connect({ name: 'dApp', url: 'https://d.app' });
    const envelope = transport.lastEnvelope();
    expect(envelope.method).toBe('pha_connect');
    expect(envelope.session).toBe('old-sess');
    expect(envelope.params?.session).toBeUndefined();

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
            features: [],
          },
          account: { address: 'P2K...' },
          session: { id: 'old-sess', expiresAt: null },
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

  // connect() falls back to the options.dapp identity (set by factories) and refuses to
  // run with no identity at all - a connect without dApp metadata is meaningless.
  it('uses options.dapp for connect() and rejects without any dApp identity', async () => {
    const bare = new PhantasmaLink5(new MockTransport());
    await expect(bare.connect()).rejects.toMatchObject({ name: 'LinkError' });

    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport, { dapp: { name: 'D', url: 'https://d.app' } });
    const promise = client.connect();
    const envelope = transport.lastEnvelope();
    expect(envelope.params?.dapp).toEqual({ name: 'D', url: 'https://d.app' });
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
            features: [],
          },
          account: { address: 'P2K...' },
          session: { id: 's1', expiresAt: null },
        },
      })
    );
    await expect(promise).resolves.toMatchObject({ session: { id: 's1' } });
  });

  // A connect result without the capabilities, the account's address or a field that spec §5
  // requires is refused with -32603, and the client keeps no session. Later calls then cannot fail
  // with a TypeError.
  it('refuses a malformed connect result and keeps no session', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport, { dapp: { name: 'D', url: 'https://d.app' } });
    const malformed = [
      { account: { address: 'P2K...' }, session: { id: 's1' } },
      { capabilities: { plvVersions: [5] }, account: {}, session: { id: 's1' } },
      {
        capabilities: { features: [], maxPayloadBytes: 7 },
        account: { address: 'P2K...' },
        session: { id: 's1', expiresAt: null },
      },
      {
        capabilities: { features: [] },
        account: { address: 'P2K...' },
        session: { id: 's1', expiresAt: '1' },
      },
      // Spec §5 requires both: the features, and the end of the session or null.
      { capabilities: { features: [] }, account: { address: 'P2K...' }, session: { id: 's1' } },
      { capabilities: {}, account: { address: 'P2K...' }, session: { id: 's1', expiresAt: null } },
    ];
    for (const result of malformed) {
      const connecting = client.connect();
      transport.inject(JSON.stringify({ plv: PLV, id: transport.lastEnvelope().id, result }));
      await expect(connecting).rejects.toMatchObject({ code: LinkErrorCode.InternalError });
      expect(client.account).toBeUndefined();
      expect(client.capabilities).toBeUndefined();
    }
    // With no adopted result, a transaction call reads no missing field and does not throw.
    expect(() => {
      void client.signTransaction({ format: 'script', tx: 'AA==' }).catch(() => undefined);
    }).not.toThrow();
    client.close();
  });

  // The client tells its caller which session it holds, so that the caller can match the
  // session that an event names.
  it('exposes the id of the session it holds', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport, { dapp: { name: 'D', url: 'https://d.app' } });
    expect(client.sessionId).toBeUndefined();
    const connecting = client.connect();
    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: transport.lastEnvelope().id,
        result: {
          wallet: { name: 'W', version: '1' },
          capabilities: { features: [] },
          account: { address: 'P2K...' },
          session: { id: 'sess-7', expiresAt: null },
        },
      })
    );
    await connecting;
    expect(client.sessionId).toBe('sess-7');
    client.forgetSession();
    expect(client.sessionId).toBeUndefined();
  });

  // After disconnect the wallet has dropped the session, so the client must stop sending
  // the dead session id (and clear the cached account).
  it('clears the session and cached account after disconnect', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport, { dapp: { name: 'D', url: 'https://d.app' } });

    const connecting = client.connect();
    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: transport.lastEnvelope().id,
        result: {
          wallet: { name: 'PGL', version: '1.0' },
          capabilities: {
            plvVersions: [5],
            methods: [],
            chains: [],
            txFormats: [],
            signatureKinds: [],
            features: [],
          },
          account: { address: 'P2K...' },
          session: { id: 'sess-x', expiresAt: null },
        },
      })
    );
    await connecting;
    expect(client.account).toBeDefined();

    const disconnecting = client.disconnect();
    expect(transport.lastEnvelope().session).toBe('sess-x'); // the disconnect itself is in-session
    transport.inject(JSON.stringify({ plv: PLV, id: transport.lastEnvelope().id, result: {} }));
    await disconnecting;

    expect(client.account).toBeUndefined();
    expect(client.isClosed).toBe(false); // no pairing to end without a channel key
    const after = client.getChains();
    expect(transport.lastEnvelope().session).toBeUndefined(); // dead id no longer sent
    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: transport.lastEnvelope().id,
        result: { chains: [], current: '', nexus: 'x' },
      })
    );
    await after;
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
      {
        run: () =>
          client.requestSigningPermission({
            calls: [{ contract: 'game1', methods: ['move'] }],
            duration: 3600,
          }),
        method: 'pha_requestSigningPermission',
        params: { calls: [{ contract: 'game1', methods: ['move'] }], duration: 3600 },
      },
      { run: () => client.getSigningPermission(), method: 'pha_getSigningPermission' },
      { run: () => client.revokeSigningPermission(), method: 'pha_revokeSigningPermission' },
      {
        run: () => client.revokeSigningPermission({ id: 'p_1' }),
        method: 'pha_revokeSigningPermission',
        params: { id: 'p_1' },
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

  // One-tap pairing (spec §17 step 3): a wallet-pushed sessionEstablished event must be
  // adopted exactly like a connect result - live session id, cached account, persistence
  // callback - while still reaching ordinary event subscribers.
  it('adopts a wallet-pushed pha_sessionEstablished event as the live session', async () => {
    const transport = new MockTransport();
    const changes: unknown[] = [];
    const client = new PhantasmaLink5(transport, { onSessionChange: (c) => changes.push(c) });
    const events: string[] = [];
    client.onEvent((event) => events.push(event));

    transport.inject(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionEstablished',
        session: 'push-1',
        data: {
          wallet: { name: 'PGL', version: '1.0' },
          capabilities: {
            plvVersions: [5],
            methods: [],
            chains: [],
            txFormats: [],
            signatureKinds: [],
            features: [],
          },
          account: { address: 'P2K...' },
          session: { id: 'push-1', expiresAt: null },
        },
      })
    );

    expect(client.account?.address).toBe('P2K...');
    expect(changes).toHaveLength(1);
    expect(events).toEqual(['pha_sessionEstablished']);

    // The adopted session rides subsequent requests.
    const promise = client.getChains();
    expect(transport.lastEnvelope().session).toBe('push-1');
    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: transport.lastEnvelope().id,
        result: { chains: [], current: '', nexus: 'x' },
      })
    );
    await promise;
  });

  // A malformed push (no session id) must be ignored, never half-adopted.
  it('ignores a malformed pha_sessionEstablished payload', () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport);
    transport.inject(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionEstablished',
        data: { account: { address: 'P2K...' } }, // no session.id
      })
    );
    expect(client.account).toBeUndefined();
  });

  // Counterpart to one-tap establish: a wallet-pushed pha_sessionDeleted (user revoke / LRU evict /
  // idle expiry) must drop the live session so a reload cannot resume a dead one - cached account
  // cleared and the persistence callback fired with undefined.
  it('drops the session on a wallet-pushed pha_sessionDeleted event', () => {
    const transport = new MockTransport();
    const changes: unknown[] = [];
    const client = new PhantasmaLink5(transport, { onSessionChange: (c) => changes.push(c) });

    // First adopt a live session (one-tap), then have the wallet delete it.
    transport.inject(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionEstablished',
        session: 'sess-x',
        data: {
          wallet: { name: 'PGL', version: '1.0' },
          capabilities: {
            plvVersions: [5],
            methods: [],
            chains: [],
            txFormats: [],
            signatureKinds: [],
            features: [],
          },
          account: { address: 'P2K...' },
          session: { id: 'sess-x', expiresAt: null },
        },
      })
    );
    expect(client.account?.address).toBe('P2K...');

    // The wallet's delete notice carries the id at the envelope level with data:{}.
    transport.inject(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionDeleted',
        session: 'sess-x',
        data: {},
      })
    );

    expect(client.account).toBeUndefined();
    // onSessionChange fired twice: adopt (the connect result), then forget (undefined).
    expect(changes).toHaveLength(2);
    expect(changes[1]).toBeUndefined();
  });

  // A notice about another session (an older one on the same channel) must not drop the live
  // session; the notice for the live id does (spec §9.5).
  it('keeps the live session on a notice about another session', async () => {
    const transport = new MockTransport();
    const client = new PhantasmaLink5(transport, { sessionId: 'live' });
    const answer = () =>
      transport.inject(
        JSON.stringify({
          plv: PLV,
          id: transport.lastEnvelope().id,
          result: { chains: [], current: '', nexus: 'x' },
        })
      );
    transport.inject(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionExpired',
        session: 'old',
        data: { session: 'old' },
      })
    );
    const first = client.getChains();
    expect(transport.lastEnvelope().session).toBe('live');
    answer();
    await first;

    transport.inject(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionExpired',
        data: { session: 'live' },
      })
    );
    const second = client.getChains();
    expect(transport.lastEnvelope().session).toBeUndefined();
    answer();
    await second;
  });

  // Spec §7: a session holds one account, and a wallet pushes pha_accountsChanged with that
  // account's current details. The client takes them, so `account` and the persistence callback
  // show a renamed account or new balances. The account is a new object, so a store that compares
  // references re-renders.
  it('takes new details of the session account from pha_accountsChanged', () => {
    const transport = new MockTransport();
    const changes: Array<ConnectResult | undefined> = [];
    const client = new PhantasmaLink5(transport, { onSessionChange: (c) => changes.push(c) });
    establish(transport, 'sess-a', { address: 'P2K...', name: 'Main' });
    const before = client.account;

    const renamed = {
      address: 'P2K...',
      name: 'Renamed',
      balances: [{ symbol: 'SOUL', value: '500000000', decimals: 8 }],
    };
    pushAccounts(transport, 'sess-a', [renamed]);

    expect(client.account).toEqual(renamed);
    expect(client.account).not.toBe(before);
    expect(changes).toHaveLength(2);
    expect(changes[1]?.account).toEqual(renamed);
    expect(changes[1]?.session.id).toBe('sess-a');
  });

  // The session's account never changes (spec §7): an entry with another address, an event of
  // another session and a malformed payload leave the account and the persisted state as they were.
  it('keeps the session account on an account event it cannot take', () => {
    const transport = new MockTransport();
    const changes: Array<ConnectResult | undefined> = [];
    const client = new PhantasmaLink5(transport, { onSessionChange: (c) => changes.push(c) });
    establish(transport, 'sess-a', { address: 'P2K...', name: 'Main' });

    pushAccounts(transport, 'sess-a', [{ address: 'P2OTHER', name: 'Other' }]);
    pushAccounts(transport, 'sess-b', [{ address: 'P2K...', name: 'Renamed' }]);
    pushAccounts(transport, 'sess-a', 'not a list');

    expect(client.account).toEqual({ address: 'P2K...', name: 'Main' });
    expect(changes).toHaveLength(1);
  });

  // Spec §7: 4100 to a request made in the session means the wallet no longer keeps it, so the
  // client drops it; 4100 to a request without a session leaves nothing to drop.
  it('drops the session on a 4100 answer to a request made in it', async () => {
    const transport = new MockTransport();
    const changes: unknown[] = [];
    const client = new PhantasmaLink5(transport, {
      sessionId: 'gone',
      onSessionChange: (c) => changes.push(c),
    });
    const refuse = () =>
      transport.inject(
        JSON.stringify({
          plv: PLV,
          id: transport.lastEnvelope().id,
          error: { code: LinkErrorCode.Unauthorized, message: 'No valid session' },
        })
      );

    const first = client.getChains();
    expect(transport.lastEnvelope().session).toBe('gone');
    refuse();
    await expect(first).rejects.toMatchObject({ code: LinkErrorCode.Unauthorized });
    expect(changes).toEqual([undefined]);

    const second = client.getChains();
    expect(transport.lastEnvelope().session).toBeUndefined();
    refuse();
    await expect(second).rejects.toMatchObject({ code: LinkErrorCode.Unauthorized });
    expect(changes).toEqual([undefined]);
    expect(client.isClosed).toBe(false);
  });

  // Spec §7: 5006 means that the user has another account selected in the wallet. The session
  // lives on, so the client keeps it and sends the next request in it again.
  it('keeps the session on a 5006 answer', async () => {
    const transport = new MockTransport();
    const changes: unknown[] = [];
    const client = new PhantasmaLink5(transport, {
      sessionId: 'kept',
      onSessionChange: (c) => changes.push(c),
    });

    const first = client.getChains();
    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: transport.lastEnvelope().id,
        error: {
          code: LinkErrorCode.AccountNotSelected,
          message: 'Select the account of this session',
          data: { address: 'P2KTest' },
        },
      })
    );
    await expect(first).rejects.toMatchObject({
      code: LinkErrorCode.AccountNotSelected,
      data: { address: 'P2KTest' },
    });
    expect(changes).toEqual([]);

    const second = client.getChains();
    expect(transport.lastEnvelope().session).toBe('kept');
    transport.inject(JSON.stringify({ plv: PLV, id: transport.lastEnvelope().id, result: {} }));
    await second;
  });

  // Spec §7: an answer that comes after the timeout belongs to the session its request named. A
  // 5100 to a request of an ended session must not end the session that came after it, and an
  // answer to a request this client never sent ends nothing over injected and loopback.
  it('keeps a newer session on a late answer to a request of an older one', async () => {
    const transport = new MockTransport();
    const changes: unknown[] = [];
    const client = new PhantasmaLink5(transport, {
      sessionId: 'old',
      requestTimeoutMs: 5,
      onSessionChange: (connect) => changes.push(connect?.session.id),
    });
    const timedOut = client.getChains();
    const oldRequest = transport.lastEnvelope().id;
    await expect(timedOut).rejects.toMatchObject({ code: LinkErrorCode.Timeout });
    transport.inject(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        event: 'pha_sessionEstablished',
        session: 'new',
        data: {
          wallet: { name: 'Wallet', version: '1.0' },
          capabilities: {
            plvVersions: [5],
            methods: [],
            chains: [],
            txFormats: [],
            signatureKinds: [],
            features: [],
          },
          account: { address: 'P2KTest' },
          session: { id: 'new', expiresAt: null },
        },
      })
    );

    const expired = (id: string) =>
      transport.inject(
        JSON.stringify({
          plv: PLV,
          id,
          error: { code: LinkErrorCode.SessionExpired, message: 'Session expired' },
        })
      );
    expired(oldRequest);
    expect(client.takeUnmatchedResponse()).toMatchObject({
      id: oldRequest,
      request: { session: 'old' },
    });
    expired('sent-by-an-earlier-page');
    expect(client.takeUnmatchedResponse()?.request).toBeUndefined();

    expect(changes).toEqual(['new']);
    expect(client.account?.address).toBe('P2KTest');
    void client.getChains().catch(() => undefined);
    expect(transport.lastEnvelope().session).toBe('new');
    client.close();
  });

  // Events reach subscribers through the client facade, and close() makes further calls fail
  // and stops delivery.
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
    expect(client.isClosed).toBe(true);
    await expect(client.getChains()).rejects.toMatchObject({ name: 'LinkError' });
    transport.inject(
      JSON.stringify({ plv: PLV, type: 'event', event: 'pha_chainChanged', data: {} })
    );
    expect(events).toEqual(['pha_accountsChanged']);
  });

  // Spec §11: a payload above the limit the wallet advertised for this transport (a
  // transaction, a message to sign or a script) fails with 5001 before anything is sent, and
  // the error carries the limit.
  it('refuses a payload above the advertised limit before sending', async () => {
    const transport = new KindMockTransport();
    const client = new PhantasmaLink5(transport);
    const connecting = client.connect({ name: 'dApp', url: 'https://d.app' });
    transport.inject(
      JSON.stringify({
        plv: PLV,
        id: transport.lastEnvelope().id,
        result: {
          wallet: { name: 'W', version: '1' },
          capabilities: {
            plvVersions: [5],
            methods: [],
            chains: [],
            txFormats: [],
            signatureKinds: [],
            features: [],
            maxPayloadBytes: { loopback: 3 },
          },
          account: { address: 'P2K...' },
          session: { id: 'sess-1', expiresAt: null },
        },
      })
    );
    await connecting;
    const sentBefore = transport.sent.length;

    await expect(
      client.signTransaction({ format: 'script', tx: 'AAAAAA==' })
    ).rejects.toMatchObject({ code: LinkErrorCode.PayloadTooLarge, data: { maxPayloadBytes: 3 } });
    await expect(
      client.sendTransaction({ format: 'script', tx: 'AAAAAA==' })
    ).rejects.toMatchObject({ code: LinkErrorCode.PayloadTooLarge });
    await expect(client.signMessage({ message: 'AAAAAA==' })).rejects.toMatchObject({
      code: LinkErrorCode.PayloadTooLarge,
      data: { maxPayloadBytes: 3 },
    });
    await expect(client.invokeScript({ chain: 'main', script: 'AAAAAA==' })).rejects.toMatchObject({
      code: LinkErrorCode.PayloadTooLarge,
    });
    expect(transport.sent.length).toBe(sentBefore);

    const fitting = client.signTransaction({ format: 'script', tx: 'AAAA' }); // 3 bytes fit
    expect(transport.sent.length).toBe(sentBefore + 1);
    transport.inject(
      JSON.stringify({ plv: PLV, id: transport.lastEnvelope().id, result: { signedTx: 'AAAA' } })
    );
    await expect(fitting).resolves.toEqual({ signedTx: 'AAAA' });
  });

  // Without a connect result the chain maximum of 32 MiB still applies (spec §11).
  it('refuses a transaction above the chain maximum', async () => {
    const transport = new KindMockTransport();
    const client = new PhantasmaLink5(transport);
    const tx = 'A'.repeat(4 * Math.ceil((MAX_TX_BYTES + 3) / 3));
    await expect(client.sendTransaction({ format: 'carbon', tx })).rejects.toMatchObject({
      code: LinkErrorCode.PayloadTooLarge,
      data: { maxPayloadBytes: MAX_TX_BYTES },
    });
    expect(transport.sent).toHaveLength(0);
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

  // Spec §9.8 counts on a client that waits 5 minutes for an answer; a loopback consent takes as
  // long as any other.
  it('waits 5 minutes for an answer over loopback', async () => {
    jest.useFakeTimers();
    try {
      const client = PhantasmaLink5.loopback({ webSocketFactory: (url) => new FakeSocket(url) });
      let outcome: unknown;
      client.getChains().catch((error: unknown) => (outcome = error));
      await jest.advanceTimersByTimeAsync(DEEPLINK_REQUEST_TIMEOUT_MS - 1);
      expect(outcome).toBeUndefined();
      await jest.advanceTimersByTimeAsync(1);
      expect(outcome).toMatchObject({ code: LinkErrorCode.Timeout });
    } finally {
      jest.useRealTimers();
    }
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
