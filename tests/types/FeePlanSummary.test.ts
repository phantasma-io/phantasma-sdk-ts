import { Bytes32 } from '../../src/types/carbon/bytes32';
import { GasConfig } from '../../src/types/carbon/blockchain/gas-config';
import { summarizeFeePlan } from '../../src/types/carbon/blockchain/tx-helpers/fee-plan-summary';
import { planFees } from '../../src/types/carbon/blockchain/tx-helpers/fee-plan';
import { NativeTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/native-tx-helper';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';

const config = new GasConfig({
  version: 1,
  feeMultiplier: 10_000n,
  gasTokenId: 1n,
  dataTokenId: 2n,
  minimumGasOffer: 10n,
  dataEscrowPerRow: 200_000n,
  gasFeeTransfer: 10n,
  gasFeeQuery: 10n,
  minimumGasBill: 10_000_000n,
});
const owner = new Bytes32(PhantasmaKeys.generate().publicKey);

describe('summarizeFeePlan', () => {
  // A settled transfer of an ordinary token into a fresh holder - 0.0042850000 KCAL of gas and one row of
  // 0.00200000 SOUL escrowed - is what a wallet must show, in those units.
  it('renders the plan in KCAL and SOUL', () => {
    const msg = NativeTxHelper.transferFungible({
      from: owner,
      to: owner,
      tokenId: 97n,
      amount: 1n,
    });
    const summary = summarizeFeePlan(planFees(msg, config));
    expect(summary).toEqual({
      gasBill: '0.004285',
      gasOffer: '0.004285',
      storageCeiling: '0.002',
      exact: true,
    });
  });

  it('takes the decimals of a chain whose gas or data token differ', () => {
    const msg = NativeTxHelper.transferFungible({
      from: owner,
      to: owner,
      tokenId: 1n,
      amount: 1n,
    });
    const summary = summarizeFeePlan(planFees(msg, config), { gas: 8, data: 8 });
    expect(summary.gasBill).toBe('0.426');
    expect(summary.storageCeiling).toBe('0');
  });
});
