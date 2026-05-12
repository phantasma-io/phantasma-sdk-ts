import { CarbonBlobLike } from '../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../carbon-serialization.js';

type Ctor<T> = new () => T;

export class CarbonBlob {
  static fromReader<T extends CarbonBlobLike>(ctor: Ctor<T>, r: CarbonBinaryReader): T {
    const t = new ctor();
    t.read(r);
    return t;
  }

  /** @deprecated Use `fromReader` instead. This alias will be removed in v1.0. */
  static New<T extends CarbonBlobLike>(ctor: Ctor<T>, r: CarbonBinaryReader): T {
    return this.fromReader(ctor, r);
  }

  static fromBytes<T extends CarbonBlobLike>(ctor: Ctor<T>, bytes: Uint8Array, offset: number): T {
    return CarbonBlob.fromBytesChecked(ctor, bytes, false, offset);
  }

  /** @deprecated Use `fromBytes` instead. This alias will be removed in v1.0. */
  static NewFromBytes<T extends CarbonBlobLike>(
    ctor: Ctor<T>,
    bytes: Uint8Array,
    offset: number
  ): T {
    return this.fromBytes(ctor, bytes, offset);
  }

  static fromBytesChecked<T extends CarbonBlobLike>(
    ctor: Ctor<T>,
    bytes: Uint8Array,
    allowTrailingBytes: boolean = false,
    offset: number = 0
  ): T {
    const view = offset > 0 ? bytes.subarray(offset) : bytes;
    const r = new CarbonBinaryReader(view);
    const t = CarbonBlob.fromReader(ctor, r);

    if (!allowTrailingBytes) {
      const rem = r.readRemaining();
      if (rem && rem.length !== 0) {
        throw new Error('unexpected trailing bytes');
      }
    }
    return t;
  }

  /** @deprecated Use `fromBytesChecked` instead. This alias will be removed in v1.0. */
  static NewFromBytesEx<T extends CarbonBlobLike>(
    ctor: Ctor<T>,
    bytes: Uint8Array,
    allowTrailingBytes: boolean = false,
    offset: number = 0
  ): T {
    return this.fromBytesChecked(ctor, bytes, allowTrailingBytes, offset);
  }

  static serialize<T extends CarbonBlobLike>(carbonBlob: T): Uint8Array {
    const w = new CarbonBinaryWriter();
    carbonBlob.write(w);
    return w.toUint8Array();
  }

  /** @deprecated Use `serialize` instead. This alias will be removed in v1.0. */
  static Serialize<T extends CarbonBlobLike>(carbonBlob: T): Uint8Array {
    return this.serialize(carbonBlob);
  }
}
