import { bytesToHex } from '../../../../utils/index.js';
import { CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { GasConfig } from '../gas-config.js';
import { ModuleId } from '../module-id.js';
import { StandardMeta } from '../modules/standard-meta.js';
import { TokenContractMethods } from '../modules/token-contract-methods.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgCall } from '../tx-msg-call.js';
import { VmDynamicStruct, VmType } from '../vm/index.js';
import { PlanAndSignOptions, planAndSignWithKeys } from './plan-and-sign.js';
import { applyTxLimits, TxLimits } from './tx-limits.js';

const MAX_TOKEN_ID = 0xffffffffffffffffn;

/**
 * Builds Token.UpdateTokenMetadata, which the token owner or governance sends to change a token's
 * metadata. The chain merges the update into the stored metadata field by field, so a field the update
 * leaves out keeps its value. `TokenMetadataBuilder.buildContractSealUpdate` returns the update that
 * seals a token against VM contracts.
 *
 * The planner has no formula for this call and prices it with the script budget, so the plan is an
 * upper bound (`exact` is false). The chain charges the transfer fee and the storage the token's row
 * grows by.
 */
export class UpdateTokenMetadataTxHelper {
  /** Builds the Token.UpdateTokenMetadata call. Fees are planned from the message afterwards. */
  static buildTx(
    tokenId: bigint,
    metadata: VmDynamicStruct,
    ownerPublicKey: Bytes32,
    limits?: TxLimits
  ): TxMsg {
    if (tokenId < 1n || tokenId > MAX_TOKEN_ID) {
      throw new RangeError(`tokenId must be between 1 and 2^64 - 1, got ${tokenId}`);
    }
    if (metadata.fields.length === 0) {
      throw new Error('A metadata update needs at least one field');
    }
    // The chain takes the seal only as the Int64 1, and a seal cannot be removed.
    const sealed = metadata.getValue(StandardMeta.Token.sealed_contract);
    if (sealed && (sealed.type !== VmType.Int64 || sealed.data !== 1n)) {
      throw new Error(
        '_sealed_c must be the Int64 1: build it with TokenMetadataBuilder.buildContractSealUpdate'
      );
    }

    const argsW = new CarbonBinaryWriter();
    argsW.write8u(tokenId);
    metadata.write(argsW);

    const msg = new TxMsg();
    msg.type = TxTypes.Call;
    msg.gasFrom = ownerPublicKey;
    msg.payload = SmallString.empty;

    const call = new TxMsgCall();
    call.moduleId = ModuleId.Token;
    call.methodId = TokenContractMethods.UpdateTokenMetadata;
    call.args = argsW.toUint8Array();
    msg.msg = call;

    return applyTxLimits(msg, limits);
  }

  /** Builds the call, plans it against `config`, signs it with in-memory keys and returns the
   * envelope bytes. */
  static buildTxAndSign(
    tokenId: bigint,
    metadata: VmDynamicStruct,
    signer: PhantasmaKeys,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): Uint8Array {
    const tx = this.buildTx(tokenId, metadata, new Bytes32(signer.publicKey), options);
    return planAndSignWithKeys(tx, [signer], config, options);
  }

  static buildTxAndSignHex(
    tokenId: bigint,
    metadata: VmDynamicStruct,
    signer: PhantasmaKeys,
    config: GasConfig,
    options?: PlanAndSignOptions
  ): string {
    return bytesToHex(this.buildTxAndSign(tokenId, metadata, signer, config, options));
  }
}
