import { CarbonBlobLike } from '../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../carbon-serialization.js';
import { Bytes32 } from './bytes32.js';
import { Bytes64 } from './bytes64.js';

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
