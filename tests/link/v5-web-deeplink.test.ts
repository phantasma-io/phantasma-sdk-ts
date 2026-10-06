import { jest } from '@jest/globals';
import { PhantasmaLink5 } from '../../src/link/v5/client.js';
import { LinkError, LinkErrorCode } from '../../src/link/v5/errors.js';
import { PLV, DEFAULT_LINK_HOST, SESSION_IDLE_TTL_MS } from '../../src/link/v5/protocol.js';
import { parsePairingUri } from '../../src/link/v5/pairing.js';
import {
  parseRequestUrl,
  buildResponseUrl,
  DEEPLINK_REQUEST_TIMEOUT_MS,
} from '../../src/link/v5/deeplink.js';
import {
  WebDeeplinkOptions,
  WebDeeplinkRecord,
  WEB_DEEPLINK_STORAGE_KEY,
} from '../../src/link/v5/web-deeplink.js';
import type { LinkTransport } from '../../src/link/v5/transport.js';
import { base64UrlToBytes, bytesToBase64 } from '../../src/link/v5/encoding.js';
import { DEFAULT_RELAY_URL } from '../../src/link/v5/relay-transport.js';
import { WebSocketLike } from '../../src/link/v5/loopback-transport.js';
import {
  sealEnvelopeText,
  openEnvelopeText,
  EncryptedFrame,
} from '../../src/link/v5/session-crypto.js';

const DAPP = { name: 'Web dApp', url: 'https://dapp.example' };

// A canonical wallet ConnectResult, as the C# dispatcher returns it.
const CONNECT_RESULT = {
  wallet: { name: 'PGL', version: '1.0' },
  capabilities: {
    plvVersions: [5],
    methods: [],
    chains: [],
    txFormats: [],
    signatureKinds: [],
  },
  account: { address: 'P2KTestAddr' },
  session: { id: 'sess-1' },
};

/** A relay socket double: it stays connecting until a test opens it, and the test plays the
 * relay server. */
class FakeRelaySocket implements WebSocketLike {
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
  sentJson(): Array<{ op: string; topic?: string; id?: string; payload?: unknown }> {
    return this.sent.map((text) => JSON.parse(text));
  }
}

/** Fake browser surface: storage, page URL, navigation events, opener, relay sockets - all
 * observable. This is the injected-hooks contract the factory promises to be testable against. */
class FakeWebEnv {
  store = new Map<string, string>();
  opened: string[] = [];
  replaced: string[] = [];
  href = 'https://dapp.example/app';
  changeHandlers = new Set<() => void>();
  unsubscribed = 0;
  sockets: FakeRelaySocket[] = [];

  readonly storage = {
    getItem: (key: string) => this.store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      this.store.set(key, value);
    },
    removeItem: (key: string) => {
      this.store.delete(key);
    },
  };

  options(): Omit<WebDeeplinkOptions, 'dapp'> {
    return {
      storage: this.storage,
      opener: (url) => this.opened.push(url),
      pageUrl: () => this.href,
      onUrlChange: (handler) => {
        this.changeHandlers.add(handler);
        return () => {
          this.changeHandlers.delete(handler);
          this.unsubscribed += 1;
        };
      },
      replaceUrl: (url) => {
        this.replaced.push(url);
        this.href = url;
      },
      webSocketFactory: (url) => {
        const socket = new FakeRelaySocket(url);
        this.sockets.push(socket);
        return socket;
      },
    };
  }

  /** The relay socket of the newest client. */
  relay(): FakeRelaySocket {
    return this.sockets[this.sockets.length - 1];
  }

  /** Simulate the wallet opening a URL at the page (the OS brings the tab back). */
  navigate(url: string): void {
    this.href = url;
    for (const handler of [...this.changeHandlers]) {
      handler();
    }
  }

  record(): WebDeeplinkRecord {
    return JSON.parse(this.store.get(WEB_DEEPLINK_STORAGE_KEY)!) as WebDeeplinkRecord;
  }
}

/** A transport that sends nothing anywhere, for checks of the client's options. */
class FakeTransportForIdle implements LinkTransport {
  send(): void {}
  onMessage(): void {}
  close(): void {}
}

/** "Wallet side" of a hop: unseal the request frame from the URL the client opened. */
function unsealRequest(
  url: string,
  key: Uint8Array
): { topic: string; envelope: { id: string; method: string; params?: Record<string, unknown> } } {
  const parsed = parseRequestUrl(url)!;
  const envelope = JSON.parse(openEnvelopeText(JSON.parse(parsed.frame) as EncryptedFrame, key));
  return { topic: parsed.topic, envelope };
}

/** "Wallet side" of the return hop: navigate the page to a sealed response URL. */
function respond(env: FakeWebEnv, key: Uint8Array, id: string, result: unknown): void {
  const record = env.record();
  const frame = JSON.stringify(sealEnvelopeText(JSON.stringify({ plv: PLV, id, result }), key));
  env.navigate(buildResponseUrl(record.callback, record.topic, frame));
}

/** A sealed error answer as the wallet's callback URL. */
function errorUrl(record: WebDeeplinkRecord, key: Uint8Array, id: string, code: number): string {
  const envelope = JSON.stringify({ plv: PLV, id, error: { code, message: 'Session expired' } });
  const frame = JSON.stringify(sealEnvelopeText(envelope, key));
  return buildResponseUrl(record.callback, record.topic, frame);
}

/** Runs a first connect; resolves with the client and the pairing key. */
async function connected(
  env: FakeWebEnv,
  connectResult: unknown = CONNECT_RESULT
): Promise<{ client: PhantasmaLink5; key: Uint8Array }> {
  const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
  const key = base64UrlToBytes(env.record().key);
  const connecting = client.connect();
  respond(env, key, unsealRequest(env.opened[0], key).envelope.id, connectResult);
  await connecting;
  return { client, key };
}

describe('PhantasmaLink5.webDeeplink', () => {
  // First run: pairing material is generated and persisted BEFORE any hop, the pairing URI
  // is a sym universal link carrying that exact material, and nothing auto-opens.
  it('generates and persists pairing material and exposes a sym universal-link pairing URI', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });

    const record = env.record();
    expect(record.v).toBe(1);
    expect(record.topic.length).toBeGreaterThan(0);
    expect(base64UrlToBytes(record.key)).toHaveLength(32);
    // The callback is the page URL without any fragment.
    expect(record.callback).toBe('https://dapp.example/app');
    expect(record.sessionId).toBeUndefined();

    expect(client.pairingUri!.startsWith(`https://${DEFAULT_LINK_HOST}/v5/pair#`)).toBe(true);
    const pairing = parsePairingUri(client.pairingUri!);
    expect(pairing.mode).toBe('sym');
    expect(pairing.topic).toBe(record.topic);
    expect(pairing.symKey).toEqual(base64UrlToBytes(record.key));
    expect(pairing.callback).toBe(record.callback);
    expect(pairing.meta).toEqual(DAPP);

    // No session yet, and the factory must not have opened any URL by itself
    // (app-opening navigation is only allowed from a user gesture).
    expect(client.account).toBeUndefined();
    expect(env.opened).toEqual([]);
  });

  // The full first-connect round-trip over the page-URL hop: the request URL carries a
  // sealed envelope (no plaintext), the response navigation resolves the call, and the
  // session lands in storage while the consumed fragment is cleaned from the URL.
  it('runs a sealed connect round-trip and persists the session', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const key = base64UrlToBytes(env.record().key);

    const promise = client.connect();
    expect(env.opened).toHaveLength(1);
    expect(env.opened[0].startsWith('phantasma://v5/req#')).toBe(true);
    expect(env.opened[0]).not.toContain('pha_connect'); // sealed, never plaintext

    const { topic, envelope } = unsealRequest(env.opened[0], key);
    expect(topic).toBe(env.record().topic);
    expect(envelope.method).toBe('pha_connect');
    expect(envelope.params?.dapp).toEqual(DAPP);
    expect(envelope.session).toBeUndefined(); // nothing to resume yet

    respond(env, key, envelope.id, CONNECT_RESULT);
    await expect(promise).resolves.toMatchObject({ session: { id: 'sess-1' } });
    expect(client.account?.address).toBe('P2KTestAddr');

    // Session persisted for the next page load; pairing material unchanged.
    const record = env.record();
    expect(record.sessionId).toBe('sess-1');
    expect(record.lastConnect?.account.address).toBe('P2KTestAddr');

    // The consumed response fragment was stripped from the page URL.
    expect(env.replaced).toEqual([record.callback]);
    expect(env.href).toBe(record.callback);
  });

  // A reloaded page restores the same pairing material, shows the cached account without
  // any URL hop, and a later connect() resumes the stored session by default (spec §7).
  it('restores state across a reload and defaults connect() to resume', async () => {
    const env = new FakeWebEnv();
    const first = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const key = base64UrlToBytes(env.record().key);
    const firstConnect = first.connect();
    respond(env, key, unsealRequest(env.opened[0], key).envelope.id, CONNECT_RESULT);
    await firstConnect;
    const recordAfterConnect = env.record();
    first.close();

    // "Reload": a fresh factory over the same storage.
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(env.record().topic).toBe(recordAfterConnect.topic);
    expect(env.record().key).toBe(recordAfterConnect.key);
    // Hop-free hydration from the cached ConnectResult.
    expect(client.account?.address).toBe('P2KTestAddr');
    expect(env.opened).toHaveLength(1); // still only the first connect's hop

    const promise = client.connect();
    const { envelope } = unsealRequest(env.opened[1], key);
    expect(envelope.session).toBe('sess-1'); // resume rides in the envelope by default
    expect(envelope.params?.session).toBeUndefined();
    respond(env, key, envelope.id, CONNECT_RESULT);
    await expect(promise).resolves.toMatchObject({ session: { id: 'sess-1' } });
  });

  // Spec §18.3: the pairing key goes with the session. Disconnect deletes the stored record
  // before the wallet hop (which may unload the page), the client closes once the answer is in,
  // and the next factory call pairs afresh.
  it('ends the pairing with the session on disconnect', async () => {
    const env = new FakeWebEnv();
    const { client, key } = await connected(env);
    const paired = env.record();

    const disconnecting = client.disconnect();
    expect(env.store.has(WEB_DEEPLINK_STORAGE_KEY)).toBe(false);
    const { envelope } = unsealRequest(env.opened[1], key);
    expect(envelope.method).toBe('pha_disconnect');
    expect(envelope.session).toBe('sess-1');
    // The wallet answers on the old channel; the page still takes the answer.
    const frame = JSON.stringify(
      sealEnvelopeText(JSON.stringify({ plv: PLV, id: envelope.id, result: {} }), key)
    );
    env.navigate(buildResponseUrl(paired.callback, paired.topic, frame));
    await disconnecting;

    expect(client.account).toBeUndefined();
    expect(client.isClosed).toBe(true);
    await expect(client.getChains()).rejects.toMatchObject({ code: LinkErrorCode.Disconnected });
    expect(env.opened).toHaveLength(2);

    await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(env.record().topic).not.toBe(paired.topic);
    expect(env.record().key).not.toBe(paired.key);
  });

  // forgetSession ends the session without a wallet hop, and the pairing with it.
  it('ends the pairing on forgetSession without opening the wallet', async () => {
    const env = new FakeWebEnv();
    const { client } = await connected(env);

    client.forgetSession();
    expect(env.store.has(WEB_DEEPLINK_STORAGE_KEY)).toBe(false);
    expect(client.isClosed).toBe(true);
    await expect(client.getChains()).rejects.toMatchObject({ code: LinkErrorCode.Disconnected });
    expect(env.opened).toHaveLength(1); // only the connect
  });

  // Spec §7: a stored session without an answer for the inactivity limit is over; the factory
  // does not resume it and pairs afresh. Every answer moves the limit.
  it('expires a stored session by inactivity and slides it on every answer', async () => {
    const start = Date.UTC(2026, 9, 1);
    jest.useFakeTimers({ now: start });
    try {
      const env = new FakeWebEnv();
      const { client, key } = await connected(env);
      expect(env.record().lastSeenAt).toBe(start);

      jest.setSystemTime(start + SESSION_IDLE_TTL_MS - 1);
      const chains = client.getChains();
      respond(env, key, unsealRequest(env.opened[1], key).envelope.id, {
        chains: [],
        current: '',
        nexus: 'x',
      });
      await chains;
      expect(env.record().lastSeenAt).toBe(start + SESSION_IDLE_TTL_MS - 1);
      client.close();

      // Past the first limit, within the slid one: the session resumes.
      jest.setSystemTime(start + SESSION_IDLE_TTL_MS + 1000);
      const resumed = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
      expect(resumed.account?.address).toBe('P2KTestAddr');
      const topic = env.record().topic;
      resumed.close();

      // A full limit after the last answer: a new pairing, no session.
      jest.setSystemTime(start + 2 * SESSION_IDLE_TTL_MS - 1);
      const fresh = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
      expect(fresh.account).toBeUndefined();
      expect(env.record().topic).not.toBe(topic);
      expect(env.record().sessionId).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  // Spec §7, §10: an error answer from the wallet is activity as well, even with a code that the
  // client also reports itself (4900 from a locked wallet). A timeout is no answer.
  // Spec §7: every session ends by inactivity. A limit of 0 would end the session at the next
  // request, and Infinity would never end it.
  it('refuses an inactivity limit that is no positive number', async () => {
    for (const idleTtlMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const env = new FakeWebEnv();
      await expect(
        PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options(), idleTtlMs })
      ).rejects.toMatchObject({ code: LinkErrorCode.InvalidParams });
      expect(() => new PhantasmaLink5(new FakeTransportForIdle(), { idleTtlMs })).toThrow(
        LinkError
      );
    }
  });

  it('slides the inactivity limit on an error answer, not on a timeout', async () => {
    const start = Date.UTC(2026, 9, 1);
    jest.useFakeTimers({ now: start });
    try {
      const env = new FakeWebEnv();
      const { client, key } = await connected(env);

      jest.setSystemTime(start + 1000);
      const locked = client.getChains();
      const { envelope } = unsealRequest(env.opened[1], key);
      env.navigate(errorUrl(env.record(), key, envelope.id, LinkErrorCode.Disconnected));
      await expect(locked).rejects.toMatchObject({ code: LinkErrorCode.Disconnected });
      expect(env.record().lastSeenAt).toBe(start + 1000);

      const unanswered = client.getChains();
      jest.advanceTimersByTime(DEEPLINK_REQUEST_TIMEOUT_MS);
      await expect(unanswered).rejects.toMatchObject({ code: LinkErrorCode.Timeout });
      expect(env.record().lastSeenAt).toBe(start + 1000);
      client.close();
    } finally {
      jest.useRealTimers();
    }
  });

  // Spec §7: the lifetime the user picked ends the session at `expiresAt`.
  it('does not resume a stored session past its expiresAt', async () => {
    const start = Date.UTC(2026, 9, 1);
    jest.useFakeTimers({ now: start });
    try {
      const env = new FakeWebEnv();
      const hour = 60 * 60 * 1000;
      const { client } = await connected(env, {
        ...CONNECT_RESULT,
        session: { id: 'sess-1', expiresAt: start + hour },
      });
      client.close();
      const topic = env.record().topic;

      jest.setSystemTime(start + hour);
      const fresh = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
      expect(fresh.account).toBeUndefined();
      expect(env.record().topic).not.toBe(topic);
    } finally {
      jest.useRealTimers();
    }
  });

  // A session that runs out while the page stays open ends at the next request: nothing is
  // sent to a wallet that dropped the pairing, and the request fails at once.
  it('ends the pairing when the session lapses in an open page', async () => {
    const start = Date.UTC(2026, 9, 1);
    jest.useFakeTimers({ now: start });
    try {
      const env = new FakeWebEnv();
      const { client } = await connected(env);

      jest.setSystemTime(start + SESSION_IDLE_TTL_MS);
      await expect(client.getChains()).rejects.toMatchObject({
        code: LinkErrorCode.Disconnected,
      });
      expect(env.opened).toHaveLength(1);
      expect(client.isClosed).toBe(true);
      expect(env.store.has(WEB_DEEPLINK_STORAGE_KEY)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  // Spec §7: 5100, 5101 and 4100 to a request in the session mean the wallet ended it.
  it('ends the session and the pairing on a 5100 answer', async () => {
    const env = new FakeWebEnv();
    const { client, key } = await connected(env);
    const record = env.record();

    const chains = client.getChains();
    const { envelope } = unsealRequest(env.opened[1], key);
    env.navigate(errorUrl(record, key, envelope.id, LinkErrorCode.SessionExpired));
    await expect(chains).rejects.toMatchObject({ code: LinkErrorCode.SessionExpired });
    expect(client.isClosed).toBe(true);
    expect(env.store.has(WEB_DEEPLINK_STORAGE_KEY)).toBe(false);
  });

  // The wallet's notice that it ended the session ends the pairing here as well.
  it('ends the pairing on a pha_sessionExpired notice', async () => {
    const env = new FakeWebEnv();
    const { client, key } = await connected(env);
    const record = env.record();

    const notice = JSON.stringify({
      plv: PLV,
      type: 'event',
      event: 'pha_sessionExpired',
      session: 'sess-1',
      data: { session: 'sess-1' },
    });
    const frame = JSON.stringify(sealEnvelopeText(notice, key));
    env.navigate(buildResponseUrl(record.callback, record.topic, frame));
    expect(client.account).toBeUndefined();
    expect(client.isClosed).toBe(true);
    expect(env.store.has(WEB_DEEPLINK_STORAGE_KEY)).toBe(false);
  });

  // The page reloaded while the wallet was open, and the answer says the session is over: the
  // factory pairs afresh and still hands the answer over.
  it('pairs afresh when the answer in the page URL ends the session', async () => {
    const env = new FakeWebEnv();
    const { client, key } = await connected(env);
    const record = env.record();
    client.close();

    env.href = errorUrl(record, key, 'lost-request', LinkErrorCode.SessionRevoked);
    const fresh = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(fresh.isClosed).toBe(false);
    expect(fresh.account).toBeUndefined();
    expect(env.record().topic).not.toBe(record.topic);
    expect(fresh.takeUnmatchedResponse()).toMatchObject({
      id: 'lost-request',
      ok: false,
      error: { code: LinkErrorCode.SessionRevoked },
    });
    expect(env.href).toBe(record.callback);
  });

  // Corrupt persisted state must never brick the dApp: it is discarded and a fresh
  // pairing is generated (the only way forward without the original key).
  it('discards a corrupt stored record and re-pairs fresh', async () => {
    const env = new FakeWebEnv();
    env.storage.setItem(WEB_DEEPLINK_STORAGE_KEY, 'not json at all');
    await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const regenerated = env.record();
    expect(regenerated.v).toBe(1);
    expect(base64UrlToBytes(regenerated.key)).toHaveLength(32);

    // A structurally valid record with a wrong-length key is equally unusable.
    env.storage.setItem(
      WEB_DEEPLINK_STORAGE_KEY,
      JSON.stringify({ v: 1, topic: 't', key: 'AAAA', callback: 'https://dapp.example/app' })
    );
    await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(env.record().topic).not.toBe('t');

    // So is a session without the time of its last activity: it could never expire.
    env.storage.setItem(
      WEB_DEEPLINK_STORAGE_KEY,
      JSON.stringify({ ...regenerated, topic: 'u', sessionId: 'sess-1' })
    );
    await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(env.record().topic).not.toBe('u');

    // And a cached connect result without its session.
    env.storage.setItem(
      WEB_DEEPLINK_STORAGE_KEY,
      JSON.stringify({
        ...regenerated,
        topic: 'w',
        sessionId: 'sess-1',
        lastSeenAt: Date.now(),
        lastConnect: { account: {} },
      })
    );
    await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(env.record().topic).not.toBe('w');

    // And a record without a relay: the wallet would publish the session where nobody listens.
    env.storage.setItem(
      WEB_DEEPLINK_STORAGE_KEY,
      JSON.stringify({ ...regenerated, topic: 'x', relay: undefined })
    );
    await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(env.record().topic).not.toBe('x');
  });

  // ONE-TAP first connection (spec §17 step 3): right after the pairing approval the
  // wallet pushes a sessionEstablished event to the callback - the session goes live and
  // is persisted with NO explicit connect() call and zero dApp-initiated hops.
  it('completes a one-tap first connection from a wallet sessionEstablished push', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const record = env.record();
    const key = base64UrlToBytes(record.key);

    // Wallet side, immediately after the user approves the pairing consent.
    const eventEnvelope = JSON.stringify({
      plv: PLV,
      type: 'event',
      event: 'pha_sessionEstablished',
      session: 'one-tap-1',
      data: { ...CONNECT_RESULT, session: { id: 'one-tap-1' } },
    });
    const frame = JSON.stringify(sealEnvelopeText(eventEnvelope, key));
    env.navigate(buildResponseUrl(record.callback, record.topic, frame));

    expect(client.account?.address).toBe('P2KTestAddr');
    expect(env.record().sessionId).toBe('one-tap-1');
    expect(env.record().lastConnect?.session.id).toBe('one-tap-1');
    expect(env.opened).toEqual([]); // the dApp never had to open a URL
    expect(env.replaced).toEqual([record.callback]); // consumed fragment cleaned
  });

  // A wallet response already present in the page URL at construction (the callback
  // navigation cold-loaded the page) is consumed and cleaned; foreign fragments are not.
  it('consumes a response already in the page URL on load and cleans the fragment', async () => {
    const env = new FakeWebEnv();
    await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const record = env.record();
    const key = base64UrlToBytes(record.key);

    // Simulate the cold navigation: the page comes up WITH the response in the URL.
    const frame = JSON.stringify(
      sealEnvelopeText(JSON.stringify({ plv: PLV, id: 'stale', result: {} }), key)
    );
    env.href = buildResponseUrl(record.callback, record.topic, frame);
    await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(env.replaced).toEqual([record.callback]);
    expect(env.href).toBe(record.callback);

    // An ordinary SPA route fragment is none of our business.
    env.replaced.length = 0;
    env.href = 'https://dapp.example/app#some-route';
    await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(env.replaced).toEqual([]);
  });

  // Outside a browser the storage hook has no default; the factory must say so clearly
  // instead of failing later on an undefined global.
  it('fails with a clear error when no storage is available', async () => {
    // Pin `localStorage` to undefined regardless of the host runtime, then restore.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
    try {
      await expect(PhantasmaLink5.webDeeplink({ dapp: DAPP })).rejects.toThrow(/storage/);
      await expect(PhantasmaLink5.webDeeplink({ dapp: DAPP })).rejects.toBeInstanceOf(LinkError);
    } finally {
      if (original) {
        Object.defineProperty(globalThis, 'localStorage', original);
      } else {
        delete (globalThis as { localStorage?: unknown }).localStorage;
      }
    }
  });

  // close() must release the page-URL listener so a discarded client cannot keep
  // receiving (or leak) after the dApp moved on.
  it('stops listening for page-URL changes after close', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    expect(env.changeHandlers.size).toBe(1);
    client.close();
    expect(env.unsubscribed).toBe(1);
    expect(env.changeHandlers.size).toBe(0);
  });

  // Deployment knobs: the pairing URI host and the wallet request base are overridable
  // (e.g. a staging link host, or universal-link request URLs instead of the scheme).
  it('honors host and walletBase overrides', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({
      dapp: DAPP,
      host: 'links.staging.example',
      walletBase: 'https://wallet.example/app',
      ...env.options(),
    });
    expect(client.pairingUri!.startsWith('https://links.staging.example/v5/pair#')).toBe(true);

    const promise = client.getChains();
    expect(env.opened[0].startsWith('https://wallet.example/app/v5/req#')).toBe(true);
    client.close();
    await expect(promise).rejects.toMatchObject({ name: 'LinkError' });
  });
});

describe('PhantasmaLink5.webDeeplink over the relay', () => {
  /** The wallet's side of the relay: a sealed envelope delivered on the pairing topic. */
  function deliver(env: FakeWebEnv, key: Uint8Array, envelope: object): void {
    const record = env.record();
    const payload = JSON.stringify(
      sealEnvelopeText(JSON.stringify({ plv: PLV, ...envelope }), key)
    );
    env.relay().receive({ op: 'deliver', topic: record.topic, payload });
  }

  /** The session the wallet publishes over the relay right after the pairing approval. */
  function establish(
    env: FakeWebEnv,
    key: Uint8Array,
    connectResult: object = CONNECT_RESULT
  ): void {
    deliver(env, key, {
      type: 'event',
      event: 'pha_sessionEstablished',
      session: 'sess-1',
      data: connectResult,
    });
  }

  /** The publishes this page sent, opened with the pairing key. */
  function published(env: FakeWebEnv, key: Uint8Array) {
    return env
      .relay()
      .sentJson()
      .filter((frame) => frame.op === 'publish')
      .map((frame) => ({
        id: frame.id as string,
        envelope: JSON.parse(
          openEnvelopeText(JSON.parse(frame.payload as string) as EncryptedFrame, key)
        ) as { id: string; method: string; session?: string },
      }));
  }

  // Spec §15: the pairing carries the relay, and the page subscribes to the topic at once, so
  // that the session the wallet publishes after the approval reaches it.
  it('pairs with a relay and subscribes to the topic', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const record = env.record();
    expect(record.relay).toBe(DEFAULT_RELAY_URL);
    expect(parsePairingUri(client.pairingUri!).relay).toBe(DEFAULT_RELAY_URL);
    expect(env.relay().url).toBe(DEFAULT_RELAY_URL);

    env.relay().open();
    expect(env.relay().sentJson()).toEqual([{ op: 'subscribe', topic: record.topic }]);
    expect(env.opened).toEqual([]);
  });

  it('takes the session the wallet publishes over the relay', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const key = base64UrlToBytes(env.record().key);
    env.relay().open();

    establish(env, key);
    expect(client.account?.address).toBe('P2KTestAddr');
    expect(env.record().sessionId).toBe('sess-1');
    expect(env.opened).toEqual([]);
  });

  // Spec §6.3, §6.4: a web page sends over the relay, so the answer arrives without a reload,
  // and the wake link brings the wallet app to the front.
  it('sends a request over the relay and opens the wake link', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const key = base64UrlToBytes(env.record().key);
    env.relay().open();
    establish(env, key);

    const chains = client.getChains();
    expect(env.opened).toEqual(['phantasma://v5/wake']);
    const [request] = published(env, key);
    expect(request.envelope.method).toBe('pha_getChains');
    expect(request.envelope.session).toBe('sess-1');
    env.relay().receive({ op: 'ack', id: request.id });
    deliver(env, key, { id: request.envelope.id, result: { chains: [], current: '', nexus: 'x' } });
    await expect(chains).resolves.toMatchObject({ nexus: 'x' });
  });

  // Spec §6.3: while the relay is not connected, a request that fits a URL takes the deeplink.
  it('falls back to the deeplink while the relay is not connected', async () => {
    const env = new FakeWebEnv();
    const { client, key } = await connected(env);
    expect(env.relay().readyState).toBe(0);

    const chains = client.getChains();
    expect(env.opened[1].startsWith('phantasma://v5/req#')).toBe(true);
    respond(env, key, unsealRequest(env.opened[1], key).envelope.id, {
      chains: [],
      current: '',
      nexus: 'x',
    });
    await expect(chains).resolves.toMatchObject({ nexus: 'x' });
    expect(published(env, key)).toEqual([]);
  });

  // Spec §6.3: a transaction above the wallet's deeplink limit goes over the relay, also while
  // the relay reconnects: it leaves when the socket opens.
  it('sends a transaction above the deeplink limit over the relay', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const key = base64UrlToBytes(env.record().key);
    env.relay().open();
    establish(env, key, {
      ...CONNECT_RESULT,
      capabilities: { ...CONNECT_RESULT.capabilities, maxPayloadBytes: { deeplink: 100 } },
    });
    // The socket drops; the reconnect is pending.
    env.relay().readyState = 3;
    env.relay().onclose?.({});

    const signing = client.signTransaction({
      format: 'carbon',
      tx: bytesToBase64(new Uint8Array(200)),
    });
    expect(env.opened).toEqual(['phantasma://v5/wake']);
    await new Promise((resolve) => setTimeout(resolve, 600)); // the first reconnect step
    env.relay().open();
    const [request] = published(env, key);
    expect(request.envelope.method).toBe('pha_signTransaction');
    env.relay().receive({ op: 'ack', id: request.id });
    deliver(env, key, { id: request.envelope.id, result: { signedTx: 'AAEC' } });
    await expect(signing).resolves.toEqual({ signedTx: 'AAEC' });
  });

  // When the relay refused the topic for good, a request that a deeplink cannot carry fails at
  // once instead of opening the wallet for nothing.
  it('fails a request too large for a deeplink when the relay is gone', async () => {
    const env = new FakeWebEnv();
    const client = await PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options() });
    const key = base64UrlToBytes(env.record().key);
    env.relay().open();
    establish(env, key);
    env.relay().receive({ op: 'error', code: 'topic_limit', message: 'too many topics' });

    await expect(
      client.signTransaction({ format: 'carbon', tx: bytesToBase64(new Uint8Array(20_000)) })
    ).rejects.toMatchObject({ code: LinkErrorCode.Disconnected });
    expect(env.opened).toEqual([]);
  });

  it('refuses a relay that is not a wss:// URL', async () => {
    const env = new FakeWebEnv();
    await expect(
      PhantasmaLink5.webDeeplink({ dapp: DAPP, ...env.options(), relayUrl: 'ws://relay.example' })
    ).rejects.toMatchObject({ code: LinkErrorCode.InvalidParams });
  });
});
