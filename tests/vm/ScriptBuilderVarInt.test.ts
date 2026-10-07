import { ScriptBuilder, Transaction } from '../../src/core';

/** Returns the hex that emitVarInt writes for `value`. */
function varInt(value: number): string {
  return new ScriptBuilder().emitVarInt(value).getScript();
}

// The VM and the node read a variable integer as one byte below 0xFD, or 0xFD, 0xFE, 0xFF followed
// by 2, 4 or 8 bytes, least significant first. Any other byte count shifts every field after it.
describe('ScriptBuilder.emitVarInt', () => {
  test('writes one byte below 0xFD and two bytes after 0xFD up to 0xFFFF', () => {
    expect(varInt(0xfc)).toBe('fc');
    expect(varInt(0xfd)).toBe('fdfd00');
    expect(varInt(0xffff)).toBe('fdffff');
  });

  test('writes four bytes after 0xFE above 0xFFFF', () => {
    expect(varInt(0x10000)).toBe('fe00000100');
    expect(varInt(0xffffffff)).toBe('feffffffff');
  });

  test('writes eight bytes after 0xFF above 0xFFFFFFFF', () => {
    expect(varInt(2 ** 32)).toBe('ff0000000001000000');
    expect(varInt(Number.MAX_SAFE_INTEGER)).toBe('ffffffffffffff1f00');
  });

  test('refuses a number above 2^53', () => {
    expect(() => varInt(2 ** 60)).toThrow('value too large');
  });

  // The script length of a transaction is such an integer. A script above 0xFFFF bytes used to get
  // three bytes after 0xFE, and the transaction could not be read back.
  test('a transaction with a script above 0xFFFF bytes reads back', () => {
    const script = 'ab'.repeat(70_000);
    const tx = new Transaction('simnet', 'main', script, new Date(1_800_000_000_000), '');
    const back = Transaction.deserialize(tx.toByteArray(false));
    expect(back.script.toLowerCase()).toBe(script);
    expect(back.chainName).toBe('main');
  });
});
