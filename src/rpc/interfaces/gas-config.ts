import { GasConfig } from '../../types/carbon/blockchain/gas-config.js';

/**
 * Response of the getGasConfig RPC method: the current on-chain gas configuration plus the
 * chain parameters fee estimation needs. 64-bit config values arrive as decimal strings (they
 * can exceed the 2^53 precision of JSON numbers). Feed {@link gasConfigFromRpc} into
 * estimateNativeFee for Tier-1 fee estimates.
 */
export interface GasConfigResult {
  /** Gas model version: 1 = original fee model, 2 = gas-model-v2 (config version >= 1). */
  gasModelVersion: number;
  /** Current on-chain GasConfig. */
  gasConfig?: GasConfigData;
  /** Chain block rate target in milliseconds. */
  blockRateTarget: number;
  /** Transaction expiry window in milliseconds. */
  expiryWindow: number;
  /** Gas-model-v2 price of block-carried bytes in gas units per byte; absent under gas model v1. */
  unitsPerBlockDataByte?: number;
}

/**
 * JSON shape of the on-chain GasConfig. Fields after gasBurnRatioShift exist only when the
 * config version is >= 1 (gas-model-v2) and are omitted from v1 responses.
 */
export interface GasConfigData {
  version: number;
  maxNameLength: number;
  maxTokenSymbolLength: number;
  feeShift: number;
  maxStructureSize: number;
  feeMultiplier: string;
  gasTokenId: string;
  dataTokenId: string;
  minimumGasOffer: string;
  dataEscrowPerRow: string;
  gasFeeTransfer: string;
  gasFeeQuery: string;
  gasFeeCreateTokenBase: string;
  gasFeeCreateTokenSymbol: string;
  gasFeeCreateTokenSeries: string;
  gasFeePerByte: string;
  gasFeeRegisterName: string;
  gasBurnRatioMul: string;
  gasBurnRatioShift: number;

  minimumGasBill?: string;
  gasProducerRatioMul?: string;
  gasProducerRatioShift?: number;
  gasDappRatioMul?: string;
  gasDappRatioShift?: number;
  policyFeeCreateTokenBase?: string;
  policyFeeCreateTokenSymbol?: string;
  policyFeeCreateTokenSeries?: string;
  policyFeeRegisterName?: string;
  legacyDataEscrowPerRow?: string;
}

/**
 * Converts the getGasConfig JSON response to the wire-format GasConfig consumed by the Tier-1
 * fee estimator. Throws on malformed numeric strings and on a v2 response missing tail fields:
 * estimating fees from silently zeroed v2 prices would produce rejected transactions.
 */
export function gasConfigFromRpc(result: GasConfigResult): GasConfig {
  const c = result.gasConfig;
  if (!c) {
    throw new Error('getGasConfig response has no gasConfig section');
  }
  const config = new GasConfig({
    version: c.version,
    maxNameLength: c.maxNameLength,
    maxTokenSymbolLength: c.maxTokenSymbolLength,
    feeShift: c.feeShift,
    maxStructureSize: c.maxStructureSize,
    feeMultiplier: parseU64(c.feeMultiplier, 'feeMultiplier'),
    gasTokenId: parseU64(c.gasTokenId, 'gasTokenId'),
    dataTokenId: parseU64(c.dataTokenId, 'dataTokenId'),
    minimumGasOffer: parseU64(c.minimumGasOffer, 'minimumGasOffer'),
    dataEscrowPerRow: parseU64(c.dataEscrowPerRow, 'dataEscrowPerRow'),
    gasFeeTransfer: parseU64(c.gasFeeTransfer, 'gasFeeTransfer'),
    gasFeeQuery: parseU64(c.gasFeeQuery, 'gasFeeQuery'),
    gasFeeCreateTokenBase: parseU64(c.gasFeeCreateTokenBase, 'gasFeeCreateTokenBase'),
    gasFeeCreateTokenSymbol: parseU64(c.gasFeeCreateTokenSymbol, 'gasFeeCreateTokenSymbol'),
    gasFeeCreateTokenSeries: parseU64(c.gasFeeCreateTokenSeries, 'gasFeeCreateTokenSeries'),
    gasFeePerByte: parseU64(c.gasFeePerByte, 'gasFeePerByte'),
    gasFeeRegisterName: parseU64(c.gasFeeRegisterName, 'gasFeeRegisterName'),
    gasBurnRatioMul: parseU64(c.gasBurnRatioMul, 'gasBurnRatioMul'),
    gasBurnRatioShift: c.gasBurnRatioShift,
  });
  if (config.version >= 1) {
    config.minimumGasBill = parseU64(c.minimumGasBill, 'minimumGasBill');
    config.gasProducerRatioMul = parseU64(c.gasProducerRatioMul, 'gasProducerRatioMul');
    config.gasProducerRatioShift = requireByte(c.gasProducerRatioShift, 'gasProducerRatioShift');
    config.gasDappRatioMul = parseU64(c.gasDappRatioMul, 'gasDappRatioMul');
    config.gasDappRatioShift = requireByte(c.gasDappRatioShift, 'gasDappRatioShift');
    config.policyFeeCreateTokenBase = parseU64(
      c.policyFeeCreateTokenBase,
      'policyFeeCreateTokenBase'
    );
    config.policyFeeCreateTokenSymbol = parseU64(
      c.policyFeeCreateTokenSymbol,
      'policyFeeCreateTokenSymbol'
    );
    config.policyFeeCreateTokenSeries = parseU64(
      c.policyFeeCreateTokenSeries,
      'policyFeeCreateTokenSeries'
    );
    config.policyFeeRegisterName = parseU64(c.policyFeeRegisterName, 'policyFeeRegisterName');
    config.legacyDataEscrowPerRow = parseU64(c.legacyDataEscrowPerRow, 'legacyDataEscrowPerRow');
  }
  return config;
}

function parseU64(value: string | undefined, fieldName: string): bigint {
  if (value === undefined || value === '') {
    throw new Error(`getGasConfig field ${fieldName} is missing or empty`);
  }
  if (!/^\d+$/.test(value)) {
    throw new Error(`getGasConfig field ${fieldName} is not a decimal integer: ${value}`);
  }
  return BigInt(value);
}

function requireByte(value: number | undefined, fieldName: string): number {
  if (value === undefined) {
    throw new Error(`getGasConfig field ${fieldName} is missing`);
  }
  return value;
}
