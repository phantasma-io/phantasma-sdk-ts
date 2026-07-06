import { CarbonBlobLike } from '../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../carbon-serialization.js';

/**
 * On-chain gas configuration (governance module). The gas-model-v2 extension fields serialize
 * only for version >= 1, mirroring the node's data_blockchain.h wire format exactly: the
 * version-0 byte image is frozen forever for historical replay, and a version>=1 image truncated
 * to the v0 length fails to parse (the tail read throws on end of stream).
 */
export class GasConfig implements CarbonBlobLike {
  version: number; // uint8
  maxNameLength: number; // uint8
  maxTokenSymbolLength: number; // uint8
  feeShift: number; // uint8
  maxStructureSize: number; // uint32
  feeMultiplier: bigint; // uint64
  gasTokenId: bigint; // uint64
  dataTokenId: bigint; // uint64
  minimumGasOffer: bigint; // uint64
  dataEscrowPerRow: bigint; // uint64
  gasFeeTransfer: bigint; // uint64
  gasFeeQuery: bigint; // uint64
  gasFeeCreateTokenBase: bigint; // uint64
  gasFeeCreateTokenSymbol: bigint; // uint64
  gasFeeCreateTokenSeries: bigint; // uint64
  gasFeePerByte: bigint; // uint64
  gasFeeRegisterName: bigint; // uint64
  gasBurnRatioMul: bigint; // uint64
  gasBurnRatioShift: number; // uint8

  // Gas-model-v2 extension (version >= 1 only).
  /** Floor applied to every settled gas bill (kcal-base). 0 = no floor (v1-equivalent). */
  minimumGasBill: bigint; // uint64
  /** Producer fee-split ratio, same mul/shift fixed-point form as the burn ratio. */
  gasProducerRatioMul: bigint; // uint64
  gasProducerRatioShift: number; // uint8
  /** Dapp (tx gasTarget) fee-split ratio. */
  gasDappRatioMul: bigint; // uint64
  gasDappRatioShift: number; // uint8
  /**
   * Product-decision prices ("policy fees") in kcal-base, charged directly with no fee
   * multiplier stage. Under v2 they replace the unit-priced gasFeeCreateToken and
   * gasFeeRegisterName fields, which stay serialized for version-0 replay.
   */
  policyFeeCreateTokenBase: bigint; // uint64
  /** Halved per symbol char after the first (v1 rule kept). */
  policyFeeCreateTokenSymbol: bigint; // uint64
  policyFeeCreateTokenSeries: bigint; // uint64
  /** Shifted right by (nameLength-1) like the v1 field (v1 rule kept). */
  policyFeeRegisterName: bigint; // uint64
  /**
   * The frozen pre-flip dataEscrowPerRow: storage rows existing before the v2 flip refund at
   * this price (exactly what they escrowed under v1). Immutable after the flip.
   */
  legacyDataEscrowPerRow: bigint; // uint64

  constructor(init?: Partial<GasConfig>) {
    this.version = 0;
    this.maxNameLength = 0;
    this.maxTokenSymbolLength = 0;
    this.feeShift = 0;
    this.maxStructureSize = 0;
    this.feeMultiplier = 0n;
    this.gasTokenId = 0n;
    this.dataTokenId = 0n;
    this.minimumGasOffer = 0n;
    this.dataEscrowPerRow = 0n;
    this.gasFeeTransfer = 0n;
    this.gasFeeQuery = 0n;
    this.gasFeeCreateTokenBase = 0n;
    this.gasFeeCreateTokenSymbol = 0n;
    this.gasFeeCreateTokenSeries = 0n;
    this.gasFeePerByte = 0n;
    this.gasFeeRegisterName = 0n;
    this.gasBurnRatioMul = 0n;
    this.gasBurnRatioShift = 0;
    this.minimumGasBill = 0n;
    this.gasProducerRatioMul = 0n;
    this.gasProducerRatioShift = 0;
    this.gasDappRatioMul = 0n;
    this.gasDappRatioShift = 0;
    this.policyFeeCreateTokenBase = 0n;
    this.policyFeeCreateTokenSymbol = 0n;
    this.policyFeeCreateTokenSeries = 0n;
    this.policyFeeRegisterName = 0n;
    this.legacyDataEscrowPerRow = 0n;
    Object.assign(this, init);
  }

  /**
   * True when this config activates the gas-model-v2 billing rules (config version >= 1). The
   * gas model is gated by the config version, not by a chain feature level.
   */
  get hasGasModelV2(): boolean {
    return this.version >= 1;
  }

  write(w: CarbonBinaryWriter): void {
    w.write1(this.version);
    w.write1(this.maxNameLength);
    w.write1(this.maxTokenSymbolLength);
    w.write1(this.feeShift);
    w.write4u(this.maxStructureSize);
    w.write8u(this.feeMultiplier);
    w.write8u(this.gasTokenId);
    w.write8u(this.dataTokenId);
    w.write8u(this.minimumGasOffer);
    w.write8u(this.dataEscrowPerRow);
    w.write8u(this.gasFeeTransfer);
    w.write8u(this.gasFeeQuery);
    w.write8u(this.gasFeeCreateTokenBase);
    w.write8u(this.gasFeeCreateTokenSymbol);
    w.write8u(this.gasFeeCreateTokenSeries);
    w.write8u(this.gasFeePerByte);
    w.write8u(this.gasFeeRegisterName);
    w.write8u(this.gasBurnRatioMul);
    w.write1(this.gasBurnRatioShift);
    if (this.version === 0) {
      // Version-0 wire image must stay byte-identical to the pre-v2 layout.
      return;
    }
    w.write8u(this.minimumGasBill);
    w.write8u(this.gasProducerRatioMul);
    w.write1(this.gasProducerRatioShift);
    w.write8u(this.gasDappRatioMul);
    w.write1(this.gasDappRatioShift);
    w.write8u(this.policyFeeCreateTokenBase);
    w.write8u(this.policyFeeCreateTokenSymbol);
    w.write8u(this.policyFeeCreateTokenSeries);
    w.write8u(this.policyFeeRegisterName);
    w.write8u(this.legacyDataEscrowPerRow);
  }

  read(r: CarbonBinaryReader): void {
    this.version = r.read1();
    this.maxNameLength = r.read1();
    this.maxTokenSymbolLength = r.read1();
    this.feeShift = r.read1();
    this.maxStructureSize = r.read4u();
    this.feeMultiplier = r.read8u();
    this.gasTokenId = r.read8u();
    this.dataTokenId = r.read8u();
    this.minimumGasOffer = r.read8u();
    this.dataEscrowPerRow = r.read8u();
    this.gasFeeTransfer = r.read8u();
    this.gasFeeQuery = r.read8u();
    this.gasFeeCreateTokenBase = r.read8u();
    this.gasFeeCreateTokenSymbol = r.read8u();
    this.gasFeeCreateTokenSeries = r.read8u();
    this.gasFeePerByte = r.read8u();
    this.gasFeeRegisterName = r.read8u();
    this.gasBurnRatioMul = r.read8u();
    this.gasBurnRatioShift = r.read1();
    if (this.version === 0) {
      // Version-0 rows carry no v2 tail; zero it so a reused instance never leaks stale values.
      this.minimumGasBill = 0n;
      this.gasProducerRatioMul = 0n;
      this.gasProducerRatioShift = 0;
      this.gasDappRatioMul = 0n;
      this.gasDappRatioShift = 0;
      this.policyFeeCreateTokenBase = 0n;
      this.policyFeeCreateTokenSymbol = 0n;
      this.policyFeeCreateTokenSeries = 0n;
      this.policyFeeRegisterName = 0n;
      this.legacyDataEscrowPerRow = 0n;
      return;
    }
    // version >= 1: the tail is mandatory; a truncated image throws (end of stream).
    this.minimumGasBill = r.read8u();
    this.gasProducerRatioMul = r.read8u();
    this.gasProducerRatioShift = r.read1();
    this.gasDappRatioMul = r.read8u();
    this.gasDappRatioShift = r.read1();
    this.policyFeeCreateTokenBase = r.read8u();
    this.policyFeeCreateTokenSymbol = r.read8u();
    this.policyFeeCreateTokenSeries = r.read8u();
    this.policyFeeRegisterName = r.read8u();
    this.legacyDataEscrowPerRow = r.read8u();
  }

  static read(r: CarbonBinaryReader): GasConfig {
    const v = new GasConfig();
    v.read(r);
    return v;
  }
}
