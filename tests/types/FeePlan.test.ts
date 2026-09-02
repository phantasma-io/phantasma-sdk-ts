import { Bytes32 } from '../../src/types/carbon/bytes32';
import { CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import { IntX } from '../../src/types/carbon/int-x';
import { SmallString } from '../../src/types/carbon/small-string';
import { TxTypes } from '../../src/types/carbon/tx-types';
import { GasConfig } from '../../src/types/carbon/blockchain/gas-config';
import { ModuleId } from '../../src/types/carbon/blockchain/module-id';
import { TxMsg } from '../../src/types/carbon/blockchain/tx-msg';
import { TxMsgCall } from '../../src/types/carbon/blockchain/tx-msg-call';
import { TxMsgBurnFungible } from '../../src/types/carbon/blockchain/tx-msg-burn-fungible';
import { TxMsgBurnNonFungible } from '../../src/types/carbon/blockchain/tx-msg-burn-non-fungible';
import { TxMsgMintNonFungible } from '../../src/types/carbon/blockchain/tx-msg-mint-non-fungible';
import { TxMsgPhantasma } from '../../src/types/carbon/blockchain/tx-msg-phantasma';
import { TxMsgTransferFungible } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible';
import { TxMsgTransferFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible-gas-payer';
import { TxMsgSigner } from '../../src/types/carbon/blockchain/extensions/tx-msg-signer';
import { StandardMeta } from '../../src/types/carbon/blockchain/modules/standard-meta';
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
import { planFees } from '../../src/types/carbon/blockchain/tx-helpers/fee-plan';
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

describe('planFees on native transfers', () => {
  it('plans a gas-token transfer for its envelope alone and applies it without touching the input', () => {
    const msg = transfer(config.gasTokenId);
    const plan = planFees(msg, config);

    expect(plan.kind).toBe(NativeFeeKind.TransferFungible);
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
    expect(fungible.kind).toBe(NativeFeeKind.CreateToken);
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

  it('reads the series being created out of the call', () => {
    const schemas = TokenSchemasBuilder.prepareStandard(false);
    const series = SeriesInfoBuilder.build(schemas.seriesMetadata, 7n, 0, 0, payerPub, []);
    const msg = CreateTokenSeriesTxHelper.buildTx(9n, series, payerPub);
    const plan = planFees(msg, config, oneWitness);
    expect(plan.kind).toBe(NativeFeeKind.CreateTokenSeries);
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
    expect(plan.kind).toBe(NativeFeeKind.MintPhantasmaNonFungible);
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

    expect(plan.kind).toBe(NativeFeeKind.MintPhantasmaNonFungible);
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
    expect(empty.kind).toBe(NativeFeeKind.BurnNonFungible);
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

    expect(plan.kind).toBe(NativeFeeKind.TransferNonFungible);
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
    expect(plan.kind).toBe(NativeFeeKind.MintNonFungible);
    expect(plan.newStorageQuanta).toBe(5);
    expect(
      planFees(msg, config, { supplyRowExists: true, romHasMetaId: false }).newStorageQuanta
    ).toBe(4);
    expect(plan.expectedGasBill).toBe(bill(10n, plan.envelopeBytes + 5 + 12));
  });

  it('recognises a name registration', () => {
    const msg = new TxMsg(TxTypes.Call, 1_787_000_000_000n, 0n, 0n, payerPub, SmallString.empty);
    const call = new TxMsgCall();
    call.moduleId = ModuleId.Governance;
    call.methodId = 1;
    const w = new CarbonBinaryWriter();
    payerPub.write(w);
    new SmallString('alice').write(w);
    call.args = w.toUint8Array();
    msg.msg = call;

    const plan = planFees(msg, config, oneWitness);
    expect(plan.kind).toBe(NativeFeeKind.RegisterName);
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
    expect(scriptPlan.kind).toBe(NativeFeeKind.Script);

    const query = new TxMsg(TxTypes.Call, 1_787_000_000_000n, 0n, 0n, payerPub, SmallString.empty);
    const call = new TxMsgCall();
    call.moduleId = ModuleId.Token;
    call.methodId = TokenContractMethods.GetBalance;
    call.args = new Uint8Array(40);
    query.msg = call;
    const queryPlan = planFees(query, config, { ...oneWitness, scriptUnitsAllowance: 100n });
    expect(queryPlan.kind).toBe(NativeFeeKind.Script);
    expect(queryPlan.expectedGasBill).toBe(bill(100n, queryPlan.envelopeBytes + 4 + 512));
  });

  it('sizes a call for the number of witnesses that will sign it', () => {
    const msg = CreateTokenTxHelper.buildTx(tokenInfo(false), payerPub);
    const one = planFees(msg, config, oneWitness);
    const two = planFees(msg, config, { witnessCount: 2 });
    expect(two.envelopeBytes).toBe(one.envelopeBytes + 96);
  });
});
