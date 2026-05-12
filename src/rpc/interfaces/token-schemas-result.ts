import type { VmStructSchemaResult } from './vm-struct-schema-result.js';

export interface TokenSchemasResult {
  seriesMetadata: VmStructSchemaResult;
  rom: VmStructSchemaResult;
  ram: VmStructSchemaResult;
}
