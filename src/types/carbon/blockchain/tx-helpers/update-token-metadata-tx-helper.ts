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
import { VmDynamicStruct, VmDynamicVariable, VmType } from '../vm/index.js';
import { PlanAndSignOptions, planAndSignWithKeys } from './plan-and-sign.js';
import { applyTxLimits, TxLimits } from './tx-limits.js';

const MAX_TOKEN_ID = 0xffffffffffffffffn;

// The `_` keys an update may set: the chain's own settings, and `_ifr`, the inflation reset that the
// chain applies and does not store. `_brn` is not among them, because only genesis sets it.
const UPDATABLE_CHAIN_KEYS: ReadonlySet<string> = new Set(
  [
    StandardMeta.Token.staking_org_id,
    StandardMeta.Token.staking_org_threshold,
    StandardMeta.Token.staking_reward_token,
    StandardMeta.Token.staking_reward_period,
    StandardMeta.Token.staking_reward_mul,
    StandardMeta.Token.staking_reward_div,
    StandardMeta.Token.staking_lock,
    StandardMeta.Token.staking_booster_token,
    StandardMeta.Token.staking_booster_mul,
    StandardMeta.Token.staking_booster_div,
    StandardMeta.Token.staking_booster_limit,
    StandardMeta.Token.inflation_period,
    StandardMeta.Token.inflation_amounts,
    StandardMeta.Token.inflation_initial_begin,
    StandardMeta.Token.inflation_initial_end,
    StandardMeta.Token.inflation_force_reset,
    StandardMeta.Token.sealed_contract,
  ].map((key) => key.data)
);

/**
 * Builds Token.UpdateTokenMetadata, which the token owner or governance sends to change a token's
 * metadata. The chain merges the update into the stored metadata field by field, so a field the update
 * leaves out keeps its value. `TokenMetadataBuilder.buildContractSealUpdate` returns the update that
 * seals a token against VM contracts.
 *
 * A field is removed by sending it as an empty `VmType.Array_Dynamic` value, the only form the chain
 * reads as a removal. A `Dynamic` value without data is stored like any other value. The keys that
 * start with `_` belong to the chain. An update may set the chain's own settings, and it may name any
 * other such key only to remove it. An update may not name `_brn` at all.
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
    // Only genesis sets `_brn`, so the chain refuses an update that names it, a removal included.
    if (metadata.getValue(StandardMeta.Token.pre_burn)) {
      throw new Error('_brn is set at genesis only');
    }
    // The chain refuses metadata that keeps a `_` key it does not define. A token may hold such a key
    // from before the chain reserved these keys. Only an update that removes the key can then succeed.
    for (const field of metadata.fields) {
      const key = field.name.data;
      if (key.startsWith('_') && !UPDATABLE_CHAIN_KEYS.has(key) && !removesField(field.value)) {
        throw new Error(`${key} is reserved for the chain: an update can only remove it`);
      }
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

/** Returns true if the value removes its field. The chain reads only an empty Array_Dynamic as null. */
function removesField(value: VmDynamicVariable): boolean {
  return (
    value.type === VmType.Array_Dynamic && Array.isArray(value.data) && value.data.length === 0
  );
}
