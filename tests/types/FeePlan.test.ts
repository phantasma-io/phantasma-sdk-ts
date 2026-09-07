import { Bytes32 } from '../../src/types/carbon/bytes32';
import { CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import { IntX } from '../../src/types/carbon/int-x';
import { SmallString } from '../../src/types/carbon/small-string';
import { TxTypes } from '../../src/types/carbon/tx-types';
import { GasConfig } from '../../src/types/carbon/blockchain/gas-config';
import { ModuleId } from '../../src/types/carbon/blockchain/module-id';
import { TxMsg } from '../../src/types/carbon/blockchain/tx-msg';
import { MsgCallArgSections, TxMsgCall } from '../../src/types/carbon/blockchain/tx-msg-call';
import { TxMsgCallMulti } from '../../src/types/carbon/blockchain/tx-msg-call-multi';
import { TxMsgBurnFungible } from '../../src/types/carbon/blockchain/tx-msg-burn-fungible';
import { TxMsgBurnFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-burn-fungible-gas-payer';
import { TxMsgBurnNonFungible } from '../../src/types/carbon/blockchain/tx-msg-burn-non-fungible';
import { TxMsgBurnNonFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-burn-non-fungible-gas-payer';
import { TxMsgMintFungible } from '../../src/types/carbon/blockchain/tx-msg-mint-fungible';
import { TxMsgMintNonFungible } from '../../src/types/carbon/blockchain/tx-msg-mint-non-fungible';
import { TxMsgPhantasma } from '../../src/types/carbon/blockchain/tx-msg-phantasma';
import { TxMsgPhantasmaRaw } from '../../src/types/carbon/blockchain/tx-msg-phantasma-raw';
import { TxMsgTrade } from '../../src/types/carbon/blockchain/tx-msg-trade';
import { TxMsgTransferFungible } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible';
import { TxMsgTransferFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible-gas-payer';
import { TxMsgTransferNonFungibleMultiGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-non-fungible-multi-gas-payer';
import { TxMsgTransferNonFungibleSingle } from '../../src/types/carbon/blockchain/tx-msg-transfer-non-fungible-single';
import { TxMsgTransferNonFungibleSingleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-non-fungible-single-gas-payer';
import { SignedTxMsg } from '../../src/types/carbon/blockchain/signed-tx-msg';
import { TxMsgSigner } from '../../src/types/carbon/blockchain/extensions/tx-msg-signer';
import { StandardMeta } from '../../src/types/carbon/blockchain/modules/standard-meta';
import { GovernanceContractMethods } from '../../src/types/carbon/blockchain/modules/governance-contract-methods';
import { TokenContractMethods } from '../../src/types/carbon/blockchain/modules/token-contract-methods';
import { TokenHelper } from '../../src/types/carbon/blockchain/modules/token-helper';
import { SeriesInfoBuilder } from '../../src/types/carbon/blockchain/modules/builders/series-info-builder';
import { TokenInfoBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-info-builder';
import { TokenMetadataBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-metadata-builder';
import { TokenSchemasBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-schemas-builder';
import { CreateTokenSeriesTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/create-token-series-tx-helper';
import { CreateTokenTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/create-token-tx-helper';
import { PhantasmaNftMintInfo } from '../../src/types/carbon/blockchain/modules/phantasma-nft-mint-info';
import { TxMsgTransferNonFungibleMulti } from '../../src/types/carbon/blockchain/tx-msg-transfer-non-fungible-multi';
import { MintPhantasmaNonFungibleArgs } from '../../src/types/carbon/blockchain/modules/mint-phantasma-non-fungible-args';
import {
  burnedInstances,
  planFees,
  type FeePlanOptions,
} from '../../src/types/carbon/blockchain/tx-helpers/fee-plan';
import { NativeFeeKind } from '../../src/types/carbon/blockchain/tx-helpers/native-fee-estimator';
import {
  VmDynamicStruct,
  VmNamedDynamicVariable,
  VmType,
} from '../../src/types/carbon/blockchain/vm/index';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';

// The mainnet gas-model-v2 configuration (special resolution #79).
function mainnetConfig(): GasConfig {
  return new GasConfig({
    version: 1,
    maxNameLength: 255,
    maxTokenSymbolLength: 255,
    feeShift: 0,
    maxStructureSize: 1_048_576,
    feeMultiplier: 10_000n,
    gasTokenId: 1n,
    dataTokenId: 2n,
    minimumGasOffer: 10n,
    dataEscrowPerRow: 200_000n,
    gasFeeTransfer: 10n,
    gasFeeQuery: 10n,
    gasFeeCreateTokenBase: 10_000_000_000n,
    gasFeeCreateTokenSymbol: 10_000_000_000n,
    gasFeeCreateTokenSeries: 2_500_000_000n,
    gasFeePerByte: 250_000n,
    gasFeeRegisterName: 10_000_000_000_000n,
    gasBurnRatioMul: 1n,
    gasBurnRatioShift: 0,
    minimumGasBill: 10_000_000n,
    policyFeeCreateTokenBase: 100_000_000_000_000n,
    policyFeeCreateTokenSymbol: 100_000_000_000_000n,
    policyFeeCreateTokenSeries: 25_000_000_000_000n,
    policyFeeRegisterName: 100_000_000_000_000_000n,
    legacyDataEscrowPerRow: 2n,
  });
}

const PAYER = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');
const OWNER = PhantasmaKeys.fromWIF('KwVG94yjfVg1YKFyRxAGtug93wdRbmLnqqrFV6Yd2CiA9KZDAp4H');
const payerPub = new Bytes32(PAYER.publicKey);
const ownerPub = new Bytes32(OWNER.publicKey);
const config = mainnetConfig();

// bill = (work + 25 * (envelope + net quanta + result)) * 10000, plus the policy fee.
function bill(work: bigint, blockData: number, policy = 0n): bigint {
  return (work + 25n * BigInt(blockData)) * 10_000n + policy;
}

function transfer(tokenId: bigint, type = TxTypes.TransferFungible): TxMsg {
  const msg = new TxMsg(type, 1_787_000_000_000n, 0n, 0n, payerPub, SmallString.empty);
  msg.msg =
    type === TxTypes.TransferFungible
      ? new TxMsgTransferFungible(ownerPub, tokenId, 10_000_000n)
      : new TxMsgTransferFungibleGasPayer({ to: payerPub, from: ownerPub, tokenId, amount: 5n });
  return msg;
}

function tokenInfo(nonFungible: boolean, metadata?: Uint8Array) {
  return TokenInfoBuilder.build(
    'GPX',
    IntX.fromI64(0n),
    nonFungible,
    nonFungible ? 0 : 2,
    payerPub,
    metadata ??
      TokenMetadataBuilder.buildAndSerialize({
        name: 'Plan probe',
        icon: 'data:image/png;base64,iVBORw0KGgo=',
        url: 'https://example.invalid/p',
        description: 'x',
      }),
    nonFungible ? TokenSchemasBuilder.prepareStandard(false) : null
  );
}

const phantasmaMint = (seriesId: bigint, romBytes: number) =>
  new PhantasmaNftMintInfo({
    phantasmaSeriesId: IntX.fromBigInt(seriesId),
    rom: new Uint8Array(romBytes),
    ram: new Uint8Array(),
  });

// What is under test here is the planner READING a mint out of the call arguments, so the call is
// assembled directly instead of through the builder: the two are exercised together in the
// builder's own tests, and a planner test that went through a builder would not say which of them
// broke.
const phantasmaMintCall = (tokens: PhantasmaNftMintInfo[], recipient: Bytes32 = ownerPub) => {
  const msg = new TxMsg(TxTypes.Call, 1_787_000_000_000n, 0n, 0n, payerPub, SmallString.empty);
  const call = new TxMsgCall();
  call.moduleId = ModuleId.Token;
  call.methodId = TokenContractMethods.MintPhantasmaNonFungible;
  const w = new CarbonBinaryWriter();
  new MintPhantasmaNonFungibleArgs({ tokenId: 9n, address: recipient, tokens }).write(w);
  call.args = w.toUint8Array();
  msg.msg = call;
  return msg;
};

// A module call and a message carrying one. Every block below builds its cases from these two, so
// what a planned call looks like is written down once.
const moduleCall = (
  moduleId: ModuleId,
  methodId: number,
  writeArgs: (w: CarbonBinaryWriter) => void
) => {
  const call = new TxMsgCall();
  call.moduleId = moduleId;
  call.methodId = methodId;
  const w = new CarbonBinaryWriter();
  writeArgs(w);
  call.args = w.toUint8Array();
  return call;
};
const msgOf = (type: TxTypes, inner: object) => {
  const msg = new TxMsg(type, 1_787_000_000_000n, 0n, 0n, payerPub, SmallString.empty);
  msg.msg = inner;
  return msg;
};

describe('planFees on native transfers', () => {
  it('plans a gas-token transfer for its envelope alone and applies it without touching the input', () => {
    const msg = transfer(config.gasTokenId);
    const plan = planFees(msg, config);

    expect(plan.kinds).toEqual([NativeFeeKind.TransferFungible]);
    expect(plan.envelopeBytes).toBe(170);
    expect(plan.expectedGasBill).toBe(42_600_000n);
    expect(plan.maxGas).toBe(42_600_000n);
    expect(plan.maxData).toBe(0n);

    const planned = plan.apply(msg);
    expect(planned.maxGas).toBe(42_600_000n);
    expect(msg.maxGas).toBe(0n);
    // The size the plan was priced for is the size the signed transaction really has.
    expect(TxMsgSigner.signAndSerialize(planned, PAYER).length).toBe(plan.envelopeBytes);
  });

  it('escrows the fresh balance row of an ordinary token unless the recipient holds it', () => {
    const msg = transfer(97n);
    expect(planFees(msg, config).maxData).toBe(200_000n);
    expect(planFees(msg, config).expectedGasBill).toBe(bill(10n, 171));
    const held = planFees(msg, config, { recipientHoldsToken: true });
    expect(held.maxData).toBe(0n);
    expect(held.expectedGasBill).toBe(bill(10n, 170));
  });

  it('sizes a gas-payer transfer with both signatures', () => {
    const msg = transfer(config.gasTokenId, TxTypes.TransferFungible_GasPayer);
    const plan = planFees(msg, config);
    expect(plan.envelopeBytes).toBe(106 + 32 + 128);
    expect(plan.expectedGasBill).toBe(bill(10n, plan.envelopeBytes));
    expect(TxMsgSigner.signAndSerializeWithKeys(plan.apply(msg), [PAYER, OWNER]).length).toBe(
      plan.envelopeBytes
    );
  });
});

// Every call in this block is a witness-array type, so each plan states how many signatures the
// envelope will carry; the planner refuses to assume a number that decides the size of the bill.
const oneWitness = { witnessCount: 1 } as const;

describe('planFees on token calls', () => {
  it('refuses to guess how many witnesses a call will carry', () => {
    const msg = CreateTokenTxHelper.buildTx(tokenInfo(false), payerPub);
    expect(() => planFees(msg, config)).toThrow(/pass witnessCount/);
  });

  it('reads the token being created out of the call', () => {
    const fungible = planFees(
      CreateTokenTxHelper.buildTx(tokenInfo(false), payerPub),
      config,
      oneWitness
    );
    const policy = 100_000_000_000_000n + (100_000_000_000_000n >> 2n);
    expect(fungible.kinds).toEqual([NativeFeeKind.CreateToken]);
    expect(fungible.newStorageQuanta).toBe(3);
    expect(fungible.expectedGasBill).toBe(bill(0n, fungible.envelopeBytes + 3 + 8, policy));
    expect(fungible.maxData).toBe(600_000n);

    const nft = planFees(
      CreateTokenTxHelper.buildTx(tokenInfo(true), payerPub),
      config,
      oneWitness
    );
    expect(nft.newStorageQuanta).toBe(4);
    expect(nft.envelopeBytes).toBeGreaterThan(fungible.envelopeBytes);
  });

  // The burnt-counter and next-inflation rows exist only when the metadata asks for them, and
  // the metadata is a named struct the plan can read.
  it('counts the rows the token metadata adds', () => {
    const metadata = new VmDynamicStruct();
    metadata.fields = [
      VmNamedDynamicVariable.from('name', VmType.String, 'Plan probe'),
      VmNamedDynamicVariable.from(StandardMeta.Token.pre_burn, VmType.Int64, 5n),
      VmNamedDynamicVariable.from('_ip', VmType.Int64, 86_400_000n),
    ];
    const w = new CarbonBinaryWriter();
    metadata.write(w);
    const plan = planFees(
      CreateTokenTxHelper.buildTx(tokenInfo(false, w.toUint8Array()), payerPub),
      config,
      oneWitness
    );
    expect(plan.newStorageQuanta).toBe(5);
  });

  // Staking metadata costs a token creation lookups the plan reads out of the same struct: a
  // staking organisation is looked up and a reward token is read, one query fee each.
  it('counts the lookups the staking metadata costs', () => {
    const metadata = (...extra: VmNamedDynamicVariable[]) => {
      const struct = new VmDynamicStruct();
      struct.fields = [
        VmNamedDynamicVariable.from('name', VmType.String, 'Plan probe'),
        VmNamedDynamicVariable.from('icon', VmType.String, 'data:image/png;base64,iVBORw0KGgo='),
        VmNamedDynamicVariable.from('url', VmType.String, 'https://example.invalid/p'),
        VmNamedDynamicVariable.from('description', VmType.String, 'x'),
        ...extra,
      ].sort((a, b) => a.name.data.localeCompare(b.name.data));
      const w = new CarbonBinaryWriter();
      struct.write(w);
      return w.toUint8Array();
    };
    const planOf = (bytes: Uint8Array) =>
      planFees(CreateTokenTxHelper.buildTx(tokenInfo(false, bytes), payerPub), config, oneWitness);
    const policy = 100_000_000_000_000n + (100_000_000_000_000n >> 2n); // 3-char symbol

    const plain = planOf(metadata());
    expect(plain.expectedGasBill).toBe(bill(0n, plain.envelopeBytes + 3 + 8, policy));
    const org = planOf(
      metadata(VmNamedDynamicVariable.from(StandardMeta.Token.staking_org_id, VmType.Int64, 3n))
    );
    expect(org.expectedGasBill).toBe(bill(10n, org.envelopeBytes + 3 + 8, policy));
    const reward = planOf(
      metadata(
        VmNamedDynamicVariable.from(StandardMeta.Token.staking_reward_token, VmType.Int64, 97n)
      )
    );
    expect(reward.expectedGasBill).toBe(bill(10n, reward.envelopeBytes + 3 + 8, policy));
    const both = planOf(
      metadata(
        VmNamedDynamicVariable.from(StandardMeta.Token.staking_org_id, VmType.Int64, 3n),
        VmNamedDynamicVariable.from(StandardMeta.Token.staking_reward_token, VmType.Int64, 97n)
      )
    );
    expect(both.expectedGasBill).toBe(bill(20n, both.envelopeBytes + 3 + 8, policy));
  });

  it('reads the series being created out of the call', () => {
    const schemas = TokenSchemasBuilder.prepareStandard(false);
    const series = SeriesInfoBuilder.build(schemas.seriesMetadata, 7n, 0, 0, payerPub, []);
    const msg = CreateTokenSeriesTxHelper.buildTx(9n, series, payerPub);
    const plan = planFees(msg, config, oneWitness);
    expect(plan.kinds).toEqual([NativeFeeKind.CreateTokenSeries]);
    expect(plan.newStorageQuanta).toBe(3);
    expect(plan.expectedGasBill).toBe(bill(0n, plan.envelopeBytes + 3 + 4, 25_000_000_000_000n));
    expect(planFees(msg, config, { ...oneWitness, seriesHasMetaId: false }).newStorageQuanta).toBe(
      2
    );
  });

  // `duplicatedSeries: false` is stated because the bill below is the unique-series one: the mode
  // is chain state no message carries, so an unspecified plan takes the costlier duplicated
  // reading. The default itself is pinned in the test after next.
  it('reads every minted instance out of a Phantasma mint call', () => {
    const msg = phantasmaMintCall([phantasmaMint(7n, 182)]);
    const plan = planFees(msg, config, {
      ...oneWitness,
      duplicatedSeries: false,
      supplyRowExists: true,
    });
    expect(plan.kinds).toEqual([NativeFeeKind.MintPhantasmaNonFungible]);
    expect(plan.newStorageQuanta).toBe(5);
    expect(plan.expectedGasBill).toBe(bill(30n, plan.envelopeBytes + 5 + 44));
    expect(plan.maxData).toBe(1_000_000n);
  });

  // A multi-instance mint prices every instance: the work and the two query fees each one costs,
  // the 40 result bytes it returns, and its own storage rows - while the recipient's balance row is
  // paid for once. Reading the count out of the call is what makes that possible, so a planner that
  // silently priced one instance would show up here as a third of the bill.
  it('prices every instance of a multi-instance Phantasma mint', () => {
    const tokens = [7n, 7n, 7n].map((series) => phantasmaMint(series, 182));
    const msg = phantasmaMintCall(tokens);
    const plan = planFees(msg, config, {
      ...oneWitness,
      duplicatedSeries: false,
      supplyRowExists: true,
    });

    expect(plan.kinds).toEqual([NativeFeeKind.MintPhantasmaNonFungible]);
    // One balance row plus, per instance, its ROM row and the three fixed rows a deterministic
    // mint writes; the single-instance plan above needs five of those same quanta.
    expect(plan.newStorageQuanta).toBe(1 + 3 * 4);
    expect(plan.expectedGasBill).toBe(bill(30n * 3n, plan.envelopeBytes + 13 + 4 + 40 * 3));
    expect(plan.maxData).toBe(13n * config.dataEscrowPerRow);
  });

  // A duplicated series costs one query more per instance than a unique one, and one more for the
  // series itself: the chain reads that series' supply once per transaction, not once per instance,
  // because it remembers the number it already read. Pricing the supply read per instance would
  // over-offer; leaving it out entirely under-offers and the chain rejects the mint.
  it('prices a duplicated series per instance and its supply once', () => {
    const tokens = [7n, 7n, 7n].map((series) => phantasmaMint(series, 182));
    const msg = phantasmaMintCall(tokens);
    const facts = { ...oneWitness, duplicatedSeries: true, supplyRowExists: true } as const;
    const plan = planFees(msg, config, facts);

    // (transfer + 3 queries) per instance, plus one query for the single series they share.
    expect(plan.expectedGasBill).toBe(bill(40n * 3n + 10n, plan.envelopeBytes + 13 + 4 + 40 * 3));
    // The same three instances spread over three series pay the supply read three times.
    const spread = phantasmaMintCall([7n, 8n, 9n].map((series) => phantasmaMint(series, 182)));
    const spreadPlan = planFees(spread, config, facts);
    expect(spreadPlan.expectedGasBill - plan.expectedGasBill).toBe(20n * 10_000n);
  });

  // The series mode is not in the message and the planner offers the bill with no headroom, so an
  // unspecified plan has to assume the mode that costs more. Assuming "unique" made a duplicated
  // mint short by exactly those query fees, and the chain aborts a short offer.
  it('plans a Phantasma mint as duplicated when the series mode is not stated', () => {
    const msg = phantasmaMintCall([7n, 7n, 7n].map((series) => phantasmaMint(series, 182)));
    const assumed = planFees(msg, config, oneWitness);
    const duplicated = planFees(msg, config, { ...oneWitness, duplicatedSeries: true });
    const unique = planFees(msg, config, { ...oneWitness, duplicatedSeries: false });

    expect(assumed.expectedGasBill).toBe(duplicated.expectedGasBill);
    expect(assumed.expectedGasBill).toBeGreaterThan(unique.expectedGasBill);
  });

  // The supply row is chain state with two absent-row edges - a limited token fully in circulation
  // before its first burn, an unlimited one with nothing outstanding before its next mint - and
  // the transaction that hits an edge recreates the row. An unstated plan covers that quantum in
  // the offer and the escrow ceiling; saying the row exists gives the exact quote.
  it('plans a mint or burn to cover the supply row unless it is said to exist', () => {
    const burn = new TxMsg(
      TxTypes.BurnFungible,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    burn.msg = new TxMsgBurnFungible({ tokenId: 97n, amount: IntX.fromI64(5n) });

    const assumed = planFees(burn, config);
    const inPlace = planFees(burn, config, { supplyRowExists: true });
    expect(assumed.newStorageQuanta).toBe(inPlace.newStorageQuanta + 1);
    expect(assumed.maxData - inPlace.maxData).toBe(config.dataEscrowPerRow);
  });

  // What a burned NFT holds is chain state with no costlier reading - it can hold anything - so
  // the planner demands the list instead of assuming an empty address; an empty list is the
  // statement that nothing is infused. The RPC-side planner fills it in from the chain.
  it('demands what a burned NFT holds and prices its return', () => {
    const burn = new TxMsg(
      TxTypes.BurnNonFungible,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    burn.msg = new TxMsgBurnNonFungible({ tokenId: 9n, instanceId: 5n });
    expect(() => planFees(burn, config)).toThrow(/infusions/);

    const facts = { tokenBurnedBefore: true, supplyRowExists: true };
    const empty = planFees(burn, config, { ...facts, infusions: [] });
    expect(empty.kinds).toEqual([NativeFeeKind.BurnNonFungible]);
    expect(empty.expectedGasBill).toBe(bill(30n, empty.envelopeBytes));

    const returned = planFees(burn, config, {
      ...facts,
      infusions: [
        { tokenId: 1n },
        { tokenId: 97n },
        { tokenId: 9n, nonFungible: true, instanceCount: 2 },
      ],
    });
    // KCAL and the custom token: a transfer and a query each; the NFT: a query, two transfers, a query.
    expect(returned.expectedGasBill - empty.expectedGasBill).toBe(80n * 10_000n);
    // The custom token's balance row, the NFT token's balance row and its two moved lookups.
    expect(returned.maxData - empty.maxData).toBe(4n * config.dataEscrowPerRow);
  });

  // Whether the recipient is an NFT-derived address decides one query fee, and the address is in
  // the message, so the planner reads it there instead of asking. A user address adds nothing; the
  // NFT form does; a zero instance id is not an NFT address, exactly as the chain reads it.
  it('reads the NFT-address recipient out of the message and prices its owner lookup', () => {
    const toAddress = (to: Bytes32) => {
      const msg = new TxMsg(
        TxTypes.TransferFungible,
        1_787_000_000_000n,
        0n,
        0n,
        payerPub,
        SmallString.empty
      );
      msg.msg = new TxMsgTransferFungible(to, config.gasTokenId, 10n);
      return planFees(msg, config).expectedGasBill;
    };
    const plain = toAddress(ownerPub);
    expect(toAddress(TokenHelper.getNftAddress(9n, 1n)) - plain).toBe(100_000n);
    expect(toAddress(TokenHelper.getNftAddress(9n, 0n))).toBe(plain);

    // Every mint kind pays the same owner lookup once per call; the Phantasma call carries its
    // recipient in the arguments and the planner reads it out of there just the same.
    const mint = phantasmaMintCall([phantasmaMint(7n, 182)], TokenHelper.getNftAddress(9n, 1n));
    const infused = planFees(mint, config, { ...oneWitness, duplicatedSeries: false });
    const normal = planFees(phantasmaMintCall([phantasmaMint(7n, 182)]), config, {
      ...oneWitness,
      duplicatedSeries: false,
    });
    expect(infused.expectedGasBill - normal.expectedGasBill).toBe(100_000n);
  });

  // The multi-instance NFT transfer is the mirror case: each instance deletes the sender's lookup
  // row and creates the recipient's, so only the recipient's new balance row is billed, while the
  // escrow ceiling still has to cover every row the transaction may create.
  it('prices every instance of a multi-instance NFT transfer', () => {
    const msg = new TxMsg(
      TxTypes.TransferNonFungible_Multi,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    msg.msg = new TxMsgTransferNonFungibleMulti({
      to: ownerPub,
      tokenId: 97n,
      instanceIds: [11n, 12n],
    });
    const plan = planFees(msg, config);

    expect(plan.kinds).toEqual([NativeFeeKind.TransferNonFungible]);
    expect(plan.newStorageQuanta).toBe(3);
    expect(plan.deletedStorageQuanta).toBe(2);
    expect(plan.expectedGasBill).toBe(bill(20n, plan.envelopeBytes + 1));
    expect(plan.maxData).toBe(3n * config.dataEscrowPerRow);
  });

  it('plans a raw NFT mint with its ROM as stored', () => {
    // Built as the raw wire message: the chain still admits the type where its token config
    // allows it, but the SDK no longer ships a builder for it.
    const msg = new TxMsg(
      TxTypes.MintNonFungible,
      0n,
      0n,
      0n,
      payerPub,
      SmallString.empty,
      new TxMsgMintNonFungible({
        tokenId: 9n,
        seriesId: 1,
        to: ownerPub,
        rom: new Uint8Array(100),
        ram: new Uint8Array(),
      })
    );
    const plan = planFees(msg, config, { supplyRowExists: true });
    expect(plan.kinds).toEqual([NativeFeeKind.MintNonFungible]);
    expect(plan.newStorageQuanta).toBe(5);
    expect(
      planFees(msg, config, { supplyRowExists: true, romHasMetaId: false }).newStorageQuanta
    ).toBe(4);
    expect(plan.expectedGasBill).toBe(bill(10n, plan.envelopeBytes + 5 + 12));
  });

  it('recognises a name registration', () => {
    const msg = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Governance, GovernanceContractMethods.RegisterName, (w) => {
        payerPub.write(w);
        new SmallString('alice').write(w);
      })
    );

    const plan = planFees(msg, config, oneWitness);
    expect(plan.kinds).toEqual([NativeFeeKind.RegisterName]);
    expect(plan.expectedGasBill).toBe(bill(0n, plan.envelopeBytes, 100_000_000_000_000_000n >> 4n));
    expect(plan.maxData).toBe(0n);
  });

  it('budgets an allowance for scripts and unmodelled calls instead of guessing', () => {
    const script = new TxMsg(
      TxTypes.Phantasma,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    script.msg = new TxMsgPhantasma({
      nexus: new SmallString('simnet'),
      chain: new SmallString('main'),
      script: new Uint8Array(40),
    });
    const scriptPlan = planFees(script, config, oneWitness);
    expect(scriptPlan.kinds).toEqual([NativeFeeKind.Script]);

    const query = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Token, TokenContractMethods.GetBalance, (w) =>
        w.write(new Uint8Array(40))
      )
    );
    const queryPlan = planFees(query, config, { ...oneWitness, scriptUnitsAllowance: 100n });
    expect(queryPlan.kinds).toEqual([NativeFeeKind.Script]);
    expect(queryPlan.expectedGasBill).toBe(bill(100n, queryPlan.envelopeBytes + 4 + 512));
  });

  it('sizes a call for the number of witnesses that will sign it', () => {
    const msg = CreateTokenTxHelper.buildTx(tokenInfo(false), payerPub);
    const one = planFees(msg, config, oneWitness);
    const two = planFees(msg, config, { witnessCount: 2 });
    expect(two.envelopeBytes).toBe(one.envelopeBytes + 96);
  });
});

// A wallet that performs several token operations at once sends them as module calls: one
// `Token.*` call, or a `Call_Multi` of them. The chain runs those through the very same contract
// methods the native transaction types run, in a plain loop, with no per-call surcharge - so the
// planner has to price them like the native operations they are instead of budgeting them as if
// they were VM scripts.
describe('planFees on token-module calls', () => {
  const oneWitness = { witnessCount: 1 };

  const burnNftCall = (tokenId: bigint, instanceIds: bigint[]) =>
    moduleCall(ModuleId.Token, TokenContractMethods.BurnNonFungible, (w) => {
      w.write8u(tokenId);
      payerPub.write(w);
      w.write4(instanceIds.length);
      for (const id of instanceIds) w.write8u(id);
    });

  it('prices a fungible transfer call exactly as the native transfer, reading token and recipient from the arguments', () => {
    const call = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Token, TokenContractMethods.TransferFungible, (w) => {
        ownerPub.write(w);
        payerPub.write(w);
        w.write8u(97n);
        IntX.fromI64(5n).write(w);
      })
    );
    const plan = planFees(call, config, oneWitness);
    expect(plan.kinds).toEqual([NativeFeeKind.TransferFungible]);
    // One transfer fee, and the fresh recipient row that the costlier default assumes.
    expect(plan.expectedGasBill).toBe(bill(10n, plan.envelopeBytes + 1));
    expect(plan.maxData).toBe(config.dataEscrowPerRow);

    // The recipient's address form decides one query fee here exactly as it does natively.
    const infused = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Token, TokenContractMethods.TransferFungible, (w) => {
        TokenHelper.getNftAddress(9n, 5n).write(w);
        payerPub.write(w);
        w.write8u(97n);
        IntX.fromI64(5n).write(w);
      })
    );
    expect(planFees(infused, config, oneWitness).expectedGasBill).toBe(
      bill(20n, plan.envelopeBytes + 1)
    );
  });

  it('counts the instances of an NFT transfer call', () => {
    const instances = [11n, 12n, 13n];
    const call = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Token, TokenContractMethods.TransferNonFungible, (w) => {
        ownerPub.write(w);
        payerPub.write(w);
        w.write8u(97n);
        w.write4(instances.length);
        for (const id of instances) w.write8u(id);
      })
    );
    const plan = planFees(call, config, oneWitness);
    expect(plan.kinds).toEqual([NativeFeeKind.TransferNonFungible]);
    // Three transfer fees; three lookup rows created against three deleted, plus the fresh
    // recipient balance row - so one net quantum of block data and four rows of ceiling.
    expect(plan.expectedGasBill).toBe(bill(30n, plan.envelopeBytes + 1));
    expect(plan.newStorageQuanta).toBe(4);
    expect(plan.deletedStorageQuanta).toBe(3);
  });

  it('prices fungible mint and burn calls with their variable-length result', () => {
    const mint = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Token, TokenContractMethods.MintFungible, (w) => {
        w.write8u(97n);
        ownerPub.write(w);
        IntX.fromI64(1000n).write(w);
      })
    );
    const mintPlan = planFees(mint, config, { ...oneWitness, bigFungible: false });
    expect(mintPlan.kinds).toEqual([NativeFeeKind.MintFungible]);
    // Transfer fee; the recipient's row and the supply row; a 9-byte int64 balance answer.
    expect(mintPlan.expectedGasBill).toBe(bill(10n, mintPlan.envelopeBytes + 2 + 9));

    const burn = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Token, TokenContractMethods.BurnFungible, (w) => {
        w.write8u(97n);
        payerPub.write(w);
        IntX.fromI64(1n).write(w);
      })
    );
    const burnPlan = planFees(burn, config, {
      ...oneWitness,
      bigFungible: false,
      tokenBurnedBefore: true,
      supplyRowExists: true,
    });
    expect(burnPlan.kinds).toEqual([NativeFeeKind.BurnFungible]);
    expect(burnPlan.expectedGasBill).toBe(bill(10n, burnPlan.envelopeBytes + 9));
  });

  it('prices an NFT burn call for every instance it names and demands what they hold', () => {
    const call = msgOf(TxTypes.Call, burnNftCall(9n, [11n, 12n]));
    expect(() => planFees(call, config, oneWitness)).toThrow(/infusions/);

    const plan = planFees(call, config, {
      ...oneWitness,
      infusions: [],
      tokenBurnedBefore: true,
      supplyRowExists: true,
    });
    expect(plan.kinds).toEqual([NativeFeeKind.BurnNonFungible]);
    // Two instances at a transfer fee plus two queries each; four rows deleted per instance.
    expect(plan.expectedGasBill).toBe(bill(60n, plan.envelopeBytes));
    expect(plan.deletedStorageQuanta).toBe(8);
  });

  // Explicit NFT mints are refused chain-wide by mainnet SR 50 whichever way they arrive, so the
  // SDK removed its native builder and does not price the call either: there is no transaction to
  // price. It must stay budgeted rather than quietly grow a model.
  it('leaves an explicit NFT mint call and an unmodelled call at the script budget', () => {
    const mint = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Token, TokenContractMethods.MintNonFungible, (w) => {
        w.write8u(97n);
        ownerPub.write(w);
        w.write4(0);
      })
    );
    expect(planFees(mint, config, oneWitness).kinds).toEqual([NativeFeeKind.Script]);

    const unknown = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Token, TokenContractMethods.ApplyInflation, (w) => w.write8u(97n))
    );
    expect(planFees(unknown, config, oneWitness).kinds).toEqual([NativeFeeKind.Script]);
  });

  // A call may name argument SECTIONS instead of arguments: the chain assembles them at execution
  // out of earlier calls' results. Nothing to read a price from, and reading the empty argument
  // buffer as if it held the fields would be worse than budgeting.
  it('budgets a call whose arguments are assembled at execution', () => {
    const call = burnNftCall(9n, [11n]);
    call.sections = new MsgCallArgSections([
      { registerOffset: -0xffff0001, args: new Uint8Array() },
    ]);
    call.args = new Uint8Array();
    const plan = planFees(msgOf(TxTypes.Call, call), config, oneWitness);
    expect(plan.kinds).toEqual([NativeFeeKind.Script]);
  });
});

describe('planFees on Call_Multi', () => {
  const oneWitness = { witnessCount: 1 };

  const burnNftCall = (tokenId: bigint, instanceId: bigint) =>
    moduleCall(ModuleId.Token, TokenContractMethods.BurnNonFungible, (w) => {
      w.write8u(tokenId);
      payerPub.write(w);
      w.write4(1);
      w.write8u(instanceId);
    });
  const burnBatch = (count: number) => {
    const msg = new TxMsg(
      TxTypes.Call_Multi,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    msg.msg = new TxMsgCallMulti(
      Array.from({ length: count }, (_, i) => burnNftCall(9n, BigInt(11 + i)))
    );
    return msg;
  };
  const burnFacts = {
    ...oneWitness,
    infusions: [],
    tokenBurnedBefore: true,
    supplyRowExists: true,
  };

  // The reference point is a measured one: two NFT burns batched this way settled at 73,100,000
  // kcal-base against a 290-byte envelope on the localnet (evidence cs-live-v6, 2026-09-02), which
  // is exactly what summing the two burn models and counting the envelope once produces.
  it('prices a batch as the sum of its calls with the envelope counted once', () => {
    for (const count of [1, 2, 3, 11, 20]) {
      const plan = planFees(burnBatch(count), config, burnFacts);
      expect(plan.kinds).toEqual(Array(count).fill(NativeFeeKind.BurnNonFungible));
      // Per burn: a transfer fee and two queries. Every burn deletes more rows than it creates, so
      // the batch adds no block data beyond its envelope.
      expect(plan.expectedGasBill).toBe(bill(30n * BigInt(count), plan.envelopeBytes));
      expect(plan.deletedStorageQuanta).toBe(4 * count);
    }
  });

  // The defect this file's batch cases exist for: a Call_Multi used to take the flat script budget
  // whatever it contained, so its price did not follow the work it does. It must now.
  it('follows the work of the batch instead of a flat budget', () => {
    const two = planFees(burnBatch(2), config, burnFacts);
    const twenty = planFees(burnBatch(20), config, burnFacts);
    const perBurn = (twenty.expectedGasBill - two.expectedGasBill) / 18n;
    const envelopePerBurn = BigInt(twenty.envelopeBytes - two.envelopeBytes) / 18n;
    expect(perBurn).toBe(bill(30n, Number(envelopePerBurn)));
  });

  it('prices what the batch gives back once, not once per burn', () => {
    const empty = planFees(burnBatch(2), config, burnFacts);
    const returned = planFees(burnBatch(2), config, {
      ...burnFacts,
      infusions: [{ tokenId: 1n }, { tokenId: 97n }],
    });
    // One transfer plus one owner-lookup query per returned token, counted for the batch and not
    // for each of its burns; the custom token's balance row is recreated for the burner.
    expect(returned.expectedGasBill - empty.expectedGasBill).toBe(40n * 10_000n);
    expect(returned.maxData - empty.maxData).toBe(config.dataEscrowPerRow);
  });

  it('prices the calls it models and budgets only the ones it does not', () => {
    const msg = new TxMsg(
      TxTypes.Call_Multi,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    const unknown = new TxMsgCall();
    unknown.moduleId = ModuleId.Token;
    unknown.methodId = TokenContractMethods.ApplyInflation;
    unknown.args = new Uint8Array(8);
    msg.msg = new TxMsgCallMulti([burnNftCall(9n, 11n), unknown]);

    const plan = planFees(msg, config, { ...burnFacts, scriptUnitsAllowance: 100n });
    expect(plan.kinds).toEqual([NativeFeeKind.BurnNonFungible, NativeFeeKind.Script]);
    // Both work terms, and the budget's event bytes. Its four storage quanta are NOT block data
    // here: the chain bills the net growth of the whole transaction, and the burn deletes four rows
    // against them - which is the reason a batch is settled once instead of call by call.
    expect(plan.expectedGasBill).toBe(bill(130n, plan.envelopeBytes + 512));
    expect(plan.newStorageQuanta).toBe(4);
    expect(plan.deletedStorageQuanta).toBe(4);
  });

  it('names every instance a message burns, whichever shape it burns them in', () => {
    const native = new TxMsg(
      TxTypes.BurnNonFungible,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    native.msg = new TxMsgBurnNonFungible({ tokenId: 9n, instanceId: 5n });
    expect(burnedInstances(native)).toEqual([{ tokenId: 9n, instanceId: 5n }]);

    expect(burnedInstances(burnBatch(2))).toEqual([
      { tokenId: 9n, instanceId: 11n },
      { tokenId: 9n, instanceId: 12n },
    ]);

    const transfer = new TxMsg(
      TxTypes.TransferFungible,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    transfer.msg = new TxMsgTransferFungible(ownerPub, 97n, 1n);
    expect(burnedInstances(transfer)).toEqual([]);
  });
});

// The coverage gate this file owes the model: every message type the SDK carries is named here
// with what the planner makes of it, and the table is asserted to be exhaustive over TxTypes. A new
// message type therefore cannot be added and quietly fall into the script budget - this test fails
// until someone states what its fee is. A `Script` entry below is a decision, not an omission.
describe('planFees over every transaction type', () => {
  const burnCall = moduleCall(ModuleId.Token, TokenContractMethods.BurnFungible, (w) => {
    w.write8u(97n);
    payerPub.write(w);
    IntX.fromI64(1n).write(w);
  });

  const cases: { type: TxTypes; msg: TxMsg; expected: NativeFeeKind[] | 'refused' }[] = [
    {
      type: TxTypes.Call,
      msg: msgOf(TxTypes.Call, burnCall),
      expected: [NativeFeeKind.BurnFungible],
    },
    {
      type: TxTypes.Call_Multi,
      msg: msgOf(TxTypes.Call_Multi, new TxMsgCallMulti([burnCall, burnCall])),
      expected: [NativeFeeKind.BurnFungible, NativeFeeKind.BurnFungible],
    },
    // A Trade packs its operations into named arrays rather than calls; nothing reads them yet, so
    // it is budgeted. Modelling it is worth doing only when something builds one.
    {
      type: TxTypes.Trade,
      msg: msgOf(TxTypes.Trade, new TxMsgTrade()),
      expected: [NativeFeeKind.Script],
    },
    {
      type: TxTypes.TransferFungible,
      msg: msgOf(TxTypes.TransferFungible, new TxMsgTransferFungible(ownerPub, 97n, 1n)),
      expected: [NativeFeeKind.TransferFungible],
    },
    {
      type: TxTypes.TransferFungible_GasPayer,
      msg: msgOf(
        TxTypes.TransferFungible_GasPayer,
        new TxMsgTransferFungibleGasPayer({
          to: ownerPub,
          from: payerPub,
          tokenId: 97n,
          amount: 1n,
        })
      ),
      expected: [NativeFeeKind.TransferFungible],
    },
    {
      type: TxTypes.TransferNonFungible_Single,
      msg: msgOf(
        TxTypes.TransferNonFungible_Single,
        new TxMsgTransferNonFungibleSingle({ to: ownerPub, tokenId: 9n, instanceId: 5n })
      ),
      expected: [NativeFeeKind.TransferNonFungible],
    },
    {
      type: TxTypes.TransferNonFungible_Single_GasPayer,
      msg: msgOf(
        TxTypes.TransferNonFungible_Single_GasPayer,
        new TxMsgTransferNonFungibleSingleGasPayer({
          to: ownerPub,
          from: payerPub,
          tokenId: 9n,
          instanceId: 5n,
        })
      ),
      expected: [NativeFeeKind.TransferNonFungible],
    },
    {
      type: TxTypes.TransferNonFungible_Multi,
      msg: msgOf(
        TxTypes.TransferNonFungible_Multi,
        new TxMsgTransferNonFungibleMulti({ to: ownerPub, tokenId: 9n, instanceIds: [5n, 6n] })
      ),
      expected: [NativeFeeKind.TransferNonFungible],
    },
    {
      type: TxTypes.TransferNonFungible_Multi_GasPayer,
      msg: msgOf(
        TxTypes.TransferNonFungible_Multi_GasPayer,
        new TxMsgTransferNonFungibleMultiGasPayer({
          to: ownerPub,
          from: payerPub,
          tokenId: 9n,
          instanceIds: [5n, 6n],
        })
      ),
      expected: [NativeFeeKind.TransferNonFungible],
    },
    {
      type: TxTypes.MintFungible,
      msg: msgOf(
        TxTypes.MintFungible,
        new TxMsgMintFungible({ tokenId: 97n, to: ownerPub, amount: IntX.fromI64(1n) })
      ),
      expected: [NativeFeeKind.MintFungible],
    },
    {
      type: TxTypes.BurnFungible,
      msg: msgOf(
        TxTypes.BurnFungible,
        new TxMsgBurnFungible({ tokenId: 97n, amount: IntX.fromI64(1n) })
      ),
      expected: [NativeFeeKind.BurnFungible],
    },
    {
      type: TxTypes.BurnFungible_GasPayer,
      msg: msgOf(
        TxTypes.BurnFungible_GasPayer,
        new TxMsgBurnFungibleGasPayer({ tokenId: 97n, from: payerPub, amount: IntX.fromI64(1n) })
      ),
      expected: [NativeFeeKind.BurnFungible],
    },
    {
      type: TxTypes.MintNonFungible,
      msg: msgOf(
        TxTypes.MintNonFungible,
        new TxMsgMintNonFungible({
          tokenId: 9n,
          to: ownerPub,
          seriesId: 1,
          rom: new Uint8Array(8),
          ram: new Uint8Array(),
        })
      ),
      expected: [NativeFeeKind.MintNonFungible],
    },
    {
      type: TxTypes.BurnNonFungible,
      msg: msgOf(
        TxTypes.BurnNonFungible,
        new TxMsgBurnNonFungible({ tokenId: 9n, instanceId: 5n })
      ),
      expected: [NativeFeeKind.BurnNonFungible],
    },
    {
      type: TxTypes.BurnNonFungible_GasPayer,
      msg: msgOf(
        TxTypes.BurnNonFungible_GasPayer,
        new TxMsgBurnNonFungibleGasPayer({ tokenId: 9n, from: payerPub, instanceId: 5n })
      ),
      expected: [NativeFeeKind.BurnNonFungible],
    },
    {
      type: TxTypes.Phantasma,
      msg: msgOf(
        TxTypes.Phantasma,
        new TxMsgPhantasma({
          nexus: new SmallString('simnet'),
          chain: new SmallString('main'),
          script: new Uint8Array(8),
        })
      ),
      expected: [NativeFeeKind.Script],
    },
    // A raw Gen2 envelope carries its own fee fields and its own signatures; this planner prices
    // Carbon messages, so it refuses rather than quoting a number for a transaction it cannot size.
    {
      type: TxTypes.Phantasma_Raw,
      msg: msgOf(TxTypes.Phantasma_Raw, new TxMsgPhantasmaRaw(new Uint8Array(8))),
      expected: 'refused',
    },
  ];

  it('names every transaction type the SDK carries', () => {
    const named = cases.map((c) => c.type).sort((a, b) => a - b);
    const all = Object.values(TxTypes)
      .filter((v): v is TxTypes => typeof v === 'number')
      .sort((a, b) => a - b);
    expect(named).toEqual(all);
  });

  it.each(cases)('plans $type as declared', ({ type, msg, expected }) => {
    // The row's declared type is what the exhaustiveness check above counts, so it has to be the
    // type of the message actually planned here - otherwise a row could claim a type it never sends.
    expect(msg.type).toBe(type);
    // Only the witness-array types take a count; the rest fix their own witness set and refuse one.
    const open = SignedTxMsg.requiredWitnesses(msg) === undefined;
    const options = { ...(open ? { witnessCount: 1 } : {}), infusions: [] };
    if (expected === 'refused') {
      expect(() => planFees(msg, config, options)).toThrow(/Cannot plan fees/);
      return;
    }
    expect(planFees(msg, config, options).kinds).toEqual(expected);
  });
});

// A wallet has to choose between showing "0.0073 KCAL" and "up to 0.0073 KCAL", and it reads that
// from one field. `exact` is true only when nothing the plan had to assume could have moved the
// number - which is a different question from whether any fact was left unstated, because most
// facts do not enter most operations.
// The coverage gate this file owes the CALL dispatch, which the table above cannot give it: a
// modelled call method is priced as the very kind its native transaction already covers, so
// `Token.TransferFungible` adds nothing to the kinds a run has seen and a new branch can appear
// without anything noticing. These tables name every method of the two modules the planner
// dispatches on, say what it makes of each, and are asserted to be exhaustive over their enums. A
// `Script` entry is a decision - the planner has no formula for that method - not an omission.
describe('planFees over every module call', () => {
  const options = { witnessCount: 1, infusions: [] };
  // A method with no model reads none of its arguments, so any bytes are enough to reach the
  // branch; the modelled ones below carry arguments they can actually be read from.
  const budgeted = (methods: TokenContractMethods[]) =>
    methods.map((method) => ({
      method,
      msg: msgOf(
        TxTypes.Call,
        moduleCall(ModuleId.Token, method, (w) => w.write8u(97n))
      ),
      expected: NativeFeeKind.Script,
    }));
  const seriesInfo = () =>
    SeriesInfoBuilder.build(
      TokenSchemasBuilder.prepareStandard(false).seriesMetadata,
      7n,
      0,
      0,
      payerPub,
      []
    );

  const tokenCases: { method: TokenContractMethods; msg: TxMsg; expected: NativeFeeKind }[] = [
    {
      method: TokenContractMethods.TransferFungible,
      msg: msgOf(
        TxTypes.Call,
        moduleCall(ModuleId.Token, TokenContractMethods.TransferFungible, (w) => {
          ownerPub.write(w);
          payerPub.write(w);
          w.write8u(97n);
          IntX.fromI64(1n).write(w);
        })
      ),
      expected: NativeFeeKind.TransferFungible,
    },
    {
      method: TokenContractMethods.TransferNonFungible,
      msg: msgOf(
        TxTypes.Call,
        moduleCall(ModuleId.Token, TokenContractMethods.TransferNonFungible, (w) => {
          ownerPub.write(w);
          payerPub.write(w);
          w.write8u(9n);
          w.write4(1);
          w.write8u(5n);
        })
      ),
      expected: NativeFeeKind.TransferNonFungible,
    },
    {
      method: TokenContractMethods.MintFungible,
      msg: msgOf(
        TxTypes.Call,
        moduleCall(ModuleId.Token, TokenContractMethods.MintFungible, (w) => {
          w.write8u(97n);
          ownerPub.write(w);
          IntX.fromI64(1n).write(w);
        })
      ),
      expected: NativeFeeKind.MintFungible,
    },
    {
      method: TokenContractMethods.BurnFungible,
      msg: msgOf(
        TxTypes.Call,
        moduleCall(ModuleId.Token, TokenContractMethods.BurnFungible, (w) => {
          w.write8u(97n);
          payerPub.write(w);
          IntX.fromI64(1n).write(w);
        })
      ),
      expected: NativeFeeKind.BurnFungible,
    },
    {
      method: TokenContractMethods.BurnNonFungible,
      msg: msgOf(
        TxTypes.Call,
        moduleCall(ModuleId.Token, TokenContractMethods.BurnNonFungible, (w) => {
          w.write8u(9n);
          payerPub.write(w);
          w.write4(1);
          w.write8u(5n);
        })
      ),
      expected: NativeFeeKind.BurnNonFungible,
    },
    {
      method: TokenContractMethods.CreateToken,
      msg: CreateTokenTxHelper.buildTx(tokenInfo(false), payerPub),
      expected: NativeFeeKind.CreateToken,
    },
    {
      method: TokenContractMethods.CreateTokenSeries,
      msg: CreateTokenSeriesTxHelper.buildTx(9n, seriesInfo(), payerPub),
      expected: NativeFeeKind.CreateTokenSeries,
    },
    {
      method: TokenContractMethods.MintPhantasmaNonFungible,
      msg: phantasmaMintCall([phantasmaMint(1n, 40)]),
      expected: NativeFeeKind.MintPhantasmaNonFungible,
    },
    // Everything the planner has no formula for. `MintNonFungible` is here on purpose: mainnet SR
    // 50 refuses an explicit NFT mint whichever way it arrives, so there is nothing to price.
    ...budgeted([
      TokenContractMethods.GetBalance,
      TokenContractMethods.DeleteTokenSeries,
      TokenContractMethods.MintNonFungible,
      TokenContractMethods.GetInstances,
      TokenContractMethods.GetNonFungibleInfo,
      TokenContractMethods.GetNonFungibleInfoByRomId,
      TokenContractMethods.GetSeriesInfo,
      TokenContractMethods.GetSeriesInfoByMetaId,
      TokenContractMethods.GetTokenInfo,
      TokenContractMethods.GetTokenInfoBySymbol,
      TokenContractMethods.GetTokenSupply,
      TokenContractMethods.GetSeriesSupply,
      TokenContractMethods.GetTokenIdBySymbol,
      TokenContractMethods.GetBalances,
      TokenContractMethods.CreateMintedTokenSeries,
      TokenContractMethods.ApplyInflation,
      TokenContractMethods.UpdateTokenMetadata,
      TokenContractMethods.GetNextTokenInflation,
      TokenContractMethods.SetTokensConfig,
      TokenContractMethods.UpdateSeriesMetadata,
    ]),
  ];

  const governanceCases: {
    method: GovernanceContractMethods;
    msg: TxMsg;
    expected: NativeFeeKind;
  }[] = [
    {
      method: GovernanceContractMethods.RegisterName,
      msg: msgOf(
        TxTypes.Call,
        moduleCall(ModuleId.Governance, GovernanceContractMethods.RegisterName, (w) => {
          payerPub.write(w);
          new SmallString('alice').write(w);
        })
      ),
      expected: NativeFeeKind.RegisterName,
    },
    {
      method: GovernanceContractMethods.SetGasConfig,
      msg: msgOf(
        TxTypes.Call,
        moduleCall(ModuleId.Governance, GovernanceContractMethods.SetGasConfig, (w) =>
          w.write8u(1n)
        )
      ),
      expected: NativeFeeKind.Script,
    },
  ];

  const exhaustive = (named: number[], all: object) =>
    expect([...named].sort((a, b) => a - b)).toEqual(
      Object.values(all)
        .filter((v): v is number => typeof v === 'number')
        .sort((a, b) => a - b)
    );

  it('names every token contract method', () => {
    exhaustive(
      tokenCases.map((c) => c.method),
      TokenContractMethods
    );
  });

  it('names every governance contract method', () => {
    exhaustive(
      governanceCases.map((c) => c.method),
      GovernanceContractMethods
    );
  });

  it.each(tokenCases.map((c) => ({ ...c, name: TokenContractMethods[c.method] })))(
    'prices Token.$name as declared',
    ({ msg, expected }) => {
      expect(planFees(msg, config, options).kinds).toEqual([expected]);
    }
  );

  it.each(governanceCases.map((c) => ({ ...c, name: GovernanceContractMethods[c.method] })))(
    'prices Governance.$name as declared',
    ({ msg, expected }) => {
      expect(planFees(msg, config, options).kinds).toEqual([expected]);
    }
  );

  it('budgets a call to a module it does not dispatch on', () => {
    const msg = msgOf(
      TxTypes.Call,
      moduleCall(ModuleId.Organization, 0, (w) => w.write8u(97n))
    );
    expect(planFees(msg, config, options).kinds).toEqual([NativeFeeKind.Script]);
  });
});

describe('planFees reports whether the bill is a prediction', () => {
  const oneWitness = { witnessCount: 1 };

  it('is exact for a gas-token transfer whatever the caller states', () => {
    // The chain's own token rows are free, so the recipient's row costs nothing and the fact the
    // caller did not state could not have changed the price. A wallet's commonest operation must
    // not be pushed into the "up to" branch by a fact that does not apply to it.
    expect(planFees(transfer(config.gasTokenId), config).exact).toBe(true);
    expect(planFees(transfer(config.dataTokenId), config).exact).toBe(true);
  });

  it('is not exact when an unstated fact decided part of the price', () => {
    // A custom token's recipient row is paid, so `recipientHoldsToken` decides one storage quantum.
    const custom = transfer(97n);
    expect(planFees(custom, config).exact).toBe(false);
    expect(planFees(custom, config, { recipientHoldsToken: true }).exact).toBe(true);
    expect(planFees(custom, config, { recipientHoldsToken: false }).exact).toBe(true);
  });

  // `bigFungible: true` does not say what the balance IS, it says the answer may be as wide as an
  // int256 - so the model prices 33 bytes and the chain writes fewer. Stating it does not make the
  // number a prediction, and the live matrix proved it: two rows that stated it settled below their
  // own plan.
  it('is not exact when the plan rests on the widest fungible result', () => {
    const mint = new TxMsg(
      TxTypes.MintFungible,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    mint.msg = new TxMsgMintFungible({ tokenId: 97n, to: ownerPub, amount: IntX.fromI64(1n) });
    const facts = { recipientHoldsToken: true, supplyRowExists: true };
    expect(planFees(mint, config, { ...facts, bigFungible: true }).exact).toBe(false);
    expect(planFees(mint, config, { ...facts, bigFungible: false }).exact).toBe(true);
  });

  it('is never exact when part of the message had to be budgeted', () => {
    const script = new TxMsg(
      TxTypes.Phantasma,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    script.msg = new TxMsgPhantasma({
      nexus: new SmallString('simnet'),
      chain: new SmallString('main'),
      script: new Uint8Array(40),
    });
    expect(planFees(script, config, oneWitness).exact).toBe(false);
  });

  it('is exact for a burn batch that states the two facts a burn reads', () => {
    const burn = new TxMsg(
      TxTypes.BurnNonFungible,
      1_787_000_000_000n,
      0n,
      0n,
      payerPub,
      SmallString.empty
    );
    burn.msg = new TxMsgBurnNonFungible({ tokenId: 9n, instanceId: 5n });
    expect(planFees(burn, config, { infusions: [] }).exact).toBe(false);
    expect(
      planFees(burn, config, { infusions: [], tokenBurnedBefore: true, supplyRowExists: true })
        .exact
    ).toBe(true);
    // The ROM's meta-id row is deleted by a burn, never created, and a burn deletes more rows than
    // it creates - so that fact cannot move a burn's bill and leaving it unstated does not make the
    // number an upper bound.
    expect(
      planFees(burn, config, {
        infusions: [],
        tokenBurnedBefore: true,
        supplyRowExists: true,
        romHasMetaId: false,
      }).exact
    ).toBe(true);
  });

  // The flag is computed by pricing the message a second time with every unstated fact at its
  // cheaper reading. That only answers honestly if the "costlier default" claim on each fact is
  // true, so it is checked here: stating the other value must never raise the quote.
  it('prices every default at or above the alternative reading', () => {
    const cases: { msg: TxMsg; options: FeePlanOptions[] }[] = [
      {
        msg: transfer(97n),
        options: [{ recipientHoldsToken: true }],
      },
      {
        msg: (() => {
          const mint = new TxMsg(
            TxTypes.MintFungible,
            1_787_000_000_000n,
            0n,
            0n,
            payerPub,
            SmallString.empty
          );
          mint.msg = new TxMsgMintFungible({
            tokenId: 97n,
            to: ownerPub,
            amount: IntX.fromI64(1n),
          });
          return mint;
        })(),
        options: [{ recipientHoldsToken: true }, { supplyRowExists: true }, { bigFungible: false }],
      },
      {
        msg: (() => {
          const burn = new TxMsg(
            TxTypes.BurnFungible,
            1_787_000_000_000n,
            0n,
            0n,
            payerPub,
            SmallString.empty
          );
          burn.msg = new TxMsgBurnFungible({ tokenId: 97n, amount: IntX.fromI64(1n) });
          return burn;
        })(),
        options: [{ tokenBurnedBefore: true }, { supplyRowExists: true }, { bigFungible: false }],
      },
      {
        msg: phantasmaMintCall([phantasmaMint(1n, 40), phantasmaMint(2n, 40)]),
        options: [
          { witnessCount: 1, recipientHoldsToken: true },
          { witnessCount: 1, supplyRowExists: true },
          { witnessCount: 1, duplicatedSeries: false },
        ],
      },
    ];
    for (const { msg, options } of cases) {
      const witness = msg.type === TxTypes.Call ? oneWitness : {};
      const assumed = planFees(msg, config, witness);
      for (const stated of options) {
        const told = planFees(msg, config, { ...witness, ...stated });
        expect(told.expectedGasBill <= assumed.expectedGasBill).toBe(true);
        expect(told.maxData <= assumed.maxData).toBe(true);
      }
    }
  });
});
