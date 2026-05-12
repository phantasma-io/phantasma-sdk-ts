import { CarbonBlobLike } from '../../../../interfaces/carbon/carbon-blob-like.js';
import type { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { VmStructSchema } from '../vm/vm-struct-schema.js';

export class TokenSchemas implements CarbonBlobLike {
  seriesMetadata: VmStructSchema;
  rom: VmStructSchema;
  ram: VmStructSchema;

  constructor(init?: Partial<TokenSchemas>) {
    this.seriesMetadata = new VmStructSchema();
    this.rom = new VmStructSchema();
    this.ram = new VmStructSchema();
    Object.assign(this, init);
  }

  write(w: CarbonBinaryWriter): void {
    this.seriesMetadata.write(w);
    this.rom.write(w);
    this.ram.write(w);
  }

  read(r: CarbonBinaryReader): void {
    this.seriesMetadata = r.readBlob(VmStructSchema);
    this.rom = r.readBlob(VmStructSchema);
    this.ram = r.readBlob(VmStructSchema);
  }

  static read(r: CarbonBinaryReader): TokenSchemas {
    const v = new TokenSchemas();
    v.read(r);
    return v;
  }
}
