import { CarbonBinaryReader } from '../types/carbon-serialization.js';
import { TxTypes } from '../types/carbon/tx-types.js';
import { ModuleId } from '../types/carbon/blockchain/module-id.js';
import { TokenContractMethods } from '../types/carbon/blockchain/modules/token-contract-methods.js';
import { TokenInfo } from '../types/carbon/blockchain/modules/token-info.js';
import { TxMsg } from '../types/carbon/blockchain/tx-msg.js';
import { TxMsgCall } from '../types/carbon/blockchain/tx-msg-call.js';
import { Token } from './interfaces/token.js';
import { getRpcErrorMessage, isRpcErrorResult } from './rpc-result.js';

/** A transaction the chain would reject after charging for it, caught before signing. */
export class TransactionPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransactionPreflightError';
  }
}

/** The lookups a pre-flight needs - a `PhantasmaAPI`, or anything shaped like one. */
export interface PreflightSource {
  getToken(symbol: string, extended?: boolean, carbonTokenId?: bigint): Promise<Token>;
  /**
   * Id of a token that certainly exists on this chain - the gas token. The symbol lookup needs it as
   * a CONTROL (see {@link preflightTransaction}); a source that cannot supply one still works, but
   * then a free symbol can only be reported `unknown`.
   */
  controlTokenId?(): Promise<bigint | undefined>;
}

/**
 * What a pre-flight established.
 *
 * - `not-applicable` - the message is not a token creation, so there is nothing to check.
 * - `taken` - the chain answered that the symbol is in use.
 * - `free` - the chain answered, through the control, that it is not.
 * - `unknown` - the lookup did not answer. Nothing follows from it; in particular it is not `free`.
 */
export type PreflightVerdict = 'not-applicable' | 'taken' | 'free' | 'unknown';

export interface PreflightResult {
  verdict: PreflightVerdict;
  /** What was being checked, e.g. `token symbol GPX`. Absent when nothing was. */
  subject?: string;
  /** Why the lookup established nothing, in the node's own words. Only on `unknown`. */
  reason?: string;
}

/**
 * Asks the chain whether the symbol a CreateToken claims is already in use. The call consumes its
 * policy fee - the largest single price in the protocol, set by governance and readable from
 * `getGasConfig` - before the contract looks at the symbol, so sending one that is taken pays that
 * fee for nothing. One lookup answers it.
 *
 * A symbol that resolves to a token is `taken`. A symbol that does not is reported by the node as an
 * ordinary RPC error, the same way it reports a missing method or a failed backend, and nothing in
 * the answer separates those: every one of them arrives as the same internal error code with prose
 * for a message. So an error alone is never read as absence. Instead the check asks a second
 * question it already knows the answer to - fetch the CONTROL token by its id, which the node
 * resolves without touching the symbol at all. A node that answers that is a node that is answering,
 * so its refusal about the caller's symbol is a real absence and the verdict is `free`; a node that
 * does not answer it has established nothing and the verdict is `unknown`. Without a control every
 * absent symbol is `unknown`.
 *
 * The control proves the node is serving token lookups. It does not exercise symbol resolution
 * itself, so a node whose token rows read while its symbol index does not would still be believed.
 * That is the residual, and it is a far narrower one than trusting an error message.
 *
 * The verdict is reported rather than acted on; `PhantasmaAPI.sendTransaction` refuses on `taken`
 * and on `unknown`. The message's own validity - flags, metadata, schemas - is enforced by the
 * builders; this is the part only the chain can answer.
 */
export async function preflightTransaction(
  source: PreflightSource,
  msg: TxMsg
): Promise<PreflightResult> {
  if (msg.type !== TxTypes.Call) return { verdict: 'not-applicable' };
  const call = msg.msg as TxMsgCall;
  if (call.moduleId !== ModuleId.Token || call.methodId !== TokenContractMethods.CreateToken) {
    return { verdict: 'not-applicable' };
  }

  const symbol = TokenInfo.read(new CarbonBinaryReader(call.args)).symbol.data;
  if (!symbol) return { verdict: 'not-applicable' };
  const subject = `token symbol ${symbol}`;

  const token = await lookUp(() => source.getToken(symbol));
  // A token came back, so the symbol resolves to one. Nothing else is read from it: the question
  // was only whether it exists.
  if (token.ok) return { verdict: 'taken', subject };

  const control = await source.controlTokenId?.();
  if (control === undefined || control === 0n) {
    return { verdict: 'unknown', subject, reason: token.reason };
  }
  const probe = await lookUp(() => source.getToken('', false, control));
  return probe.ok
    ? { verdict: 'free', subject }
    : { verdict: 'unknown', subject, reason: probe.reason };
}

type LookUp<T> = { ok: true; value: T } | { ok: false; reason: string };

// A lookup counts as answered only when it returns a value. An RPC error result and a thrown
// transport failure mean the same thing here - the question was not answered - and neither is
// inspected further, because nothing in either distinguishes "there is no such symbol" from "this
// node could not tell you".
async function lookUp<T>(call: () => Promise<T>): Promise<LookUp<T>> {
  try {
    const value = await call();
    if (isRpcErrorResult(value)) return { ok: false, reason: value.error };
    return { ok: true, value };
  } catch (error: unknown) {
    return { ok: false, reason: getRpcErrorMessage(error, 'the lookup failed') };
  }
}
