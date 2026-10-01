import { PhantasmaLink5 } from '../../src/link/v5/client.js';
import {
  InjectedTransport,
  PhantasmaLinkProvider,
  findInjectedProvider,
} from '../../src/link/v5/injected-transport.js';
import { LinkError, LinkErrorCode } from '../../src/link/v5/errors.js';
import { PLV } from '../../src/link/v5/protocol.js';

/** A fake `window.phantasmaLink`: records request frames, answers them through `answer`,
 * and pushes event frames to its subscribers. */
class FakeProvider implements PhantasmaLinkProvider {
  readonly plvVersions: readonly number[] = [PLV];
  readonly requests: string[] = [];
  private readonly handlers = new Set<(frame: string) => void>();
  unsubscribed = 0;
  /** Decides the answer to a request frame. The default is an empty success result. */
  answer: (frame: string) => Promise<string> = async (frame) => {
    const { id } = JSON.parse(frame) as { id: string };
    return JSON.stringify({ plv: PLV, id, result: {} });
  };

  request(frame: string): Promise<string> {
    this.requests.push(frame);
    return this.answer(frame);
  }

  onEvent(handler: (frame: string) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
      this.unsubscribed += 1;
    };
  }

  emit(frame: string): void {
    for (const handler of this.handlers) {
      handler(frame);
    }
  }

  lastRequest(): { id: string; method?: string; session?: string } {
    return JSON.parse(this.requests[this.requests.length - 1]);
  }
}

/** The `pha_connect` result a wallet returns, in the shape the client adopts. */
function connectResult(id: string): string {
  return JSON.stringify({
    plv: PLV,
    id,
    result: {
      wallet: { name: 'Aura', version: '0.1.0' },
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
  });
}

describe('findInjectedProvider (spec 6.1 detection)', () => {
  // The provider is present when the object exists, request is a function, and
  // plvVersions contains 5.
  it('returns the provider when it has the spec shape', () => {
    const provider = new FakeProvider();
    expect(findInjectedProvider({ phantasmaLink: provider })).toBe(provider);
  });

  it('returns undefined when the slot is empty', () => {
    expect(findInjectedProvider({})).toBeUndefined();
    expect(findInjectedProvider({ phantasmaLink: null })).toBeUndefined();
  });

  it('returns undefined when request is not a function', () => {
    expect(
      findInjectedProvider({ phantasmaLink: { plvVersions: [5], onEvent: () => () => {} } })
    ).toBeUndefined();
  });

  it('returns undefined when plvVersions lacks 5', () => {
    const provider = { plvVersions: [6], request: async () => '', onEvent: () => () => {} };
    expect(findInjectedProvider({ phantasmaLink: provider })).toBeUndefined();
  });
});

describe('InjectedTransport', () => {
  // One send is one provider request; the response frame reaches the message handler.
  it('sends one frame per request and delivers the response to onMessage', async () => {
    const provider = new FakeProvider();
    const transport = new InjectedTransport({ provider });
    const received: string[] = [];
    transport.onMessage((frame) => received.push(frame));

    await transport.send(JSON.stringify({ plv: PLV, id: 'r1', method: 'pha_getChains' }));

    expect(provider.requests).toHaveLength(1);
    expect(JSON.parse(received[0])).toEqual({ plv: PLV, id: 'r1', result: {} });
  });

  // Event frames come through the provider subscription; close() unsubscribes.
  it('delivers event frames to onMessage and unsubscribes on close', () => {
    const provider = new FakeProvider();
    const transport = new InjectedTransport({ provider });
    const received: string[] = [];
    transport.onMessage((frame) => received.push(frame));

    const event = JSON.stringify({ plv: PLV, type: 'event', event: 'pha_accountsChanged' });
    provider.emit(event);
    expect(received).toEqual([event]);

    transport.close();
    provider.emit(event);
    expect(received).toHaveLength(1);
    expect(provider.unsubscribed).toBe(1);
  });

  // Frames are JSON text. A provider that pushes an object pushes nothing the transport
  // can deliver.
  it('ignores an event that is not a text frame', () => {
    const provider = new FakeProvider();
    const transport = new InjectedTransport({ provider });
    const received: string[] = [];
    transport.onMessage((frame) => received.push(frame));

    provider.emit({ plv: PLV, type: 'event' } as unknown as string);
    expect(received).toHaveLength(0);
  });

  // A bridge failure is the only case that rejects the provider promise; the transport turns
  // it into a 4900 LinkError.
  it('rejects send with 4900 when the provider rejects', async () => {
    const provider = new FakeProvider();
    provider.answer = async () => {
      throw new Error('port closed');
    };
    const transport = new InjectedTransport({ provider });

    const sending = transport.send(JSON.stringify({ plv: PLV, id: 'r1', method: 'x' }));
    await expect(sending).rejects.toBeInstanceOf(LinkError);
    await expect(sending).rejects.toMatchObject({
      code: LinkErrorCode.Disconnected,
      message: expect.stringContaining('port closed'),
    });
  });

  it('rejects send with 4900 when the response is not a text frame', async () => {
    const provider = new FakeProvider();
    provider.answer = async () => ({ plv: PLV }) as unknown as string;
    const transport = new InjectedTransport({ provider });

    await expect(
      transport.send(JSON.stringify({ plv: PLV, id: 'r1', method: 'x' }))
    ).rejects.toMatchObject({ code: LinkErrorCode.Disconnected });
  });

  it('throws 4900 at construction when no provider is present', () => {
    expect(() => new InjectedTransport({ provider: undefined })).toThrow(LinkError);
    expect(() => new InjectedTransport({})).toThrow(
      expect.objectContaining({ code: LinkErrorCode.Disconnected })
    );
  });
});

describe('PhantasmaLink5.injected', () => {
  // The factory builds a working client: connect adopts the session, later calls carry it.
  it('connects through the provider and keeps the session on later calls', async () => {
    const provider = new FakeProvider();
    provider.answer = async (frame) => {
      const { id, method } = JSON.parse(frame) as { id: string; method: string };
      if (method === 'pha_connect') {
        return connectResult(id);
      }
      return JSON.stringify({
        plv: PLV,
        id,
        result: { chains: ['phantasma:mainnet'], current: 'phantasma:mainnet', nexus: 'mainnet' },
      });
    };
    const client = PhantasmaLink5.injected({ provider });

    const result = await client.connect({ name: 'dApp', url: 'https://d.app' });
    expect(result.wallet.name).toBe('Aura');
    expect(client.account?.address).toBe('P2K...');

    await expect(client.getChains()).resolves.toMatchObject({ nexus: 'mainnet' });
    expect(provider.lastRequest().session).toBe('sess-1');
  });

  // Several requests may be in flight; each response finds its request by id even when the
  // wallet answers them out of order.
  it('matches concurrent responses by id', async () => {
    const provider = new FakeProvider();
    const release: Array<() => void> = [];
    provider.answer = (frame) =>
      new Promise((resolve) => {
        const { id, method } = JSON.parse(frame) as { id: string; method: string };
        release.push(() => resolve(JSON.stringify({ plv: PLV, id, result: { nexus: method } })));
      });
    const client = PhantasmaLink5.injected({ provider });

    const first = client.getChains();
    const second = client.getWalletInfo();
    expect(release).toHaveLength(2);
    release[1]();
    release[0]();

    await expect(first).resolves.toMatchObject({ nexus: 'pha_getChains' });
    await expect(second).resolves.toMatchObject({ nexus: 'pha_getWalletInfo' });
  });

  // The caller of a typed method sees a bridge failure as a 4900 LinkError.
  it('reports a bridge failure to the caller as 4900', async () => {
    const provider = new FakeProvider();
    provider.answer = async () => {
      throw new Error('extension reloaded');
    };
    const client = PhantasmaLink5.injected({ provider });

    await expect(client.getChains()).rejects.toMatchObject({
      code: LinkErrorCode.Disconnected,
      message: expect.stringContaining('extension reloaded'),
    });
  });

  // Wallet events pushed through the provider reach the client's event subscribers.
  it('forwards wallet events to the client subscribers', () => {
    const provider = new FakeProvider();
    const client = PhantasmaLink5.injected({ provider });
    const seen: Array<[string, unknown]> = [];
    client.onEvent((event, data) => seen.push([event, data]));

    provider.emit(
      JSON.stringify({
        plv: PLV,
        type: 'event',
        session: 'sess-1',
        event: 'pha_accountsChanged',
        data: { accounts: ['P2K...'] },
      })
    );

    expect(seen).toEqual([['pha_accountsChanged', { accounts: ['P2K...'] }]]);
  });
});
