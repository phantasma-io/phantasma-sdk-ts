import { TxMsg } from '../tx-msg.js';

/**
 * Explicit transaction limits a builder writes into the message.
 *
 * Builders carry no prices. A message built without `maxGas` has a zero gas offer, and that marks it
 * as not yet planned. Plan it with `PhantasmaAPI.fees.plan` or `planFees` before signing, or pass
 * the offer here.
 */
export interface TxLimits {
  /** Gas offer in kcal-base (`TxMsg.maxGas`). Default 0, which means unplanned. */
  maxGas?: bigint;
  /** Storage-escrow ceiling in data-token atoms (`TxMsg.maxData`). Default 0. */
  maxData?: bigint;
  /**
   * Expiry as a millisecond timestamp (`TxMsg.expiry`). Default {@link DEFAULT_TX_EXPIRY_MS} from
   * now.
   *
   * A flow with a person in it should set this from the chain's own window instead. Examples are a
   * hardware wallet confirming and a wallet-link round trip. See {@link expiryWithin}.
   */
  expiry?: bigint;
}

/** Writes the limits into a message that the builders assemble. */
export function applyTxLimits(msg: TxMsg, limits: TxLimits = {}): TxMsg {
  msg.maxGas = limits.maxGas ?? 0n;
  msg.maxData = limits.maxData ?? 0n;
  msg.expiry = limits.expiry ?? defaultExpiry();
  return msg;
}

/**
 * Default lifetime of a message a builder stamps, in milliseconds.
 *
 * The chain reads `expiry` in milliseconds and refuses anything at or beyond `now + expiryWindow`.
 * `expiryWindow` is a chain setting, and its node default is 60,000 ms.
 *
 * A default has to hold on the shortest window a chain may run. The value is also compared against
 * the NODE's clock, so it has to survive the two clocks disagreeing. That is why it keeps a quarter
 * of a minute of headroom and does not take the whole 60,000.
 *
 * A chain that allows longer reports its own window as `expiryWindow` in `getGasConfig`, reachable
 * as `PhantasmaAPI.fees.chainParams()`.
 */
export const DEFAULT_TX_EXPIRY_MS = 45_000;

/** Expiry for a message built to be signed and sent now. */
export function defaultExpiry(): bigint {
  return BigInt(Date.now() + DEFAULT_TX_EXPIRY_MS);
}

/**
 * The latest expiry a chain with this window will still admit, less a margin for the clock the node
 * compares it against. Use it when a person sits between building a transaction and signing it: the
 * chain's window is usually far longer than {@link DEFAULT_TX_EXPIRY_MS}, and the whole of it is
 * available.
 *
 * @param expiryWindowMs - the chain's window, from `PhantasmaAPI.fees.chainParams()`.
 * @param marginMs - headroom for clock skew and the trip to the node. Default 5,000 ms.
 */
export function expiryWithin(expiryWindowMs: number, marginMs: number = 5_000): bigint {
  if (!Number.isSafeInteger(expiryWindowMs) || expiryWindowMs <= 0) {
    throw new RangeError('expiryWindowMs must be a positive integer');
  }
  if (!Number.isSafeInteger(marginMs) || marginMs < 0) {
    throw new RangeError('marginMs must be a non-negative integer');
  }
  const lifetime = expiryWindowMs - marginMs;
  if (lifetime <= 0) {
    throw new RangeError(
      `a margin of ${marginMs}ms leaves nothing of a ${expiryWindowMs}ms window`
    );
  }
  return BigInt(Date.now() + lifetime);
}
