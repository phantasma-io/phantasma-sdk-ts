import { formatUnits } from '../../../../utils/units.js';
import { DomainSettings } from '../../../domain-settings.js';
import { FeePlan } from './fee-plan.js';

/** A fee plan in the units a person reads. Gas is shown in KCAL and the storage deposit in
 * SOUL. */
export interface FeePlanSummary {
  /** What the transaction will cost in gas, as a decimal KCAL amount. */
  gasBill: string;
  /** The gas offer written into the transaction. The difference to `gasBill` is refunded. */
  gasOffer: string;
  /**
   * The storage deposit the transaction may take, as a decimal SOUL amount. The chain escrows it
   * while the transaction settles and refunds it when the rows it paid for are deleted. A wallet
   * shows it apart from the fee, as a refundable deposit.
   */
  storageCeiling: string;
}

export interface FeePlanSummaryDecimals {
  /** Decimals of the chain's gas token. The default is 10, which is what KCAL has. */
  gas?: number;
  /** Decimals of the chain's data token. The default is 8, which is what SOUL has. */
  data?: number;
}

/** Renders a plan in the units a person reads. */
export function summarizeFeePlan(
  plan: FeePlan,
  decimals: FeePlanSummaryDecimals = {}
): FeePlanSummary {
  const gas = decimals.gas ?? DomainSettings.FuelTokenDecimals;
  const data = decimals.data ?? DomainSettings.StakingTokenDecimals;
  return {
    gasBill: formatUnits(plan.expectedGasBill, gas),
    gasOffer: formatUnits(plan.maxGas, gas),
    storageCeiling: formatUnits(plan.maxData, data),
  };
}
