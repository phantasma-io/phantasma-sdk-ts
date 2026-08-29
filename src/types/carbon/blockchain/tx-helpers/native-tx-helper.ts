import { Bytes32 } from '../../bytes32.js';
import { IntX } from '../../int-x.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgBurnFungible } from '../tx-msg-burn-fungible.js';
import { TxMsgBurnFungibleGasPayer } from '../tx-msg-burn-fungible-gas-payer.js';
import { TxMsgBurnNonFungible } from '../tx-msg-burn-non-fungible.js';
import { TxMsgBurnNonFungibleGasPayer } from '../tx-msg-burn-non-fungible-gas-payer.js';
import { TxMsgMintFungible } from '../tx-msg-mint-fungible.js';
import { TxMsgTransferFungible } from '../tx-msg-transfer-fungible.js';
import { TxMsgTransferFungibleGasPayer } from '../tx-msg-transfer-fungible-gas-payer.js';
import { TxMsgTransferNonFungibleMulti } from '../tx-msg-transfer-non-fungible-multi.js';
import { TxMsgTransferNonFungibleMultiGasPayer } from '../tx-msg-transfer-non-fungible-multi-gas-payer.js';
import { TxMsgTransferNonFungibleSingle } from '../tx-msg-transfer-non-fungible-single.js';
import { TxMsgTransferNonFungibleSingleGasPayer } from '../tx-msg-transfer-non-fungible-single-gas-payer.js';
import { applyTxLimits, TxLimits } from './tx-limits.js';

/**
 * Who pays: the native transaction types come in pairs - the plain form, where the account moving
 * the tokens also pays the gas and signs alone, and the `_GasPayer` form, where a second account
 * pays the gas and both sign. Naming a `gasPayer` selects the second form.
 */
export interface NativeTxParties extends TxLimits {
  /** The account whose tokens move; always a witness. */
  from: Bytes32;
  /** A different account that pays the gas and becomes the first witness. */
  gasPayer?: Bytes32;
}

export interface TransferFungibleParams extends NativeTxParties {
  to: Bytes32;
  tokenId: bigint;
  /** Amount in the token's atoms (u64; big-fungible tokens need a script transfer). */
  amount: bigint;
}

export interface TransferNonFungibleParams extends NativeTxParties {
  to: Bytes32;
  tokenId: bigint;
  /** One instance uses the single-instance type, several the multi-instance type. */
  instanceIds: readonly bigint[];
}

export interface MintFungibleParams extends TxLimits {
  /** The token owner: pays the gas and signs. */
  owner: Bytes32;
  to: Bytes32;
  tokenId: bigint;
  /** Amount in the token's atoms. Mint and burn carry an IntX because they also serve big-fungible
   * tokens, whose balances do not fit a u64; `IntX.fromI64` wraps an ordinary amount. */
  amount: IntX;
}

export interface BurnFungibleParams extends NativeTxParties {
  tokenId: bigint;
  /** Amount in the token's atoms, as an IntX for the same reason as a mint. */
  amount: IntX;
}

export interface BurnNonFungibleParams extends NativeTxParties {
  tokenId: bigint;
  instanceId: bigint;
}

/**
 * Builders for the native transaction types - transfers, mints and burns that need no VM script.
 * They assemble the message only: fees are planned afterwards from the message itself
 * (`PhantasmaAPI.fees.plan`, `planFees`) and the witnesses sign with `TxMsgSigner`. Unless a
 * `maxGas` is passed the message carries a zero offer and cannot be signed until it is planned.
 */
export class NativeTxHelper {
  static transferFungible(p: TransferFungibleParams): TxMsg {
    if (p.gasPayer) {
      const msg = base(TxTypes.TransferFungible_GasPayer, p.gasPayer, p);
      msg.msg = new TxMsgTransferFungibleGasPayer({
        to: p.to,
        from: p.from,
        tokenId: p.tokenId,
        amount: p.amount,
      });
      return msg;
    }
    const msg = base(TxTypes.TransferFungible, p.from, p);
    msg.msg = new TxMsgTransferFungible(p.to, p.tokenId, p.amount);
    return msg;
  }

  static transferNonFungible(p: TransferNonFungibleParams): TxMsg {
    if (p.instanceIds.length === 0) throw new Error('instanceIds must not be empty');
    const single = p.instanceIds.length === 1;
    if (p.gasPayer) {
      const msg = base(
        single
          ? TxTypes.TransferNonFungible_Single_GasPayer
          : TxTypes.TransferNonFungible_Multi_GasPayer,
        p.gasPayer,
        p
      );
      msg.msg = single
        ? new TxMsgTransferNonFungibleSingleGasPayer({
            to: p.to,
            from: p.from,
            tokenId: p.tokenId,
            instanceId: p.instanceIds[0],
          })
        : new TxMsgTransferNonFungibleMultiGasPayer({
            to: p.to,
            from: p.from,
            tokenId: p.tokenId,
            instanceIds: [...p.instanceIds],
          });
      return msg;
    }
    const msg = base(
      single ? TxTypes.TransferNonFungible_Single : TxTypes.TransferNonFungible_Multi,
      p.from,
      p
    );
    msg.msg = single
      ? new TxMsgTransferNonFungibleSingle({
          to: p.to,
          tokenId: p.tokenId,
          instanceId: p.instanceIds[0],
        })
      : new TxMsgTransferNonFungibleMulti({
          to: p.to,
          tokenId: p.tokenId,
          instanceIds: [...p.instanceIds],
        });
    return msg;
  }

  static mintFungible(p: MintFungibleParams): TxMsg {
    const msg = base(TxTypes.MintFungible, p.owner, p);
    msg.msg = new TxMsgMintFungible({ tokenId: p.tokenId, to: p.to, amount: p.amount });
    return msg;
  }

  static burnFungible(p: BurnFungibleParams): TxMsg {
    if (p.gasPayer) {
      const msg = base(TxTypes.BurnFungible_GasPayer, p.gasPayer, p);
      msg.msg = new TxMsgBurnFungibleGasPayer({
        tokenId: p.tokenId,
        from: p.from,
        amount: p.amount,
      });
      return msg;
    }
    const msg = base(TxTypes.BurnFungible, p.from, p);
    msg.msg = new TxMsgBurnFungible({ tokenId: p.tokenId, amount: p.amount });
    return msg;
  }

  static burnNonFungible(p: BurnNonFungibleParams): TxMsg {
    if (p.gasPayer) {
      const msg = base(TxTypes.BurnNonFungible_GasPayer, p.gasPayer, p);
      msg.msg = new TxMsgBurnNonFungibleGasPayer({
        tokenId: p.tokenId,
        from: p.from,
        instanceId: p.instanceId,
      });
      return msg;
    }
    const msg = base(TxTypes.BurnNonFungible, p.from, p);
    msg.msg = new TxMsgBurnNonFungible({ tokenId: p.tokenId, instanceId: p.instanceId });
    return msg;
  }
}

function base(type: TxTypes, gasFrom: Bytes32, limits: TxLimits): TxMsg {
  const msg = new TxMsg();
  msg.type = type;
  msg.gasFrom = gasFrom;
  msg.payload = SmallString.empty;
  return applyTxLimits(msg, limits);
}
