import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import { CarbonBlob } from '../../src/core/types/Carbon/CarbonBlob';
import { Bytes32 } from '../../src/core/types/Carbon/Bytes32';
import { IntX } from '../../src/core/types/Carbon/IntX';
import { SmallString } from '../../src/core/types/Carbon/SmallString';
import { TxTypes } from '../../src/core/types/Carbon/TxTypes';
import {
  TxMsg,
  TxMsgBurnFungibleGasPayer,
  TxMsgMintFungible,
  TxMsgTransferFungible,
  TxMsgTransferFungibleGasPayer,
} from '../../src/core/types/Carbon/Blockchain';
import { TxMsgSigner } from '../../src/core/types/Carbon/Blockchain/Extensions/TxMsgSigner';
import {
  CreateSeriesFeeOptions,
  CreateTokenFeeOptions,
  CreateTokenSeriesTxHelper,
  CreateTokenTxHelper,
  MintNftFeeOptions,
  MintNonFungibleTxHelper,
  MintPhantasmaNonFungibleTxHelper,
} from '../../src/core/types/Carbon/Blockchain/TxHelpers';
import {
  NftRomBuilder,
  PhantasmaNftRomBuilder,
  SeriesInfoBuilder,
  TokenInfoBuilder,
  TokenMetadataBuilder,
  TokenSchemasBuilder,
} from '../../src/core/types/Carbon/Blockchain/Modules/Builders';
import { PhantasmaKeys } from '../../src/core/types/PhantasmaKeys';
import { bytesToHex } from '../../src/core/utils';

const FIXTURE = path.join(process.cwd(), 'tests', 'fixtures', 'carbon_tx_builder_vectors.tsv');
const CARBON_TX_BUILDER_FIXTURE_SHA256 =
  'efcb2d237ffd2ca3178b8c3b3106c7d035bc0f5e05959abb135163d637c3b11d';
const SAMPLE_PNG_ICON_DATA_URI =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

describe('Carbon transaction builder golden vectors', () => {
  test('fixture hash is locked', () => {
    const digest = createHash('sha256').update(fs.readFileSync(FIXTURE)).digest('hex');
    expect(digest).toBe(CARBON_TX_BUILDER_FIXTURE_SHA256);
  });

  test.each(carbonBuilderRows())('matches %s', (caseId, source, expectedHex, notes) => {
    expect(['csharp_sdk', 'go_sdk']).toContain(source);
    expect(carbonTxBuilderVector(caseId)).toBe(expectedHex);
    expect(notes).toBeTruthy();
  });
});

function carbonBuilderRows(): string[][] {
  return fs
    .readFileSync(FIXTURE, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('case_id\t'))
    .map((line) => line.split('\t'));
}

function carbonTxBuilderVector(caseId: string): string {
  // Deterministic, non-funded fixture keys used only to reproduce signed
  // Carbon transaction golden vectors.
  const sender = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');
  const receiver = PhantasmaKeys.fromWIF('KwVG94yjfVg1YKFyRxAGtug93wdRbmLnqqrFV6Yd2CiA9KZDAp4H');
  const senderBytes = new Bytes32(sender.PublicKey);
  const receiverBytes = new Bytes32(receiver.PublicKey);

  switch (caseId) {
    case 'signed_transfer_fungible': {
      const msg = baseTx(TxTypes.TransferFungible, senderBytes);
      msg.msg = new TxMsgTransferFungible(receiverBytes, 1n, 100000000n);
      return bytesToHex(TxMsgSigner.signAndSerialize(msg, sender)).toUpperCase();
    }
    case 'transfer_fungible_gas_payer': {
      const msg = baseTx(TxTypes.TransferFungible_GasPayer, senderBytes);
      msg.msg = new TxMsgTransferFungibleGasPayer({
        to: receiverBytes,
        from: senderBytes,
        tokenId: 1n,
        amount: 100000000n,
      });
      return serializeTx(msg);
    }
    case 'burn_fungible_gas_payer': {
      const msg = baseTx(TxTypes.BurnFungible_GasPayer, senderBytes);
      msg.msg = new TxMsgBurnFungibleGasPayer({
        tokenId: 1n,
        from: senderBytes,
        amount: IntX.fromI64(100000000n),
      });
      return serializeTx(msg);
    }
    case 'mint_fungible': {
      const msg = baseTx(TxTypes.MintFungible, senderBytes);
      msg.msg = new TxMsgMintFungible({
        tokenId: 1n,
        to: receiverBytes,
        amount: IntX.fromI64(100000000n),
      });
      return serializeTx(msg);
    }
    case 'create_token_nft': {
      const schemas = TokenSchemasBuilder.prepareStandard(false);
      const metadata = TokenMetadataBuilder.buildAndSerialize({
        name: 'My test token!',
        icon: SAMPLE_PNG_ICON_DATA_URI,
        url: 'http://example.com',
        description: 'My test token description',
      });
      const tokenInfo = TokenInfoBuilder.build(
        'MYNFT',
        IntX.fromI64(0n),
        true,
        0,
        senderBytes,
        metadata,
        schemas
      );
      return serializeTx(
        CreateTokenTxHelper.buildTx(
          tokenInfo,
          senderBytes,
          new CreateTokenFeeOptions(10000n, 10000000000n, 10000000000n, 10000n),
          100000000n,
          1759711416000n
        )
      );
    }
    case 'create_token_series_u256_id': {
      const schemas = TokenSchemasBuilder.prepareStandard(false);
      const seriesInfo = SeriesInfoBuilder.build(
        schemas.seriesMetadata,
        (1n << 256n) - 1n,
        0,
        0,
        senderBytes,
        []
      );
      return serializeTx(
        CreateTokenSeriesTxHelper.buildTx(
          (1n << 64n) - 1n,
          seriesInfo,
          senderBytes,
          new CreateSeriesFeeOptions(10000n, 2500000000n, 10000n),
          100000000n,
          1759711416000n
        )
      );
    }
    case 'mint_non_fungible_u256_nft_id': {
      const schemas = TokenSchemasBuilder.prepareStandard(false);
      const rom = NftRomBuilder.buildAndSerialize(schemas.rom, (1n << 256n) - 1n, nftMetadata());
      return serializeTx(
        MintNonFungibleTxHelper.buildTx(
          (1n << 64n) - 1n,
          0xffffffff,
          senderBytes,
          senderBytes,
          rom,
          new Uint8Array(),
          new MintNftFeeOptions(10000n, 1000n),
          100000000n,
          1759711416000n
        )
      );
    }
    case 'mint_phantasma_nft_single_u255_series': {
      const schemas = TokenSchemasBuilder.prepareStandard(false);
      const publicRom = PhantasmaNftRomBuilder.buildAndSerialize(schemas.rom, nftMetadata(false));
      return serializeTx(
        MintPhantasmaNonFungibleTxHelper.buildTx(
          42n,
          (1n << 255n) - 1n,
          senderBytes,
          receiverBytes,
          publicRom,
          new Uint8Array(),
          new MintNftFeeOptions(10000n, 1000n),
          123n,
          1759711416000n
        )
      );
    }
    default:
      throw new Error(`unhandled Carbon tx builder vector: ${caseId}`);
  }
}

function baseTx(type: TxTypes, gasFrom: Bytes32): TxMsg {
  return new TxMsg(
    type,
    1759711416000n,
    10000000n,
    1000n,
    gasFrom,
    new SmallString('test-payload')
  );
}

function serializeTx(msg: TxMsg): string {
  return bytesToHex(CarbonBlob.Serialize(msg)).toUpperCase();
}

function nftMetadata(includeRawRom = true): Array<{ name: string; value: unknown }> {
  const fields: Array<{ name: string; value: unknown }> = [
    { name: 'name', value: 'My NFT #1' },
    { name: 'description', value: 'This is my first NFT!' },
    { name: 'imageURL', value: 'images-assets.nasa.gov/image/PIA13227/PIA13227~orig.jpg' },
    { name: 'infoURL', value: 'https://images.nasa.gov/details/PIA13227' },
    { name: 'royalties', value: 10000000 },
  ];
  if (includeRawRom) {
    fields.push({ name: 'rom', value: new Uint8Array([0x01, 0x42]) });
  }
  return fields;
}
