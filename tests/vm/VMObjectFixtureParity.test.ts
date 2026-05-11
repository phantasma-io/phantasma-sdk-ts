import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import { Address, Base16, PBinaryWriter, Timestamp, VMObject, VMType } from '../../src/core';

const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures');

const VM_TYPE_NAMES = new Map<VMType, string>([
  [VMType.None, 'None'],
  [VMType.Struct, 'Struct'],
  [VMType.Bytes, 'Bytes'],
  [VMType.Number, 'Number'],
  [VMType.String, 'String'],
  [VMType.Timestamp, 'Timestamp'],
  [VMType.Bool, 'Bool'],
  [VMType.Enum, 'Enum'],
  [VMType.Object, 'Object'],
]);

const UNIT_COVERED_GEN2_FIXTURES = new Set([
  'gen2_csharp_vm_bigint_binary.tsv',
  'gen2_csharp_vm_bigint_decimal.tsv',
  'gen2_csharp_vmobject_arraytype.tsv',
  'gen2_csharp_vmobject_asbool.tsv',
  'gen2_csharp_vmobject_asbytes.tsv',
  'gen2_csharp_vmobject_asnumber.tsv',
  'gen2_csharp_vmobject_asstring.tsv',
  'gen2_csharp_vmobject_cast_struct.tsv',
  'gen2_csharp_vmobject_serde.tsv',
]);

const LIVE_RUNNER_COVERED_GEN2_FIXTURES = new Set([
  'gen2_csharp_vm_scriptcontext_ops.tsv',
  'gen2_csharp_vm_scriptcontext_unary.tsv',
]);

const NOT_SDK_UNIT_APPLICABLE_GEN2_FIXTURES = new Set([
  'gen2_csharp_vm_bigint_narrow_int.tsv',
  'gen2_csharp_vm_bigint_ops.tsv',
  'gen2_csharp_vm_bigint_unary_ops.tsv',
]);

const GEN2_FIXTURE_SHA256 = new Map([
  [
    'gen2_csharp_vm_bigint_binary.tsv',
    'a5be05751b35de8b7b3578577bb2769073ac7a2ddea3eaf9503d76d0302fa464',
  ],
  [
    'gen2_csharp_vm_bigint_decimal.tsv',
    '1bede4198883018817d94eceefe4e7b70a9f5c96c9d60d57481990ad21b027a9',
  ],
  [
    'gen2_csharp_vm_bigint_narrow_int.tsv',
    'b82315b4483c23ee7e3e9943b5c41cf8daf12c627c6e12f30b735ad7dbde1445',
  ],
  [
    'gen2_csharp_vm_bigint_ops.tsv',
    '997f3a935393358a89c7be785176e8528535111994bc5193c7d7ddc2429aa3d3',
  ],
  [
    'gen2_csharp_vm_bigint_unary_ops.tsv',
    '53719de8a1528897a083401aaad251cdb3e9e201f8639d29cd3708beeda93ea7',
  ],
  [
    'gen2_csharp_vm_scriptcontext_ops.tsv',
    'c87e4a5ec075b8efc0abe88a551ae8fe505df04167cb0e4f2714768c0a1e917f',
  ],
  [
    'gen2_csharp_vm_scriptcontext_unary.tsv',
    '7198d33a84bd61c671dc1871f2b56e232748c41d69e957e8f994cd2dc9b5922c',
  ],
  [
    'gen2_csharp_vmobject_arraytype.tsv',
    'f6b7ce9cd92f464d260018ffb1a0ab01202ca908cf915dead3295e8270ddf532',
  ],
  [
    'gen2_csharp_vmobject_asbool.tsv',
    'a2979cc7eccd22760de82f8401de4b8b41c45fedf09b91a94871d3a3051c85d5',
  ],
  [
    'gen2_csharp_vmobject_asbytes.tsv',
    'dd326e18c94e2e116705893f742c708cfb1cd7b96c8a40a2ab6637b39ae409b9',
  ],
  [
    'gen2_csharp_vmobject_asnumber.tsv',
    '986cfc21658c66b04c1ffaaa7bb9fa08bc9a3acd929276d0d2496ba43c43bf69',
  ],
  [
    'gen2_csharp_vmobject_asstring.tsv',
    'eb14408b7e65fc417bf1bbfe4fb1e87c3d06d28734c7c25514a806f41fceede6',
  ],
  [
    'gen2_csharp_vmobject_cast_struct.tsv',
    '1580a9ec312619a7e2632076073ae80d57dcfc3defc0ef7b4876da34c0e231af',
  ],
  [
    'gen2_csharp_vmobject_serde.tsv',
    '0c74c90e83c5c20bed48b1d52ca5489d15a7c4f67874184c1d0a4f708ce5e42f',
  ],
]);

describe('Gen2 C# VMObject fixture parity', () => {
  test('fixture manifest is explicit and hash-locked', () => {
    const discovered = fs
      .readdirSync(FIXTURE_DIR)
      .filter((name) => name.startsWith('gen2_csharp_') && name.endsWith('.tsv'))
      .sort();
    const classified = [
      ...UNIT_COVERED_GEN2_FIXTURES,
      ...LIVE_RUNNER_COVERED_GEN2_FIXTURES,
      ...NOT_SDK_UNIT_APPLICABLE_GEN2_FIXTURES,
    ].sort();

    expect(discovered).toStrictEqual(classified);
    expect([...GEN2_FIXTURE_SHA256.keys()].sort()).toStrictEqual(classified);

    for (const [name, expected] of GEN2_FIXTURE_SHA256) {
      const digest = createHash('sha256')
        .update(fs.readFileSync(path.join(FIXTURE_DIR, name)))
        .digest('hex');
      expect(digest).toBe(expected);
    }
  });

  test('AsString matches Gen2 C# fixtures', () => {
    for (const parts of fixtureRows('gen2_csharp_vmobject_asstring.tsv')) {
      const [caseId, sourceKind, , payload, outcome, expected] = parts;
      expect(outcome).toBe('ok');
      expect(objectFromFixture(sourceKind, payload).AsString()).toBe(expected);
      expect(caseId).toBeTruthy();
    }
  });

  test('string AsNumber matches Gen2 C# decimal fixtures', () => {
    for (const parts of fixtureRows('gen2_csharp_vm_bigint_decimal.tsv')) {
      const [caseId, inputText, outcome, expected] = parts;
      const result = callResult(() => typedObject(VMType.String, inputText).AsNumber());
      if (outcome === 'ok') {
        expect(result).toBe(BigInt(expected));
      } else {
        expect(result).toBeInstanceOf(Error);
      }
      expect(caseId).toBeTruthy();
    }
  });

  test('AsNumber matches Gen2 C# fixtures', () => {
    for (const parts of fixtureRows('gen2_csharp_vmobject_asnumber.tsv')) {
      const [caseId, sourceKind, , payload, outcome, expected] = parts;
      const result = callResult(() => objectFromFixture(sourceKind, payload).AsNumber());
      if (outcome === 'ok') {
        expect(result).toBe(BigInt(expected));
      } else {
        expect(result).toBeInstanceOf(Error);
      }
      expect(caseId).toBeTruthy();
    }
  });

  test('AsByteArray matches Gen2 C# fixtures', () => {
    for (const parts of fixtureRows('gen2_csharp_vmobject_asbytes.tsv')) {
      const [caseId, sourceKind, , payload, outcome, expected] = parts;
      const result = callResult(() => objectFromFixture(sourceKind, payload).AsByteArray());
      if (outcome === 'ok') {
        expect(bytesToHex(result as Uint8Array)).toBe(expected);
      } else {
        expect(result).toBeInstanceOf(Error);
      }
      expect(caseId).toBeTruthy();
    }
  });

  test('AsBool matches Gen2 C# fixtures', () => {
    for (const parts of fixtureRows('gen2_csharp_vmobject_asbool.tsv')) {
      const [caseId, sourceKind, , payload, outcome, expected] = parts;
      const result = callResult(() => objectFromFixture(sourceKind, payload).AsBool());
      if (outcome === 'ok') {
        expect(String(result).toLowerCase()).toBe(expected);
      } else {
        expect(result).toBeInstanceOf(Error);
      }
      expect(caseId).toBeTruthy();
    }
  });

  test('array type matches Gen2 C# fixtures', () => {
    for (const parts of fixtureRows('gen2_csharp_vmobject_arraytype.tsv')) {
      const [caseId, sourceKind, , payload, expected] = parts;
      expect(VM_TYPE_NAMES.get(objectFromFixture(sourceKind, payload).GetArrayType())).toBe(
        expected
      );
      expect(caseId).toBeTruthy();
    }
  });

  test('serialization matches Gen2 C# fixtures', () => {
    for (const parts of fixtureRows('gen2_csharp_vmobject_serde.tsv')) {
      const [caseId, sourceKind, , payload, serializedHex, roundtripType, descriptor] = parts;
      const obj = objectFromFixture(sourceKind, payload);

      expect(serializeObject(obj)).toBe(serializedHex);

      const roundtrip = VMObject.FromBytes(hexToBytes(serializedHex));
      expect(VM_TYPE_NAMES.get(roundtrip.Type)).toBe(roundtripType);
      expect(objectDescriptor(roundtrip)).toBe(descriptor);
      expect(caseId).toBeTruthy();
    }
  });

  test('CastTo common targets matches Gen2 C# conversion fixtures', () => {
    for (const [fileName, targetType, expectedType] of [
      ['gen2_csharp_vmobject_asstring.tsv', VMType.String, VMType.String],
      ['gen2_csharp_vmobject_asbytes.tsv', VMType.Bytes, VMType.Bytes],
      ['gen2_csharp_vmobject_asnumber.tsv', VMType.Number, VMType.Number],
      ['gen2_csharp_vmobject_asbool.tsv', VMType.Bool, VMType.Bool],
    ] as const) {
      for (const parts of fixtureRows(fileName)) {
        const [caseId, sourceKind, , payload, outcome, expected] = parts;
        const result = callResult(() =>
          VMObject.CastTo(objectFromFixture(sourceKind, payload), targetType)
        );
        if (outcome === 'ok') {
          const object = result as VMObject;
          expect(object.Type).toBe(expectedType);
          if (targetType === VMType.String) expect(object.Data).toBe(expected);
          if (targetType === VMType.Bytes)
            expect(bytesToHex(object.Data as Uint8Array)).toBe(expected);
          if (targetType === VMType.Number) expect(object.Data).toBe(BigInt(expected));
          if (targetType === VMType.Bool) expect(object.Data).toBe(expected === 'true');
        } else {
          expect(result).toBeInstanceOf(Error);
        }
        expect(caseId).toBeTruthy();
      }
    }
  });

  test('CastTo Struct matches Gen2 C# fixtures', () => {
    for (const parts of fixtureRows('gen2_csharp_vmobject_cast_struct.tsv')) {
      const [caseId, sourceKind, , payload, outcome, expectedType, descriptor] = parts;
      const result = callResult(() =>
        VMObject.CastTo(objectFromFixture(sourceKind, payload), VMType.Struct)
      );
      if (outcome === 'ok') {
        const object = result as VMObject;
        expect(VM_TYPE_NAMES.get(object.Type)).toBe(expectedType);
        expect(objectDescriptor(object)).toBe(descriptor);
      } else {
        expect(result).toBeInstanceOf(Error);
      }
      expect(caseId).toBeTruthy();
    }
  });

  test('serialized fixture payloads reject truncation', () => {
    for (const parts of fixtureRows('gen2_csharp_vmobject_serde.tsv')) {
      const [caseId, , , , serializedHex] = parts;
      const payload = hexToBytes(serializedHex);
      expect(payload.length).toBeGreaterThan(0);
      expect(
        callResult(() => VMObject.FromBytes(payload.slice(0, payload.length - 1)))
      ).toBeInstanceOf(Error);
      expect(caseId).toBeTruthy();
    }
  });
});

function fixtureRows(name: string): string[][] {
  const rows: string[][] = [];
  let width = 0;
  for (const line of fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const parts = line.split('\t');
    if (line.startsWith('case_id\t')) {
      width = parts.length;
      continue;
    }
    while (width && parts.length < width) parts.push('');
    rows.push(parts);
  }
  return rows;
}

function objectFromFixture(sourceKind: string, payload: string): VMObject {
  if (sourceKind === 'serialized_vmobject') return VMObject.FromBytes(hexToBytes(payload));
  if (sourceKind === 'empty') return typedObject(VMType.None, null);
  if (sourceKind === 'string') return typedObject(VMType.String, payload);
  if (sourceKind === 'bytes') return typedObject(VMType.Bytes, hexToBytes(payload));
  if (sourceKind === 'bool') return typedObject(VMType.Bool, payload === 'true');
  if (sourceKind === 'enum') return typedObject(VMType.Enum, Number(payload));
  if (sourceKind === 'timestamp')
    return typedObject(VMType.Timestamp, new Timestamp(Number(payload)));
  if (sourceKind === 'number') return typedObject(VMType.Number, BigInt(payload));
  if (sourceKind === 'object') return typedObject(VMType.Object, hexToBytes(payload));
  if (sourceKind === 'struct') {
    const data = new Map<VMObject, VMObject>();
    data.set(typedObject(VMType.String, 'name'), typedObject(VMType.String, 'neo'));
    data.set(typedObject(VMType.String, 'count'), typedObject(VMType.Number, 7n));
    return typedObject(VMType.Struct, data);
  }
  throw new Error(`unsupported fixture source kind: ${sourceKind}`);
}

function typedObject(type: VMType, data: unknown): VMObject {
  const object = new VMObject();
  object.Type = type;
  object.Data = data;
  return object;
}

function serializeObject(object: VMObject): string {
  const writer = new PBinaryWriter();
  object.SerializeData(writer);
  return bytesToHex(writer.toUint8Array());
}

function objectDescriptor(object: VMObject): string {
  switch (object.Type) {
    case VMType.None:
      return 'None';
    case VMType.Struct:
      return `Struct:${serializeObject(object)}`;
    case VMType.Bytes:
      return `Bytes:${bytesToHex(object.Data as Uint8Array)}`;
    case VMType.Number:
      return `Number:${object.AsNumber()}`;
    case VMType.String:
      return `String:${object.AsString()}`;
    case VMType.Timestamp:
      return `Timestamp:${object.AsTimestamp().value}`;
    case VMType.Bool:
      return `Bool:${String(object.AsBool()).toLowerCase()}`;
    case VMType.Enum:
      return `Enum:${object.Data}`;
    case VMType.Object: {
      const bytes =
        object.Data instanceof Address ? object.Data.ToByteArray() : (object.Data as Uint8Array);
      if (bytes.length === Address.LengthInBytes) return `Object.Address:${bytesToHex(bytes)}`;
      if (bytes.length === 32) return `Object.Hash:${bytesToHex(bytes)}`;
      return `Object:${bytesToHex(bytes)}`;
    }
    default:
      throw new Error(`unsupported object type: ${object.Type}`);
  }
}

function callResult(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function hexToBytes(hex: string): Uint8Array {
  return Base16.decodeUint8Array(hex);
}

function bytesToHex(bytes: Uint8Array): string {
  return Base16.encodeUint8Array(bytes).toLowerCase();
}
