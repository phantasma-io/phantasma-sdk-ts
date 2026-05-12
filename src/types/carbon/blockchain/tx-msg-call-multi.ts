import { CarbonBlobLike } from '../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../carbon-serialization.js';
import { TxMsgCall } from './tx-msg-call.js';

export class TxMsgCallMulti implements CarbonBlobLike {
  constructor(public calls: TxMsgCall[] = []) {}

  write(w: CarbonBinaryWriter): void {
    w.writeArrayBlob(this.calls);
  }

  read(r: CarbonBinaryReader): void {
    this.calls = r.readArrayBlob(TxMsgCall);
  }

  static read(r: CarbonBinaryReader): TxMsgCallMulti {
    const v = new TxMsgCallMulti();
    v.read(r);
    return v;
  }
}
