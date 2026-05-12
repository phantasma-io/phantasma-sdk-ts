import * as publicApi from '../../src/public';
import {
  Address,
  Bytes32,
  PhantasmaAPI,
  PhantasmaKeys,
  ScriptBuilder,
  Transaction,
  TxMsg,
  TxTypes,
  VMObject,
} from '../../src/public';
import type {
  CarbonBlobLike,
  ContractDescriptor,
  KeyPair,
  LinkAccount,
  StackLike,
  TokenDescriptor,
} from '../../src/public';

describe('public entrypoint', () => {
  test('exports the canonical SDK surface without legacy compatibility barrels', () => {
    expect(publicApi).toHaveProperty('Address');
    expect(publicApi).toHaveProperty('PhantasmaAPI');
    expect(publicApi).toHaveProperty('PhantasmaKeys');
    expect(publicApi).toHaveProperty('ScriptBuilder');
    expect(publicApi).toHaveProperty('Transaction');
    expect(publicApi).toHaveProperty('VMObject');
    expect(publicApi).toHaveProperty('TxMsg');
    expect(publicApi).not.toHaveProperty('PhantasmaTS');
    expect(publicApi).not.toHaveProperty('ISerializable');
  });

  test('supports ordinary typed consumer usage through canonical names', () => {
    const keys = PhantasmaKeys.generate();
    const keyPair: KeyPair = keys;
    const address = Address.fromPublicKey(keyPair.publicKey);

    expect(address.text).toBe(keys.address.text);

    const script = new ScriptBuilder().beginScript().emitVarString('public-api').endScript();
    const tx = new Transaction('testnet', 'main', script, new Date('2026-01-01T00:00:00Z'), '');
    const decoded = Transaction.fromBytes(tx.toByteArray(false));

    expect(decoded.toStringEncoded(false)).toBe(tx.toStringEncoded(false));
    expect(VMObject.fromObject('value')?.asString()).toBe('value');
    expect(new Bytes32(Uint8Array.from({ length: 32 }, (_, i) => i)).toHex()).toHaveLength(64);
    expect(new TxMsg().type).toBe(TxTypes.Call);
    expect(new PhantasmaAPI('http://localhost:5172/rpc', null, 'simnet')).toBeInstanceOf(
      PhantasmaAPI
    );
  });

  test('exports canonical structural types for application code', () => {
    const values: number[] = [];
    const stack: StackLike<number> = {
      push(item: number) {
        values.push(item);
      },
      pop() {
        return values.pop();
      },
      peek() {
        return values.at(-1);
      },
      size() {
        return values.length;
      },
    };
    stack.push(7);

    const account: LinkAccount = {
      alias: 'main',
      name: 'Main',
      address: Address.nullText,
      avatar: '',
      platform: 'phantasma',
      external: '',
      balances: [],
      files: [],
    };
    const blob: CarbonBlobLike = { write: () => undefined, read: () => undefined };
    const contract: ContractDescriptor = {
      name: 'account',
      abi: publicApi.ContractInterface.Empty,
    };
    const token: Partial<TokenDescriptor> = {
      name: 'Soul',
      symbol: 'SOUL',
      owner: Address.nullAddress,
    };

    expect(stack.peek()).toBe(7);
    expect(account.address).toBe(Address.nullText);
    expect(blob).toHaveProperty('write');
    expect(contract.name).toBe('account');
    expect(token.symbol).toBe('SOUL');
  });
});
