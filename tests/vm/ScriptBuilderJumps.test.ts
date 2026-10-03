import { Opcode, ScriptBuilder } from '../../src/core';

// Jumps and calls to labels. Each expected script is what the C# SDK's ScriptBuilder produces for
// the same calls: the two bytes after a jump hold the byte offset just past the label's NOP, little
// endian.
describe('ScriptBuilder jumps', () => {
  test('a forward jump lands after its label', () => {
    const script = new ScriptBuilder()
      .emitJump(Opcode.JMP, 'end')
      .emit(Opcode.NOP)
      .emitLabel('end')
      .endScript();
    expect(script).toBe('08050000000B');
  });

  test('a backward jump lands after its label', () => {
    const script = new ScriptBuilder()
      .emitLabel('top')
      .emit(Opcode.NOP)
      .emitJump(Opcode.JMP, 'top')
      .endScript();
    expect(script).toBe('00000801000B');
  });

  test('a conditional jump keeps its register before the target', () => {
    expect(
      new ScriptBuilder()
        .emitConditionalJump(Opcode.JMPIF, 3, 'skip')
        .emit(Opcode.NOP)
        .emitLabel('skip')
        .endScript()
    ).toBe('0903060000000B');
    expect(
      new ScriptBuilder()
        .emitJump(Opcode.JMPNOT, 'skip', 2)
        .emit(Opcode.NOP)
        .emitLabel('skip')
        .endScript()
    ).toBe('0A02060000000B');
  });

  test('a call keeps its register count before the target', () => {
    const script = new ScriptBuilder()
      .emitCall('fn', 2)
      .emit(Opcode.RET)
      .emitLabel('fn')
      .endScript();
    expect(script).toBe('060206000B000B');
  });

  test('labels match without regard to case', () => {
    const script = new ScriptBuilder().emitJump(Opcode.JMP, 'End').emitLabel('end').endScript();
    expect(script).toBe('080400000B');
    // The same with the upper-case letter on the label's side.
    expect(new ScriptBuilder().emitJump(Opcode.JMP, 'end').emitLabel('End').endScript()).toBe(
      '080400000B'
    );
  });

  // The chain reads a jump target as a signed 16-bit number, so a jump reaches offset 32767 at
  // most. A JMP takes 3 bytes and the label's NOP 1, so after `fill` NOPs the label sits at
  // fill + 4.
  const jumpOver = (fill: number) =>
    new ScriptBuilder()
      .emitJump(Opcode.JMP, 'far')
      .emitBytes(new Array(fill).fill(Opcode.NOP))
      .emitLabel('far');

  test('a jump reaches offset 32767 and no farther', () => {
    expect(() => jumpOver(32763).endScript()).not.toThrow();
    expect(() => jumpOver(32764).endScript()).toThrow('above 32767');
  });

  test('a call reaches past offset 32767', () => {
    // A CALL takes 4 bytes, so after 32764 NOPs the label sits at 32769, 0x8001, which the chain
    // accepts as a call target.
    const script = new ScriptBuilder()
      .emitCall('far', 1)
      .emitBytes(new Array(32764).fill(Opcode.NOP))
      .emitLabel('far')
      .endScript();
    expect(script.slice(4, 8)).toBe('0180');
  });

  test('a builder started again forgets which offsets were calls', () => {
    // The old CALL and the new JMPIF both keep their target at offset 2. The new target still
    // gets the jump limit: 4 bytes of JMPIF and 32764 NOPs put the label at 32769.
    const sb = new ScriptBuilder();
    sb.beginScript().emitCall('fn', 1).emitLabel('fn').endScript();
    sb.beginScript()
      .emitJump(Opcode.JMPIF, 'far', 0)
      .emitBytes(new Array(32764).fill(Opcode.NOP))
      .emitLabel('far');
    expect(() => sb.endScript()).toThrow('above 32767');
  });

  test('a jump to a label the script never defines is refused', () => {
    const sb = new ScriptBuilder().emitJump(Opcode.JMP, 'nowhere');
    expect(() => sb.endScript()).toThrow('Could not find label: nowhere');
  });

  test('a builder started again keeps no jump or label of the previous script', () => {
    const sb = new ScriptBuilder();
    sb.beginScript().emitJump(Opcode.JMP, 'end').emit(Opcode.NOP).emitLabel('end').endScript();

    // Three NOPs and RET, with nothing written over bytes 1 and 2 where the old jump target was.
    expect(sb.beginScript().emit(Opcode.NOP).emit(Opcode.NOP).emit(Opcode.NOP).endScript()).toBe(
      '0000000B'
    );
    // The old label does not resolve a jump of the new script.
    expect(() => sb.beginScript().emitJump(Opcode.JMP, 'end').endScript()).toThrow(
      'Could not find label: end'
    );
  });
});
