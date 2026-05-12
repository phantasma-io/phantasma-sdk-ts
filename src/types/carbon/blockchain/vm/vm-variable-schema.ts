import { CarbonBlobLike } from '../../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { VmType } from './vm-type.js';
import { VmStructSchema } from './vm-struct-schema.js';

export class VmVariableSchema implements CarbonBlobLike {
  type!: VmType;
  structure!: VmStructSchema;

  constructor(type?: VmType, structure?: VmStructSchema) {
    if (type) this.type = type;
    if (structure) this.structure = structure;
  }

  write(w: CarbonBinaryWriter): void {
    w.write1(this.type & 0xff);
    if (this.type === VmType.Struct || this.type === (VmType.Struct | VmType.Array)) {
      this.structure.write(w);
    }
  }
  read(r: CarbonBinaryReader): void {
    this.type = r.read1() as VmType;
    if (this.type === VmType.Struct || this.type === (VmType.Struct | VmType.Array)) {
      this.structure = r.readBlob(VmStructSchema);
    }
  }

  static read(r: CarbonBinaryReader): VmVariableSchema {
    const v = new VmVariableSchema();
    v.read(r);
    return v;
  }
}
