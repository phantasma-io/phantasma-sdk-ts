import { gasConfigFromRpc, GasConfigResult } from '../../src/rpc/interfaces/gas-config';

// getGasConfig response decoding: the node serializes 64-bit config values as decimal strings
// (JSON-number precision) and omits the v2 tail fields for version-0 configs. gasConfigFromRpc
// must produce the exact wire config the Tier-1 estimator consumes.

// Shape currently served by a v1 (pre-flip) chain: no v2 fields at all.
const v1Response: GasConfigResult = {
  gasModelVersion: 1,
  blockRateTarget: 2000,
  expiryWindow: 90000,
  gasConfig: {
    version: 0,
    maxNameLength: 32,
    maxTokenSymbolLength: 10,
    feeShift: 0,
    maxStructureSize: 65536,
    feeMultiplier: '10000',
    gasTokenId: '2',
    dataTokenId: '1',
    minimumGasOffer: '10',
    dataEscrowPerRow: '2',
    gasFeeTransfer: '10',
    gasFeeQuery: '2',
    gasFeeCreateTokenBase: '10000000000',
    gasFeeCreateTokenSymbol: '10000000000',
    gasFeeCreateTokenSeries: '2500000000',
    gasFeePerByte: '250000',
    gasFeeRegisterName: '10000000000000',
    gasBurnRatioMul: '1',
    gasBurnRatioShift: 0,
  },
};

// Post-flip shape: version 1 config with the full v2 tail (policyFeeRegisterName deliberately
// exceeds 2^53 to pin the strings-not-numbers decision).
const v2Response: GasConfigResult = {
  gasModelVersion: 2,
  blockRateTarget: 2000,
  expiryWindow: 90000,
  unitsPerBlockDataByte: 25,
  gasConfig: {
    ...v1Response.gasConfig!,
    version: 1,
    dataEscrowPerRow: '200000',
    minimumGasBill: '10000000',
    gasProducerRatioMul: '0',
    gasProducerRatioShift: 0,
    gasDappRatioMul: '0',
    gasDappRatioShift: 0,
    policyFeeCreateTokenBase: '100000000000000',
    policyFeeCreateTokenSymbol: '100000000000000',
    policyFeeCreateTokenSeries: '25000000000000',
    policyFeeRegisterName: '100000000000000000',
    legacyDataEscrowPerRow: '2',
  },
};

describe('gasConfigFromRpc', () => {
  it('maps a v1 response and zeroes the absent v2 fields', () => {
    const config = gasConfigFromRpc(v1Response);

    expect(config.version).toBe(0);
    expect(config.hasGasModelV2).toBe(false);
    expect(config.feeMultiplier).toBe(10_000n);
    expect(config.gasFeePerByte).toBe(250_000n);
    // v2 fields absent from the wire must map to zero, not garbage.
    expect(config.minimumGasBill).toBe(0n);
    expect(config.policyFeeRegisterName).toBe(0n);
  });

  it('maps a v2 response with the full tail', () => {
    const config = gasConfigFromRpc(v2Response);

    expect(config.version).toBe(1);
    expect(config.hasGasModelV2).toBe(true);
    expect(config.dataEscrowPerRow).toBe(200_000n);
    expect(config.minimumGasBill).toBe(10_000_000n);
    // Above-2^53 value survives exactly because it rides a string.
    expect(config.policyFeeRegisterName).toBe(100_000_000_000_000_000n);
    expect(config.legacyDataEscrowPerRow).toBe(2n);
  });

  // A response claiming gas model v2 but missing tail fields must fail loudly - estimating
  // fees from silently zeroed v2 prices would produce rejected transactions.
  it('throws on a v2 response with a missing tail field', () => {
    const broken: GasConfigResult = JSON.parse(JSON.stringify(v2Response));
    delete broken.gasConfig!.minimumGasBill;

    expect(() => gasConfigFromRpc(broken)).toThrow(/minimumGasBill/);
  });

  it('throws when the gasConfig section is missing', () => {
    expect(() =>
      gasConfigFromRpc({ gasModelVersion: 1, blockRateTarget: 0, expiryWindow: 0 })
    ).toThrow(/no gasConfig/);
  });
});
