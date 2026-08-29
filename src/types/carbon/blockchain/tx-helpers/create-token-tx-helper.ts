import { bytesToHex, hexToBytes } from '../../../../utils/index.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { TxMsgSigner } from '../extensions/tx-msg-signer.js';
import { ModuleId } from '../module-id.js';
import { TokenContractMethods, TokenInfo } from '../modules/index.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgCall } from '../tx-msg-call.js';
import { CreateTokenFeeOptions } from './fee-options.js';

export class CreateTokenTxHelper {
  static buildTx(
    tokenInfo: TokenInfo,
    creatorPublicKey: Bytes32,
    feeOptions?: CreateTokenFeeOptions,
    maxData?: bigint,
    expiry?: bigint
  ): TxMsg {
    const fees = feeOptions ?? new CreateTokenFeeOptions();
    const maxGas = fees.calculateMaxGas(tokenInfo.symbol);

    const msg = new TxMsg();
    msg.type = TxTypes.Call;
    msg.expiry = expiry ?? BigInt(Date.now() + 60_000);
    msg.maxGas = maxGas;
    msg.maxData = maxData ?? 0n;
    msg.gasFrom = creatorPublicKey;
    msg.payload = SmallString.empty;

    const argsW = new CarbonBinaryWriter();
    tokenInfo.write(argsW);

    const call = new TxMsgCall();
    call.moduleId = ModuleId.Token;
    call.methodId = TokenContractMethods.CreateToken;
    call.args = argsW.toUint8Array();
    msg.msg = call;

    return msg;
  }

  static buildTxAndSign(
    tokenInfo: TokenInfo,
    signer: PhantasmaKeys,
    feeOptions?: CreateTokenFeeOptions,
    maxData?: bigint,
    expiry?: bigint
  ): Uint8Array {
    const tx = this.buildTx(tokenInfo, new Bytes32(signer.publicKey), feeOptions, maxData, expiry);
    return TxMsgSigner.signAndSerialize(tx, signer);
  }

  static buildTxAndSignHex(
    tokenInfo: TokenInfo,
    signer: PhantasmaKeys,
    feeOptions?: CreateTokenFeeOptions,
    maxData?: bigint,
    expiry?: bigint
  ): string {
    const bytes = this.buildTxAndSign(tokenInfo, signer, feeOptions, maxData, expiry);
    return bytesToHex(bytes);
  }

  /**
   * The token id the creation returned. Token.CreateToken answers with a u64, and a token id is a
   * `bigint` everywhere else in the SDK - a `number` cannot hold the whole range, and reading only
   * its low half would return a wrong id rather than fail.
   */
  static parseResult(resultHex: string): bigint {
    const r = new CarbonBinaryReader(hexToBytes(resultHex));
    return r.read8u();
  }
}
