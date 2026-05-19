import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { PhantasmaAPI } from '../../src/core/rpc/phantasma';
import { isRpcErrorResult, unwrapRpcResult } from '../../src/core/rpc';

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

type RpcHandler = (body: string, response: ServerResponse, request: IncomingMessage) => void;

async function withRpcServer(handler: RpcHandler, run: (url: string) => Promise<void>) {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      handler(Buffer.concat(chunks).toString('utf8'), response, request);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}/rpc`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

describe('PhantasmaAPI RPC shapes', () => {
  test('JSONRPCResult returns typed success results', async () => {
    let postedBody = '';

    await withRpcServer(
      (body, response) => {
        postedBody = body;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', result: { height: 42 }, id: 1 }));
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');
        const result = await api.JSONRPCResult<{ height: number }>('getBlockHeight', ['main']);

        expect(unwrapRpcResult(result)).toEqual({ height: 42 });
        expect(JSON.parse(postedBody)).toMatchObject({
          jsonrpc: '2.0',
          method: 'getBlockHeight',
          params: ['main'],
          id: '1',
        });
      }
    );
  });

  test('JSONRPCResult rejects missing, null, stale, and mismatched response ids', async () => {
    // The typed result path returns a normalized RPC error instead of exposing an uncorrelated result.
    for (const responseId of [undefined, null, 0, '0', '99', { bad: 'id' }]) {
      await withRpcServer(
        (_body, response) => {
          response.setHeader('content-type', 'application/json');
          const envelope: Record<string, unknown> = { jsonrpc: '2.0', result: { height: 42 } };
          if (responseId !== undefined) {
            envelope.id = responseId;
          }
          response.end(JSON.stringify(envelope));
        },
        async (url) => {
          const api = new PhantasmaAPI(url, null, 'localnet');
          const result = await api.JSONRPCResult('getBlockHeight', ['main']);

          expect(isRpcErrorResult(result)).toBe(true);
          expect(result).toMatchObject({
            error: expect.stringContaining('mismatched response id'),
          });
        }
      );
    }
  });

  test('JSONRPCResult increments request ids and accepts only the echoed id', async () => {
    const postedIds: Array<unknown> = [];

    await withRpcServer(
      (body, response) => {
        const request = JSON.parse(body) as { id: string };
        postedIds.push(request.id);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { ok: true } }));
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');

        expect(unwrapRpcResult(await api.JSONRPCResult('first', []))).toEqual({ ok: true });
        expect(unwrapRpcResult(await api.JSONRPCResult('second', []))).toEqual({ ok: true });
      }
    );

    expect(postedIds).toEqual(['1', '2']);
  });

  test('JSONRPCResult normalizes JSON-RPC error objects', async () => {
    await withRpcServer(
      (_body, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'unknown method', data: { method: 'missing' } },
            id: '1',
          })
        );
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');
        const result = await api.JSONRPCResult('missing', []);

        expect(isRpcErrorResult(result)).toBe(true);
        expect(result).toEqual({
          error: 'unknown method',
          code: -32601,
          data: { method: 'missing' },
        });
        expect(() => unwrapRpcResult(result)).toThrow('unknown method');
      }
    );
  });

  test('JSONRPCResult rejects id mismatches before JSON-RPC error objects', async () => {
    await withRpcServer(
      (_body, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'unknown method' },
            id: '0',
          })
        );
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');
        const result = await api.JSONRPCResult('missing', []);

        expect(isRpcErrorResult(result)).toBe(true);
        expect(result).toMatchObject({ error: expect.stringContaining('mismatched response id') });
        expect(result).not.toMatchObject({ error: expect.stringContaining('unknown method') });
      }
    );
  });

  test('blank script error fields are not treated as RPC errors', () => {
    const scriptResult = { events: [], result: '03020800', error: '', results: [], oracles: [] };

    expect(isRpcErrorResult(scriptResult)).toBe(false);
    expect(unwrapRpcResult(scriptResult)).toBe(scriptResult);
  });

  test('JSONRPC preserves historical JSON-RPC application error shape', async () => {
    await withRpcServer(
      (_body, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'unknown method', data: { method: 'missing' } },
            id: '1',
          })
        );
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');
        const result = await api.JSONRPC('missing', []);

        expect(result).toEqual({ error: 'unknown method' });
      }
    );
  });

  test('JSONRPC increments request ids and rejects a stale response echo', async () => {
    // The historical JSONRPC path shares the same request-id contract as
    // JSONRPCResult: a stale echo from the previous request must fail closed.
    const postedIds: string[] = [];

    await withRpcServer(
      (body, response) => {
        const request = JSON.parse(body) as { id: string };
        postedIds.push(request.id);
        const responseId = postedIds.length === 2 ? postedIds[0] : request.id;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: responseId, result: 7 }));
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');

        expect(await api.JSONRPC('first', [])).toBe(7);
        await expect(api.JSONRPC('second', [])).rejects.toThrow('mismatched response id');
      }
    );

    expect(postedIds).toEqual(['1', '2']);
  });

  test('JSONRPC rejects missing, null, stale, and mismatched response ids', async () => {
    // The historical JSONRPC path throws on protocol-level id failures before returning a result.
    for (const responseId of [undefined, null, 0, '0', '99', { bad: 'id' }]) {
      await withRpcServer(
        (_body, response) => {
          response.setHeader('content-type', 'application/json');
          const envelope: Record<string, unknown> = { jsonrpc: '2.0', result: 7 };
          if (responseId !== undefined) {
            envelope.id = responseId;
          }
          response.end(JSON.stringify(envelope));
        },
        async (url) => {
          const api = new PhantasmaAPI(url, null, 'localnet');

          await expect(api.JSONRPC('getBlockHeight', ['main'])).rejects.toThrow(
            'mismatched response id'
          );
        }
      );
    }
  });

  test('JSONRPC rejects success responses without a result field', async () => {
    await withRpcServer(
      (_body, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', id: '1' }));
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');

        await expect(api.JSONRPC('getBlockHeight', ['main'])).rejects.toThrow('returned no result');
      }
    );
  });

  test('JSONRPC rejects id mismatches before application error objects', async () => {
    await withRpcServer(
      (_body, response) => {
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32601, message: 'unknown method' },
            id: '0',
          })
        );
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');

        await expect(api.JSONRPC('missing', [])).rejects.toThrow('mismatched response id');
      }
    );
  });

  test('JSONRPC preserves historical transport and malformed JSON rejection', async () => {
    await withRpcServer(
      (_body, response) => {
        response.statusCode = 503;
        response.statusMessage = 'Service Unavailable';
        response.end('offline');
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');
        await expect(api.JSONRPC('getBlockHeight', ['main'])).rejects.toThrow();
      }
    );

    await withRpcServer(
      (_body, response) => {
        response.setHeader('content-type', 'application/json');
        response.end('{not-json');
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');
        await expect(api.JSONRPC('getBlockHeight', ['main'])).rejects.toThrow();
      }
    );
  });

  test('JSONRPCResult normalizes HTTP and malformed JSON failures', async () => {
    await withRpcServer(
      (_body, response) => {
        response.statusCode = 503;
        response.statusMessage = 'Service Unavailable';
        response.end('offline');
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');
        const result = await api.JSONRPCResult('getBlockHeight', ['main']);

        expect(result).toEqual({
          error: 'HTTP 503: Service Unavailable',
          status: 503,
          statusText: 'Service Unavailable',
        });
      }
    );

    await withRpcServer(
      (_body, response) => {
        response.setHeader('content-type', 'application/json');
        response.end('{not-json');
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet');
        const result = await api.JSONRPCResult('getBlockHeight', ['main']);

        expect(isRpcErrorResult(result)).toBe(true);
        expect(result).toMatchObject({ error: expect.stringMatching(/invalid json|Unexpected/iu) });
      }
    );
  });

  test('JSONRPC paths reject oversized response bodies with configurable limits', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: '1', result: '0123456789ABCDEF' });

    await withRpcServer(
      (_requestBody, response) => {
        response.setHeader('content-type', 'application/json');
        response.setHeader('content-length', String(Buffer.byteLength(body)));
        response.end(body);
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet', {
          maxRpcResponseBytes: Buffer.byteLength(body) - 1,
        });

        const result = await api.JSONRPCResult('getBlockHeight', ['main']);
        expect(isRpcErrorResult(result)).toBe(true);
        expect(result).toMatchObject({ error: expect.stringContaining('exceeds') });
      }
    );

    await withRpcServer(
      (_requestBody, response) => {
        response.setHeader('content-type', 'application/json');
        response.setHeader('content-length', String(Buffer.byteLength(body)));
        response.end(body);
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet', {
          maxRpcResponseBytes: Buffer.byteLength(body) - 1,
        });

        await expect(api.JSONRPC('getBlockHeight', ['main'])).rejects.toThrow('exceeds');
      }
    );
  });

  test('JSONRPC paths reject oversized chunked response bodies before full materialization', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: '1', result: '0123456789ABCDEF' });

    await withRpcServer(
      (_requestBody, response) => {
        response.setHeader('content-type', 'application/json');
        response.write(body.slice(0, 12));
        response.end(body.slice(12));
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet', {
          maxRpcResponseBytes: Buffer.byteLength(body) - 1,
        });

        const result = await api.JSONRPCResult('getBlockHeight', ['main']);
        expect(isRpcErrorResult(result)).toBe(true);
        expect(result).toMatchObject({ error: expect.stringContaining('exceeds') });
      }
    );

    await withRpcServer(
      (_requestBody, response) => {
        response.setHeader('content-type', 'application/json');
        response.write(body.slice(0, 12));
        response.end(body.slice(12));
      },
      async (url) => {
        const api = new PhantasmaAPI(url, null, 'localnet', {
          maxRpcResponseBytes: Buffer.byteLength(body) - 1,
        });

        await expect(api.JSONRPC('getBlockHeight', ['main'])).rejects.toThrow('exceeds');
      }
    );
  });

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

  test('numeric RPC helpers return errors without parsing them as numbers', async () => {
    const api = new CapturingAPI();
    api.nextResult = { error: 'bad block hash' };

    const count = await api.getBlockTransactionCountByHash('main', 'ABCDEF');

    expect(count).toEqual({ error: 'bad block hash' });
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
