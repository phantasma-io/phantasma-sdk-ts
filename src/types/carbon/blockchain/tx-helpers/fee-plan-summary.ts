import { formatUnits } from '../../../../utils/units.js';
import { DomainSettings } from '../../../domain-settings.js';
import { FeePlan } from './fee-plan.js';

/** A fee plan in the units a person reads: KCAL for gas, SOUL for the storage deposit. */
export interface FeePlanSummary {
  /** What the transaction will cost in gas, as a decimal KCAL amount. */
  gasBill: string;
  /** The gas offer written into the transaction; the difference to `gasBill` is refunded. */
  gasOffer: string;
  /**
   * The storage deposit the transaction may take, as a decimal SOUL amount. It is escrowed while
   * the transaction settles and refunded when the rows it paid for are deleted; a wallet shows it
   * separately from the fee, as a refundable deposit.
   */
  storageCeiling: string;
}

export interface FeePlanSummaryDecimals {
  /** Decimals of the chain's gas token. Default: KCAL, 10. */
  gas?: number;
  /** Decimals of the chain's data token. Default: SOUL, 8. */
  data?: number;
}

/** Renders a plan for display. */
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
