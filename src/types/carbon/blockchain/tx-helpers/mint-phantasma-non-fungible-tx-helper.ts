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

/** A deterministic Phantasma NFT mint: one call, one recipient, one entry per minted instance. */
export interface PhantasmaNftMintParams extends TxLimits {
  tokenId: bigint;
  /** The account that pays the gas and signs the mint. */
  sender: Bytes32;
  /** The account that receives every instance this call mints. */
  to: Bytes32;
  /**
   * One entry per instance, each naming the Phantasma series it is minted into and carrying the
   * public ROM. Instances of several series may share one call; a single mint passes one entry.
   */
  tokens: readonly PhantasmaNftMintInfo[];
}

export class MintPhantasmaNonFungibleTxHelper {
  /** Builds the Token.MintPhantasmaNonFungible call. Fees are planned from the message afterwards. */
  static buildTx(p: PhantasmaNftMintParams): TxMsg {
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

    return applyTxLimits(msg, p);
  }

  /**
   * Builds, plans against `config` and signs with in-memory keys, returning the envelope bytes.
   * The transaction's own limits come from `p`; `options` governs how the fee is planned.
   */
  static buildTxAndSign(
    p: PhantasmaNftMintParams,
    signer: PhantasmaKeys,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): Uint8Array {
    return planAndSignWithKeys(this.buildTx(p), [signer], config, options);
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
