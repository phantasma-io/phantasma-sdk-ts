import { CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import { MetadataField } from '../../src/types/carbon/blockchain/modules/builders/metadata-helper';
import { PhantasmaNftRomBuilder } from '../../src/types/carbon/blockchain/modules/builders/phantasma-nft-rom-builder';
import { TokenSchemasBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-schemas-builder';
import {
  VmNamedVariableSchema,
  VmStructSchema,
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

const romFromJson = (extraFields: unknown[]): VmStructSchema =>
  TokenSchemasBuilder.fromJson(
    JSON.stringify({ seriesMetadata: [], rom: [...STANDARD_ROM_FIELDS, ...extraFields], ram: [] })
  ).rom;

// The ROM schema that fromJson makes, built by hand: the two fields the SDK always adds, the standard
// fields, then the given ones.
const romByHand = (extraFields: VmNamedVariableSchema[]): VmStructSchema =>
  new VmStructSchema([
    new VmNamedVariableSchema('_i', VmType.Int256),
    new VmNamedVariableSchema('rom', VmType.Bytes),
    new VmNamedVariableSchema('name', VmType.String),
    new VmNamedVariableSchema('description', VmType.String),
    new VmNamedVariableSchema('imageURL', VmType.String),
    new VmNamedVariableSchema('infoURL', VmType.String),
    new VmNamedVariableSchema('royalties', VmType.Int32),
    ...extraFields,
  ]);

const serialize = (schema: VmStructSchema): string => {
  const w = new CarbonBinaryWriter();
  schema.write(w);
  return bytesToHex(w.toUint8Array());
};

const structField = (name: string, type: VmType, fields: VmNamedVariableSchema[]) =>
  new VmNamedVariableSchema(name, new VmVariableSchema(type, new VmStructSchema(fields)));

// A Struct or Array_Struct field carries the schema of its struct, and the chain writes the field's
// values by it. The JSON of token schemas names that struct's fields under "fields".
describe('TokenSchemasBuilder.fromJson with struct fields', () => {
  const stats = {
    name: 'stats',
    type: 'Struct',
    fields: [
      { name: 'level', type: 'Int32' },
      { name: 'class', type: 'String' },
    ],
  };
  const statsByHand = structField('stats', VmType.Struct, [
    new VmNamedVariableSchema('level', VmType.Int32),
    new VmNamedVariableSchema('class', VmType.String),
  ]);

  it('builds a Struct field with the schema of its struct, in the given order', () => {
    expect(serialize(romFromJson([stats]))).toBe(serialize(romByHand([statsByHand])));
  });

  it('builds an Array_Struct field with the schema of each of its structs', () => {
    const items = { name: 'items', type: 'Array_Struct', fields: [{ name: 'id', type: 'Int64' }] };
    const itemsByHand = structField('items', VmType.Array_Struct, [
      new VmNamedVariableSchema('id', VmType.Int64),
    ]);

    expect(serialize(romFromJson([items]))).toBe(serialize(romByHand([itemsByHand])));
  });

  it('builds a struct field inside a struct field', () => {
    const outer = { name: 'outer', type: 'Struct', fields: [stats] };
    const outerByHand = structField('outer', VmType.Struct, [statsByHand]);

    expect(serialize(romFromJson([outer]))).toBe(serialize(romByHand([outerByHand])));
  });

  it('gives NFT data built by the schema the same bytes as by a schema made by hand', () => {
    const metadata: MetadataField[] = [
      { name: 'name', value: 'Hero' },
      { name: 'description', value: 'An NFT with a struct field' },
      { name: 'imageURL', value: 'https://example.invalid/hero.png' },
      { name: 'infoURL', value: 'https://example.invalid/hero' },
      { name: 'royalties', value: 0 },
      { name: 'stats', value: { level: 3, class: 'mage' } },
    ];

    expect(
      bytesToHex(PhantasmaNftRomBuilder.buildAndSerialize(romFromJson([stats]), metadata))
    ).toBe(
      bytesToHex(PhantasmaNftRomBuilder.buildAndSerialize(romByHand([statsByHand]), metadata))
    );
  });

  it('refuses a Struct field without fields', () => {
    expect(() => romFromJson([{ name: 'stats', type: 'Struct' }])).toThrow(
      'rom.stats has the type Struct and needs a fields array'
    );
  });

  it('refuses an Array_Struct field whose struct has no fields', () => {
    expect(() => romFromJson([{ name: 'items', type: 'Array_Struct', fields: [] }])).toThrow(
      'rom.items has the type Array_Struct and needs at least one field'
    );
  });

  it('refuses fields on a field of another type', () => {
    expect(() => romFromJson([{ name: 'title', type: 'String', fields: [] }])).toThrow(
      'rom.title has the type String and cannot have fields'
    );
  });

  it('names the struct field when one of its fields is malformed', () => {
    expect(() =>
      romFromJson([{ name: 'stats', type: 'Struct', fields: [{ name: 'level', type: 5 }] }])
    ).toThrow('rom.stats field type must be string');
  });
});
