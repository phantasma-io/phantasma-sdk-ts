import { CarbonBlobLike } from '../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../carbon-serialization.js';
import { Bytes32 } from '../bytes32.js';
import { IntX } from '../int-x.js';

export class TxMsgBurnFungibleGasPayer implements CarbonBlobLike {
  tokenId: bigint; // uint64
  from: Bytes32;
  amount: IntX;

  constructor(init?: Partial<TxMsgBurnFungibleGasPayer>) {
    this.tokenId = 0n;
    this.from = new Bytes32();
    this.amount = IntX.fromI64(0);
    Object.assign(this, init);
  }

  write(w: CarbonBinaryWriter): void {
    w.write8u(this.tokenId);
    w.write32(this.from);
    this.amount.write(w);
  }

  read(r: CarbonBinaryReader): void {
    this.tokenId = r.read8u();
    this.from = Bytes32.read(r);
    this.amount = IntX.read(r);
  }

  static read(r: CarbonBinaryReader): TxMsgBurnFungibleGasPayer {
    const v = new TxMsgBurnFungibleGasPayer();
    v.read(r);
    return v;
  }
}
