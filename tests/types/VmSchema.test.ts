import { CarbonBinaryReader, CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import { TokenSchemasBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-schemas-builder';
import { TokenSchemas } from '../../src/types/carbon/blockchain/modules/token-schemas';
import {
  VmNamedVariableSchema,
  VmType,
  VmVariableSchema,
} from '../../src/types/carbon/blockchain/vm';
import { bytesToHex } from '../../src/utils/hex';

// The fields every NFT token schema needs, so that TokenSchemasBuilder.fromJson accepts the schemas.
const STANDARD_ROM_FIELDS = [
  { name: 'name', type: 'String' },
  { name: 'description', type: 'String' },
  { name: 'imageURL', type: 'String' },
  { name: 'infoURL', type: 'String' },
  { name: 'royalties', type: 'Int32' },
];

// A Dynamic field holds a value of any VM type. VmType.Dynamic is 0, so a schema field of that type
// has to keep the 0 instead of being taken for a field without a type.
describe('a schema field of type Dynamic', () => {
  it('writes its name and the type byte 0, and reads back as Dynamic', () => {
    const w = new CarbonBinaryWriter();
    new VmNamedVariableSchema('anything', VmType.Dynamic).write(w);

    // A small string is its length byte and its UTF-8 bytes. The type follows as one byte.
    const name = bytesToHex(new TextEncoder().encode('anything'));
    expect(bytesToHex(w.toUint8Array())).toBe(`08${name}00`);
    const read = VmNamedVariableSchema.read(new CarbonBinaryReader(w.toUint8Array()));
    expect(read.name.data).toBe('anything');
    expect(read.schema.type).toBe(VmType.Dynamic);
  });

  it('keeps its type when a variable schema is made from it', () => {
    expect(new VmVariableSchema(VmType.Dynamic).type).toBe(VmType.Dynamic);
  });

  it('is serialized with the token schemas that TokenSchemasBuilder.fromJson reads', () => {
    const schemas = TokenSchemasBuilder.fromJson(
      JSON.stringify({
        seriesMetadata: [],
        rom: [...STANDARD_ROM_FIELDS, { name: 'anything', type: 'Dynamic' }],
        ram: [],
      })
    );

    const read = TokenSchemas.read(new CarbonBinaryReader(TokenSchemasBuilder.serialize(schemas)));
    const field = read.rom.fields.find((f) => f.name.data === 'anything');
    expect(field?.schema.type).toBe(VmType.Dynamic);
  });
});
