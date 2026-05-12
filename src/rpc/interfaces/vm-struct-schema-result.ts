import type { VmNamedVariableSchemaResult } from './vm-named-variable-schema-result.js';

export interface VmStructSchemaResult {
  fields: VmNamedVariableSchemaResult[];
  flags: number;
}
