import { CarbonBlobLike } from '../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../carbon-serialization.js';

export class TxMsgPhantasmaRaw implements CarbonBlobLike {
  transaction: Uint8Array;

  constructor(transaction: Uint8Array = new Uint8Array()) {
    this.transaction = transaction;
  }

  write(w: CarbonBinaryWriter): void {
    w.writeArray(this.transaction);
  }

  read(r: CarbonBinaryReader): void {
    this.transaction = r.readArray();
  }

  static read(r: CarbonBinaryReader): TxMsgPhantasmaRaw {
    const v = new TxMsgPhantasmaRaw();
    v.read(r);
    return v;
  }
}
