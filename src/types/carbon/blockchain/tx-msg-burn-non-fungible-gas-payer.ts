import { CarbonBlobLike } from '../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../carbon-serialization.js';
import { Bytes32 } from '../bytes32.js';

export class TxMsgBurnNonFungibleGasPayer implements CarbonBlobLike {
  tokenId: bigint; // uint64
  from: Bytes32;
  instanceId: bigint; // uint64

  constructor(init?: Partial<TxMsgBurnNonFungibleGasPayer>) {
    this.tokenId = 0n;
    this.from = new Bytes32();
    this.instanceId = 0n;
    Object.assign(this, init);
  }

  write(w: CarbonBinaryWriter): void {
    w.write8u(this.tokenId);
    w.write32(this.from);
    w.write8u(this.instanceId);
  }

  read(r: CarbonBinaryReader): void {
    this.tokenId = r.read8u();
    this.from = Bytes32.read(r);
    this.instanceId = r.read8u();
  }

  static read(r: CarbonBinaryReader): TxMsgBurnNonFungibleGasPayer {
    const v = new TxMsgBurnNonFungibleGasPayer();
    v.read(r);
    return v;
  }
}
