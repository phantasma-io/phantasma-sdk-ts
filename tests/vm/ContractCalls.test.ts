import { Address, Opcode, ScriptBuilder, VMType, hexToBytes } from '../../src/core';
import { readContractCalls } from '../../src/vm/contract-calls';

const FROM = Address.fromText('P2KEYzWsbrMbPNtW1tBzzDKeYxYi4hjzpx4EfiyRyaoLkMM');

/** Returns the bytes of a script built by ScriptBuilder. */
function built(build: (sb: ScriptBuilder) => ScriptBuilder): Uint8Array {
  return hexToBytes(build(new ScriptBuilder()).endScript());
}

/** The script a dApp builds for one contract call with gas paid by FROM. */
function gameScript(): Uint8Array {
  return built((sb) =>
    sb
      .allowGas(FROM, Address.nullAddress, 100000n, 21000n)
      .callContract('game1', 'move', [FROM, 3n, 'north'])
      .spendGas(FROM)
  );
}

// readContractCalls is the wallet's view of what a transaction calls. It must read the scripts that
// ScriptBuilder writes, and refuse every other byte layout, so that it never sees a different call
// than the VM makes.
describe('readContractCalls', () => {
  test('reads the gas calls and a contract call in the order the VM makes them', () => {
    const calls = readContractCalls(gameScript());
    expect(calls?.map((call) => `${call.contract}.${call.method}`)).toEqual([
      'gas.AllowGas',
      'game1.move',
      'gas.SpendGas',
    ]);
  });

  test('returns the arguments in parameter order with their load types', () => {
    const calls = readContractCalls(gameScript());
    const allowGas = calls?.[0];
    expect(allowGas?.args.map((arg) => arg.type)).toEqual([
      VMType.Bytes,
      VMType.Bytes,
      VMType.Number,
      VMType.Number,
    ]);
    // An Address loads as its serialized form: the length byte 34, then the 34 address bytes.
    expect(allowGas?.args[0].bytes).toEqual(Uint8Array.from([34, ...FROM.toByteArray()]));
    const move = calls?.[1];
    expect(move?.args.map((arg) => arg.type)).toEqual([VMType.Bytes, VMType.Number, VMType.String]);
    expect(new TextDecoder().decode(move?.args[2].bytes)).toBe('north');
  });

  test('reads a call without arguments and an argument longer than 252 bytes', () => {
    const long = 'x'.repeat(300);
    const calls = readContractCalls(
      built((sb) => sb.callContract('game1', 'reset', []).callContract('game1', 'say', [long]))
    );
    expect(calls?.[0]).toMatchObject({ contract: 'game1', method: 'reset', args: [] });
    expect(new TextDecoder().decode(calls?.[1].args[0].bytes)).toBe(long);
  });

  test('refuses a script that calls an interop', () => {
    const script = built((sb) =>
      sb
        .allowGas(FROM, Address.nullAddress, 100000n, 21000n)
        .callInterop('Runtime.TransferTokens', [FROM, FROM, 'SOUL', 1n])
        .spendGas(FROM)
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  test('refuses a script with a jump', () => {
    const script = built((sb) =>
      sb.emitJump(Opcode.JMP, 'end').emitLabel('end').callContract('game1', 'move', [])
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  test('refuses an opcode that ScriptBuilder never writes between calls', () => {
    const script = gameScript();
    const withNop = Uint8Array.from([Opcode.NOP, ...script]);
    expect(readContractCalls(withNop)).toBeUndefined();
  });

  test('refuses a byte after RET and a script without RET', () => {
    const script = gameScript();
    expect(readContractCalls(Uint8Array.from([...script, Opcode.RET]))).toBeUndefined();
    expect(readContractCalls(script.slice(0, script.length - 1))).toBeUndefined();
  });

  test('refuses a script with no call', () => {
    expect(readContractCalls(Uint8Array.from([Opcode.RET]))).toBeUndefined();
    expect(readContractCalls(new Uint8Array(0))).toBeUndefined();
  });

  test('refuses a value pushed after the last call', () => {
    const script = built((sb) => sb.callContract('game1', 'move', []).emitLoad(0, 'x').emitPush(0));
    expect(readContractCalls(script)).toBeUndefined();
  });

  // LOAD r2 then PUSH r0 pushes whatever r0 holds, not the loaded value. A reader that ignored the
  // register would see the method "move" where the VM pushes something else.
  test('refuses a load into another register', () => {
    const script = built((sb) =>
      sb
        .emitLoad(2, 'move')
        .emitPush(0)
        .emitLoad(0, 'game1')
        .emit(Opcode.CTX, [0, 1])
        .emit(Opcode.SWITCH, [1])
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  test('refuses a push of another register', () => {
    const script = built((sb) =>
      sb
        .emitLoad(0, 'move')
        .emitPush(2)
        .emitLoad(0, 'game1')
        .emit(Opcode.CTX, [0, 1])
        .emit(Opcode.SWITCH, [1])
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  // SWITCH r1 after CTX r0 r2 enters whatever context r1 still holds, for example the gas contract
  // of the previous call, and not the contract that was just loaded.
  test('refuses a switch into a register that CTX did not fill', () => {
    const script = built((sb) =>
      sb
        .emitLoad(0, 'move')
        .emitPush(0)
        .emitLoad(0, 'game1')
        .emit(Opcode.CTX, [0, 2])
        .emit(Opcode.SWITCH, [1])
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  test('refuses a switch through another register than the one CTX filled', () => {
    const script = built((sb) =>
      sb
        .emitLoad(0, 'move')
        .emitPush(0)
        .emitLoad(0, 'game1')
        .emit(Opcode.CTX, [0, 1])
        .emit(Opcode.SWITCH, [2])
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  test('refuses a context taken from another register than the loaded name', () => {
    const script = built((sb) =>
      sb
        .emitLoad(0, 'move')
        .emitPush(0)
        .emitLoad(0, 'game1')
        .emit(Opcode.CTX, [2, 1])
        .emit(Opcode.SWITCH, [1])
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  test('refuses a context switch through other registers', () => {
    // LOAD r0 "move", PUSH r0, LOAD r0 "game1", CTX r0 r2, SWITCH r2, RET
    const script = built((sb) =>
      sb
        .emitLoad(0, 'move')
        .emitPush(0)
        .emitLoad(0, 'game1')
        .emit(Opcode.CTX, [0, 2])
        .emit(Opcode.SWITCH, [2])
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  // The VM accepts the 0xFD length form for any length, so a short literal could hide behind it.
  // ScriptBuilder writes the shortest form only, and so does the reader.
  test('refuses a literal length in a longer form than needed', () => {
    // LOAD r0 String, length 4 written as FD 04 00, "move", then the rest of a call.
    const method = [
      Opcode.LOAD,
      0,
      VMType.String,
      0xfd,
      0x04,
      0x00,
      ...new TextEncoder().encode('move'),
    ];
    const rest = built((sb) =>
      sb.emitPush(0).emitLoad(0, 'game1').emit(Opcode.CTX, [0, 1]).emit(Opcode.SWITCH, [1])
    );
    expect(readContractCalls(Uint8Array.from([...method, ...rest]))).toBeUndefined();
  });

  test('refuses the four-byte and eight-byte length forms', () => {
    const tail = built((sb) =>
      sb.emitPush(0).emitLoad(0, 'game1').emit(Opcode.CTX, [0, 1]).emit(Opcode.SWITCH, [1])
    );
    const four = [
      Opcode.LOAD,
      0,
      VMType.String,
      0xfe,
      0x04,
      0x00,
      0x00,
      0x00,
      ...new TextEncoder().encode('move'),
    ];
    const eight = [
      Opcode.LOAD,
      0,
      VMType.String,
      0xff,
      4,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
      ...new TextEncoder().encode('move'),
    ];
    expect(readContractCalls(Uint8Array.from([...four, ...tail]))).toBeUndefined();
    expect(readContractCalls(Uint8Array.from([...eight, ...tail]))).toBeUndefined();
  });

  test('refuses a literal that runs past the end of the script', () => {
    const truncated = Uint8Array.from([Opcode.LOAD, 0, VMType.String, 10, 0x61, 0x62]);
    expect(readContractCalls(truncated)).toBeUndefined();
  });

  test('refuses a load type the VM does not define', () => {
    const script = built((sb) =>
      sb
        .emitLoadBytes(0, [1], 9 as VMType)
        .emitPush(0)
        .callContract('game1', 'move', [])
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  // The bytes spell "move", but the load type is Bytes. ScriptBuilder loads a name as a String, and
  // the reader does not guess how the VM turns other types into text.
  test('refuses a method name that is not a String', () => {
    const script = built((sb) =>
      sb
        .emitLoadBytes(0, Array.from(new TextEncoder().encode('move')), VMType.Bytes)
        .emitPush(0)
        .emitLoad(0, 'game1')
        .emit(Opcode.CTX, [0, 1])
        .emit(Opcode.SWITCH, [1])
    );
    expect(readContractCalls(script)).toBeUndefined();
  });

  // A name is compared byte for byte with a granted name. A byte outside printable ASCII could
  // decode to the same text as another byte, so such a name is refused.
  test('refuses a name with a space or a byte outside printable ASCII', () => {
    expect(readContractCalls(built((sb) => sb.callContract('game 1', 'move', [])))).toBeUndefined();
    expect(readContractCalls(built((sb) => sb.callContract('game1', 'mové', [])))).toBeUndefined();
  });
});
