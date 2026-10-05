import { Opcode, ScriptBuilder } from '../../src/core';

// appendHexEncoded writes the bytes its hex string encodes, so the script and the `str` mirror agree
// and a jump after it counts those bytes.
describe('ScriptBuilder.appendHexEncoded', () => {
  test('writes the decoded bytes into the script', () => {
    const sb = new ScriptBuilder().appendHexEncoded('0aff');
    expect(sb.getScript()).toBe('0aff');
    expect(sb.str).toBe('0aff');
  });

  test('a jump after it counts the decoded bytes', () => {
    const script = new ScriptBuilder()
      .appendHexEncoded('0aff')
      .emitJump(Opcode.JMP, 'end')
      .emitLabel('end')
      .endScript();
    expect(script).toBe('0AFF080600000B');
  });

  test('refuses a string that is not hex', () => {
    expect(() => new ScriptBuilder().appendHexEncoded('xyz1')).toThrow('Invalid hex string');
  });
});
