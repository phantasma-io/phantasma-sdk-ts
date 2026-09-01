import { CarbonBinaryReader } from '../../../carbon-serialization.js';
import { SmallString } from '../../small-string.js';
import { TxTypes } from '../../tx-types.js';
import { CarbonTokenFlags } from '../carbon-token-flags.js';
import { GasConfig } from '../gas-config.js';
import { GovernanceContractMethods } from '../modules/governance-contract-methods.js';
import { ModuleId } from '../module-id.js';
import { MintPhantasmaNonFungibleArgs } from '../modules/mint-phantasma-non-fungible-args.js';
import { StandardMeta } from '../modules/standard-meta.js';
import { TokenContractMethods } from '../modules/token-contract-methods.js';
import { TokenHelper } from '../modules/token-helper.js';
import { TokenInfo } from '../modules/token-info.js';
import { SignedTxMsg } from '../signed-tx-msg.js';
import { TxMsg } from '../tx-msg.js';
import { TxMsgBurnFungible } from '../tx-msg-burn-fungible.js';
import { TxMsgBurnFungibleGasPayer } from '../tx-msg-burn-fungible-gas-payer.js';
import { TxMsgBurnNonFungible } from '../tx-msg-burn-non-fungible.js';
import { TxMsgBurnNonFungibleGasPayer } from '../tx-msg-burn-non-fungible-gas-payer.js';
import { TxMsgCall } from '../tx-msg-call.js';
import { TxMsgMintFungible } from '../tx-msg-mint-fungible.js';
import { TxMsgMintNonFungible } from '../tx-msg-mint-non-fungible.js';
import { TxMsgTransferFungible } from '../tx-msg-transfer-fungible.js';
import { TxMsgTransferFungibleGasPayer } from '../tx-msg-transfer-fungible-gas-payer.js';
import { TxMsgTransferNonFungibleMulti } from '../tx-msg-transfer-non-fungible-multi.js';
import { TxMsgTransferNonFungibleMultiGasPayer } from '../tx-msg-transfer-non-fungible-multi-gas-payer.js';
import { TxMsgTransferNonFungibleSingle } from '../tx-msg-transfer-non-fungible-single.js';
import { TxMsgTransferNonFungibleSingleGasPayer } from '../tx-msg-transfer-non-fungible-single-gas-payer.js';
import { VmDynamicStruct } from '../vm/vm-dynamic-struct.js';
import {
  estimateNativeFee,
  NativeFeeEstimate,
  NativeFeeKind,
  NativeFeeParams,
} from './native-fee-estimator.js';

/**
 * Facts about chain state and signing that a message does not carry but the fee depends on. Every
 * state fact defaults to the case that costs more, so an unspecified plan is an upper bound the
 * settlement can only undercut; the defaults themselves belong to {@link NativeFeeParams}, which
 * documents each one, and are not restated here so the two cannot drift apart.
 */
export interface FeePlanOptions extends Pick<
  NativeFeeParams,
  // Taken from NativeFeeParams rather than re-declared, so each fact keeps one definition, one
  // default and one doc comment. The facts the message itself carries - counts, sizes, token ids,
  // the NFT-address recipient, `nonFungible`, `pre_burn` - are deliberately absent: `planFees`
  // reads those out of the message, and a caller-supplied value could only contradict it.
  //
  // Every one of these is optional and most callers pass none. Roughly in order of how likely a
  // caller is to know the answer:
  //
  // an ordinary wallet may well know these:
  | 'recipientHoldsToken'
  | 'bigFungible'
  | 'tokenBurnedBefore'
  | 'supplyRowExists'
  // these need the token's schema or the series' metadata, so pass them only if you read them:
  | 'duplicatedSeries'
  | 'romHasMetaId'
  | 'seriesHasMetaId'
  // and these three size the allowance for a VM script, whose cost no formula can predict:
  | 'scriptUnitsAllowance'
  | 'scriptEventBytes'
  | 'scriptStorageQuanta'
> {
  /**
   * How many witnesses will sign a Call / Call_Multi / Trade / Phantasma message. Required for
   * those types and for them only: their witness set is chosen by the caller, nothing in the
   * message says how large it will be, and each witness adds 96 bytes the chain bills. Every other
   * type fixes its own witness set, so passing this for one of them is an error rather than a hint.
   * `PhantasmaAPI.sendTransaction` fills it in from the signers it was given.
   */
  witnessCount?: number;
}

/** A fee plan for one message: the estimate, what it was computed from, and how to apply it. */
export interface FeePlan extends NativeFeeEstimate {
  /**
   * The operation the message was recognised as, which is also what the bill was computed from.
   * Every kind but {@link NativeFeeKind.Script} is priced with the chain's own formula for that
   * operation; `Script` covers VM scripts and unmodelled calls, whose work depends on execution and
   * can only be budgeted (see `scriptUnitsAllowance` and its neighbours).
   *
   * A formula-priced bill is exact for the facts it was given and an upper bound for the ones it
   * had to assume: a state fact left unspecified is filled with its costlier default.
   */
  kind: NativeFeeKind;
  /** The signed size the plan was computed for - the bytes the block will carry. */
  envelopeBytes: number;
  /** A copy of `msg` with `maxGas` and `maxData` set to the plan. The input is left untouched. */
  apply(msg: TxMsg): TxMsg;
}

/**
 * Plans the gas offer and storage ceiling of a message from the message itself: its type and
 * contents decide the operation model, its signed size is computed with placeholder witnesses,
 * and the chain config supplies the prices. Pure - fetch the config with `PhantasmaAPI.fees` or
 * `getGasConfig` and pass it in.
 */
export function planFees(msg: TxMsg, config: GasConfig, options: FeePlanOptions = {}): FeePlan {
  // A witness-array message does not say how many signatures it will carry, and each one is 96
  // billed bytes. Assuming a single witness would under-offer every multi-party transaction by 96
  // bytes each and get it rejected, so the count is demanded rather than guessed - the same stance
  // `estimateNativeFee` takes on a missing envelope size.
  if (SignedTxMsg.requiredWitnesses(msg) === undefined && options.witnessCount === undefined) {
    throw new Error(
      `${TxTypes[msg.type]} transactions choose their own witnesses: pass witnessCount to plan one`
    );
  }
  const { kind, params } = describe(msg, options);
  const envelopeBytes = SignedTxMsg.envelopeBytes(msg, options.witnessCount);
  const estimate = estimateNativeFee(kind, config, { ...params, envelopeBytes });
  return {
    ...estimate,
    kind,
    envelopeBytes,
    apply(target: TxMsg): TxMsg {
      return new TxMsg(
        target.type,
        target.expiry,
        estimate.maxGas,
        estimate.maxData,
        target.gasFrom,
        target.payload,
        target.msg
      );
    },
  };
}

interface Description {
  kind: NativeFeeKind;
  params: NativeFeeParams;
}

function describe(msg: TxMsg, options: FeePlanOptions): Description {
  // Passed through undefined and all: the calculator owns every default, so no default is decided
  // in two places. Whether the recipient is an NFT-derived address is NOT here: the address form
  // decides it, and the message carries the address, so each branch below reads it out.
  const stateFacts: NativeFeeParams = {
    recipientHoldsToken: options.recipientHoldsToken,
    bigFungible: options.bigFungible,
    tokenBurnedBefore: options.tokenBurnedBefore,
    supplyRowExists: options.supplyRowExists,
    romHasMetaId: options.romHasMetaId,
  };

  switch (msg.type) {
    case TxTypes.TransferFungible:
    case TxTypes.TransferFungible_GasPayer: {
      const inner = msg.msg as TxMsgTransferFungible | TxMsgTransferFungibleGasPayer;
      return describeAs(NativeFeeKind.TransferFungible, {
        ...stateFacts,
        tokenId: inner.tokenId,
        toIsNftAddress: TokenHelper.isNftAddress(inner.to),
      });
    }
    case TxTypes.TransferNonFungible_Single:
    case TxTypes.TransferNonFungible_Single_GasPayer: {
      const inner = msg.msg as
        | TxMsgTransferNonFungibleSingle
        | TxMsgTransferNonFungibleSingleGasPayer;
      return describeAs(NativeFeeKind.TransferNonFungible, {
        ...stateFacts,
        tokenId: inner.tokenId,
        count: 1,
        toIsNftAddress: TokenHelper.isNftAddress(inner.to),
      });
    }
    case TxTypes.TransferNonFungible_Multi:
    case TxTypes.TransferNonFungible_Multi_GasPayer: {
      const inner = msg.msg as
        | TxMsgTransferNonFungibleMulti
        | TxMsgTransferNonFungibleMultiGasPayer;
      return describeAs(NativeFeeKind.TransferNonFungible, {
        ...stateFacts,
        tokenId: inner.tokenId,
        count: inner.instanceIds.length,
        toIsNftAddress: TokenHelper.isNftAddress(inner.to),
      });
    }
    case TxTypes.MintFungible: {
      const inner = msg.msg as TxMsgMintFungible;
      return describeAs(NativeFeeKind.MintFungible, {
        ...stateFacts,
        tokenId: inner.tokenId,
        toIsNftAddress: TokenHelper.isNftAddress(inner.to),
      });
    }
    case TxTypes.BurnFungible:
    case TxTypes.BurnFungible_GasPayer: {
      const inner = msg.msg as TxMsgBurnFungible | TxMsgBurnFungibleGasPayer;
      return describeAs(NativeFeeKind.BurnFungible, { ...stateFacts, tokenId: inner.tokenId });
    }
    case TxTypes.MintNonFungible: {
      const inner = msg.msg as TxMsgMintNonFungible;
      return describeAs(NativeFeeKind.MintNonFungible, {
        ...stateFacts,
        tokenId: inner.tokenId,
        romBytes: inner.rom.length,
        ramBytes: inner.ram.length,
        toIsNftAddress: TokenHelper.isNftAddress(inner.to),
      });
    }
    case TxTypes.BurnNonFungible:
    case TxTypes.BurnNonFungible_GasPayer: {
      const inner = msg.msg as TxMsgBurnNonFungible | TxMsgBurnNonFungibleGasPayer;
      // The stored ROM is chain state the message does not carry, so the deleted quanta are a lower
      // bound. That does not touch the offer: a burn deletes more than it creates, and only the
      // rows it creates are escrowed.
      return describeAs(NativeFeeKind.BurnNonFungible, {
        ...stateFacts,
        tokenId: inner.tokenId,
        count: 1,
      });
    }
    case TxTypes.Call:
      return describeCall(msg.msg as TxMsgCall, stateFacts, options);
    case TxTypes.Call_Multi:
    case TxTypes.Trade:
    case TxTypes.Phantasma:
      return scriptPlan(options);
    default:
      throw new Error(`Cannot plan fees for transaction type ${TxTypes[msg.type] ?? msg.type}`);
  }
}

function describeCall(
  call: TxMsgCall,
  stateFacts: NativeFeeParams,
  options: FeePlanOptions
): Description {
  if (call.moduleId === ModuleId.Token) {
    switch (call.methodId) {
      case TokenContractMethods.CreateToken: {
        const info = TokenInfo.read(new CarbonBinaryReader(call.args));
        const metadata = info.metadata.length
          ? VmDynamicStruct.read(new CarbonBinaryReader(info.metadata))
          : undefined;
        // The token-info row is the Call arguments as submitted: the chain stores the TokenInfo it
        // was given, metadata included, and measured bills confirm the row equals the arguments.
        // Which extra rows the creation writes is decided by the metadata, which is a named struct
        // the plan can read.
        return describeAs(NativeFeeKind.CreateToken, {
          symbolLength: info.symbol.data.length,
          tokenInfoBytes: call.args.length,
          nonFungible: (info.flags & CarbonTokenFlags.NonFungible) !== 0,
          hasPreBurn: metadata?.getValue(StandardMeta.Token.pre_burn) !== undefined,
          hasInflationSchedule:
            metadata?.getValue(StandardMeta.Token.inflation_period) !== undefined,
        });
      }
      case TokenContractMethods.CreateTokenSeries:
        // The arguments are the u64 token id followed by the SeriesInfo, which becomes the row.
        return describeAs(NativeFeeKind.CreateTokenSeries, {
          seriesInfoBytes: Math.max(call.args.length - 8, 0),
          seriesHasMetaId: options.seriesHasMetaId,
        });
      case TokenContractMethods.MintPhantasmaNonFungible: {
        const args = MintPhantasmaNonFungibleArgs.read(new CarbonBinaryReader(call.args));
        // Each instance names the series it is minted into, so the number of distinct series a
        // duplicated mint touches - which is what the chain's per-series supply read costs follow -
        // is readable from the call and never has to be supplied by the caller.
        const seriesIds = new Set(args.tokens.map((t) => t.phantasmaSeriesId.toBigInt()));
        return describeAs(NativeFeeKind.MintPhantasmaNonFungible, {
          ...stateFacts,
          tokenId: args.tokenId,
          count: args.tokens.length,
          romBytes: args.tokens.map((t) => t.rom.length),
          ramBytes: args.tokens.map((t) => t.ram.length),
          duplicatedSeries: options.duplicatedSeries,
          distinctSeriesCount: seriesIds.size,
          toIsNftAddress: TokenHelper.isNftAddress(args.address),
        });
      }
      default:
        return scriptPlan(options);
    }
  }
  if (
    call.moduleId === ModuleId.Governance &&
    call.methodId === GovernanceContractMethods.RegisterName
  ) {
    // The arguments are the 32-byte address followed by the name as a SmallString.
    const reader = new CarbonBinaryReader(call.args);
    reader.read32();
    const name = SmallString.read(reader);
    return describeAs(NativeFeeKind.RegisterName, { nameLength: name.data.length });
  }
  return scriptPlan(options);
}

function describeAs(kind: NativeFeeKind, params: NativeFeeParams): Description {
  return { kind, params };
}

function scriptPlan(options: FeePlanOptions): Description {
  return {
    kind: NativeFeeKind.Script,
    params: {
      scriptUnitsAllowance: options.scriptUnitsAllowance,
      scriptEventBytes: options.scriptEventBytes,
      scriptStorageQuanta: options.scriptStorageQuanta,
    },
  };
}
