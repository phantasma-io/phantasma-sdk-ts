import { CarbonBlobLike } from '../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../carbon-serialization.js';
import { Bytes32 } from '../bytes32.js';
import { Bytes64 } from '../bytes64.js';
import { TxTypes } from '../tx-types.js';
import { Witness } from '../witness.js';
import { TxMsg } from './tx-msg.js';
import { TxMsgBurnFungibleGasPayer } from './tx-msg-burn-fungible-gas-payer.js';
import { TxMsgBurnNonFungibleGasPayer } from './tx-msg-burn-non-fungible-gas-payer.js';
import { TxMsgTransferFungibleGasPayer } from './tx-msg-transfer-fungible-gas-payer.js';
import { TxMsgTransferNonFungibleMultiGasPayer } from './tx-msg-transfer-non-fungible-multi-gas-payer.js';
import { TxMsgTransferNonFungibleSingleGasPayer } from './tx-msg-transfer-non-fungible-single-gas-payer.js';

/**
 * A transaction message with its witness signatures, in the envelope layout the chain reads.
 *
 * - A native single-witness type appends one bare 64-byte signature by `gasFrom`.
 * - A `_GasPayer` type appends two bare signatures. The gas payer (`gasFrom`) comes first and the
 *   token owner second. The owner is the message's `from`, and the node resolves that address from
 *   the message itself.
 * - Call, Call_Multi, Trade and Phantasma append a length-prefixed array of witnesses. Each entry is
 *   an address and a signature, and the caller composes the array.
 * - Phantasma_Raw carries no witnesses.
 */
export class SignedTxMsg implements CarbonBlobLike {
  constructor(
    public msg: TxMsg = new TxMsg(),
    public witnesses: Witness[] = []
  ) {}

  /**
   * Returns the addresses whose signatures the envelope of `msg` must carry, in envelope order.
   * This works for the types whose witness set the message fixes. It returns `undefined` for the
   * witness-array types, which are Call, Call_Multi, Trade and Phantasma. The caller chooses the
   * witnesses of those four.
   */
  static requiredWitnesses(msg: TxMsg): Bytes32[] | undefined {
    switch (msg.type) {
      case TxTypes.TransferFungible:
      case TxTypes.TransferNonFungible_Single:
      case TxTypes.TransferNonFungible_Multi:
      case TxTypes.MintFungible:
      case TxTypes.BurnFungible:
      case TxTypes.MintNonFungible:
      case TxTypes.BurnNonFungible:
        return [msg.gasFrom];
      case TxTypes.TransferFungible_GasPayer:
      case TxTypes.TransferNonFungible_Single_GasPayer:
      case TxTypes.TransferNonFungible_Multi_GasPayer:
      case TxTypes.BurnFungible_GasPayer:
      case TxTypes.BurnNonFungible_GasPayer:
        return [msg.gasFrom, gasPayerOwner(msg)];
      case TxTypes.Phantasma_Raw:
        return [];
      default:
        return undefined;
    }
  }

  /**
   * Returns the size in bytes of `msg` once signed. That is the envelope the block carries and gas
   * model v2 bills. No key is needed. Signatures are fixed-width, so zero-filled placeholder
   * witnesses serialize to exactly the signed length.
   *
   * The witness set is the one the message requires. For the witness-array types, which are Call,
   * Call_Multi, Trade and Phantasma, pass how many witnesses will sign.
   */
  static envelopeBytes(msg: TxMsg, witnessCount?: number): number {
    const required = SignedTxMsg.requiredWitnesses(msg);
    if (required !== undefined && witnessCount !== undefined && witnessCount !== required.length) {
      throw new Error(
        `${TxTypes[msg.type]} carries ${required.length} witness(es), not ${witnessCount}`
      );
    }
    // The gas payer is always one of the witnesses of a witness-array message, so the placeholder
    // set names it. Addresses are fixed-width, so this does not change the size it measures. It
    // keeps the sizing path honest about the envelope it predicts. It also lets `write` below
    // enforce the payer's presence without rejecting its own placeholders.
    const addresses = required ?? openWitnessPlaceholders(msg, witnessCount ?? 1);
    const placeholders = addresses.map((address) => new Witness(address, Bytes64.Empty));
    const w = new CarbonBinaryWriter();
    new SignedTxMsg(msg, placeholders).write(w);
    return w.toUint8Array().length;
  }

  write(w: CarbonBinaryWriter): void {
    this.msg.write(w);
    switch (this.msg.type) {
      case TxTypes.TransferFungible:
      case TxTypes.TransferNonFungible_Single:
      case TxTypes.TransferNonFungible_Multi:
      case TxTypes.MintFungible:
      case TxTypes.BurnFungible:
      case TxTypes.MintNonFungible:
      case TxTypes.BurnNonFungible: {
        if (this.witnesses.length !== 1) throw new Error('Expected 1 witness');
        const w0 = this.witnesses[0];
        if (!w0.address.equals(this.msg.gasFrom)) throw new Error('Witness address mismatch');
        w.write64(w0.signature.bytes);
        break;
      }

      case TxTypes.TransferFungible_GasPayer:
      case TxTypes.TransferNonFungible_Single_GasPayer:
      case TxTypes.TransferNonFungible_Multi_GasPayer:
      case TxTypes.BurnFungible_GasPayer:
      case TxTypes.BurnNonFungible_GasPayer: {
        if (this.witnesses.length !== 2) throw new Error('Expected 2 witnesses');
        const w0 = this.witnesses[0];
        const w1 = this.witnesses[1];
        if (!w0.address.equals(this.msg.gasFrom)) throw new Error('Gas witness address mismatch');
        if (!w1.address.equals(gasPayerOwner(this.msg))) {
          throw new Error('From witness address mismatch');
        }
        w.write64(w0.signature.bytes);
        w.write64(w1.signature.bytes);
        break;
      }

      case TxTypes.Call:
      case TxTypes.Call_Multi:
      case TxTypes.Trade:
      case TxTypes.Phantasma: {
        // The witness set of these types is the caller's to choose, with one rule the node
        // enforces: the account paying the gas must be among the signers, or the transaction is
        // rejected as "not signed by gas payer". Catching it here names the mistake instead of
        // spending a round trip on it.
        if (!this.witnesses.some((witness) => witness.address.equals(this.msg.gasFrom))) {
          throw new Error('The gas payer must be one of the witnesses');
        }
        w.writeArrayBlob(this.witnesses);
        break;
      }

      case TxTypes.Phantasma_Raw: {
        if (this.witnesses.length !== 0) throw new Error('No witnesses expected');
        break;
      }

      default:
        throw new Error('Unsupported transaction type');
    }
  }

  read(r: CarbonBinaryReader) {
    this.msg = TxMsg.read(r);
    this.witnesses = [];
    switch (this.msg.type) {
      case TxTypes.TransferFungible:
      case TxTypes.TransferNonFungible_Single:
      case TxTypes.TransferNonFungible_Multi:
      case TxTypes.MintFungible:
      case TxTypes.BurnFungible:
      case TxTypes.MintNonFungible:
      case TxTypes.BurnNonFungible: {
        const sig = Bytes64.read(r);
        this.witnesses = [new Witness(this.msg.gasFrom, sig)];
        break;
      }

      case TxTypes.TransferFungible_GasPayer:
      case TxTypes.TransferNonFungible_Single_GasPayer:
      case TxTypes.TransferNonFungible_Multi_GasPayer:
      case TxTypes.BurnFungible_GasPayer:
      case TxTypes.BurnNonFungible_GasPayer: {
        const gasSignature = Bytes64.read(r);
        const fromSignature = Bytes64.read(r);
        this.witnesses = [
          new Witness(this.msg.gasFrom, gasSignature),
          new Witness(gasPayerOwner(this.msg), fromSignature),
        ];
        break;
      }

      case TxTypes.Call:
      case TxTypes.Call_Multi:
      case TxTypes.Trade:
      case TxTypes.Phantasma: {
        this.witnesses = r.readArrayBlob(Witness);
        break;
      }

      case TxTypes.Phantasma_Raw:
        this.witnesses = [];
        break;

      default:
        throw new Error('Unsupported transaction type');
    }
  }

  static read(r: CarbonBinaryReader): SignedTxMsg {
    const v = new SignedTxMsg();
    v.read(r);
    return v;
  }
}

// Placeholder addresses for sizing a witness-array envelope: the gas payer, which the node requires
// to be a witness, then anonymous fillers for the rest. Only the count affects the size.
function openWitnessPlaceholders(msg: TxMsg, witnessCount: number): Bytes32[] {
  if (!Number.isSafeInteger(witnessCount) || witnessCount < 1) {
    throw new Error(`${TxTypes[msg.type]} needs at least one witness, not ${witnessCount}`);
  }
  return [msg.gasFrom, ...new Array<Bytes32>(witnessCount - 1).fill(Bytes32.Empty)];
}

// The token owner of a gas-payer message: the account whose tokens move, as opposed to `gasFrom`,
// which only pays. Every gas-payer message type carries it as `from`.
function gasPayerOwner(msg: TxMsg): Bytes32 {
  switch (msg.type) {
    case TxTypes.TransferFungible_GasPayer:
      return (msg.msg as TxMsgTransferFungibleGasPayer).from;
    case TxTypes.TransferNonFungible_Single_GasPayer:
      return (msg.msg as TxMsgTransferNonFungibleSingleGasPayer).from;
    case TxTypes.TransferNonFungible_Multi_GasPayer:
      return (msg.msg as TxMsgTransferNonFungibleMultiGasPayer).from;
    case TxTypes.BurnFungible_GasPayer:
      return (msg.msg as TxMsgBurnFungibleGasPayer).from;
    case TxTypes.BurnNonFungible_GasPayer:
      return (msg.msg as TxMsgBurnNonFungibleGasPayer).from;
    default:
      throw new Error('Not a gas-payer transaction type');
  }
}
