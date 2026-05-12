import { CarbonBlobLike } from '../../../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { SmallString } from '../../small-string.js';
import { VmType } from './vm-type.js';
import { VmVariableSchema } from './vm-variable-schema.js';

export class VmNamedVariableSchema implements CarbonBlobLike {
  name!: SmallString;
  schema!: VmVariableSchema;

  constructor(name?: SmallString | string, schema?: VmVariableSchema | VmType) {
    if (name) {
      if (name instanceof SmallString) {
        this.name = name;
      } else {
        this.name = new SmallString(name);
      }
    }
    if (schema) {
      if (schema instanceof VmVariableSchema) {
        this.schema = schema;
      } else {
        this.schema = new VmVariableSchema(schema);
      }
    }
  }

  write(w: CarbonBinaryWriter): void {
    this.name.write(w);
    this.schema.write(w);
  }
  read(r: CarbonBinaryReader): void {
    this.name = r.readBlob(SmallString);
    this.schema = r.readBlob(VmVariableSchema);
  }

  static read(r: CarbonBinaryReader): VmNamedVariableSchema {
    const v = new VmNamedVariableSchema();
    v.read(r);
    return v;
  }
}
