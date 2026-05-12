import type { VmStructSchemaResult } from './vm-struct-schema-result.js';

export interface VmVariableSchemaResult {
  type: string;
  schema?: VmStructSchemaResult;
}
