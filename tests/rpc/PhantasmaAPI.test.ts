import { PhantasmaAPI } from '../../src/core/rpc/phantasma';

class CapturingAPI extends PhantasmaAPI {
  calls: Array<{ method: string; params: Array<unknown> }> = [];
  nextResult: unknown = 0;

  constructor() {
    super('https://example.invalid/rpc', null, 'main');
  }

  async JSONRPC(method: string, params: Array<unknown>): Promise<unknown> {
    this.calls.push({ method, params });
    return this.nextResult;
  }
}

describe('PhantasmaAPI RPC shapes', () => {
  // Verifies block transaction counts require the explicit chain argument expected by RPC.
  test('getBlockTransactionCountByHash sends chain-aware params', async () => {
    const api = new CapturingAPI();
    api.nextResult = '7';

    const count = await api.getBlockTransactionCountByHash('main', 'ABCDEF');

    expect(count).toBe(7);
    expect(api.calls).toEqual([
      { method: 'getBlockTransactionCountByHash', params: ['main', 'ABCDEF'] },
    ]);
  });

  // Verifies the transaction-by-block lookup requires the current explicit-chain RPC parameter order.
  test('getTransactionByBlockHashAndIndex sends chain-aware params', async () => {
    const api = new CapturingAPI();
    api.nextResult = { hash: 'TX' };

    const result = await api.getTransactionByBlockHashAndIndex('main', 'ABCDEF', 2);

    expect(result).toEqual({ hash: 'TX' });
    expect(api.calls).toEqual([
      { method: 'getTransactionByBlockHashAndIndex', params: ['main', 'ABCDEF', 2] },
    ]);
  });

  // Verifies newly documented Carbon helpers emit the exact RPC method names and parameters.
  test('new Carbon RPC helpers use current parameter order', async () => {
    const api = new CapturingAPI();

    await api.getTokenSeriesById('CROWN', 17n, 'series-alpha', 3);
    await api.getVersion();
    await api.getPhantasmaVmConfig('main');

    expect(api.calls).toEqual([
      { method: 'getTokenSeriesById', params: ['CROWN', '17', 'series-alpha', 3] },
      { method: 'getVersion', params: [] },
      { method: 'getPhantasmaVmConfig', params: ['main'] },
    ]);
  });
});
