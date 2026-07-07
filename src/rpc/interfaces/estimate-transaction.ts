import { NativeFeeEstimate } from '../../types/carbon/blockchain/tx-helpers/native-fee-estimator.js';

/**
 * Response of the estimateTransaction RPC method: the exact fee bill of one serialized
 * transaction envelope, computed by dry-running it against current chain state (gas-model-v2
 * Tier-2). 64-bit amounts arrive as decimal strings (they can exceed the 2^53 precision of JSON
 * numbers). Amounts are kcal-base atoms of the gas token; escrow amounts are data-token atoms.
 * Service availability (routing, gas model, node budget) surfaces as a standard RPC error, never
 * through this shape. Feed {@link feeEstimateFromRpc} into the same NativeFeeEstimate wallets use
 * for Tier-1 estimates.
 */
export interface EstimateTransactionResult {
  /** True when the transaction would not complete on-chain as submitted; see abortReason. */
  wouldAbort: boolean;
  /** Rejection or abort reason when wouldAbort is true; empty otherwise. */
  abortReason?: string;
  /** Settled gas bill in kcal-base, including the minimum-bill floor and the maxGas clamp (aborted transactions still pay). */
  gasBillKcalBase: string;
  /** Newly paid storage quanta the transaction creates (dataRows * dataEscrowPerRow == dataEscrowAtoms). */
  dataRows: string;
  /** Gross storage escrow paid for grown rows, in data-token atoms. */
  dataEscrowAtoms: string;
  /** Gross storage refunds for shrunk rows, in data-token atoms. */
  dataRefundAtoms: string;
  /** Recommended TxMsg.maxGas: the bill plus a 15% state-drift margin, floored at the chain minimums; "0" when wouldAbort. */
  recommendedMaxGas: string;
  /** Recommended TxMsg.maxData: the net escrow plus a 15% margin, aligned up to whole rows; "0" when wouldAbort or nothing is escrowed. */
  recommendedMaxData: string;
}

/**
 * Converts a completed estimate into the same NativeFeeEstimate struct Tier-1 estimates produce,
 * so wallet code consumes both tiers identically: maxGas/maxData are the recommended ceilings and
 * expectedGasBill is the exact settled bill. Throws when wouldAbort is set - an aborted simulation
 * has no recommendations (retry with a higher offer or fall back to the Tier-1 estimator).
 */
export function feeEstimateFromRpc(result: EstimateTransactionResult): NativeFeeEstimate {
  if (result.wouldAbort) {
    throw new Error(
      `estimateTransaction reported the transaction would abort: ${result.abortReason ?? ''}`
    );
  }
  return {
    maxGas: parseU64(result.recommendedMaxGas, 'recommendedMaxGas'),
    maxData: parseU64(result.recommendedMaxData, 'recommendedMaxData'),
    expectedGasBill: parseU64(result.gasBillKcalBase, 'gasBillKcalBase'),
  };
}

function parseU64(value: string | undefined, fieldName: string): bigint {
  if (value === undefined || value === '') {
    throw new Error(`estimateTransaction field ${fieldName} is missing or empty`);
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`estimateTransaction field ${fieldName} is not a decimal integer: ${value}`);
  }
  return BigInt(value);
}
