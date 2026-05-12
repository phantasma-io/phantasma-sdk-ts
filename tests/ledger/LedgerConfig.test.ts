import { PhantasmaAPI } from '../../src/core';
import {
  getLedgerAccountSigner,
  LedgerBip32Factory,
  LedgerBip39,
  LedgerClientConfig,
  LedgerCompatibleConfig,
  LedgerConfig,
  LedgerTransport,
  normalizeLedgerConfig,
} from '../../src/ledger';
import type { LedgerTransportDevice } from '../../src/ledger/interfaces/device';

const PUBLIC_KEY = '01'.repeat(32);

function createTransport(publicKey: string = PUBLIC_KEY): LedgerTransport {
  const device: LedgerTransportDevice = {
    exchange: async () => Buffer.from(`${publicKey}9000`, 'hex'),
    close: async () => undefined,
  };

  return {
    isSupported: async () => true,
    list: async () => ['ledger-path'],
    open: async () => device,
  };
}

const bip39: LedgerBip39 = {
  mnemonicToSeedSync: () => Buffer.alloc(32, 1),
  entropyToMnemonic: () => 'seed words',
};

const bip32Factory: LedgerBip32Factory = () => ({
  fromSeed: () => ({
    privateKey: Buffer.alloc(32, 2),
    derivePath: () => ({
      privateKey: Buffer.alloc(32, 3),
      derivePath: () => {
        throw new Error('nested derivation is not used by these tests');
      },
    }),
  }),
});

function createCamelConfig(transport: LedgerTransport = createTransport()): LedgerClientConfig {
  return {
    transport,
    bip39,
    bip32Factory,
    curve: 'curve',
    nexusName: 'localnet',
    chainName: 'main',
    rpc: new PhantasmaAPI('http://localhost:5172/rpc', null, 'localnet'),
  };
}

function createLegacyConfig(transport: LedgerTransport = createTransport()): LedgerConfig {
  return {
    Debug: true,
    Transport: transport,
    Bip39: bip39,
    Bip32Factory: bip32Factory,
    Curve: 'curve',
    NexusName: 'localnet',
    ChainName: 'main',
    Payload: 'payload',
    TokenNames: ['SOUL'],
    RPC: new PhantasmaAPI('http://localhost:5172/rpc', null, 'localnet'),
    GasPrice: 100000,
    GasLimit: 21000,
    VerifyResponse: true,
  };
}

describe('Ledger compatible config', () => {
  test('normalizes canonical lower-camel config', () => {
    // Behavior: lower-camel Ledger config accepts the mandatory dependencies
    // while defaulting optional transaction/debug policy fields.
    const transport = createTransport();
    const normalized = normalizeLedgerConfig(createCamelConfig(transport));

    expect(normalized.debug).toBe(false);
    expect(normalized.transport).toBe(transport);
    expect(normalized.bip39).toBe(bip39);
    expect(normalized.bip32Factory).toBe(bip32Factory);
    expect(normalized.curve).toBe('curve');
    expect(normalized.nexusName).toBe('localnet');
    expect(normalized.chainName).toBe('main');
    expect(normalized.payload).toBe('');
    expect(normalized.tokenNames).toStrictEqual([]);
    expect(normalized.gasPrice).toBe(0);
    expect(normalized.gasLimit).toBe(0);
    expect(normalized.verifyResponse).toBe(false);
  });

  test('normalizes legacy PascalCase config without changing semantics', () => {
    // Behavior: legacy PascalCase config remains accepted without requiring
    // consumers to migrate all fields in the same release.
    const transport = createTransport();
    const normalized = normalizeLedgerConfig(createLegacyConfig(transport));

    expect(normalized.debug).toBe(true);
    expect(normalized.transport).toBe(transport);
    expect(normalized.nexusName).toBe('localnet');
    expect(normalized.chainName).toBe('main');
    expect(normalized.payload).toBe('payload');
    expect(normalized.tokenNames).toStrictEqual(['SOUL']);
    expect(normalized.gasPrice).toBe(100000);
    expect(normalized.gasLimit).toBe(21000);
    expect(normalized.verifyResponse).toBe(true);
  });

  test('keeps documented defaults while still requiring mandatory fields', () => {
    // Behavior: explicit lower-camel optional values override defaults, while
    // mandatory dependencies still fail with targeted errors.
    const normalized = normalizeLedgerConfig({
      ...createCamelConfig(),
      debug: true,
      payload: 'payload',
      tokenNames: ['SOUL'],
      gasPrice: 100000,
      gasLimit: 21000,
      verifyResponse: true,
    });

    expect(normalized.debug).toBe(true);
    expect(normalized.payload).toBe('payload');
    expect(normalized.tokenNames).toStrictEqual(['SOUL']);
    expect(normalized.gasPrice).toBe(100000);
    expect(normalized.gasLimit).toBe(21000);
    expect(normalized.verifyResponse).toBe(true);
    expect(() => normalizeLedgerConfig({ debug: false } as LedgerCompatibleConfig)).toThrow(
      'transport is a required ledger config parameter.'
    );
  });

  test('ledger account signer exposes canonical methods from lower-camel config', async () => {
    // Behavior: SDK-created signers expose the new lower-camel methods while
    // keeping the legacy methods available through the extended contract.
    const signer = await getLedgerAccountSigner(createCamelConfig(), 0);

    expect(signer.getPublicKey()).toBe(PUBLIC_KEY);
    expect(signer.getAccount().text).toMatch(/^P/);
  });
});
