import { CarbonBlobLike } from '../../interfaces/Carbon/ICarbonBlob.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../CarbonSerialization.js';
import { Bytes32 } from './Bytes32.js';
import { Bytes64 } from './Bytes64.js';

export class Witness implements CarbonBlobLike {
  constructor(
    public address: Bytes32 = Bytes32.Empty,
    public signature: Bytes64 = Bytes64.Empty
  ) {}
  write(w: CarbonBinaryWriter): void {
    this.address.write(w);
    this.signature.write(w);
  }
  read(r: CarbonBinaryReader): void {
    this.address = Bytes32.read(r);
    this.signature = Bytes64.read(r);
  }
  static read(r: CarbonBinaryReader): Witness {
    const v = new Witness();
    v.read(r);
    return v;
  }
}
