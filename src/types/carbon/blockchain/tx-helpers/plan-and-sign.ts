import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { GasConfig } from '../gas-config.js';
import { TxMsgSigner } from '../extensions/tx-msg-signer.js';
import { SignedTxMsg } from '../signed-tx-msg.js';
import { TxMsg } from '../tx-msg.js';
import { FeePlanOptions, planFees } from './fee-plan.js';
import { TxLimits } from './tx-limits.js';

/** Options of the `buildTxAndSign*` conveniences: how to plan the fee, or what to write instead. */
export type PlanAndSignOptions = FeePlanOptions & TxLimits;

/**
 * Plans a freshly built message against `config` - unless the caller fixed `maxGas` themselves -
 * and signs it with in-memory keys. The convenience behind every `buildTxAndSign*` helper; a
 * wallet with an external signer plans with `planFees` and signs with `TxMsgSigner.signWith`.
 */
export function planAndSignWithKeys(
  msg: TxMsg,
  keys: PhantasmaKeys[],
  config: GasConfig,
  options: PlanAndSignOptions = {}
): Uint8Array {
  // Whether the fee is already settled is read from the MESSAGE: the builders are what write the
  // caller's limits into it, so the message is the one place that is right for every helper. The
  // same rule as `PhantasmaAPI.sendTransaction`.
  if (msg.maxGas !== 0n) return TxMsgSigner.signAndSerializeWithKeys(msg, keys);
  // Only the witness-array types take their witness count from the caller, and these keys are that
  // caller's answer; for every other type the message fixes its own slots and one key may fill two
  // of them, so passing a count would contradict the message.
  const openWitnessSet = SignedTxMsg.requiredWitnesses(msg) === undefined;
  const planned = planFees(msg, config, {
    ...(openWitnessSet ? { witnessCount: keys.length } : {}),
    ...options,
  }).apply(msg);
  return TxMsgSigner.signAndSerializeWithKeys(planned, keys);
}
