import { bytesToHex, hexToBytes } from '../../../../utils/index.js';
import { CarbonBinaryReader } from '../../../carbon-serialization.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { GasConfig } from '../gas-config.js';
import { TokenHelper } from '../modules/token-helper.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgMintNonFungible } from '../tx-msg-mint-non-fungible.js';
import { PlanAndSignOptions, planAndSignWithKeys } from './plan-and-sign.js';
import { applyTxLimits, TxLimits } from './tx-limits.js';

export class MintNonFungibleTxHelper {
  /** Builds the native MintNonFungible transaction. Fees are planned from the message afterwards. */
  static buildTx(
    carbonTokenId: bigint,
    carbonSeriesId: number,
    senderPublicKey: Bytes32,
    receiverPublicKey: Bytes32,
    rom: Uint8Array,
    ram: Uint8Array,
    limits?: TxLimits
  ): TxMsg {
    const msg = new TxMsg();
    msg.type = TxTypes.MintNonFungible;
    msg.gasFrom = senderPublicKey;
    msg.payload = SmallString.empty;

    const mint = new TxMsgMintNonFungible();
    mint.tokenId = carbonTokenId;
    mint.seriesId = carbonSeriesId;
    mint.to = receiverPublicKey;
    mint.rom = rom;
    mint.ram = ram;
    msg.msg = mint;

    return applyTxLimits(msg, limits);
  }

  /** Builds, plans against `config` and signs with in-memory keys, returning the envelope bytes. */
  static buildTxAndSign(
    tokenId: bigint,
    seriesId: number,
    signer: PhantasmaKeys,
    receiverPublicKey: Bytes32,
    rom: Uint8Array,
    ram: Uint8Array,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): Uint8Array {
    const tx = this.buildTx(
      tokenId,
      seriesId,
      new Bytes32(signer.publicKey),
      receiverPublicKey,
      rom,
      ram,
      options
    );
    return planAndSignWithKeys(tx, [signer], config, options);
  }

  static buildTxAndSignHex(
    tokenId: bigint,
    seriesId: number,
    signer: PhantasmaKeys,
    receiverPublicKey: Bytes32,
    rom: Uint8Array,
    ram: Uint8Array | null | undefined,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): string {
    return bytesToHex(
      this.buildTxAndSign(
        tokenId,
        seriesId,
        signer,
        receiverPublicKey,
        rom,
        ram ?? new Uint8Array(),
        config,
        options
      )
    );
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
