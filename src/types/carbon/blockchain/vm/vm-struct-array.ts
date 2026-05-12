import { VmStructSchema } from './vm-struct-schema.js';
import { VmDynamicStruct } from './vm-dynamic-struct.js';

export class VmStructArray {
  schema: VmStructSchema = new VmStructSchema();
  structs: VmDynamicStruct[] = [];
}
