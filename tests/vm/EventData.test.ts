import {
  decodeVMObject,
  getChainValueEventData,
  getGasEventData,
  getInfusionEventData,
  getTokenEventData,
  bytesToHex,
  PBinaryWriter,
  VMObject,
} from '../../src/public';

function encode(write: (writer: PBinaryWriter) => void): string {
  const writer = new PBinaryWriter();
  write(writer);
  return bytesToHex(writer.toUint8Array());
}

describe('VM event data helpers', () => {
  test('decodeVMObject decodes serialized VM objects and rejects unknown VM types', () => {
    const object = VMObject.fromObject('hello');
    if (!object) {
      throw new Error('VMObject.fromObject returned null');
    }

    const encoded = encode((writer) => object.serializeData(writer));

    expect(decodeVMObject(encoded)).toBe('hello');
    expect(() => decodeVMObject('ff')).toThrow('unsupported type 255');
  });

  test('decodes token and chain value events with typed fields', () => {
    const tokenEvent = encode((writer) => {
      writer.writeString('SOUL');
      writer.writeBigInteger(123456789n);
      writer.writeString('main');
    });
    const chainValueEvent = encode((writer) => {
      writer.writeString('height');
      writer.writeBigInteger(42n);
    });

    expect(getTokenEventData(tokenEvent)).toStrictEqual({
      symbol: 'SOUL',
      value: '123456789',
      chainName: 'main',
    });
    expect(getChainValueEventData(chainValueEvent)).toStrictEqual({
      name: 'height',
      value: 42,
    });
  });

  test('decodes signed integer event values and keeps infusion compatibility aliases', () => {
    const gasEvent = encode((writer) => {
      writer.writeByte(2);
      writer.writeBytes([0xaa, 0xbb]);
      writer.writeByte(1);
      writer.writeByte(0xf9);
      writer.writeBigInteger(9n);
    });
    const infusionEvent = encode((writer) => {
      writer.writeString('SOUL');
      writer.writeBigInteger(11n);
      writer.writeString('KCAL');
      writer.writeBigInteger(12n);
      writer.writeString('main');
    });

    expect(getGasEventData(gasEvent)).toStrictEqual({
      address: 'aabb',
      price: -7,
      amount: 9,
      endAmount: 0,
    });

    const infusion = getInfusionEventData(infusionEvent);
    expect(infusion).toMatchObject({
      baseSymbol: 'SOUL',
      tokenId: '11',
      infusedSymbol: 'KCAL',
      infusedValue: '12',
      chainName: 'main',
    });
    expect(infusion.TokenID).toBe(infusion.tokenId);
    expect(infusion.InfusedSymbol).toBe(infusion.infusedSymbol);
    expect(infusion.InfusedValue).toBe(infusion.infusedValue);
    expect(infusion.ChainName).toBe(infusion.chainName);
  });
});
