import { CarbonBlobLike } from '../../../../interfaces/carbon/carbon-blob-like.js';
import type { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { Bytes32 } from '../../bytes32.js';

export class PhantasmaNftMintResult implements CarbonBlobLike {
  phantasmaNftId: Bytes32;
  carbonInstanceId: bigint;

  constructor(init?: Partial<PhantasmaNftMintResult>) {
    this.phantasmaNftId = new Bytes32();
    this.carbonInstanceId = 0n;
    Object.assign(this, init);
  }

  write(w: CarbonBinaryWriter): void {
    this.phantasmaNftId.write(w);
    w.write8u(this.carbonInstanceId);
  }

  read(r: CarbonBinaryReader): void {
    this.phantasmaNftId = Bytes32.read(r);
    this.carbonInstanceId = r.read8u();
  }

  static read(r: CarbonBinaryReader): PhantasmaNftMintResult {
    const v = new PhantasmaNftMintResult();
    v.read(r);
    return v;
  }
}
