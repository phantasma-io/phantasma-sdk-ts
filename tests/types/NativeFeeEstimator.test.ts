import { GasConfig } from '../../src/types/carbon/blockchain/gas-config';
import {
  envelopeBytesFor,
  estimateNativeFee,
  InfusedAsset,
  NativeFeeKind,
  phantasmaCanonicalRomBytes,
  storageQuantaFor,
} from '../../src/types/carbon/blockchain/tx-helpers/native-fee-estimator';

// Tier-1 fee calculator tests. Every v2 expectation below is a bill a real transaction was actually
// charged on a gas-model-v2 network, read back from its settlement: a failure here means the SDK
// disagrees with the chain, not that a number was chosen badly. The same fixtures and expectations
// exist in every SDK, so a divergence between SDKs shows up as a failure in one of them.

// Live mainnet v1 values: multiplier 10000, shift 0, transfer 10 units, byte fee 250000
// kcal-base, minimum offer 10, escrow 2 atoms/row.
function v1Config(): GasConfig {
  return new GasConfig({
    version: 0,
    maxNameLength: 32,
    maxTokenSymbolLength: 10,
    feeShift: 0,
    feeMultiplier: 10_000n,
    gasTokenId: 1n,
    dataTokenId: 2n,
    minimumGasOffer: 10n,
    dataEscrowPerRow: 2n,
    gasFeeTransfer: 10n,
    gasFeeQuery: 10n,
    gasFeeCreateTokenBase: 10_000_000_000n,
    gasFeeCreateTokenSymbol: 10_000_000_000n,
    gasFeeCreateTokenSeries: 2_500_000_000n,
    gasFeePerByte: 250_000n,
    gasFeeRegisterName: 10_000_000_000_000n,
    gasBurnRatioMul: 1n,
  });
}

// The mainnet / testnet gas-model-v2 configuration (special resolutions #79 and #68 carry the
// same 29 fields).
function v2Config(): GasConfig {
  const config = v1Config();
  config.version = 1;
  config.maxNameLength = 255;
  config.maxTokenSymbolLength = 255;
  config.dataEscrowPerRow = 200_000n;
  config.legacyDataEscrowPerRow = 2n;
  config.minimumGasBill = 10_000_000n;
  config.policyFeeCreateTokenBase = 100_000_000_000_000n;
  config.policyFeeCreateTokenSymbol = 100_000_000_000_000n;
  config.policyFeeCreateTokenSeries = 25_000_000_000_000n;
  config.policyFeeRegisterName = 100_000_000_000_000_000n;
  return config;
}

// The localnet configuration of the 2026-08-28 live run: policy fees at the 10 KCAL scale, escrow
// 50,000 atoms per row, everything else as mainnet.
function localnetConfig(): GasConfig {
  const config = v2Config();
  config.dataEscrowPerRow = 50_000n;
  config.policyFeeCreateTokenBase = 100_000_000_000n;
  config.policyFeeCreateTokenSymbol = 100_000_000_000n;
  config.policyFeeCreateTokenSeries = 25_000_000_000n;
  config.policyFeeRegisterName = 1_000_000_000_000n;
  return config;
}

describe('estimateNativeFee against settled v2 transactions', () => {
  // A native SOUL or KCAL transfer is 170 signed bytes and escrows nothing, even into an address
  // that has never held the token, because the gas and data token balance rows are free.
  it('bills a native gas- or data-token transfer for its envelope alone', () => {
    for (const tokenId of [1n, 2n]) {
      const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, v2Config(), {
        envelopeBytes: 170,
        tokenId,
      });
      expect(estimate.expectedGasBill).toBe(42_600_000n);
      expect(estimate.maxGas).toBe(42_600_000n);
      expect(estimate.maxData).toBe(0n);
      expect(estimate.newStorageQuanta).toBe(0);
    }
  });

  // The same envelope moving an ordinary token into a fresh holder creates one paid balance row,
  // which the chain adds to the byte count and escrows at the row price.
  it('bills and escrows the fresh balance row of an ordinary token transfer', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, v2Config(), {
      envelopeBytes: 170,
      tokenId: 97n,
    });
    expect(estimate.expectedGasBill).toBe(42_850_000n);
    expect(estimate.maxData).toBe(200_000n);

    const held = estimateNativeFee(NativeFeeKind.TransferFungible, v2Config(), {
      envelopeBytes: 170,
      tokenId: 97n,
      recipientHoldsToken: true,
    });
    expect(held.expectedGasBill).toBe(42_600_000n);
    expect(held.maxData).toBe(0n);
  });

  // Mainnet tx 6C1A6412... (block 9,075,820): a PoltergeistLite transfer of 178 bytes was billed
  // 44,600,000 - the figure the node printed in its "gas fees" abort.
  it('reproduces the first live mainnet bill', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, v2Config(), {
      envelopeBytes: 178,
      tokenId: 1n,
    });
    expect(estimate.expectedGasBill).toBe(44_600_000n);
  });

  // A native MintFungible of 171 bytes into a fresh holder of a token whose supply row is in
  // place. The call returns the new balance, and a call result is block data exactly like the
  // envelope. The result's size depends on the balance it reports: 9 bytes while it fits int64, up
  // to 33 beyond - so stating `bigFungible: false` prices the 9-byte result exactly, and leaving
  // it unstated prices the 33-byte maximum, 24 bytes of block data more.
  it('bills a fungible mint with its 9-byte result when the token is declared small', () => {
    const estimate = estimateNativeFee(NativeFeeKind.MintFungible, v2Config(), {
      envelopeBytes: 171,
      tokenId: 97n,
      bigFungible: false,
      supplyRowExists: true,
    });
    expect(estimate.expectedGasBill).toBe(45_350_000n);
    expect(estimate.maxData).toBe(200_000n);

    const defaulted = estimateNativeFee(NativeFeeKind.MintFungible, v2Config(), {
      envelopeBytes: 171,
      tokenId: 97n,
      supplyRowExists: true,
    });
    expect(defaulted.expectedGasBill - estimate.expectedGasBill).toBe(24n * 25n * 10_000n);
  });

  // An NFT transfer of 170 bytes into a fresh holder. The owner's lookup row is
  // deleted and the recipient's created (net zero), the fresh balance row is the one net quantum;
  // both new rows are escrowed, the deleted row's deposit comes back at its own price.
  it('bills an NFT transfer for its net rows and escrows its new ones', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferNonFungible, v2Config(), {
      envelopeBytes: 170,
      tokenId: 7n,
    });
    expect(estimate.expectedGasBill).toBe(42_850_000n);
    expect(estimate.newStorageQuanta).toBe(2);
    expect(estimate.deletedStorageQuanta).toBe(1);
    expect(estimate.maxData).toBe(400_000n);
  });

  // The same transfer into an NFT-derived address (an infusion) pays one query fee
  // more for the owner check of the target.
  it('adds the query fee of an infusion target', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferNonFungible, v2Config(), {
      envelopeBytes: 170,
      tokenId: 7n,
      toIsNftAddress: true,
    });
    expect(estimate.expectedGasBill).toBe(42_950_000n);

    // Minting into an NFT address pays the same owner lookup, once per call, on all three mint
    // kinds - the chain checks the recipient the same way it does for a transfer.
    const mints = [
      NativeFeeKind.MintFungible,
      NativeFeeKind.MintNonFungible,
      NativeFeeKind.MintPhantasmaNonFungible,
    ] as const;
    for (const kind of mints) {
      const params = { envelopeBytes: 200, tokenId: 7n, romBytes: 10 };
      const plain = estimateNativeFee(kind, v2Config(), params);
      const infused = estimateNativeFee(kind, v2Config(), { ...params, toIsNftAddress: true });
      expect(infused.expectedGasBill - plain.expectedGasBill).toBe(100_000n);
    }
  });

  // A native NFT burn of 138 bytes; the mint's ten quanta are deleted and refunded,
  // no net block data, the token had been burned before and its supply row was in place.
  it('bills an NFT burn for its work and envelope only', () => {
    const estimate = estimateNativeFee(NativeFeeKind.BurnNonFungible, v2Config(), {
      envelopeBytes: 138,
      tokenId: 7n,
      romBytes: 3067 * 2 + 36,
      romHasMetaId: true,
      tokenBurnedBefore: true,
      supplyRowExists: true,
    });
    expect(estimate.expectedGasBill).toBe(34_800_000n);
    expect(estimate.deletedStorageQuanta).toBe(10);
    expect(estimate.newStorageQuanta).toBe(0);
    expect(estimate.maxData).toBe(0n);
  });

  // Burning an NFT returns whatever its own address holds, and the chain charges for each returned
  // asset as the transfers it performs: a transfer fee plus the owner lookup of the NFT-address
  // source per fungible token; an instance query, a transfer per instance and that lookup per NFT
  // token. The returned rows never add block data - a burn refunds more than the returns create -
  // so the bill moves by the work alone, while the escrow ceiling covers a balance row the burner
  // lacks and the moved lookup rows. Measured live 2026-09-02: +200,000 for one infused KCAL atom,
  // +700,000 for KCAL, a custom token and an NFT together.
  it('prices the assets a burned NFT returns', () => {
    const burn = (...infusions: InfusedAsset[]) =>
      estimateNativeFee(NativeFeeKind.BurnNonFungible, v2Config(), {
        envelopeBytes: 138,
        tokenId: 7n,
        romBytes: 3067 * 2 + 36,
        romHasMetaId: true,
        tokenBurnedBefore: true,
        supplyRowExists: true,
        infusions,
      });
    const empty = burn();
    expect(empty.expectedGasBill).toBe(34_800_000n);

    // One fungible token: a transfer and a query. The gas token's rows are free, so nothing else.
    const kcal = burn({ tokenId: 1n });
    expect(kcal.expectedGasBill - empty.expectedGasBill).toBe(20n * 10_000n);
    expect(kcal.newStorageQuanta).toBe(empty.newStorageQuanta);
    expect(kcal.deletedStorageQuanta).toBe(empty.deletedStorageQuanta);

    // A custom token the burner does not hold: the same work, plus the balance row the return
    // creates - and the NFT address's own row, which the return deletes.
    const custom = burn({ tokenId: 97n });
    expect(custom.expectedGasBill - empty.expectedGasBill).toBe(20n * 10_000n);
    expect(custom.newStorageQuanta).toBe(empty.newStorageQuanta + 1);
    expect(custom.deletedStorageQuanta).toBe(empty.deletedStorageQuanta + 1);
    expect(custom.maxData).toBe(empty.maxData + v2Config().dataEscrowPerRow);
    expect(burn({ tokenId: 97n, burnerHoldsToken: true }).newStorageQuanta).toBe(
      empty.newStorageQuanta
    );
    // An id the reader could not resolve is priced as a paid row: over-covering, never short.
    expect(burn({}).newStorageQuanta).toBe(empty.newStorageQuanta + 1);

    // Two instances of an NFT token: the instance query, two transfers, the lookup; a balance row
    // plus two moved lookup rows created, the NFT address's balance row and two lookups deleted.
    const nft = burn({ tokenId: 9n, nonFungible: true, instanceCount: 2 });
    expect(nft.expectedGasBill - empty.expectedGasBill).toBe(40n * 10_000n);
    expect(nft.newStorageQuanta).toBe(empty.newStorageQuanta + 3);
    expect(nft.deletedStorageQuanta).toBe(empty.deletedStorageQuanta + 3);

    // The live combination: KCAL, a held custom token and one NFT - seventy units.
    const all = burn(
      { tokenId: 1n },
      { tokenId: 97n, burnerHoldsToken: true },
      { tokenId: 9n, nonFungible: true, instanceCount: 1, burnerHoldsToken: true }
    );
    expect(all.expectedGasBill - empty.expectedGasBill).toBe(70n * 10_000n);

    expect(() => burn({ tokenId: 9n, nonFungible: true, instanceCount: 0 })).toThrow(
      /instanceCount/
    );
  });

  // Two settled CreateToken bills with 7-character symbols. The fungible one is 374 signed bytes and writes the
  // symbol, token-info and null-balance rows and returns the u64 token id; the NFT-capable one
  // (466 bytes) adds the series counter. Policy fee 10 KCAL + 10 KCAL >> 6.
  it('reproduces the two localnet CreateToken bills to the atom', () => {
    const fungible = estimateNativeFee(NativeFeeKind.CreateToken, localnetConfig(), {
      envelopeBytes: 374,
      symbolLength: 7,
      // The Call arguments ARE the serialized TokenInfo, so their length is the envelope minus the
      // 100-byte transaction header and the 58 bytes the Call header and witness array add.
      tokenInfoBytes: 374 - 100 - 58,
    });
    expect(fungible.expectedGasBill).toBe(101_658_750_000n);
    expect(fungible.newStorageQuanta).toBe(3);
    expect(fungible.maxData).toBe(150_000n);

    const nft = estimateNativeFee(NativeFeeKind.CreateToken, localnetConfig(), {
      envelopeBytes: 466,
      symbolLength: 7,
      tokenInfoBytes: 466 - 100 - 58,
      nonFungible: true,
    });
    expect(nft.expectedGasBill).toBe(101_682_000_000n);
    expect(nft.newStorageQuanta).toBe(4);
    expect(nft.maxData).toBe(200_000n);
  });

  // A settled CreateTokenSeries of 246 bytes with a `_i` in its metadata writes the
  // series info, its supply and the meta-id lookup and returns the u32 series id.
  // Validating token metadata that names a staking organisation looks the organisation up, and
  // metadata that names a reward token reads that token: one query fee each, on top of the policy
  // fee and the rows.
  it('charges the lookups that staking metadata costs a token creation', () => {
    const create = (hasStakingOrganisation: boolean, hasStakingRewardToken: boolean) =>
      estimateNativeFee(NativeFeeKind.CreateToken, localnetConfig(), {
        envelopeBytes: 374,
        symbolLength: 7,
        tokenInfoBytes: 374 - 100 - 58,
        hasStakingOrganisation,
        hasStakingRewardToken,
      });
    const plain = create(false, false);
    expect(create(true, false).expectedGasBill - plain.expectedGasBill).toBe(100_000n);
    expect(create(false, true).expectedGasBill - plain.expectedGasBill).toBe(100_000n);
    const both = create(true, true);
    expect(both.expectedGasBill - plain.expectedGasBill).toBe(200_000n);
    expect(both.newStorageQuanta).toBe(plain.newStorageQuanta);
  });

  it('reproduces the localnet CreateTokenSeries bill', () => {
    const estimate = estimateNativeFee(NativeFeeKind.CreateTokenSeries, localnetConfig(), {
      envelopeBytes: 246,
      // As above, less the 8-byte token id that precedes the SeriesInfo in the Call arguments.
      seriesInfoBytes: 246 - 100 - 58 - 8,
      seriesHasMetaId: true,
    });
    expect(estimate.expectedGasBill).toBe(25_063_250_000n);
    expect(estimate.newStorageQuanta).toBe(3);
  });

  // Two settled deterministic Phantasma mints. The 182-byte public ROM was the token's
  // first mint to that owner (fresh balance row, 5 quanta); the 3,083-byte one found the balance
  // row in place and its canonical ROM alone took seven quanta (10 in total). Each instance pays the
  // mint plus two query fees and returns 40 bytes after the 4-byte count.
  //
  // Both were minted into a UNIQUE series of a token whose supply row was in place, and every
  // settled-bill case below says both explicitly: the series mode and the supply row are chain
  // state the message does not carry, so the calculator assumes the costlier reading of each when
  // nobody tells it. Leaving either out here would compare the chain's receipt against a
  // deliberate over-estimate.
  it('reproduces the two localnet Phantasma NFT mint bills', () => {
    const small = estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, localnetConfig(), {
      envelopeBytes: 413,
      tokenId: 9n,
      romBytes: 182,
      duplicatedSeries: false,
      supplyRowExists: true,
    });
    expect(small.expectedGasBill).toBe(115_800_000n);
    expect(small.newStorageQuanta).toBe(5);
    expect(small.maxData).toBe(250_000n);

    const large = estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, localnetConfig(), {
      envelopeBytes: 3314,
      tokenId: 9n,
      romBytes: 3083,
      recipientHoldsToken: true,
      duplicatedSeries: false,
      supplyRowExists: true,
    });
    expect(large.expectedGasBill).toBe(842_300_000n);
    expect(large.newStorageQuanta).toBe(10);
    expect(large.maxData).toBe(500_000n);
  });

  // The same model at a different network's prices, including two 166-byte mints of the same size
  // where only the first paid for the owner's balance row.
  it('reproduces the four testnet Phantasma NFT mint bills', () => {
    const cases: Array<[number, number, boolean, bigint, number]> = [
      [398, 167, false, 112_050_000n, 5],
      [3298, 3067, true, 838_300_000n, 10],
      [397, 166, false, 111_800_000n, 5],
      [397, 166, true, 111_550_000n, 4],
    ];
    for (const [envelopeBytes, romBytes, recipientHoldsToken, bill, quanta] of cases) {
      const estimate = estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, v2Config(), {
        envelopeBytes,
        tokenId: 9n,
        romBytes,
        recipientHoldsToken,
        duplicatedSeries: false,
        supplyRowExists: true,
      });
      expect(estimate.expectedGasBill).toBe(bill);
      expect(estimate.newStorageQuanta).toBe(quanta);
    }
  });

  // A sweep of settled mints across the quantum boundary (public ROM bytes -> quanta, the first
  // mint also paying for the balance row): 268 -> 5, 968 -> 5, 1168 -> 6, 3068 -> 10, 5068 -> 13.
  // 968 and 1168 straddle the 1024-byte boundary, which is where a wrong ROM model shows up.
  it('reproduces the ROM-size sweep quanta', () => {
    const sweep: Array<[number, boolean, number]> = [
      [268, false, 5],
      [968, true, 5],
      [1168, true, 6],
      [3068, true, 10],
      [5068, true, 13],
    ];
    for (const [romBytes, recipientHoldsToken, quanta] of sweep) {
      const estimate = estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, v2Config(), {
        envelopeBytes: 1000,
        romBytes,
        recipientHoldsToken,
        supplyRowExists: true,
      });
      expect(estimate.newStorageQuanta).toBe(quanta);
    }
  });

  // Several instances in one transaction: the work units, the per-instance query fees, the call
  // result bytes and the per-instance storage all scale with the count, while the recipient's
  // balance row is paid for exactly once. A settled three-instance Phantasma mint of 75-byte public
  // ROMs, 490 signed bytes: 13 quanta are one balance row plus, per instance, one ROM row and the
  // three fixed rows a deterministic mint writes.
  it('scales a multi-instance Phantasma mint by its instance count', () => {
    const estimate = estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, localnetConfig(), {
      envelopeBytes: 490,
      count: 3,
      romBytes: 75,
      duplicatedSeries: false,
      supplyRowExists: true,
    });
    expect(estimate.expectedGasBill).toBe(157_650_000n);
    expect(estimate.newStorageQuanta).toBe(13);
    expect(estimate.maxData).toBe(650_000n);

    // The recipient's balance row is paid for once however many instances are minted, so one
    // instance writes four of the thirteen quanta plus that shared row, not a third of them.
    const single = estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, localnetConfig(), {
      envelopeBytes: 490,
      count: 1,
      romBytes: 75,
      duplicatedSeries: false,
      supplyRowExists: true,
    });
    expect(single.newStorageQuanta).toBe(5);
  });

  // A duplicated series is read twice per instance rather than once - the mode check and the shared
  // ROM each read the token info - and its supply is read once per series for the whole
  // transaction, because the chain reuses the number it already read. The counts therefore scale
  // differently and the model has to keep them apart.
  it('charges a duplicated series three queries an instance and one for the series', () => {
    const shared = {
      envelopeBytes: 490,
      count: 3,
      romBytes: 75,
      duplicatedSeries: true,
    } as const;
    const oneSeries = estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, localnetConfig(), {
      ...shared,
      distinctSeriesCount: 1,
    });
    const unique = estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, localnetConfig(), {
      envelopeBytes: 490,
      count: 3,
      romBytes: 75,
      duplicatedSeries: false,
    });
    // Three extra instance queries and one supply query over the unique-series bill.
    expect(oneSeries.expectedGasBill - unique.expectedGasBill).toBe(40n * 10_000n);

    const threeSeries = estimateNativeFee(
      NativeFeeKind.MintPhantasmaNonFungible,
      localnetConfig(),
      {
        ...shared,
        distinctSeriesCount: 3,
      }
    );
    expect(threeSeries.expectedGasBill - oneSeries.expectedGasBill).toBe(20n * 10_000n);

    // A series count nobody could have minted is a bookkeeping error, not a price.
    expect(() =>
      estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, localnetConfig(), {
        ...shared,
        distinctSeriesCount: 4,
      })
    ).toThrow(/distinctSeriesCount/);
  });

  // A settled two-instance NFT transfer of 182 signed bytes: each instance deletes the owner's
  // lookup row and creates the recipient's, so only the recipient's new balance row is billed,
  // while the escrow ceiling still covers all three rows the transaction may create.
  it('scales a multi-instance NFT transfer by its instance count', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferNonFungible, localnetConfig(), {
      envelopeBytes: 182,
      count: 2,
      tokenId: 181n,
    });
    expect(estimate.expectedGasBill).toBe(45_950_000n);
    expect(estimate.newStorageQuanta).toBe(3);
    expect(estimate.deletedStorageQuanta).toBe(2);
    expect(estimate.maxData).toBe(150_000n);
  });

  // A settled RegisterName of a 10-character name, 213 signed bytes. Governance rows are free data,
  // so the bill is the policy fee (10,000,000 KCAL >> 9) plus the envelope and nothing else.
  it('reproduces the testnet RegisterName bill', () => {
    const estimate = estimateNativeFee(NativeFeeKind.RegisterName, v2Config(), {
      envelopeBytes: 213,
      nameLength: 10,
    });
    expect(estimate.expectedGasBill).toBe(195_312_553_250_000n);
    expect(estimate.maxData).toBe(0n);
  });

  // A tiny v2 tx can never bill below the consensus floor; the offer must also respect the
  // admission check maxGas >= minimumGasBill.
  it('applies the minimum bill floor', () => {
    const config = v2Config();
    config.minimumGasBill = 10_000_000_000n;
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, config, {
      envelopeBytes: 170,
      tokenId: 1n,
    });
    expect(estimate.expectedGasBill).toBe(10_000_000_000n);
    expect(estimate.maxGas).toBe(10_000_000_000n);
  });

  // Facts about chain state that the message cannot carry are defaulted to the case that COSTS
  // MORE, because the offer is spent against the real bill and a short one aborts the transaction
  // while an over-offer is refunded. These three pin that direction for the facts where the cheap
  // reading used to be the default; each case fails if a default flips back.
  describe('unspecified state facts default to the costlier reading', () => {
    it('assumes a Phantasma series is duplicated until told otherwise', () => {
      const shared = { envelopeBytes: 490, count: 3, romBytes: 75 } as const;
      const assumed = estimateNativeFee(
        NativeFeeKind.MintPhantasmaNonFungible,
        localnetConfig(),
        shared
      );
      const duplicated = estimateNativeFee(
        NativeFeeKind.MintPhantasmaNonFungible,
        localnetConfig(),
        {
          ...shared,
          duplicatedSeries: true,
        }
      );
      const unique = estimateNativeFee(NativeFeeKind.MintPhantasmaNonFungible, localnetConfig(), {
        ...shared,
        duplicatedSeries: false,
      });
      // Three extra instance queries plus one supply query: 40 units at this config's multiplier.
      expect(duplicated.expectedGasBill - unique.expectedGasBill).toBe(40n * 10_000n);
      expect(assumed.expectedGasBill).toBe(duplicated.expectedGasBill);
    });

    it('assumes a minted ROM carries a meta id, which is a row it must escrow for', () => {
      const shared = { envelopeBytes: 300, tokenId: 97n, romBytes: 64 } as const;
      const assumed = estimateNativeFee(NativeFeeKind.MintNonFungible, v2Config(), shared);
      const withMetaId = estimateNativeFee(NativeFeeKind.MintNonFungible, v2Config(), {
        ...shared,
        romHasMetaId: true,
      });
      const without = estimateNativeFee(NativeFeeKind.MintNonFungible, v2Config(), {
        ...shared,
        romHasMetaId: false,
      });
      expect(withMetaId.newStorageQuanta).toBe(without.newStorageQuanta + 1);
      expect(assumed.newStorageQuanta).toBe(withMetaId.newStorageQuanta);
      // maxData is the one that has to be right: the chain aborts a transaction whose escrow
      // exceeds it, so a row assumed away is not an under-offer but a failed transaction.
      expect(assumed.maxData).toBe(withMetaId.maxData);
      expect(assumed.maxData - without.maxData).toBe(v2Config().dataEscrowPerRow);
    });

    // Same flag, same default on a burn - it keeps the deleted rows mirroring what the mint wrote -
    // but there it moves a reported number and nothing else. Deleted rows are refunded, `maxData`
    // covers only the rows an operation CREATES, and a burn always deletes more than it creates, so
    // the block-data term floors at zero whichever way the flag goes. This pins both halves: the
    // count follows the flag, the price does not.
    it('counts a burned meta-id row but does not price on it', () => {
      const shared = { envelopeBytes: 300, tokenId: 97n, romBytes: 64 } as const;
      const assumed = estimateNativeFee(NativeFeeKind.BurnNonFungible, v2Config(), shared);
      const without = estimateNativeFee(NativeFeeKind.BurnNonFungible, v2Config(), {
        ...shared,
        romHasMetaId: false,
      });
      expect(assumed.deletedStorageQuanta).toBe(without.deletedStorageQuanta + 1);
      expect(assumed.expectedGasBill).toBe(without.expectedGasBill);
      expect(assumed.maxGas).toBe(without.maxGas);
      expect(assumed.maxData).toBe(without.maxData);
    });

    it('assumes a created series carries a meta id, which is one more row', () => {
      const shared = { envelopeBytes: 300, seriesInfoBytes: 100 } as const;
      const assumed = estimateNativeFee(NativeFeeKind.CreateTokenSeries, v2Config(), shared);
      const without = estimateNativeFee(NativeFeeKind.CreateTokenSeries, v2Config(), {
        ...shared,
        seriesHasMetaId: false,
      });
      expect(assumed.newStorageQuanta).toBe(without.newStorageQuanta + 1);
    });

    // The supply row disappears when its balance reaches exactly zero - a limited token fully in
    // circulation, an unlimited one with nothing outstanding - and the next mint or burn recreates
    // it. Unstated, every mint and burn prices that recreation: one quantum in the bill and the
    // escrow ceiling. Transfers never touch the row, and the chain's own gas and data tokens are
    // free rows, so neither moves with the flag.
    it('assumes the supply row must be recreated on mints and burns', () => {
      const kinds = [
        NativeFeeKind.MintFungible,
        NativeFeeKind.BurnFungible,
        NativeFeeKind.MintNonFungible,
        NativeFeeKind.MintPhantasmaNonFungible,
        NativeFeeKind.BurnNonFungible,
      ] as const;
      for (const kind of kinds) {
        const shared = { envelopeBytes: 300, tokenId: 97n, romBytes: 64 } as const;
        const assumed = estimateNativeFee(kind, v2Config(), shared);
        const inPlace = estimateNativeFee(kind, v2Config(), { ...shared, supplyRowExists: true });
        expect(assumed.newStorageQuanta).toBe(inPlace.newStorageQuanta + 1);
        expect(assumed.maxData - inPlace.maxData).toBe(v2Config().dataEscrowPerRow);
        // An NFT burn deletes more quanta than it creates, so its block-data term floors at zero
        // either way and only the escrow ceiling moves; everywhere else the bill moves too.
        expect(assumed.expectedGasBill - inPlace.expectedGasBill).toBe(
          kind === NativeFeeKind.BurnNonFungible ? 0n : 25n * 10_000n
        );
      }

      const transfer = { envelopeBytes: 300, tokenId: 97n } as const;
      expect(estimateNativeFee(NativeFeeKind.TransferFungible, v2Config(), transfer)).toEqual(
        estimateNativeFee(NativeFeeKind.TransferFungible, v2Config(), {
          ...transfer,
          supplyRowExists: true,
        })
      );
      const gasToken = { envelopeBytes: 300, tokenId: 1n } as const;
      expect(estimateNativeFee(NativeFeeKind.BurnFungible, v2Config(), gasToken)).toEqual(
        estimateNativeFee(NativeFeeKind.BurnFungible, v2Config(), {
          ...gasToken,
          supplyRowExists: true,
        })
      );
    });
  });

  // A wallet that caches prices gets its config back as plain data - a spread, a structured clone,
  // a value out of a store - with the fields intact and the class prototype gone. Selecting the gas
  // model through a prototype accessor silently bills such a config under the v1 rules and offers
  // orders of magnitude too little, which is the shape of the failure this whole fee model exists
  // to prevent. The model is chosen by the version field, so it survives the round trip.
  it('bills a config restored as plain data under the same model as the instance', () => {
    const live = v2Config();
    const restored = { ...live } as GasConfig;
    expect(restored instanceof GasConfig).toBe(false);
    expect((restored as { hasGasModelV2?: boolean }).hasGasModelV2).toBeUndefined();

    const params = { envelopeBytes: 170, tokenId: 1n } as const;
    expect(estimateNativeFee(NativeFeeKind.TransferFungible, restored, params)).toEqual(
      estimateNativeFee(NativeFeeKind.TransferFungible, live, params)
    );
  });

  it('requires the envelope size under gas model v2', () => {
    expect(() => estimateNativeFee(NativeFeeKind.TransferFungible, v2Config())).toThrow(
      'envelopeBytes is required'
    );
  });
});

describe('estimateNativeFee under gas model v1', () => {
  // v1 transfer with an existing recipient row: bill is the pure work term 10 * 10000.
  it('bills work only for a transfer to an existing recipient', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, v1Config(), {
      recipientHoldsToken: true,
    });
    expect(estimate.expectedGasBill).toBe(100_000n);
    // stdFee shape: 2x min offer + work + flat 1 KiB byte allowance.
    expect(estimate.maxGas).toBe(10n * 2n + 100_000n + 1024n * 250_000n);
    expect(estimate.maxData).toBe(0n);
  });

  // v1 transfer default (worst case: 1 fresh row): the row quantum joins the byte fee and the
  // escrow shows up in maxData at the v1 price.
  it('includes one fresh row by default', () => {
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, v1Config());
    expect(estimate.expectedGasBill).toBe(100_000n + 250_000n);
    expect(estimate.maxData).toBe(2n);
  });

  // CreateToken under v1 charges unit-priced product fees through the multiplier; the 8-byte
  // result and the rows are block data at the v1 byte price.
  it('prices token creation through the multiplier', () => {
    const estimate = estimateNativeFee(NativeFeeKind.CreateToken, v1Config(), {
      symbolLength: 4,
      tokenInfoBytes: 200,
    });
    const work = (10_000_000_000n + 1_250_000_000n) * 10_000n;
    expect(estimate.expectedGasBill).toBe(work + (8n + 3n) * 250_000n);
  });

  // RegisterName halves the price per character after the first, under both models.
  it('halves the name price per character under both models', () => {
    const v1 = estimateNativeFee(NativeFeeKind.RegisterName, v1Config(), { nameLength: 8 });
    const v2 = estimateNativeFee(NativeFeeKind.RegisterName, v2Config(), {
      nameLength: 8,
      envelopeBytes: 300,
    });
    expect(v1.expectedGasBill).toBe((10_000_000_000_000n >> 7n) * 10_000n);
    expect(v2.expectedGasBill).toBe((100_000_000_000_000_000n >> 7n) + 300n * 25n * 10_000n);
  });

  // feeShift semantics: the chain clamps shifts >= 64 to a zero work delta; the estimator must
  // match rather than undercharge/overcharge.
  it('zeroes scaled terms on an oversized feeShift', () => {
    const config = v1Config();
    config.feeShift = 64;
    const estimate = estimateNativeFee(NativeFeeKind.TransferFungible, config, {
      recipientHoldsToken: true,
    });
    expect(estimate.expectedGasBill).toBe(0n);
  });
});

describe('estimateNativeFee guard rails', () => {
  // The Script kind budgets a generous VM unit allowance (default 5000 exceeds every script in
  // mainnet history) instead of pretending opcode costs are closed-form.
  it('budgets a VM allowance for scripts', () => {
    const estimate = estimateNativeFee(NativeFeeKind.Script, v2Config(), {
      envelopeBytes: 568,
      scriptStorageQuanta: 0,
    });
    // (5000 vm units + (568 + 512 events) * 25) * 10000
    expect(estimate.expectedGasBill).toBe((5000n + 1080n * 25n) * 10_000n);
  });

  // Envelope arithmetic mirrors SignedTxMsg: native kinds append bare 64-byte signatures,
  // call/script kinds append a length-prefixed 96-byte witness array. The witness count is always
  // stated: a fee kind cannot tell a two-signature gas-payer transfer from its one-signature form.
  it('follows the witness layout for envelope sizes', () => {
    expect(envelopeBytesFor(NativeFeeKind.TransferFungible, 150, 1)).toBe(150 + 64);
    expect(envelopeBytesFor(NativeFeeKind.TransferFungible, 150, 2)).toBe(150 + 128);
    expect(envelopeBytesFor(NativeFeeKind.CreateToken, 900, 1)).toBe(900 + 4 + 96);
    expect(envelopeBytesFor(NativeFeeKind.Script, 500, 2)).toBe(500 + 4 + 192);
  });

  it('measures rows in 1024-byte quanta and the canonical ROM at twice the public one', () => {
    expect(storageQuantaFor(0)).toBe(0);
    expect(storageQuantaFor(1024)).toBe(1);
    expect(storageQuantaFor(1025)).toBe(2);
    expect(phantasmaCanonicalRomBytes(182)).toBe(400);
  });

  // The chain's length-halved fee is defined up to 64 characters, and the calculator refuses to
  // price anything longer. A 64-character name is the longest priceable one and must still price.
  it('refuses to price a name or symbol past the length the chain can shift', () => {
    const config = v2Config();
    const longest = estimateNativeFee(NativeFeeKind.RegisterName, config, {
      envelopeBytes: 300,
      nameLength: 64,
    });
    expect(longest.expectedGasBill).toBeGreaterThan(0n);

    expect(() =>
      estimateNativeFee(NativeFeeKind.RegisterName, config, { envelopeBytes: 300, nameLength: 65 })
    ).toThrow(/cannot be priced offline/);
    expect(() =>
      estimateNativeFee(NativeFeeKind.CreateToken, config, {
        envelopeBytes: 300,
        symbolLength: 65,
        tokenInfoBytes: 100,
      })
    ).toThrow(/cannot be priced offline/);
  });

  // Impossible inputs are rejected instead of quoting fees for txs the chain would never admit.
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
    expect(() =>
      estimateNativeFee(NativeFeeKind.MintNonFungible, v2Config(), {
        envelopeBytes: 300,
        count: 2,
        romBytes: [10],
      })
    ).toThrow('one entry per instance');
  });
});
