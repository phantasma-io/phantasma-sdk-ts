import { bytesToHex, hexToBytes } from '../../../../utils/index.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { TxMsgSigner } from '../extensions/tx-msg-signer.js';
import { ModuleId } from '../module-id.js';
import { SeriesInfo, TokenContract_Methods } from '../modules/index.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgCall } from '../tx-msg-call.js';
import { CreateSeriesFeeOptions } from './fee-options.js';

export class CreateTokenSeriesTxHelper {
  /** Build a Tx without signing. */
  static buildTx(
    tokenId: bigint, // ulong
    seriesInfo: SeriesInfo,
    creatorPublicKey: Bytes32,
    feeOptions?: CreateSeriesFeeOptions,
    maxData?: bigint,
    expiry?: bigint
  ): TxMsg {
    const fees = feeOptions ?? new CreateSeriesFeeOptions();
    const maxGas = fees.calculateMaxGas();

    const argsW = new CarbonBinaryWriter();
    argsW.write8(tokenId);
    seriesInfo.write(argsW);

    // --- Tx message: Call(Token.CreateTokenSeries, args) ---
    const msg = new TxMsg();
    msg.type = TxTypes.Call;
    msg.expiry = expiry ?? BigInt(Date.now() + 60_000);
    msg.maxGas = maxGas;
    msg.maxData = maxData ?? 0n;
    msg.gasFrom = creatorPublicKey;
    msg.payload = SmallString.empty;

    const call = new TxMsgCall();
    call.moduleId = ModuleId.Token;
    call.methodId = TokenContract_Methods.CreateTokenSeries;
    call.args = argsW.toUint8Array();
    msg.msg = call;

    return msg;
  }

  /** Build and sign, returning raw bytes. */
  static buildTxAndSign(
    tokenId: bigint,
    seriesInfo: SeriesInfo,
    signer: PhantasmaKeys,
    feeOptions?: CreateSeriesFeeOptions,
    maxData?: bigint,
    expiry?: bigint
  ): Uint8Array {
    const tx = this.buildTx(
      tokenId,
      seriesInfo,
      new Bytes32(signer.publicKey),
      feeOptions,
      maxData,
      expiry
    );
    return TxMsgSigner.signAndSerialize(tx, signer);
  }

  /** Build, sign and return hex string. */
  static buildTxAndSignHex(
    tokenId: bigint,
    seriesInfo: SeriesInfo,
    signer: PhantasmaKeys,
    feeOptions?: CreateSeriesFeeOptions,
    maxData?: bigint,
    expiry?: bigint
  ): string {
    return bytesToHex(
      this.buildTxAndSign(tokenId, seriesInfo, signer, feeOptions, maxData, expiry)
    );
  }

  static parseResult(resultHex: string): number {
    // UInt32 carbon seriesId
    const r = new CarbonBinaryReader(hexToBytes(resultHex));
    return r.read4u();
  }
}
