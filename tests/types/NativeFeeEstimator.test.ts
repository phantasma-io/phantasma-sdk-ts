import { GasConfig } from '../../src/types/carbon/blockchain/gas-config';
import {
  envelopeBytesFor,
  estimateNativeFee,
  NativeFeeKind,
} from '../../src/types/carbon/blockchain/tx-helpers/native-fee-estimator';

// Tier-1 fee calculator tests. Expected numbers are hand-derived from the chain billing formula
// (bill = work-units and byte fee through the feeMultiplier/feeShift knob, plus v2 policy fees
// and the v2 minimum-bill floor), pinned as constants so any formula regression fails loudly.
// The same fixtures and expectations exist in every SDK (parity suite).

// Live mainnet v1 values: multiplier 10000, shift 0, transfer 10 units, byte fee 250000
// kcal-base, minimum offer 10, escrow 2 atoms/row.
function v1Config(): GasConfig {
  return new GasConfig({
    version: 0,
    maxNameLength: 32,
    maxTokenSymbolLength: 10,
    feeShift: 0,
    feeMultiplier: 10_000n,
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
  });
}

// Spec activation values on top of the same knob settings.
function v2Config(): GasConfig {
  const config = v1Config();
  config.version = 1;
  config.dataEscrowPerRow = 200_000n;
  config.legacyDataEscrowPerRow = 2n;
  config.minimumGasBill = 10_000_000n;
  config.policyFeeCreateTokenBase = 100_000_000_000_000n;
  config.policyFeeCreateTokenSymbol = 100_000_000_000_000n;
  config.policyFeeCreateTokenSeries = 25_000_000_000_000n;
  config.policyFeeRegisterName = 100_000_000_000_000_000n;
  return config;
}

describe('estimateNativeFee', () => {
  // v1 transfer with an existing recipient row: bill is the pure work term 10 * 10000.
  it('v1 transfer to an existing recipient bills work only', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, v1Config(), {
      freshRows: 0,
    });

    expect(estimate.expectedGasBill).toBe(100_000n);
    // stdFee shape: 2x min offer + work + flat 1 KiB byte allowance.
    expect(estimate.maxGas).toBe(10n * 2n + 100_000n + 1024n * 250_000n);
    expect(estimate.maxData).toBe(0n);
  });

  // v1 transfer default (worst case: 1 fresh row): the row quantum joins the byte fee and the
  // escrow shows up in maxData at the v1 price.
  it('v1 transfer defaults include one fresh row', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, v1Config());

    expect(estimate.expectedGasBill).toBe(100_000n + 250_000n);
    expect(estimate.maxData).toBe(2n);
  });

  // v2 transfer, default envelope 512 + 1 fresh row: blockData 513 -> 12825 byte units + 10
  // work units = 12835 units * 10000 = 128_350_000 kcal-base (above the 1e7 floor).
  it('v2 transfer default envelope bill', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, v2Config());

    expect(estimate.expectedGasBill).toBe(128_350_000n);
    expect(estimate.maxGas).toBe(128_350_000n + 128_350_000n / 4n);
    expect(estimate.maxData).toBe(200_000n);
  });

  // v2 exact envelope: a measured 250-byte native transfer to an existing recipient bills
  // (10 + 250*25) * 10000.
  it('v2 transfer exact envelope bill', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, v2Config(), {
      envelopeBytes: 250,
      freshRows: 0,
    });

    expect(estimate.expectedGasBill).toBe((10n + 250n * 25n) * 10_000n);
  });

  // A tiny v2 tx can never bill below the consensus floor; the offer must also respect the
  // admission check maxGas >= minimumGasBill.
  it('v2 floor applies to small bills', () => {
    const config = v2Config();
    config.minimumGasBill = 10_000_000_000n; // exaggerated floor above the computed bill

    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, config, {
      envelopeBytes: 250,
      freshRows: 0,
    });

    expect(estimate.expectedGasBill).toBe(10_000_000_000n);
    expect(estimate.maxGas >= 10_000_000_000n).toBe(true);
  });

  // NFT transfers scale the work term per instance; under v2 each instance also recreates its
  // lookup row, so the escrow allowance is (count + 1) rows.
  it('v2 NFT multi transfer scales units and rows', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferNonFungible, v2Config(), {
      count: 5,
      envelopeBytes: 300,
    });

    // work 5*10 units + bytes (300 envelope + 6 rows) * 25 units, all * 10000.
    expect(estimate.expectedGasBill).toBe((50n + 306n * 25n) * 10_000n);
    expect(estimate.maxData).toBe(6n * 200_000n);
  });

  // CreateToken under v1 charges unit-priced product fees through the multiplier.
  it('v1 create token unit fee', () => {
    const estimate = estimateNativeFee(NativeFeeKind.CreateToken, v1Config(), {
      symbolLength: 4,
      freshRows: 0,
      envelopeBytes: 1000,
    });

    const work = (10_000_000_000n + 1_250_000_000n) * 10_000n;
    expect(estimate.expectedGasBill).toBe(work); // byte fee: 0 payload, 0 events, 0 rows
  });

  // CreateToken under v2 pays the direct kcal-base policy fee (no multiplier) plus the byte
  // fee for its envelope; the policy magnitude equals the v1 price by design.
  it('v2 create token policy fee', () => {
    const estimate = estimateNativeFee(NativeFeeKind.CreateToken, v2Config(), {
      symbolLength: 4,
      freshRows: 0,
      envelopeBytes: 1000,
    });

    const policy = 100_000_000_000_000n + (100_000_000_000_000n >> 3n);
    const byteFee = 1000n * 25n * 10_000n;
    expect(estimate.expectedGasBill).toBe(policy + byteFee);
  });

  // RegisterName halves the price per character after the first, under both models.
  it('register name length discount', () => {
    const v1 = estimateNativeFee(NativeFeeKind.RegisterName, v1Config(), {
      nameLength: 8,
      freshRows: 0,
      envelopeBytes: 300,
    });
    const v2 = estimateNativeFee(NativeFeeKind.RegisterName, v2Config(), {
      nameLength: 8,
      freshRows: 0,
      envelopeBytes: 300,
    });

    expect(v1.expectedGasBill).toBe((10_000_000_000_000n >> 7n) * 10_000n);
    expect(v2.expectedGasBill).toBe((100_000_000_000_000_000n >> 7n) + 300n * 25n * 10_000n);
  });

  // The Script kind budgets a generous VM unit allowance (default 5000 exceeds every script in
  // mainnet history) instead of pretending opcode costs are closed-form.
  it('script kind budgets a VM allowance', () => {
    const estimate = estimateNativeFee(NativeFeeKind.Script, v2Config(), {
      envelopeBytes: 568,
      freshRows: 0,
    });

    // (5000 vm units + (568 + 512 events) * 25) * 10000
    expect(estimate.expectedGasBill).toBe((5000n + 1080n * 25n) * 10_000n);
  });

  // Envelope arithmetic mirrors SignedTxMsg: native kinds append bare 64-byte signatures,
  // call/script kinds append a length-prefixed 96-byte witness array.
  it('envelope bytes follow the witness layout', () => {
    expect(envelopeBytesFor(NativeFeeKind.TransferFungible, 150)).toBe(150 + 64);
    expect(envelopeBytesFor(NativeFeeKind.TransferFungible, 150, 2)).toBe(150 + 128);
    expect(envelopeBytesFor(NativeFeeKind.CreateToken, 900)).toBe(900 + 4 + 96);
    expect(envelopeBytesFor(NativeFeeKind.Script, 500, 2)).toBe(500 + 4 + 192);
  });

  // Guard rails: impossible inputs are rejected instead of quoting fees for txs the chain
  // would never admit.
  it('rejects invalid inputs', () => {
    expect(() =>
      estimateNativeFee(NativeFeeKind.TransferFungible, v1Config(), { count: 0 })
    ).toThrow();
    expect(() =>
      estimateNativeFee(NativeFeeKind.RegisterName, v1Config(), { nameLength: 0 })
    ).toThrow();
    // maxTokenSymbolLength is 10
    expect(() =>
      estimateNativeFee(NativeFeeKind.CreateToken, v1Config(), { symbolLength: 11 })
    ).toThrow();
  });

  // feeShift semantics: the chain clamps shifts >= 64 to a zero work delta; the estimator must
  // match rather than undercharge/overcharge.
  it('zeroes scaled terms on an oversized feeShift', () => {
    const config = v1Config();
    config.feeShift = 64;

    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, config, { freshRows: 0 });

    // v1: work term zeroed, byte fee (raw kcal-base knob) unaffected by the shift.
    expect(estimate.expectedGasBill).toBe(0n);
  });
});
