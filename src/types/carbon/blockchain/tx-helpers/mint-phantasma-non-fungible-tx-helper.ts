import { bytesToHex, hexToBytes } from '../../../../utils/index.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { GasConfig } from '../gas-config.js';
import { ModuleId } from '../module-id.js';
import {
  MintPhantasmaNonFungibleArgs,
  PhantasmaNftMintInfo,
  PhantasmaNftMintResult,
  TokenContractMethods,
} from '../modules/index.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgCall } from '../tx-msg-call.js';
import { PlanAndSignOptions, planAndSignWithKeys } from './plan-and-sign.js';
import { applyTxLimits, TxLimits } from './tx-limits.js';

/** A deterministic Phantasma NFT mint. It is one call with one recipient and one entry per minted
 * instance. */
export interface PhantasmaNftMintParams {
  tokenId: bigint;
  /** The account that pays the gas and signs the mint. */
  sender: Bytes32;
  /** The account that receives every instance this call mints. */
  to: Bytes32;
  /**
   * One entry per instance. Each entry names the Phantasma series the instance is minted into and
   * carries the public ROM. Instances of several series may share one call. A single mint passes
   * one entry.
   */
  tokens: readonly PhantasmaNftMintInfo[];
}

export class MintPhantasmaNonFungibleTxHelper {
  /** Builds the Token.MintPhantasmaNonFungible call. Fees are planned from the message
   * afterwards. */
  static buildTx(p: PhantasmaNftMintParams, limits?: TxLimits): TxMsg {
    if (p.tokens.length === 0) throw new Error('tokens must not be empty');

    // This helper only packages the Token.Call ABI surface.
    const args = new MintPhantasmaNonFungibleArgs({
      tokenId: p.tokenId,
      address: p.to,
      tokens: [...p.tokens],
    });

    const msg = new TxMsg();
    msg.type = TxTypes.Call;
    msg.gasFrom = p.sender;
    msg.payload = SmallString.empty;

    const call = new TxMsgCall();
    call.moduleId = ModuleId.Token;
    call.methodId = TokenContractMethods.MintPhantasmaNonFungible;
    const argsWriter = new CarbonBinaryWriter();
    args.write(argsWriter);
    call.args = argsWriter.toUint8Array();
    msg.msg = call;

    return applyTxLimits(msg, limits);
  }

  /** Builds the call, plans it against `config`, signs it with in-memory keys and returns the
   * envelope bytes. */
  static buildTxAndSign(
    p: PhantasmaNftMintParams,
    signer: PhantasmaKeys,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): Uint8Array {
    return planAndSignWithKeys(this.buildTx(p, options), [signer], config, options);
  }

  static buildTxAndSignHex(
    p: PhantasmaNftMintParams,
    signer: PhantasmaKeys,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): string {
    return bytesToHex(this.buildTxAndSign(p, signer, config, options));
  }

  static parseResult(resultHex: string): PhantasmaNftMintResult[] {
    const r = new CarbonBinaryReader(hexToBytes(resultHex));
    return r.readArrayBlob(PhantasmaNftMintResult);
  }
}
