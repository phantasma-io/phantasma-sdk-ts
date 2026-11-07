import { CarbonBinaryReader, CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import {
  MetadataField,
  pushMetadataField,
} from '../../src/types/carbon/blockchain/modules/builders/metadata-helper';
import { TokenSchemasBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-schemas-builder';
import { TokenSchemas } from '../../src/types/carbon/blockchain/modules/token-schemas';
import {
  VmDynamicStruct,
  VmDynamicVariable,
  VmNamedVariableSchema,
  VmStructArray,
  VmStructSchema,
  VmType,
  VmVariableSchema,
} from '../../src/types/carbon/blockchain/vm';
import { SmallString } from '../../src/types/carbon/small-string';
import { bytesToHex } from '../../src/utils/hex';

// The chain's layout of the values below: a string is its UTF-8 bytes and a zero byte, an Int32 four
// and an Int64 eight little-endian bytes, and a count four little-endian bytes.
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};
const sz = (s: string) => concat(new TextEncoder().encode(s), new Uint8Array([0]));
const u32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
};
const i32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return b;
};
const i64 = (v: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigInt64(0, v, true);
  return b;
};

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

// NFT data and series metadata are written by their schema: only the values, in schema order. A Struct
// or Array_Struct field inside is written by that field's own struct schema, so it has to be read by
// it as well.
describe('a struct written by its schema', () => {
  const statsSchema = new VmStructSchema([
    new VmNamedVariableSchema('hp', VmType.Int32),
    new VmNamedVariableSchema('tag', VmType.String),
  ]);
  const itemSchema = new VmStructSchema([new VmNamedVariableSchema('id', VmType.Int64)]);
  const fields = [
    new VmNamedVariableSchema('stats', new VmVariableSchema(VmType.Struct, statsSchema)),
    new VmNamedVariableSchema('items', new VmVariableSchema(VmType.Array_Struct, itemSchema)),
    new VmNamedVariableSchema('note', VmType.String),
  ];
  const schema = new VmStructSchema(fields);
  const metadata: MetadataField[] = [
    { name: 'stats', value: { hp: 7, tag: 'x' } },
    { name: 'items', value: [{ id: 1n }, { id: 2n }] },
    { name: 'note', value: 'after the structs' },
  ];

  it('reads its Struct and Array_Struct fields back by their own schemas', () => {
    const struct = new VmDynamicStruct();
    for (const f of fields) pushMetadataField(f, struct, metadata);
    const w = new CarbonBinaryWriter();
    expect(struct.writeWithSchema(schema, w)).toBe(true);
    expect(bytesToHex(w.toUint8Array())).toBe(
      bytesToHex(concat(i32(7), sz('x'), u32(2), i64(1n), i64(2n), sz('after the structs')))
    );

    const read = new VmDynamicStruct();
    read.readWithSchema(schema, new CarbonBinaryReader(w.toUint8Array()));

    const stats = read.getValue(new SmallString('stats'))?.data as VmDynamicStruct;
    expect(stats.getValue(new SmallString('hp'))?.data).toBe(7);
    expect(stats.getValue(new SmallString('tag'))?.data).toBe('x');
    const items = read.getValue(new SmallString('items'))?.data as VmStructArray;
    expect(items.structs.map((s) => s.getValue(new SmallString('id'))?.data)).toEqual([1n, 2n]);
    expect(read.getValue(new SmallString('note'))?.data).toBe('after the structs');
  });
});

// A Dynamic field is written as its value's type byte and then the value. An Array_Dynamic field is a
// count and then each item in the same way.
describe('a struct with Dynamic fields written by its schema', () => {
  const fields = [
    new VmNamedVariableSchema('extra', VmType.Dynamic),
    new VmNamedVariableSchema('extras', new VmVariableSchema(VmType.Array_Dynamic)),
    new VmNamedVariableSchema('note', VmType.String),
  ];
  const schema = new VmStructSchema(fields);
  const metadata: MetadataField[] = [
    { name: 'extra', value: { type: 'Int64', value: '9007199254740993' } },
    {
      name: 'extras',
      value: [
        { type: 'String', value: 'a' },
        { type: 'Int32', value: 7 },
      ],
    },
    { name: 'note', value: 'after the dynamic values' },
  ];

  it('writes each value with its type, as the chain reads it, and reads it back', () => {
    const struct = new VmDynamicStruct();
    for (const f of fields) pushMetadataField(f, struct, metadata);
    const w = new CarbonBinaryWriter();
    expect(struct.writeWithSchema(schema, w)).toBe(true);
    expect(bytesToHex(w.toUint8Array())).toBe(
      bytesToHex(
        concat(
          new Uint8Array([VmType.Int64]),
          i64(9007199254740993n),
          u32(2),
          new Uint8Array([VmType.String]),
          sz('a'),
          new Uint8Array([VmType.Int32]),
          i32(7),
          sz('after the dynamic values')
        )
      )
    );

    const read = new VmDynamicStruct();
    read.readWithSchema(schema, new CarbonBinaryReader(w.toUint8Array()));

    const extra = read.getValue(new SmallString('extra'))?.data as VmDynamicVariable;
    expect([extra.type, extra.data]).toEqual([VmType.Int64, 9007199254740993n]);
    const extras = read.getValue(new SmallString('extras'))?.data as VmDynamicVariable[];
    expect(extras.map((item) => [item.type, item.data])).toEqual([
      [VmType.String, 'a'],
      [VmType.Int32, 7],
    ]);
    expect(read.getValue(new SmallString('note'))?.data).toBe('after the dynamic values');
  });
});
