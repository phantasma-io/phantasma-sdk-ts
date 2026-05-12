import { CarbonBlobLike } from '../../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { Bytes32 } from '../../bytes32.js';
import { IntX } from '../../int-x.js';

export enum ListingType {
  FixedPrice = 0,
}

export class TokenListing implements CarbonBlobLike {
  constructor(
    public type: ListingType = ListingType.FixedPrice,
    public seller: Bytes32 = new Bytes32(),
    public quoteTokenId: bigint = 0n,
    public price: IntX = new IntX(),
    public startDate: bigint = 0n,
    public endDate: bigint = 0n
  ) {}

  write(w: CarbonBinaryWriter): void {
    w.write1(this.type);
    this.seller.write(w);
    w.write8u(this.quoteTokenId);
    this.price.write(w);
    w.write8(this.startDate);
    w.write8(this.endDate);
  }

  read(r: CarbonBinaryReader): void {
    this.type = r.read1() as ListingType;
    this.seller = Bytes32.read(r);
    this.quoteTokenId = r.read8u();
    this.price = r.readBlob(IntX);
    this.startDate = r.read8();
    this.endDate = r.read8();
  }

  static read(r: CarbonBinaryReader): TokenListing {
    const v = new TokenListing();
    v.read(r);
    return v;
  }
}
