import { Address, PhantasmaKeys, ScriptBuilder, Transaction } from '../../src/core';
import {
  matchSigningPermission,
  readSigningPermissionRequest,
} from '../../src/link/v5/signing-permission';
import type { SigningPermission } from '../../src/link/v5/methods';

const NOW = 1_800_000_000_000;
const ACCOUNT = PhantasmaKeys.generate().address;
const SPONSOR = PhantasmaKeys.generate().address;

function permission(overrides: Partial<SigningPermission> = {}): SigningPermission {
  return {
    id: 'p1',
    chain: 'main',
    calls: [{ contract: 'game1', methods: ['move', 'attack'] }],
    expiresAt: NOW + 3_600_000,
    gasLimit: '0',
    gasReserved: '0',
    ...overrides,
  };
}

/** Returns a script transaction that a dApp builds with ScriptBuilder: AllowGas, the body, SpendGas. */
function transaction(
  body: (sb: ScriptBuilder) => ScriptBuilder,
  options: {
    payer?: Address | string;
    price?: bigint | number;
    limit?: bigint | number;
    chain?: string;
    expiresAt?: number;
  } = {}
): Transaction {
  const payer = options.payer ?? SPONSOR;
  const sb = new ScriptBuilder().allowGas(
    payer,
    Address.nullAddress,
    options.price ?? 100_000n,
    options.limit ?? 900n
  );
  const script = body(sb).spendGas(payer).endScript();
  return new Transaction(
    'simnet',
    options.chain ?? 'main',
    script,
    new Date(options.expiresAt ?? NOW + 60_000),
    ''
  );
}

/** Matches `tx` in a request sent at `sentAt`, at `now`; the request was sent at NOW by default. */
function match(
  tx: Transaction,
  granted: SigningPermission = permission(),
  now: number = NOW,
  sentAt: number = NOW
) {
  return matchSigningPermission({ tx, permission: granted, account: ACCOUNT.text, now, sentAt });
}

const move = (sb: ScriptBuilder) => sb.callContract('game1', 'move', [ACCOUNT, 3n]);

// The wallet signs without a prompt only what matchSigningPermission accepts. Every case below is a
// transaction that a hostile or careless dApp could send in a session with a permission.
describe('matchSigningPermission', () => {
  test('accepts a granted call whose gas another address pays, at no gas to the account', () => {
    expect(match(transaction(move))).toEqual({
      matched: true,
      accountGas: 0n,
    });
  });

  test('accepts several granted calls in one transaction', () => {
    const tx = transaction((sb) =>
      move(sb)
        .callContract('game1', 'attack', [ACCOUNT, 'orc'])
        .callContract('items', 'equip', [ACCOUNT])
    );
    const granted = permission({
      calls: [
        { contract: 'game1', methods: ['move', 'attack'] },
        { contract: 'items', methods: ['equip'] },
      ],
    });
    expect(match(tx, granted)).toEqual({ matched: true, accountGas: 0n });
  });

  test('reserves price × limit when the account pays and it fits the rest of the budget', () => {
    const tx = transaction(move, { payer: ACCOUNT, price: 100_000n, limit: 900n });
    const granted = permission({ gasLimit: '100000000', gasReserved: '10000000' });
    expect(match(tx, granted)).toEqual({
      matched: true,
      accountGas: 90_000_000n,
    });
  });

  test('refuses a transaction the account pays when the budget cannot cover it', () => {
    const tx = transaction(move, { payer: ACCOUNT, price: 100_000n, limit: 900n });
    expect(match(tx).matched).toBe(false);
    expect(match(tx, permission({ gasLimit: '100000000', gasReserved: '10000001' })).matched).toBe(
      false
    );
  });

  test('reads text addresses and decimal numbers in the gas calls the way the VM does', () => {
    const tx = transaction(move, { payer: ACCOUNT.text, price: 100000, limit: 900 });
    expect(match(tx, permission({ gasLimit: '90000000' }))).toEqual({
      matched: true,
      accountGas: 90_000_000n,
    });
  });

  test('refuses a method that is not granted and a contract that is not granted', () => {
    expect(
      match(transaction((sb) => sb.callContract('game1', 'withdraw', [ACCOUNT]))).matched
    ).toBe(false);
    expect(match(transaction((sb) => sb.callContract('game2', 'move', [ACCOUNT]))).matched).toBe(
      false
    );
  });

  test('refuses an interop call between the gas calls', () => {
    const tx = transaction((sb) =>
      move(sb).callInterop('Runtime.TransferTokens', [ACCOUNT, SPONSOR, 'SOUL', 1n])
    );
    expect(match(tx).matched).toBe(false);
  });

  // `stake` moves the account's SOUL. Even a permission that a careless wallet stored with it must
  // not let a stake call through.
  test('refuses a built-in contract even when the permission names it', () => {
    const tx = transaction((sb) => sb.callContract('stake', 'Unstake', [ACCOUNT, 1n]));
    const careless = permission({ calls: [{ contract: 'stake', methods: ['Unstake'] }] });
    expect(match(tx, careless).matched).toBe(false);
  });

  test('refuses a script that does not open with AllowGas or close with SpendGas', () => {
    const noGas = new Transaction(
      'simnet',
      'main',
      move(new ScriptBuilder()).endScript(),
      new Date(NOW + 60_000),
      ''
    );
    expect(match(noGas).matched).toBe(false);
    const late = new Transaction(
      'simnet',
      'main',
      move(new ScriptBuilder())
        .allowGas(SPONSOR, Address.nullAddress, 100_000n, 900n)
        .spendGas(SPONSOR)
        .endScript(),
      new Date(NOW + 60_000),
      ''
    );
    expect(match(late).matched).toBe(false);
  });

  // ScriptBuilder.allowGas always passes four values. A fifth one would stay on the VM stack for a
  // later call to pop, so the wallet accepts only the four.
  test('refuses an AllowGas with another number of arguments', () => {
    const sb = new ScriptBuilder().callContract('gas', 'AllowGas', [
      SPONSOR,
      Address.nullAddress,
      100_000n,
      900n,
      ACCOUNT,
    ]);
    const script = move(sb).spendGas(SPONSOR).endScript();
    const tx = new Transaction('simnet', 'main', script, new Date(NOW + 60_000), '');
    expect(match(tx).matched).toBe(false);
  });

  test('refuses a SpendGas for another address than the AllowGas payer', () => {
    const sb = new ScriptBuilder().allowGas(SPONSOR, Address.nullAddress, 100_000n, 900n);
    const script = move(sb).spendGas(ACCOUNT).endScript();
    const tx = new Transaction('simnet', 'main', script, new Date(NOW + 60_000), '');
    expect(match(tx).matched).toBe(false);
  });

  test('refuses another chain, a transaction that outlives the permission, an expired permission', () => {
    expect(match(transaction(move, { chain: 'side' })).matched).toBe(false);
    expect(match(transaction(move, { expiresAt: NOW + 3_600_001 })).matched).toBe(false);
    expect(match(transaction(move), permission(), NOW + 3_600_000).matched).toBe(false);
  });

  test('refuses a negative gas price and an offer above the int64 maximum', () => {
    expect(match(transaction(move, { price: -1n })).matched).toBe(false);
    expect(match(transaction(move, { price: 2n ** 40n, limit: 2n ** 30n })).matched).toBe(false);
  });

  test('refuses a script that ScriptBuilder did not write', () => {
    const tx = transaction(move);
    tx.script = '00' + tx.script; // a NOP in front
    expect(match(tx).matched).toBe(false);
  });

  // A script with the two gas calls and nothing between them calls no granted method; spec §9.8
  // asks for one or more.
  test('refuses a script with the gas calls and no call between them', () => {
    expect(match(transaction((sb) => sb)).matched).toBe(false);
  });

  // ScriptBuilder.spendGas passes one value. A second one would stay on the VM stack.
  test('refuses a SpendGas with another number of arguments', () => {
    const sb = new ScriptBuilder().allowGas(SPONSOR, Address.nullAddress, 100_000n, 900n);
    const script = move(sb).callContract('gas', 'SpendGas', [SPONSOR, ACCOUNT]).endScript();
    const tx = new Transaction('simnet', 'main', script, new Date(NOW + 60_000), '');
    expect(match(tx).matched).toBe(false);
  });

  // An address loads as Bytes of 35: the length byte 34, then the 34 address bytes. Bytes of 35
  // that start with another byte are no address, even when the rest is one.
  test('refuses a gas payer of 35 bytes whose first byte is not the length 34', () => {
    const notAnAddress = new Uint8Array([33, ...SPONSOR.toByteArray()]);
    const sb = new ScriptBuilder().callContract('gas', 'AllowGas', [
      notAnAddress,
      Address.nullAddress,
      100_000n,
      900n,
    ]);
    const script = move(sb).callContract('gas', 'SpendGas', [notAnAddress]).endScript();
    const tx = new Transaction('simnet', 'main', script, new Date(NOW + 60_000), '');
    expect(match(tx).matched).toBe(false);
  });
});

// Spec §9.8: a transaction is signed without a prompt only when it expires at most 5 minutes after
// its request was sent. A copy of the request that comes later then carries a dead transaction,
// whatever lifetime the dApp chose.
describe('matchSigningPermission and the send time of the request', () => {
  const MINUTE = 60_000;

  test('accepts a transaction that expires 5 minutes after the request was sent', () => {
    const tx = transaction(move, { expiresAt: NOW + 5 * MINUTE });
    expect(match(tx).matched).toBe(true);
  });

  test('refuses a transaction that expires later than 5 minutes after the request was sent', () => {
    const tx = transaction(move, { expiresAt: NOW + 5 * MINUTE + 1 });
    expect(match(tx).matched).toBe(false);
  });

  // The helper above fills in a send time, so this case calls the matcher itself.
  test('refuses a request without a send time', () => {
    const result = matchSigningPermission({
      tx: transaction(move),
      permission: permission(),
      account: ACCOUNT.text,
      now: NOW,
      sentAt: undefined,
    });
    expect(result.matched).toBe(false);
  });

  // A transaction of 1000 minutes, sent at minute 0 and delivered again at minute 998 with two
  // minutes to live: it never qualifies, at minute 0 or at minute 998.
  test('refuses a long-lived transaction at any moment of its life', () => {
    const sentAt = NOW;
    const tx = transaction(move, { expiresAt: sentAt + 1000 * MINUTE });
    const long = permission({ expiresAt: sentAt + 1440 * MINUTE });
    expect(match(tx, long, sentAt, sentAt).matched).toBe(false);
    expect(match(tx, long, sentAt + 998 * MINUTE, sentAt).matched).toBe(false);
  });

  // A short transaction delivered again after it expired is refused here; the chain refuses it too.
  test('refuses a copy that arrives after its transaction expired', () => {
    const tx = transaction(move, { expiresAt: NOW + 2 * MINUTE });
    expect(match(tx, permission(), NOW + 2 * MINUTE).matched).toBe(false);
    expect(match(tx, permission(), NOW + 3 * MINUTE).matched).toBe(false);
  });
});

// The wallet checks the params of a request before it reads the contracts and asks the user.
describe('readSigningPermissionRequest', () => {
  const calls = [{ contract: 'game1', methods: ['move'] }];

  test('fills in the chain and the gas limit', () => {
    expect(readSigningPermissionRequest({ calls, duration: 3600 })).toEqual({
      chain: 'main',
      calls,
      duration: 3600,
      gasLimit: '0',
    });
  });

  test.each([
    ['no calls', { calls: [], duration: 3600 }],
    [
      'nine contracts',
      {
        calls: Array.from({ length: 9 }, (_, i) => ({ contract: `c${i}`, methods: ['m'] })),
        duration: 3600,
      },
    ],
    ['a built-in contract', { calls: [{ contract: 'stake', methods: ['Stake'] }], duration: 3600 }],
    ['no methods', { calls: [{ contract: 'game1', methods: [] }], duration: 3600 }],
    [
      'a method named twice',
      { calls: [{ contract: 'game1', methods: ['move', 'move'] }], duration: 3600 },
    ],
    ['a contract named twice', { calls: [...calls, ...calls], duration: 3600 }],
    ['a name with a space', { calls: [{ contract: 'game 1', methods: ['move'] }], duration: 3600 }],
    ['a duration under a minute', { calls, duration: 59 }],
    ['a duration over a day', { calls, duration: 86_401 }],
    ['a fractional duration', { calls, duration: 60.5 }],
    ['a gas limit that is not decimal', { calls, duration: 3600, gasLimit: '1e9' }],
    [
      'a gas limit above the int64 maximum',
      { calls, duration: 3600, gasLimit: (2n ** 63n).toString() },
    ],
    ['a chain that is not a name', { calls, duration: 3600, chain: '' }],
  ])('refuses %s with -32602', (_label, params) => {
    expect(() => readSigningPermissionRequest(params)).toThrow(
      expect.objectContaining({ code: -32602 })
    );
  });
});
