import {
  feeEstimateFromRpc,
  EstimateTransactionResult,
} from '../../src/rpc/interfaces/estimate-transaction';

// estimateTransaction response decoding: the node serializes 64-bit amounts as decimal strings
// (JSON-number precision), and a completed estimate must convert into the same NativeFeeEstimate
// the Tier-1 estimator produces so wallet code consumes both tiers identically.

// Completed dry run: recommendations present, no abort. recommendedMaxGas deliberately exceeds
// 2^53 to pin the strings-not-numbers decision.
const completed: EstimateTransactionResult = {
  wouldAbort: false,
  abortReason: '',
  gasBillKcalBase: '10000000',
  dataRows: '1',
  dataEscrowAtoms: '200000',
  dataRefundAtoms: '0',
  recommendedMaxGas: '100000000000000000',
  recommendedMaxData: '400000',
};

// Aborted dry run: the settled abort bill is still reported (aborts pay), recommendations are 0.
const aborted: EstimateTransactionResult = {
  wouldAbort: true,
  abortReason: 'gas fees [gas=3125 max=40]',
  gasBillKcalBase: '40',
  dataRows: '0',
  dataEscrowAtoms: '0',
  dataRefundAtoms: '0',
  recommendedMaxGas: '0',
  recommendedMaxData: '0',
};

describe('feeEstimateFromRpc', () => {
  it('converts a completed estimate into a NativeFeeEstimate', () => {
    const estimate = feeEstimateFromRpc(completed);

    // Above-2^53 value survives exactly because it rides a string.
    expect(estimate.maxGas).toBe(100_000_000_000_000_000n);
    expect(estimate.maxData).toBe(400_000n);
    expect(estimate.expectedGasBill).toBe(10_000_000n);
  });

  // An aborted simulation has no recommendations; converting must fail loudly rather than yield
  // zero ceilings a wallet could sign with.
  it('refuses to convert an aborted estimate', () => {
    expect(() => feeEstimateFromRpc(aborted)).toThrow(/gas fees/);
  });

  // A malformed server response (lost field) must not silently become a zero ceiling.
  it('throws on a missing numeric field', () => {
    const broken: EstimateTransactionResult = JSON.parse(JSON.stringify(completed));
    broken.recommendedMaxGas = '';

    expect(() => feeEstimateFromRpc(broken)).toThrow(/recommendedMaxGas/);
  });
});
