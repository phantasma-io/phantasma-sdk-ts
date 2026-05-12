import {
  PBinaryReader,
  PBinaryWriter,
  ScriptBuilder,
  Serialization,
  VMObject,
  VMType,
} from '../../src/core';
import type { Serializable } from '../../src/public';

class CanonicalSerializable implements Serializable {
  value = '';

  constructor(value: string = '') {
    this.value = value;
  }

  serializeData(writer: PBinaryWriter): void {
    writer.writeString(this.value);
  }

  unserializeData(reader: PBinaryReader): void {
    this.value = reader.readString();
  }
}

describe('canonical Serializable interface', () => {
  test('Serialization accepts lower-camel serializable objects', () => {
    const bytes = Serialization.serialize(new CanonicalSerializable('canonical'));
    const decoded = Serialization.deserialize<CanonicalSerializable>(bytes, CanonicalSerializable);

    expect(decoded).toBeInstanceOf(CanonicalSerializable);
    expect(decoded.value).toBe('canonical');
  });

  test('ScriptBuilder and VMObject accept lower-camel serializable objects', () => {
    const value = new CanonicalSerializable('vm');
    const script = new ScriptBuilder().beginScript().emitLoadSerializable(0, value).endScript();
    const vmObject = new VMObject().setValue(value, VMType.Object);
    const writer = new PBinaryWriter();

    expect(script).toMatch(/0B$/);
    expect(() => vmObject.SerializeData(writer)).not.toThrow();
    expect(writer.toUint8Array().length).toBeGreaterThan(0);
  });
});
