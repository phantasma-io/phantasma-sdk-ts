import { bytesToHex } from '../../src/core/utils';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../src/core/types/CarbonSerialization';
import { Bytes32 } from '../../src/core/types/Carbon/Bytes32';
import { TxTypes } from '../../src/core/types/Carbon/TxTypes';
import { TxMsgCall } from '../../src/core/types/Carbon/Blockchain/TxMsgCall';
import { IntX } from '../../src/core/types/Carbon/IntX';
import {
  MintPhantasmaNonFungibleArgs,
  PhantasmaNftMintInfo,
  PhantasmaNftMintResult,
  TokenContractMethods,
} from '../../src/core/types/Carbon/Blockchain/Modules';
import {
  PhantasmaNftRomBuilder,
  TokenSchemasBuilder,
} from '../../src/core/types/Carbon/Blockchain/Modules/Builders';
import { VmDynamicStruct } from '../../src/core/types/Carbon/Blockchain/Vm';
import { SmallString } from '../../src/core/types/Carbon/SmallString';
import { MintPhantasmaNonFungibleTxHelper } from '../../src/core/types/Carbon/Blockchain/TxHelpers';
import { ModuleId } from '../../src/core/types/Carbon/Blockchain/ModuleId';
import { GasConfig } from '../../src/types/carbon/blockchain/gas-config';
import { SignedTxMsg } from '../../src/types/carbon/blockchain/signed-tx-msg';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';

const sender = new Bytes32(new Uint8Array(32).fill(0x11));
const receiver = new Bytes32(new Uint8Array(32).fill(0x22));

const buildMetadata = () => [
  { name: 'name', value: 'My NFT #1' },
  { name: 'description', value: 'This is my first NFT!' },
  { name: 'imageURL', value: 'images-assets.nasa.gov/image/PIA13227/PIA13227~orig.jpg' },
  { name: 'infoURL', value: 'https://images.nasa.gov/details/PIA13227' },
  { name: 'royalties', value: 10000000 },
];

describe('Phantasma deterministic mint helpers', () => {
  it('PhantasmaNftRomBuilder serializes public mint payload without service fields', () => {
    const tokenSchemas = TokenSchemasBuilder.prepareStandard(false);
    const rom = PhantasmaNftRomBuilder.buildAndSerialize(tokenSchemas.rom, buildMetadata());
    const publicSchema = PhantasmaNftRomBuilder.buildPublicMintSchema(tokenSchemas.rom);

    const reader = new CarbonBinaryReader(rom);
    const romStruct = new VmDynamicStruct();
    romStruct.readWithSchema(publicSchema, reader);

    expect(romStruct.getValue(new SmallString('name'))?.data).toBe('My NFT #1');
    expect(romStruct.getValue(new SmallString('description'))?.data).toBe('This is my first NFT!');
    expect(romStruct.getValue(new SmallString('_i'))).toBeUndefined();
    expect(romStruct.getValue(new SmallString('rom'))).toBeUndefined();
  });

  it('MintPhantasmaNonFungibleTxHelper builds Token.Call args with the deterministic method id', () => {
    const tokenSchemas = TokenSchemasBuilder.prepareStandard(false);
    const rom = PhantasmaNftRomBuilder.buildAndSerialize(tokenSchemas.rom, buildMetadata());

    const tx = MintPhantasmaNonFungibleTxHelper.buildTx(
      {
        tokenId: 42n,
        sender,
        to: receiver,
        tokens: [
          new PhantasmaNftMintInfo({
            phantasmaSeriesId: IntX.fromBigInt(777n),
            rom,
            ram: new Uint8Array(),
          }),
        ],
      },
      { maxData: 123n, expiry: 999n }
    );

    expect(tx.type).toBe(TxTypes.Call);

    const call = tx.msg as TxMsgCall;
    expect(call.moduleId).toBe(ModuleId.Token);
    expect(call.methodId).toBe(TokenContractMethods.MintPhantasmaNonFungible);

    const argsReader = new CarbonBinaryReader(call.args);
    const decoded = MintPhantasmaNonFungibleArgs.read(argsReader);
    expect(decoded.tokenId).toBe(42n);
    expect(decoded.address.equals(receiver)).toBe(true);
    expect(decoded.tokens).toHaveLength(1);
    expect(decoded.tokens[0].phantasmaSeriesId.toBigInt()).toBe(777n);
    expect(bytesToHex(decoded.tokens[0].rom).toUpperCase()).toBe(bytesToHex(rom).toUpperCase());
    expect(decoded.tokens[0].ram).toEqual(new Uint8Array());
  });

  it('MintPhantasmaNonFungibleTxHelper leaves the offer unplanned unless limits are given', () => {
    const tokenSchemas = TokenSchemasBuilder.prepareStandard(false);
    const rom = PhantasmaNftRomBuilder.buildAndSerialize(tokenSchemas.rom, buildMetadata());
    const tokens = [
      new PhantasmaNftMintInfo({
        phantasmaSeriesId: IntX.fromBigInt(1n),
        rom,
        ram: new Uint8Array(),
      }),
      new PhantasmaNftMintInfo({
        phantasmaSeriesId: IntX.fromBigInt(2n),
        rom,
        ram: new Uint8Array(),
      }),
    ];

    const unplanned = MintPhantasmaNonFungibleTxHelper.buildTx({
      tokenId: 42n,
      sender,
      to: receiver,
      tokens,
    });
    expect(unplanned.maxGas).toBe(0n);
    expect(unplanned.maxData).toBe(0n);

    const tx = MintPhantasmaNonFungibleTxHelper.buildTx(
      {
        tokenId: 42n,
        sender,
        to: receiver,
        tokens,
      },
      { maxGas: 20_000n, maxData: 123n, expiry: 999n }
    );
    expect(tx.maxGas).toBe(20_000n);
    expect(tx.maxData).toBe(123n);
    expect(tx.expiry).toBe(999n);

    // Both builds carry every instance the caller passed, whatever the limits are: the fee is
    // planned from these arguments afterwards, so a builder that dropped or merged an instance
    // would produce an offer for a cheaper transaction than the one being sent.
    for (const built of [unplanned, tx]) {
      const decoded = MintPhantasmaNonFungibleArgs.read(
        new CarbonBinaryReader((built.msg as TxMsgCall).args)
      );
      expect(decoded.tokens).toHaveLength(2);
      expect(decoded.tokens.map((t) => t.phantasmaSeriesId.toBigInt())).toEqual([1n, 2n]);
      expect(decoded.tokens.map((t) => t.rom.length)).toEqual([rom.length, rom.length]);
    }
  });

  // A gas config is data, not an identity: one restored from a wallet's cache has the same fields
  // and no prototype, and every other entry point in the SDK accepts it. This helper has to as
  // well, or a wallet that caches prices cannot mint - and it has to produce the SAME plan from
  // both, which is what the offer written into the envelope is read back to prove.
  it('MintPhantasmaNonFungibleTxHelper plans with a gas config restored from storage', () => {
    const tokenSchemas = TokenSchemasBuilder.prepareStandard(false);
    const rom = PhantasmaNftRomBuilder.buildAndSerialize(tokenSchemas.rom, buildMetadata());
    const signer = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');
    const live = new GasConfig({
      version: 1,
      maxNameLength: 255,
      maxTokenSymbolLength: 255,
      feeMultiplier: 10_000n,
      gasTokenId: 1n,
      dataTokenId: 2n,
      minimumGasOffer: 10n,
      dataEscrowPerRow: 200_000n,
      gasFeeTransfer: 10n,
      gasFeeQuery: 10n,
      minimumGasBill: 10_000_000n,
    });
    const restored = { ...live };
    expect(restored instanceof GasConfig).toBe(false);

    const tokens = [
      new PhantasmaNftMintInfo({
        phantasmaSeriesId: IntX.fromBigInt(1n),
        rom,
        ram: new Uint8Array(),
      }),
    ];
    // A fixed expiry, so the two envelopes differ in nothing but the config object they were
    // priced with. Every field of the offer is fixed-width, so comparing the envelopes' LENGTHS
    // would pass whatever either plan produced; the offer itself has to be read back out.
    const params = {
      tokenId: 42n,
      sender: new Bytes32(signer.publicKey),
      to: receiver,
      tokens,
      expiry: 1_787_000_000_000n,
    };
    const offerOf = (envelope: Uint8Array) =>
      SignedTxMsg.read(new CarbonBinaryReader(envelope)).msg;

    const fromRestored = offerOf(
      MintPhantasmaNonFungibleTxHelper.buildTxAndSign(params, signer, restored)
    );
    const fromLive = offerOf(MintPhantasmaNonFungibleTxHelper.buildTxAndSign(params, signer, live));

    expect(fromRestored.maxGas).toBe(fromLive.maxGas);
    expect(fromRestored.maxData).toBe(fromLive.maxData);
    // And the plan is a real one, not a zero offer both paths happened to agree on: the mint's
    // five rows plus the supply row an unstated plan covers.
    expect(fromRestored.maxGas).toBeGreaterThan(0n);
    expect(fromRestored.maxData).toBe(6n * live.dataEscrowPerRow);
  });

  it('MintPhantasmaNonFungibleTxHelper.parseResult preserves both ids', () => {
    const lowId = new Uint8Array(32);
    lowId[0] = 0x7b;
    const highId = new Uint8Array(32);
    highId[0] = 0x2a;
    highId[31] = 0x80;

    const writer = new CarbonBinaryWriter();
    writer.writeArrayBlob([
      new PhantasmaNftMintResult({
        phantasmaNftId: new Bytes32(lowId),
        carbonInstanceId: 7n,
      }),
      new PhantasmaNftMintResult({
        phantasmaNftId: new Bytes32(highId),
        carbonInstanceId: 8n,
      }),
    ]);

    const parsed = MintPhantasmaNonFungibleTxHelper.parseResult(bytesToHex(writer.toUint8Array()));
    expect(parsed).toHaveLength(2);
    expect(parsed[0].phantasmaNftId.equals(new Bytes32(lowId))).toBe(true);
    expect(parsed[0].carbonInstanceId).toBe(7n);
    expect(parsed[1].phantasmaNftId.equals(new Bytes32(highId))).toBe(true);
    expect(parsed[1].carbonInstanceId).toBe(8n);
  });
});
