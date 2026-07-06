import { CarbonBinaryReader, CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import { GasConfig } from '../../src/types/carbon/blockchain/gas-config';

// Wire-format tests for the gas-model-v2 GasConfig extension. The chain serializes the 10 v2
// fields only for version >= 1; the version-0 image is frozen forever (historical replay), so
// these tests pin both layouts and the truncation failure mode.

// The mainnet v1 values (feeMultiplier 10000, transfer 10 units, byte fee 250000, escrow 2).
function liveV1Config(): GasConfig {
  return new GasConfig({
    version: 0,
    maxNameLength: 32,
    maxTokenSymbolLength: 10,
    feeShift: 0,
    maxStructureSize: 65536,
    feeMultiplier: 10_000n,
    gasTokenId: 2n,
    dataTokenId: 1n,
    minimumGasOffer: 10n,
    dataEscrowPerRow: 2n,
    gasFeeTransfer: 10n,
    gasFeeQuery: 2n,
    gasFeeCreateTokenBase: 10_000_000_000n,
    gasFeeCreateTokenSymbol: 10_000_000_000n,
    gasFeeCreateTokenSeries: 2_500_000_000n,
    gasFeePerByte: 250_000n,
    gasFeeRegisterName: 10_000_000_000_000n,
    gasBurnRatioMul: 1n,
    gasBurnRatioShift: 0,
  });
}

// The spec activation-package values for the v2 tail.
function v2Config(): GasConfig {
  const config = liveV1Config();
  config.version = 1;
  config.dataEscrowPerRow = 200_000n;
  config.minimumGasBill = 10_000_000n;
  config.policyFeeCreateTokenBase = 100_000_000_000_000n;
  config.policyFeeCreateTokenSymbol = 100_000_000_000_000n;
  config.policyFeeCreateTokenSeries = 25_000_000_000_000n;
  config.policyFeeRegisterName = 100_000_000_000_000_000n;
  config.legacyDataEscrowPerRow = 2n;
  return config;
}

function serialize(config: GasConfig): Uint8Array {
  const w = new CarbonBinaryWriter();
  config.write(w);
  return w.toUint8Array();
}

describe('GasConfig gas-model-v2 wire format', () => {
  // Version-0 configs must keep the exact pre-v2 wire size (113 bytes); any growth would
  // corrupt every historical block image.
  it('keeps the legacy 113-byte layout for version 0', () => {
    expect(serialize(liveV1Config()).length).toBe(113);
  });

  // A version>=1 config appends the 66-byte v2 tail (8x u64 + 2x u8) after an unchanged head
  // encoding - the tail is a pure wire extension, it must not disturb the first 113 bytes.
  it('appends the 66-byte v2 tail after an unchanged head', () => {
    const v2Bytes = serialize(v2Config());
    expect(v2Bytes.length).toBe(179);

    const v0Twin = v2Config();
    v0Twin.version = 0; // same head values, version-0 layout
    const v0Bytes = serialize(v0Twin);
    expect(v0Bytes.length).toBe(113);

    expect(v2Bytes[0]).toBe(1);
    expect(v0Bytes[0]).toBe(0);
    for (let i = 1; i < 113; i++) {
      expect(v2Bytes[i]).toBe(v0Bytes[i]);
    }
  });

  it('roundtrips all v2 fields', () => {
    const decoded = GasConfig.read(new CarbonBinaryReader(serialize(v2Config())));

    expect(decoded.version).toBe(1);
    expect(decoded.hasGasModelV2).toBe(true);
    expect(decoded.dataEscrowPerRow).toBe(200_000n);
    expect(decoded.minimumGasBill).toBe(10_000_000n);
    expect(decoded.policyFeeCreateTokenBase).toBe(100_000_000_000_000n);
    expect(decoded.policyFeeCreateTokenSeries).toBe(25_000_000_000_000n);
    expect(decoded.policyFeeRegisterName).toBe(100_000_000_000_000_000n);
    expect(decoded.legacyDataEscrowPerRow).toBe(2n);
  });

  // Reading a version-0 image must zero the v2 fields even on a dirty instance - consumers
  // must never see stale tail values on a v1 chain.
  it('zeroes v2 fields when reading a version-0 image', () => {
    const dirty = v2Config(); // instance with nonzero v2 fields
    const reader = new CarbonBinaryReader(serialize(liveV1Config()));
    dirty.read(reader);

    expect(dirty.version).toBe(0);
    expect(dirty.hasGasModelV2).toBe(false);
    expect(dirty.minimumGasBill).toBe(0n);
    expect(dirty.policyFeeCreateTokenBase).toBe(0n);
    expect(dirty.legacyDataEscrowPerRow).toBe(0n);
  });

  // A version>=1 image truncated to the version-0 length must FAIL to parse, never silently
  // produce a config with zeroed v2 prices (that would mean free product actions).
  it('fails to parse a truncated v2 image', () => {
    const truncated = serialize(v2Config()).subarray(0, 113);
    expect(() => GasConfig.read(new CarbonBinaryReader(truncated))).toThrow();
  });
});
