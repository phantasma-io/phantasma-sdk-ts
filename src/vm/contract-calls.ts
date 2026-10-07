// Reads the contract calls of a VM script that ScriptBuilder built with callContract (allowGas and
// spendGas included) and endScript. A wallet uses it to learn what a transaction calls before it
// signs the transaction without asking the user (Phantasma Link v5, the signing permission).
//
// The reader is strict on purpose. It accepts exactly the bytes that ScriptBuilder writes for such a
// script and returns undefined for anything else: another opcode, another register, a length written
// in a longer form than needed, a byte after the final RET. The VM executes a script that passes this
// reader as a straight line of loads, pushes and context switches, so the calls read here are the
// calls the VM makes. A looser reader could be fooled by bytes that the VM reads differently.

import { Opcode } from './opcode.js';
import { VMType } from './vm-type.js';

/** A value that a script loads into a register and pushes as a call argument. */
export interface ScriptValue {
  /** The VM type byte of the load. */
  type: VMType;
  /** The literal bytes of the load, as the VM receives them. */
  bytes: Uint8Array;
}

/** One contract call of a script. */
export interface ScriptContractCall {
  /** The contract name that the script loads before the context switch. */
  contract: string;
  /** The method name: the last value the script pushes before the context switch. */
  method: string;
  /** The arguments in the method's parameter order. The script pushes them last to first, so the
   * first argument is the one on top of the stack when the method starts. */
  args: ScriptValue[];
}

// ScriptBuilder loads every value into register 0 and switches through register 1.
const VALUE_REGISTER = 0;
const CONTEXT_REGISTER = 1;

// The VM reads a LOAD literal into a buffer of 0xFFFF bytes and faults on a longer one, and
// ScriptBuilder refuses to write one.
const MAX_LOAD_BYTES = 0xffff;

// A name is read only when every byte is printable ASCII without a space. Contract and method names
// are identifiers. Bytes outside that range could decode to the same text as other bytes and make two
// different names look equal.
const MAX_NAME_BYTES = 255;

interface Load {
  value: ScriptValue;
  next: number;
}

/** Returns the LOAD instruction at `pos` when it loads into register 0, or undefined. The length
 * of the literal must use the shortest form, and only the two forms that ScriptBuilder writes for
 * lengths up to 0xFFFF are accepted. */
function readLoad(script: Uint8Array, pos: number): Load | undefined {
  if (pos + 3 >= script.length) {
    return undefined;
  }
  if (script[pos] !== Opcode.LOAD || script[pos + 1] !== VALUE_REGISTER) {
    return undefined;
  }
  const type = script[pos + 2];
  if (type > VMType.Object) {
    return undefined;
  }
  const header = script[pos + 3];
  let length: number;
  let start: number;
  if (header < 0xfd) {
    length = header;
    start = pos + 4;
  } else if (header === 0xfd) {
    if (pos + 5 >= script.length) {
      return undefined;
    }
    length = script[pos + 4] | (script[pos + 5] << 8);
    // A length below 0xFD has a one-byte form, and ScriptBuilder always writes that form.
    if (length < 0xfd) {
      return undefined;
    }
    start = pos + 6;
  } else {
    return undefined;
  }
  if (length > MAX_LOAD_BYTES || start + length > script.length) {
    return undefined;
  }
  return {
    value: { type: type as VMType, bytes: script.slice(start, start + length) },
    next: start + length,
  };
}

/** Returns true if `text` can be a contract or method name in a script that readContractCalls
 * reads: 1 to 255 printable ASCII characters without a space. */
export function isCallName(text: string): boolean {
  if (text.length === 0 || text.length > MAX_NAME_BYTES) {
    return false;
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) {
      return false;
    }
  }
  return true;
}

/** Returns the text of a String value that holds a name, or undefined. */
function readName(value: ScriptValue): string | undefined {
  // The length is checked before the bytes become characters, so a long literal is never spread.
  if (value.type !== VMType.String || value.bytes.length > MAX_NAME_BYTES) {
    return undefined;
  }
  // Every byte becomes one character, so a byte outside printable ASCII becomes a character that
  // isCallName refuses.
  const text = String.fromCharCode(...value.bytes);
  return isCallName(text) ? text : undefined;
}

/** Returns true if the bytes at `pos` are `PUSH r0`. */
function isPushValue(script: Uint8Array, pos: number): boolean {
  return (
    pos + 1 < script.length && script[pos] === Opcode.PUSH && script[pos + 1] === VALUE_REGISTER
  );
}

/** Returns true if the bytes at `pos` are `CTX r0 r1` followed by `SWITCH r1`. */
function isContextSwitch(script: Uint8Array, pos: number): boolean {
  return (
    pos + 4 < script.length &&
    script[pos] === Opcode.CTX &&
    script[pos + 1] === VALUE_REGISTER &&
    script[pos + 2] === CONTEXT_REGISTER &&
    script[pos + 3] === Opcode.SWITCH &&
    script[pos + 4] === CONTEXT_REGISTER
  );
}

/**
 * Returns the contract calls of a script in the order the VM makes them, or undefined when the
 * script is not made of calls in the form that `ScriptBuilder.callContract` writes, closed by the
 * single `RET` of `ScriptBuilder.endScript`. A script with no call is undefined too.
 *
 * Each call is a run of `LOAD r0 <value>` + `PUSH r0` pairs (the arguments, last first, then the
 * method name), then `LOAD r0 <contract name>`, `CTX r0 r1` and `SWITCH r1`.
 */
export function readContractCalls(script: Uint8Array): ScriptContractCall[] | undefined {
  const calls: ScriptContractCall[] = [];
  // The values pushed since the previous call, in script order.
  let pushed: ScriptValue[] = [];
  let pos = 0;
  while (pos < script.length) {
    if (script[pos] === Opcode.RET) {
      // RET ends the script: it must be the last byte, and nothing may be pushed after the last call.
      if (pos !== script.length - 1 || pushed.length > 0 || calls.length === 0) {
        return undefined;
      }
      return calls;
    }
    const load = readLoad(script, pos);
    if (load === undefined) {
      return undefined;
    }
    pos = load.next;
    if (isPushValue(script, pos)) {
      pushed.push(load.value);
      pos += 2;
      continue;
    }
    if (!isContextSwitch(script, pos)) {
      return undefined;
    }
    pos += 5;
    // The loaded value is the contract; the method name is the last value pushed before it.
    const methodValue = pushed.pop();
    if (methodValue === undefined) {
      return undefined;
    }
    const contract = readName(load.value);
    const method = readName(methodValue);
    if (contract === undefined || method === undefined) {
      return undefined;
    }
    calls.push({ contract, method, args: pushed.reverse() });
    pushed = [];
  }
  // A script without its closing RET is not the form ScriptBuilder writes.
  return undefined;
}
