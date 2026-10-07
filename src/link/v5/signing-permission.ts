// Phantasma Link v5 - the signing permission, wallet side (spec §9.8). A dApp asks once for the
// permission to have some methods of some contracts called without a prompt. The wallet keeps the
// permission with the session. For each transaction request of that session it asks
// matchSigningPermission whether it may sign without asking; anything that does not match goes to
// the normal prompt. The rules live here so that every TS wallet applies the same ones.
//
// The chain has no key delegation, so nothing but the wallet enforces a permission. The wallet sees
// which methods a transaction calls, never what they do: the user's signature covers the whole
// transaction, and a contract written to move the user's assets can do it inside a granted method.
// A permission therefore trusts the site and its contracts. The rules below keep the rest closed:
// only the exact script form that ScriptBuilder writes, only the granted calls between the two gas
// calls, and a gas budget when the user pays.

import { Address } from '../../types/address.js';
import { twosComplementLEToBigInt } from '../../types/carbon-serialization.js';
import { hexToBytes } from '../../utils/index.js';
import { isCallName, readContractCalls, ScriptValue } from '../../vm/contract-calls.js';
import { VMType } from '../../vm/vm-type.js';
import { LinkError, LinkErrorCode } from './errors.js';
import type {
  RequestSigningPermissionParams,
  SigningPermission,
  SigningPermissionCall,
} from './methods.js';

/** The shortest permission a wallet grants, in seconds (spec §9.8). */
export const SIGNING_PERMISSION_MIN_DURATION_S = 60;
/** The longest permission a wallet grants, in seconds: one day (spec §9.8). */
export const SIGNING_PERMISSION_MAX_DURATION_S = 24 * 60 * 60;
/** The most contracts one permission names (spec §9.8). */
export const SIGNING_PERMISSION_MAX_CONTRACTS = 8;
/** The most methods of one contract that one permission names (spec §9.8). */
export const SIGNING_PERMISSION_MAX_METHODS = 32;
/** The longest time from a request's `sentAt` to the expiry of a transaction that the wallet signs
 * without a prompt, in milliseconds (spec §9.8). A copy of the request delivered later carries a
 * transaction that has expired. */
export const SIGNING_PERMISSION_TX_WINDOW_MS = 5 * 60 * 1000;

/** The chain's built-in contracts. A permission never names one: `gas` carries the gas of every
 * transaction, `stake` moves the account's SOUL, and the chain refuses calls to the others
 * (spec §9.8). */
export const BUILT_IN_CONTRACTS: readonly string[] = [
  'gas',
  'stake',
  'account',
  'block',
  'consensus',
  'exchange',
  'friends',
  'governance',
  'interop',
  'mail',
  'market',
  'privacy',
  'ranking',
  'relay',
  'sale',
  'storage',
  'swap',
  'token',
  'validator',
];

// The node rejects a gas offer above the largest int64 (gas mismatch), so a budget above it means
// nothing.
const INT64_MAX = 2n ** 63n - 1n;

// A gas price or limit wider than this is no number the SDK writes. Such a literal is refused
// instead of read, so a long literal can never be read one way here and another way by the VM.
const MAX_NUMBER_BYTES = 32;

const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** The answer of {@link matchSigningPermission}. */
export type SigningPermissionMatch =
  | {
      matched: true;
      /** The gas the transaction may make the account pay: `price × limit` of its `AllowGas`
       * when the account is the gas payer, otherwise 0. The wallet adds it to `gasReserved` when
       * it signs. */
      accountGas: bigint;
    }
  | {
      matched: false;
      /** Why the transaction needs the normal prompt; for logs, never shown to the dApp. */
      reason: string;
    };

/** The fields of a script transaction that {@link matchSigningPermission} reads. A deserialized
 * `Transaction` has them. */
export interface SigningPermissionTransaction {
  chainName: string;
  expiration: Date;
  /** The script, in hex. */
  script: string;
}

function invalid(message: string): LinkError {
  return new LinkError(LinkErrorCode.InvalidParams, message);
}

function readCall(value: unknown): SigningPermissionCall {
  const record = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const contract = record['contract'];
  const methods = record['methods'];
  if (typeof contract !== 'string' || !isCallName(contract)) {
    throw invalid('Each call needs a contract name');
  }
  if (BUILT_IN_CONTRACTS.includes(contract)) {
    throw invalid(`A built-in contract cannot be granted: ${contract}`);
  }
  if (
    !Array.isArray(methods) ||
    methods.length === 0 ||
    methods.length > SIGNING_PERMISSION_MAX_METHODS
  ) {
    throw invalid(`Each call needs 1 to ${SIGNING_PERMISSION_MAX_METHODS} method names`);
  }
  for (const method of methods) {
    if (typeof method !== 'string' || !isCallName(method)) {
      throw invalid('A method name is not valid');
    }
  }
  if (new Set(methods).size !== methods.length) {
    throw invalid(`A method is named twice for ${contract}`);
  }
  return { contract, methods: [...(methods as string[])] };
}

/**
 * Returns the params of a `pha_requestSigningPermission` request with the defaults filled in, or
 * throws `-32602` when they break a rule of spec §9.8.
 */
export function readSigningPermissionRequest(
  params: unknown
): Required<RequestSigningPermissionParams> {
  const record = (typeof params === 'object' && params !== null ? params : {}) as Record<
    string,
    unknown
  >;
  const chain = record['chain'] ?? 'main';
  if (typeof chain !== 'string' || !isCallName(chain)) {
    throw invalid('chain must be the name of a chain');
  }
  const calls = record['calls'];
  if (
    !Array.isArray(calls) ||
    calls.length === 0 ||
    calls.length > SIGNING_PERMISSION_MAX_CONTRACTS
  ) {
    throw invalid(`calls must name 1 to ${SIGNING_PERMISSION_MAX_CONTRACTS} contracts`);
  }
  const read = calls.map(readCall);
  if (new Set(read.map((call) => call.contract)).size !== read.length) {
    throw invalid('A contract is named twice');
  }
  const duration = record['duration'];
  if (
    typeof duration !== 'number' ||
    !Number.isInteger(duration) ||
    duration < SIGNING_PERMISSION_MIN_DURATION_S ||
    duration > SIGNING_PERMISSION_MAX_DURATION_S
  ) {
    throw invalid(
      `duration must be ${SIGNING_PERMISSION_MIN_DURATION_S} to ${SIGNING_PERMISSION_MAX_DURATION_S} seconds`
    );
  }
  const gasLimit = record['gasLimit'] ?? '0';
  if (typeof gasLimit !== 'string' || !DECIMAL.test(gasLimit) || BigInt(gasLimit) > INT64_MAX) {
    throw invalid('gasLimit must be a decimal string');
  }
  return { chain, calls: read, duration, gasLimit };
}

/** Returns the text of the address a gas call loads, as the VM reads it, or undefined for any
 * other form. The SDK loads an Address object as Bytes of 35 (the length byte 34, then the
 * address) and a text address as a String. */
function readAddress(value: ScriptValue): string | undefined {
  try {
    if (value.type === VMType.String) {
      if (value.bytes.length > 64) {
        return undefined;
      }
      const text = String.fromCharCode(...value.bytes);
      // Only the canonical text of an address: the one the address prints itself.
      return Address.fromText(text).text === text ? text : undefined;
    }
    if (value.type === VMType.Bytes) {
      if (
        value.bytes.length === Address.lengthInBytes + 1 &&
        value.bytes[0] === Address.lengthInBytes
      ) {
        return Address.fromBytes(value.bytes.slice(1)).text;
      }
      if (value.bytes.length === Address.lengthInBytes) {
        return Address.fromBytes(value.bytes).text;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Returns the non-negative number a gas call loads, or undefined. The VM reads a Number as
 * two's complement, least significant byte first, and a String as decimal digits. */
function readNumber(value: ScriptValue): bigint | undefined {
  if (value.type === VMType.Number) {
    if (value.bytes.length === 0 || value.bytes.length > MAX_NUMBER_BYTES) {
      return undefined;
    }
    const number = twosComplementLEToBigInt(value.bytes);
    return number >= 0n ? number : undefined;
  }
  if (value.type === VMType.String) {
    if (value.bytes.length > MAX_NUMBER_BYTES) {
      return undefined;
    }
    const text = String.fromCharCode(...value.bytes);
    return DECIMAL.test(text) ? BigInt(text) : undefined;
  }
  return undefined;
}

function granted(permission: SigningPermission, contract: string, method: string): boolean {
  return permission.calls.some(
    (call) => call.contract === contract && call.methods.includes(method)
  );
}

/**
 * Returns whether the script transaction `tx` of a request sent at `sentAt` passes rules 3 to 6 of
 * spec §9.8 at `now` (Unix milliseconds), and the gas it may make the account pay. The transaction
 * must be on the permission's chain, must not have expired, and must expire no later than the
 * permission and no later than {@link SIGNING_PERMISSION_TX_WINDOW_MS} after `sentAt`. Its script
 * must be exactly `gas.AllowGas(from, to, price, limit)`, one or more granted calls,
 * `gas.SpendGas(from)` and `RET`, in the form ScriptBuilder writes. When `from` is `account`,
 * `price × limit` must fit in the rest of the gas budget.
 *
 * The caller decides the rest before it signs without a prompt: rules 1 and 2 (the wallet is
 * unlocked, the session's account is the selected one, the wallet uses the network on which the
 * user approved the permission, the format is `script` and the signature kind is Ed25519), and
 * that the request id is new. The permission object names a chain of the nexus, not the network,
 * so the caller keeps the network with the permission when the user approves it. The caller keeps that id until the
 * transaction expires (spec §18.2), so a copy of the request is never signed again without a
 * prompt.
 */
export function matchSigningPermission(input: {
  tx: SigningPermissionTransaction;
  permission: SigningPermission;
  account: string;
  now: number;
  /** The request's `sentAt` (spec §4); a request without it never matches. */
  sentAt: number | undefined;
}): SigningPermissionMatch {
  const { tx, permission, account, now, sentAt } = input;
  const no = (reason: string): SigningPermissionMatch => ({ matched: false, reason });
  if (now >= permission.expiresAt) {
    return no('the permission expired');
  }
  if (tx.chainName !== permission.chain) {
    return no('another chain');
  }
  const expiresAt = tx.expiration.getTime();
  if (expiresAt <= now) {
    return no('the transaction expired');
  }
  // A transaction signed now must not stay valid after the permission, so a revoke or the end
  // of the permission is never outlived by a signature made under it.
  if (expiresAt > permission.expiresAt) {
    return no('the transaction expires after the permission');
  }
  // The distance from the send time to the expiry is written in the request and never changes.
  // A transaction that lives longer than the window after its request was sent never matches, so
  // a copy of the request that comes later carries a transaction that has expired.
  if (sentAt === undefined) {
    return no('the request carries no send time');
  }
  if (expiresAt > sentAt + SIGNING_PERMISSION_TX_WINDOW_MS) {
    return no('the transaction expires more than 5 minutes after the request was sent');
  }
  let script: Uint8Array;
  try {
    script = hexToBytes(tx.script);
  } catch {
    return no('the script is not hex');
  }
  const calls = readContractCalls(script);
  if (calls === undefined || calls.length < 3) {
    return no('the script is not gas, granted calls, gas');
  }
  const allowGas = calls[0];
  const spendGas = calls[calls.length - 1];
  if (
    allowGas.contract !== 'gas' ||
    allowGas.method !== 'AllowGas' ||
    allowGas.args.length !== 4 ||
    spendGas.contract !== 'gas' ||
    spendGas.method !== 'SpendGas' ||
    spendGas.args.length !== 1
  ) {
    return no('the script does not open with AllowGas and close with SpendGas');
  }
  const payer = readAddress(allowGas.args[0]);
  const price = readNumber(allowGas.args[2]);
  const limit = readNumber(allowGas.args[3]);
  if (payer === undefined || price === undefined || limit === undefined) {
    return no('the gas call cannot be read');
  }
  if (readAddress(spendGas.args[0]) !== payer) {
    return no('SpendGas names another address than AllowGas');
  }
  for (const call of calls.slice(1, -1)) {
    if (
      BUILT_IN_CONTRACTS.includes(call.contract) ||
      !granted(permission, call.contract, call.method)
    ) {
      return no(`${call.contract}.${call.method} is not granted`);
    }
  }
  const maxGas = price * limit;
  if (maxGas > INT64_MAX) {
    return no('the gas offer is above the chain maximum');
  }
  const accountGas = payer === account ? maxGas : 0n;
  if (accountGas > BigInt(permission.gasLimit) - BigInt(permission.gasReserved)) {
    return no('the gas budget is spent');
  }
  return { matched: true, accountGas };
}
