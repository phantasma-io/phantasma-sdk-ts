import { PBinaryReader, PBinaryWriter, Timestamp } from '../../src/public';

function encodeTimestamp(timestamp: Timestamp): Uint8Array {
  const writer = new PBinaryWriter();
  timestamp.serializeData(writer);
  return writer.toUint8Array();
}

describe('Timestamp', () => {
  test('serializes and deserializes through canonical instance methods', () => {
    const timestamp = new Timestamp(1234567890);
    const restored = new Timestamp(0);

    restored.unserializeData(new PBinaryReader(encodeTimestamp(timestamp)));

    expect(restored.value).toBe(timestamp.value);
  });

  test('keeps deprecated static serialization aliases compatible', () => {
    const timestamp = new Timestamp(1234567890);
    const writer = new PBinaryWriter();

    Timestamp.serialize(timestamp, writer);

    expect(Timestamp.deserialize(new PBinaryReader(writer.toUint8Array())).value).toBe(
      timestamp.value
    );
  });
});
