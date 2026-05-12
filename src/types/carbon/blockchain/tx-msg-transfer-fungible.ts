import { CarbonBlobLike } from '../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../carbon-serialization.js';
import { Bytes32 } from '../bytes32.js';

export class TxMsgTransferFungible implements CarbonBlobLike {
  constructor(
    public to: Bytes32 = Bytes32.Empty,
    public tokenId: bigint = 0n,
    public amount: bigint = 0n
  ) {}
  write(w: CarbonBinaryWriter): void {
    this.to.write(w);
    w.write8u(this.tokenId);
    w.write8u(this.amount);
  }
  read(r: CarbonBinaryReader): void {
    this.to = Bytes32.read(r);
    this.tokenId = r.read8u();
    this.amount = r.read8u();
  }

  static read(r: CarbonBinaryReader): TxMsgTransferFungible {
    const v = new TxMsgTransferFungible();
    v.read(r);
    return v;
  }
}
