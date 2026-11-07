import { CarbonBinaryReader, CarbonBinaryWriter } from '../../src/core/types/CarbonSerialization';
import { bytesToHex } from '../../src/core/utils';
import { Bytes16 } from '../../src/core/types/Carbon/Bytes16';
import { Bytes32 } from '../../src/core/types/Carbon/Bytes32';
import {
  VmDynamicStruct,
  VmDynamicVariable,
  VmNamedVariableSchema,
  VmStructSchema,
  VmType,
  VmVariableSchema,
} from '../../src/core/types/Carbon/Blockchain/Vm';
import {
  MetadataField,
  pushMetadataField,
} from '../../src/core/types/Carbon/Blockchain/Modules/Builders/MetadataHelper';

describe('MetadataHelper.pushMetadataField', () => {
  it('accepts matching Int32 values', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('royalties', VmType.Int32);
    const metadata: MetadataField[] = [{ name: 'royalties', value: 42 }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields).toHaveLength(1);
    expect(struct.fields[0].value.data).toBe(42);
  });

  it('rejects non-integer values for Int32 fields', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('royalties', VmType.Int32);
    const metadata: MetadataField[] = [{ name: 'royalties', value: 'forty-two' }];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'royalties' must be an integer between -2147483648 and 2147483647"
    );
  });

  it('rejects values outside of the allowed Int32/UInt32 range', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('royalties', VmType.Int32);
    const metadata: MetadataField[] = [{ name: 'royalties', value: 0xffffffff + 1 }];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'royalties' must be between -2147483648 and 2147483647 or between 0 and 4294967295"
    );
  });

  it('accepts hex strings for byte fields', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('payload', VmType.Bytes);
    const metadata: MetadataField[] = [{ name: 'payload', value: '0a0b' }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields).toHaveLength(1);
    expect(struct.fields[0].value.data).toEqual(new Uint8Array([0x0a, 0x0b]));
  });

  it('accepts 0x-prefixed hex strings for byte fields', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('payload', VmType.Bytes);
    const metadata: MetadataField[] = [{ name: 'payload', value: '0x0a0b' }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields).toHaveLength(1);
    expect(struct.fields[0].value.data).toEqual(new Uint8Array([0x0a, 0x0b]));
  });

  it('accepts unsigned range values for Int8', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('level', VmType.Int8);
    const metadata: MetadataField[] = [{ name: 'level', value: 200 }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toBe(200);
  });

  it('accepts unsigned range values for Int16', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('checksum', VmType.Int16);
    const metadata: MetadataField[] = [{ name: 'checksum', value: 65535 }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toBe(65535);
  });

  it('rejects invalid hex strings for byte fields', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('payload', VmType.Bytes);
    const metadata: MetadataField[] = [{ name: 'payload', value: 'xyz' }];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'payload' must be a byte array or hex string"
    );
  });

  it('requires a bigint or a digit string for unsafe Int64 values', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('supply', VmType.Int64);
    const unsafeNumber = Number.MAX_SAFE_INTEGER + 1;
    const metadata: MetadataField[] = [{ name: 'supply', value: unsafeNumber }];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'supply' must be given as a bigint or a string of decimal digits when it exceeds the safe integer range"
    );
  });

  // JSON has no bigint, and a JSON number above 2^53 - 1 loses digits when it is read. So a caller
  // that reads JSON gives such an Int64 or Int256 value as a string of decimal digits.
  it('accepts a string of decimal digits for Int64 above the safe integer range', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('supply', VmType.Int64);
    const metadata: MetadataField[] = [{ name: 'supply', value: '9007199254740993' }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toBe(9007199254740993n);
  });

  it('accepts a negative string of decimal digits for Int256', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('delta', VmType.Int256);
    const metadata: MetadataField[] = [{ name: 'delta', value: '-123' }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toBe(-123n);
  });

  it('accepts strings of decimal digits for the items of an Array_Int256', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema(
      'ids',
      new VmVariableSchema(VmType.Array | VmType.Int256)
    );
    const uint256Max = (1n << 256n) - 1n;
    const metadata: MetadataField[] = [{ name: 'ids', value: ['1', uint256Max.toString()] }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toEqual([1n, uint256Max]);
  });

  it('refuses a hex string for Int64', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('supply', VmType.Int64);
    const metadata: MetadataField[] = [{ name: 'supply', value: '0x10' }];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'supply' must be a bigint, a safe integer number or a string of decimal digits"
    );
  });

  it('refuses a string of decimal digits outside the Int64 range', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('supply', VmType.Int64);
    const metadata: MetadataField[] = [{ name: 'supply', value: (1n << 64n).toString() }];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'supply' must be between -9223372036854775808 and 9223372036854775807 or between 0 and 18446744073709551615 (Int64)"
    );
  });

  it('accepts bigint input for Int64 values', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('supply', VmType.Int64);
    const metadata: MetadataField[] = [{ name: 'supply', value: 123n }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toBe(123n);
  });

  it('rejects values outside Int64/UInt64 bounds', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('supply', VmType.Int64);
    const metadata: MetadataField[] = [{ name: 'supply', value: 1n << 64n }];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'supply' must be between -9223372036854775808 and 9223372036854775807 or between 0 and 18446744073709551615 (Int64)"
    );
  });

  it('rejects values outside Int256/UInt256 bounds', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('value', VmType.Int256);
    const metadata: MetadataField[] = [{ name: 'value', value: 1n << 256n }];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'value' must be between -57896044618658097711785492504343953926634992332820282019728792003956564819968 and 57896044618658097711785492504343953926634992332820282019728792003956564819967 or between 0 and 115792089237316195423570985008687907853269984665640564039457584007913129639935 (Int256)"
    );
  });

  it('accepts unsigned range values for Int64 via BigInt', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('supply', VmType.Int64);
    const metadata: MetadataField[] = [{ name: 'supply', value: (1n << 64n) - 1n }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toBe((1n << 64n) - 1n);
  });

  it('accepts unsigned range values for Int256 via BigInt', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('value', VmType.Int256);
    const metadata: MetadataField[] = [{ name: 'value', value: (1n << 256n) - 1n }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toBe((1n << 256n) - 1n);
  });

  it('builds nested struct metadata from plain object', () => {
    const struct = new VmDynamicStruct();
    const nestedSchema = new VmStructSchema([
      new VmNamedVariableSchema('innerName', VmType.String),
      new VmNamedVariableSchema('innerValue', VmType.Int32),
    ]);
    const schema = new VmNamedVariableSchema(
      'details',
      new VmVariableSchema(VmType.Struct, nestedSchema)
    );
    const metadata: MetadataField[] = [
      {
        name: 'details',
        value: { innerName: 'demo', innerValue: 5 },
      },
    ];

    pushMetadataField(schema, struct, metadata);

    const nested = struct.fields[0].value.data as VmDynamicStruct;
    expect(nested.fields).toHaveLength(2);
    expect(nested.fields[0].name.data).toBe('innerName');
    expect(nested.fields[1].value.data).toBe(5);
  });

  it('rejects struct metadata with unknown properties', () => {
    const struct = new VmDynamicStruct();
    const nestedSchema = new VmStructSchema([
      new VmNamedVariableSchema('innerName', VmType.String),
    ]);
    const schema = new VmNamedVariableSchema(
      'details',
      new VmVariableSchema(VmType.Struct, nestedSchema)
    );
    const metadata: MetadataField[] = [
      {
        name: 'details',
        value: { innerName: 'demo', extra: 'oops' },
      },
    ];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'details' received unknown property 'extra'"
    );
  });

  it('rejects struct metadata missing required fields', () => {
    const struct = new VmDynamicStruct();
    const nestedSchema = new VmStructSchema([
      new VmNamedVariableSchema('innerName', VmType.String),
    ]);
    const schema = new VmNamedVariableSchema(
      'details',
      new VmVariableSchema(VmType.Struct, nestedSchema)
    );
    const metadata: MetadataField[] = [
      {
        name: 'details',
        value: {},
      },
    ];

    expect(() => pushMetadataField(schema, struct, metadata)).toThrow(
      "Metadata field 'details.innerName' is mandatory"
    );
  });

  it('accepts arrays for matching array schema', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema(
      'tags',
      new VmVariableSchema(VmType.Array | VmType.String)
    );
    const metadata: MetadataField[] = [{ name: 'tags', value: ['alpha', 'beta'] }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toEqual(['alpha', 'beta']);
  });

  it('converts Int8 arrays into Uint8Array', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema(
      'deltas',
      new VmVariableSchema(VmType.Array | VmType.Int8)
    );
    const metadata: MetadataField[] = [{ name: 'deltas', value: [1, -1, 5] }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(struct.fields[0].value.data as Uint8Array)).toEqual([1, 255, 5]);
  });

  it('builds VmStructArray for arrays of structs', () => {
    const struct = new VmDynamicStruct();
    const elementSchema = new VmStructSchema([new VmNamedVariableSchema('name', VmType.String)]);
    const schema = new VmNamedVariableSchema(
      'items',
      new VmVariableSchema(VmType.Array | VmType.Struct, elementSchema)
    );
    const metadata: MetadataField[] = [
      {
        name: 'items',
        value: [{ name: 'one' }, { name: 'two' }],
      },
    ];

    pushMetadataField(schema, struct, metadata);

    const arrayValue = struct.fields[0].value.data;
    expect(arrayValue.schema).toBe(elementSchema);
    expect(arrayValue.structs).toHaveLength(2);
  });

  it('converts hex input into Bytes16 instance', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema('hash', VmType.Bytes16);
    const metadata: MetadataField[] = [{ name: 'hash', value: '00112233445566778899aabbccddeeff' }];

    pushMetadataField(schema, struct, metadata);

    expect(struct.fields[0].value.data).toBeInstanceOf(Bytes16);
    expect((struct.fields[0].value.data as Bytes16).bytes).toHaveLength(16);
  });

  it('builds arrays of Bytes32 instances', () => {
    const struct = new VmDynamicStruct();
    const schema = new VmNamedVariableSchema(
      'roots',
      new VmVariableSchema(VmType.Array | VmType.Bytes32)
    );
    const metadata: MetadataField[] = [
      {
        name: 'roots',
        value: [
          '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
          'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        ],
      },
    ];

    pushMetadataField(schema, struct, metadata);

    const values = struct.fields[0].value.data as Bytes32[];
    expect(values).toHaveLength(2);
    expect(values[0]).toBeInstanceOf(Bytes32);
  });

  it('serializes an array of Bytes32 by its schema, as NFT data is, and reads it back', () => {
    const rootsSchema = new VmNamedVariableSchema(
      'roots',
      new VmVariableSchema(VmType.Array | VmType.Bytes32)
    );
    const noteSchema = new VmNamedVariableSchema('note', VmType.String);
    const schema = new VmStructSchema([rootsSchema, noteSchema]);
    const roots = [
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    ];
    const metadata: MetadataField[] = [
      { name: 'roots', value: roots },
      { name: 'note', value: 'after the array' },
    ];
    const struct = new VmDynamicStruct();
    pushMetadataField(rootsSchema, struct, metadata);
    pushMetadataField(noteSchema, struct, metadata);

    const w = new CarbonBinaryWriter();
    expect(struct.writeWithSchema(schema, w)).toBe(true);
    const read = new VmDynamicStruct();
    read.readWithSchema(schema, new CarbonBinaryReader(w.toUint8Array()));

    const readRoots = read.fields.find((f) => f.name.data === 'roots');
    const readNote = read.fields.find((f) => f.name.data === 'note');
    expect((readRoots?.value.data as Bytes32[]).map((x) => bytesToHex(x.bytes))).toEqual(roots);
    expect(readNote?.value.data).toBe('after the array');
  });
});

// A Dynamic field can hold a value of any VM type, and the chain stores the type with the value. So
// the value names its type: { type, value }, the value given as for a field of that type.
describe('MetadataHelper.pushMetadataField for Dynamic fields', () => {
  const dynamicField = new VmNamedVariableSchema('extra', VmType.Dynamic);
  const dynamicArrayField = new VmNamedVariableSchema(
    'extras',
    new VmVariableSchema(VmType.Array_Dynamic)
  );

  it('stores a typed value inside the Dynamic field', () => {
    const struct = new VmDynamicStruct();
    const metadata: MetadataField[] = [
      { name: 'extra', value: { type: 'Int64', value: '9007199254740993' } },
    ];

    pushMetadataField(dynamicField, struct, metadata);

    expect(struct.fields[0].value.type).toBe(VmType.Dynamic);
    const inner = struct.fields[0].value.data as VmDynamicVariable;
    expect(inner.type).toBe(VmType.Int64);
    expect(inner.data).toBe(9007199254740993n);
  });

  it('takes the type as a VmType as well as by its name', () => {
    const struct = new VmDynamicStruct();
    const metadata: MetadataField[] = [
      { name: 'extra', value: { type: VmType.Array_String, value: ['a', 'b'] } },
    ];

    pushMetadataField(dynamicField, struct, metadata);

    const inner = struct.fields[0].value.data as VmDynamicVariable;
    expect(inner.type).toBe(VmType.Array_String);
    expect(inner.data).toEqual(['a', 'b']);
  });

  it('stores an array of typed values inside an Array_Dynamic field', () => {
    const struct = new VmDynamicStruct();
    const root = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
    const metadata: MetadataField[] = [
      {
        name: 'extras',
        value: [
          { type: 'Int32', value: 5 },
          { type: 'Bytes32', value: root },
        ],
      },
    ];

    pushMetadataField(dynamicArrayField, struct, metadata);

    const items = struct.fields[0].value.data as VmDynamicVariable[];
    expect(items.map((item) => item.type)).toEqual([VmType.Int32, VmType.Bytes32]);
    expect(items[0].data).toBe(5);
    expect(bytesToHex((items[1].data as Bytes32).bytes)).toBe(root);
  });

  it('refuses a value without its type', () => {
    const struct = new VmDynamicStruct();
    const metadata: MetadataField[] = [{ name: 'extra', value: 'text' }];

    expect(() => pushMetadataField(dynamicField, struct, metadata)).toThrow(
      "Metadata field 'extra' is Dynamic and must be given as { type, value }"
    );
  });

  it('refuses a type that is not a VM type', () => {
    const struct = new VmDynamicStruct();
    const metadata: MetadataField[] = [{ name: 'extra', value: { type: 'Float', value: 1 } }];

    expect(() => pushMetadataField(dynamicField, struct, metadata)).toThrow(
      "Metadata field 'extra' names an unknown type 'Float'"
    );
  });

  // A typed value names one type, so it cannot give the types of the fields of a struct. It takes no
  // typed values inside a typed value either.
  it.each(['Struct', 'Array_Struct', 'Dynamic', 'Array_Dynamic'])(
    'refuses a Dynamic value of type %s',
    (type) => {
      const struct = new VmDynamicStruct();
      const metadata: MetadataField[] = [{ name: 'extra', value: { type, value: {} } }];

      expect(() => pushMetadataField(dynamicField, struct, metadata)).toThrow(
        "Metadata field 'extra' cannot hold a Dynamic value of type"
      );
    }
  );

  it('checks each item of an Array_Dynamic field against its own type', () => {
    const struct = new VmDynamicStruct();
    const metadata: MetadataField[] = [
      { name: 'extras', value: [{ type: 'Bytes32', value: '0011' }] },
    ];

    expect(() => pushMetadataField(dynamicArrayField, struct, metadata)).toThrow(
      "Metadata field 'extras[0]' must be exactly 32 bytes"
    );
  });
});
