import { bytesToHex, hexToBytes } from '../../../../utils/index.js';
import { CarbonBinaryReader } from '../../../carbon-serialization.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { TxMsgSigner } from '../extensions/tx-msg-signer.js';
import { TokenHelper } from '../modules/token-helper.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgMintNonFungible } from '../tx-msg-mint-non-fungible.js';
import { MintNftFeeOptions } from './fee-options.js';

export class MintNonFungibleTxHelper {
  // Build a Tx without signing
  static buildTx(
    carbonTokenId: bigint,
    carbonSeriesId: number,
    senderPublicKey: Bytes32,
    receiverPublicKey: Bytes32,
    rom: Uint8Array,
    ram: Uint8Array,
    feeOptions?: MintNftFeeOptions,
    maxData?: bigint,
    expiry?: bigint
  ): TxMsg {
    const fees = feeOptions ?? new MintNftFeeOptions();
    const maxGas = fees.calculateMaxGas();

    const msg = new TxMsg();
    msg.type = TxTypes.MintNonFungible;
    msg.expiry = expiry ?? BigInt(Date.now() + 60_000);
    msg.maxGas = maxGas;
    msg.maxData = maxData ?? 0n;
    msg.gasFrom = senderPublicKey;
    msg.payload = SmallString.empty;

    const mint = new TxMsgMintNonFungible();
    mint.tokenId = carbonTokenId;
    mint.seriesId = carbonSeriesId;
    mint.to = receiverPublicKey;
    mint.rom = rom;
    mint.ram = ram;

    msg.msg = mint;

    return msg;
  }

  // Build and sign, returning raw bytes
  static buildTxAndSign(
    tokenId: bigint,
    seriesId: number,
    signer: PhantasmaKeys,
    receiverPublicKey: Bytes32,
    rom: Uint8Array,
    ram: Uint8Array,
    feeOptions?: MintNftFeeOptions,
    maxData?: bigint,
    expiry?: bigint
  ): Uint8Array {
    const senderPub = new Bytes32(signer.publicKey);
    const tx = this.buildTx(
      tokenId,
      seriesId,
      senderPub,
      receiverPublicKey,
      rom,
      ram,
      feeOptions,
      maxData,
      expiry
    );
    return TxMsgSigner.signAndSerialize(tx, signer);
  }

  // Build, sign and return hex string
  static buildTxAndSignHex(
    tokenId: bigint,
    seriesId: number,
    signer: PhantasmaKeys,
    receiverPublicKey: Bytes32,
    rom: Uint8Array,
    ram: Uint8Array | null | undefined,
    feeOptions?: MintNftFeeOptions,
    maxData?: bigint,
    expiry?: bigint
  ): string {
    const bytes = this.buildTxAndSign(
      tokenId,
      seriesId,
      signer,
      receiverPublicKey,
      rom,
      ram ?? new Uint8Array(),
      feeOptions,
      maxData,
      expiry
    );
    return bytesToHex(bytes);
  }

  static parseResult(carbonTokenId: bigint, resultHex: string): Bytes32[] {
    const result: Bytes32[] = [];

    const r = new CarbonBinaryReader(hexToBytes(resultHex));
    const count = r.read4u();

    for (let i = 0; i < count; i++) {
      const instanceId = r.read8u();

      const carbonNftId = TokenHelper.getNftAddress(carbonTokenId, instanceId);
      result.push(carbonNftId);
    }

    return result;
  }
}
