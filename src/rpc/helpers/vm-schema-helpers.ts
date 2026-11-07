import {
  VmNamedVariableSchema,
  VmStructSchema,
  VmType,
  vmTypeFromString,
  VmVariableSchema,
} from '../../types/index.js';
import { VmStructSchemaResult, VmVariableSchemaResult } from '../interfaces/index.js';

/**
 * Returns the struct schema that an RPC result describes, such as one of a token's schemas from
 * `getToken`. The RPC also returns the struct's flags and, for a Struct or Array_Struct field, the
 * schema of that struct. Both are kept, because data written by the schema needs them.
 */
export function vmStructSchemaFromRpcResult(r: VmStructSchemaResult): VmStructSchema {
  const schema = new VmStructSchema();
  schema.fields = [];
  if (typeof r?.flags === 'number') schema.flags = r.flags;
  const fields = r?.fields ?? [];
  for (const f of fields) {
    const name = String(f?.name ?? '');
    if (!name) continue;
    // A field without a type is skipped, because vmVariableSchemaFromRpcResult would throw for it.
    const t = f.schema?.type;
    if (typeof t !== 'number' && typeof t !== 'string') continue;
    schema.fields.push(new VmNamedVariableSchema(name, vmVariableSchemaFromRpcResult(f.schema)));
  }
  return schema;
}

export function vmVariableSchemaFromRpcResult(v: VmVariableSchemaResult): VmVariableSchema {
  const typeVal = v?.type;
  let vmType: VmType;
  if (typeof typeVal === 'number') vmType = typeVal as VmType;
  else if (typeof typeVal === 'string') vmType = vmTypeFromString(typeVal);
  else throw new Error('Invalid VmVariableSchemaResult.type');

  const vs = new VmVariableSchema(vmType);
  // If nested struct schema is present, convert recursively
  if (v.schema) {
    vs.structure = vmStructSchemaFromRpcResult(v.schema);
  }
  return vs;
}
