import { CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { Ed25519Signature } from '../../../ed25519-signature.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { Bytes64 } from '../../bytes64.js';
import { CarbonBlob } from '../../carbon-blob.js';
import { TxTypes } from '../../tx-types.js';
import { Witness } from '../../witness.js';
import { SignedTxMsg } from '../signed-tx-msg.js';
import { TxMsg } from '../tx-msg.js';
import { TxSigner } from './tx-signer.js';

/** One envelope witness slot and the signer that fills it. */
interface WitnessSlot<S extends TxSigner> {
  address: Bytes32;
  signer: S;
}

export class TxMsgSigner {
  /** Signs a single-witness message with in-memory keys. */
  static sign(msg: TxMsg, key: PhantasmaKeys): SignedTxMsg {
    assertPlanned(msg);
    const sig = new Bytes64(Ed25519Signature.generate(key, CarbonBlob.serialize(msg)).bytes);

    return new SignedTxMsg(msg, [new Witness(new Bytes32(key.publicKey), sig)]);
  }

  static signAndSerialize(msg: TxMsg, key: PhantasmaKeys): Uint8Array {
    return serialize(this.sign(msg, key));
  }

  /**
   * Signs a message with in-memory keys, one per witness the message needs. Works for every
   * transaction type: a gas-payer transfer takes the gas payer's and the owner's keys in any order,
   * a Call takes the keys of every witness the contract will check.
   */
  static signWithKeys(msg: TxMsg, keys: PhantasmaKeys[]): SignedTxMsg {
    assertPlanned(msg);
    const message = CarbonBlob.serialize(msg);
    const witnesses = witnessSlots(msg, keys).map(
      (slot) => new Witness(slot.address, new Bytes64(slot.signer.sign(message).bytes))
    );
    return new SignedTxMsg(msg, witnesses);
  }

  static signAndSerializeWithKeys(msg: TxMsg, keys: PhantasmaKeys[]): Uint8Array {
    return serialize(this.signWithKeys(msg, keys));
  }

  /**
   * Signs a message with any {@link TxSigner}s - keys, hardware wallets, remote services - one per
   * witness. Every signer signs the same serialized message; a signer that must witness twice (the
   * same account paying gas and owning the tokens) is asked once and its signature reused.
   */
  static async signWith(msg: TxMsg, signers: TxSigner[]): Promise<SignedTxMsg> {
    assertPlanned(msg);
    const message = CarbonBlob.serialize(msg);
    const signatures = new Map<string, Bytes64>();
    const witnesses: Witness[] = [];
    for (const slot of witnessSlots(msg, signers)) {
      const key = slot.address.toHex();
      let signature = signatures.get(key);
      if (!signature) {
        signature = new Bytes64((await slot.signer.sign(message)).bytes);
        signatures.set(key, signature);
      }
      witnesses.push(new Witness(slot.address, signature));
    }
    return new SignedTxMsg(msg, witnesses);
  }

  static async signAndSerializeWith(msg: TxMsg, signers: TxSigner[]): Promise<Uint8Array> {
    return serialize(await this.signWith(msg, signers));
  }
}

// A zero gas offer is never admissible, so it marks a message that was built but not planned;
// signing it would only produce a rejection. Plan with `PhantasmaAPI.fees.plan` / `planFees`, or
// set `maxGas` deliberately.
function assertPlanned(msg: TxMsg): void {
  if (msg.maxGas === 0n) {
    throw new Error('Transaction has no gas offer: plan its fees or set maxGas before signing');
  }
}

function serialize(signed: SignedTxMsg): Uint8Array {
  const w = new CarbonBinaryWriter();
  signed.write(w);
  return w.toUint8Array();
}

/**
 * Pairs every witness slot of the envelope with the signer that owns its address. For the types
 * whose witness set the node fixes (native transfers, mints, burns and their gas-payer variants)
 * the slots come in envelope order regardless of how the signers were passed, and the signer set
 * must match the required addresses exactly - a missing owner key or a stray extra key is a
 * caller mistake the node would reject later at a cost. For the witness-array types the caller's
 * order is the envelope order.
 */
function witnessSlots<S extends TxSigner>(msg: TxMsg, signers: S[]): WitnessSlot<S>[] {
  const required = SignedTxMsg.requiredWitnesses(msg);
  if (required === undefined) {
    return signers.map((signer) => ({ address: new Bytes32(signer.publicKey), signer }));
  }
  if (msg.type === TxTypes.Phantasma_Raw) {
    if (signers.length !== 0) throw new Error('Phantasma_Raw transactions carry no witnesses');
    return [];
  }

  const byAddress = new Map<string, S>();
  for (const signer of signers) {
    byAddress.set(new Bytes32(signer.publicKey).toHex(), signer);
  }
  const slots = required.map((address) => {
    const signer = byAddress.get(address.toHex());
    if (!signer) throw new Error(`No signer for witness ${address.toHex()}`);
    return { address, signer };
  });
  const requiredKeys = new Set(required.map((address) => address.toHex()));
  for (const key of byAddress.keys()) {
    if (!requiredKeys.has(key)) {
      throw new Error(`Signer ${key} is not a witness of this transaction`);
    }
  }
  return slots;
}
