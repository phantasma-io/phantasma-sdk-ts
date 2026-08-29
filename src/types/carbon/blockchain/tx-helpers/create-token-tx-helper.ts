import { bytesToHex, hexToBytes } from '../../../../utils/index.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { GasConfig } from '../gas-config.js';
import { ModuleId } from '../module-id.js';
import { TokenContractMethods, TokenInfo } from '../modules/index.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgCall } from '../tx-msg-call.js';
import { PlanAndSignOptions, planAndSignWithKeys } from './plan-and-sign.js';
import { applyTxLimits, TxLimits } from './tx-limits.js';

export class CreateTokenTxHelper {
  /** Builds the Token.CreateToken call. Fees are planned from the message afterwards. */
  static buildTx(tokenInfo: TokenInfo, creatorPublicKey: Bytes32, limits?: TxLimits): TxMsg {
    const msg = new TxMsg();
    msg.type = TxTypes.Call;
    msg.gasFrom = creatorPublicKey;
    msg.payload = SmallString.empty;

    const argsW = new CarbonBinaryWriter();
    tokenInfo.write(argsW);

    const call = new TxMsgCall();
    call.moduleId = ModuleId.Token;
    call.methodId = TokenContractMethods.CreateToken;
    call.args = argsW.toUint8Array();
    msg.msg = call;

    return applyTxLimits(msg, limits);
  }

  /** Builds, plans against `config` and signs with in-memory keys, returning the envelope bytes. */
  static buildTxAndSign(
    tokenInfo: TokenInfo,
    signer: PhantasmaKeys,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): Uint8Array {
    const tx = this.buildTx(tokenInfo, new Bytes32(signer.publicKey), options);
    return planAndSignWithKeys(tx, [signer], config, options);
  }

  static buildTxAndSignHex(
    tokenInfo: TokenInfo,
    signer: PhantasmaKeys,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): string {
    return bytesToHex(this.buildTxAndSign(tokenInfo, signer, config, options));
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
