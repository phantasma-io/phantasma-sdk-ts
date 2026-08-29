import { bytesToHex, hexToBytes } from '../../../../utils/index.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { GasConfig } from '../gas-config.js';
import { ModuleId } from '../module-id.js';
import { SeriesInfo, TokenContractMethods } from '../modules/index.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgCall } from '../tx-msg-call.js';
import { PlanAndSignOptions, planAndSignWithKeys } from './plan-and-sign.js';
import { applyTxLimits, TxLimits } from './tx-limits.js';

export class CreateTokenSeriesTxHelper {
  /** Builds the Token.CreateTokenSeries call. Fees are planned from the message afterwards. */
  static buildTx(
    tokenId: bigint, // ulong
    seriesInfo: SeriesInfo,
    creatorPublicKey: Bytes32,
    limits?: TxLimits
  ): TxMsg {
    const argsW = new CarbonBinaryWriter();
    argsW.write8(tokenId);
    seriesInfo.write(argsW);

    const msg = new TxMsg();
    msg.type = TxTypes.Call;
    msg.gasFrom = creatorPublicKey;
    msg.payload = SmallString.empty;

    const call = new TxMsgCall();
    call.moduleId = ModuleId.Token;
    call.methodId = TokenContractMethods.CreateTokenSeries;
    call.args = argsW.toUint8Array();
    msg.msg = call;

    return applyTxLimits(msg, limits);
  }

  /** Builds, plans against `config` and signs with in-memory keys, returning the envelope bytes. */
  static buildTxAndSign(
    tokenId: bigint,
    seriesInfo: SeriesInfo,
    signer: PhantasmaKeys,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): Uint8Array {
    const tx = this.buildTx(tokenId, seriesInfo, new Bytes32(signer.publicKey), options);
    return planAndSignWithKeys(tx, [signer], config, options);
  }

  static buildTxAndSignHex(
    tokenId: bigint,
    seriesInfo: SeriesInfo,
    signer: PhantasmaKeys,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): string {
    return bytesToHex(this.buildTxAndSign(tokenId, seriesInfo, signer, config, options));
  }

  static parseResult(resultHex: string): number {
    // UInt32 carbon seriesId
    const r = new CarbonBinaryReader(hexToBytes(resultHex));
    return r.read4u();
  }
}
