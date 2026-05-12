import { CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { Ed25519Signature } from '../../../ed25519-signature.js';
import { PhantasmaKeys } from '../../../phantasma-keys.js';
import { Bytes32 } from '../../bytes32.js';
import { Bytes64 } from '../../bytes64.js';
import { CarbonBlob } from '../../carbon-blob.js';
import { Witness } from '../../witness.js';
import { SignedTxMsg } from '../signed-tx-msg.js';
import { TxMsg } from '../tx-msg.js';

export class TxMsgSigner {
  static sign(msg: TxMsg, key: PhantasmaKeys): SignedTxMsg {
    const sig = new Bytes64(Ed25519Signature.generate(key, CarbonBlob.Serialize(msg)).Bytes);

    return new SignedTxMsg(msg, [new Witness(new Bytes32(key.publicKey), sig)]);
  }

  static signAndSerialize(msg: TxMsg, key: PhantasmaKeys): Uint8Array {
    const signed = this.sign(msg, key);

    const w = new CarbonBinaryWriter();
    signed.write(w);

    return w.toUint8Array();
  }
}
