import { vmStructSchemaFromRpcResult } from '../../src/rpc/helpers/vm-schema-helpers';
import type { VmStructSchemaResult } from '../../src/rpc/interfaces';
import { CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import {
  VmNamedVariableSchema,
  VmStructSchema,
  VmType,
  VmVariableSchema,
} from '../../src/types/carbon/blockchain/vm';
import { bytesToHex } from '../../src/utils/hex';

const serialize = (schema: VmStructSchema): string => {
  const w = new CarbonBinaryWriter();
  schema.write(w);
  return bytesToHex(w.toUint8Array());
};

// The shape in which getToken returns a token's schemas: every field with its type name, a Struct or
// Array_Struct field with the schema of its struct, and every struct with its flags.
describe('vmStructSchemaFromRpcResult', () => {
  it('keeps the schema of a Struct and of an Array_Struct field', () => {
    const rom: VmStructSchemaResult = {
      fields: [
        { name: 'name', schema: { type: 'String' } },
        {
          name: 'stats',
          schema: {
            type: 'Struct',
            schema: {
              fields: [
                { name: 'hp', schema: { type: 'Int32' } },
                { name: 'tag', schema: { type: 'String' } },
              ],
              flags: 0,
            },
          },
        },
        {
          name: 'items',
          schema: {
            type: 'Array_Struct',
            schema: { fields: [{ name: 'id', schema: { type: 'Int64' } }], flags: 0 },
          },
        },
      ],
      flags: 0,
    };

    const expected = new VmStructSchema([
      new VmNamedVariableSchema('name', VmType.String),
      new VmNamedVariableSchema(
        'stats',
        new VmVariableSchema(
          VmType.Struct,
          new VmStructSchema([
            new VmNamedVariableSchema('hp', VmType.Int32),
            new VmNamedVariableSchema('tag', VmType.String),
          ])
        )
      ),
      new VmNamedVariableSchema(
        'items',
        new VmVariableSchema(
          VmType.Array_Struct,
          new VmStructSchema([new VmNamedVariableSchema('id', VmType.Int64)])
        )
      ),
    ]);
    expect(serialize(vmStructSchemaFromRpcResult(rom))).toBe(serialize(expected));
  });

  it('keeps the flags, such as the dynamic extras of an NFT RAM schema without fields', () => {
    const ram: VmStructSchemaResult = { fields: [], flags: VmStructSchema.Flags.DynamicExtras };

    const schema = vmStructSchemaFromRpcResult(ram);

    expect(schema.flags).toBe(VmStructSchema.Flags.DynamicExtras);
    expect(serialize(schema)).toBe(
      serialize(new VmStructSchema([], VmStructSchema.Flags.DynamicExtras))
    );
  });
});
