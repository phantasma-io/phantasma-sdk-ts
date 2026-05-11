import { BinaryWriter, Encoding } from 'csharp-binary-stream';
import { hexToBytes } from '../../utils/index.js';
import { Signature, SignatureKind } from '../../interfaces/index.js';
import { Timestamp } from '../Timestamp.js';

type byte = number;

export class PBinaryWriter {
  private writer: BinaryWriter;
  _buffer: Buffer;
  _position: number;
  _length: number;
  constructor(arg1?: undefined | Buffer | Uint8Array | null) {
    this.writer = new BinaryWriter(arg1);
  }

  get length(): number {
    return this.writer.length;
  }

  get position(): number {
    return this.writer.position;
  }

  set position(value: number) {
    this.writer.position = value;
  }

  writeBoolean(value: boolean): void {
    this.writer.writeBoolean(value);
  }

  writeByte(value: number): void {
    this.writer.writeByte(value);
  }
  writeSameByte(value: number, repeats: number): void {
    this.writer.writeSameByte(value, repeats);
  }
  writeSignedByte(value: number): void {
    this.writer.writeSignedByte(value);
  }
  writeShort(value: number): void {
    this.writer.writeShort(value);
  }
  writeUnsignedShort(value: number): void {
    this.writer.writeUnsignedShort(value);
  }
  writeInt(value: number): void {
    this.writer.writeInt(value);
  }
  writeUnsignedInt(value: number): void {
    this.writer.writeUnsignedInt(value);
  }
  writeLong(value: string | number): void {
    this.writer.writeLong(value);
  }
  writeUnsignedLong(value: string | number): void {
    this.writer.writeUnsignedLong(value);
  }
  writeFloat(value: number): void {
    this.writer.writeFloat(value);
  }
  writeDouble(value: number): void {
    this.writer.writeDouble(value);
  }
  writeChar(character: string | number, encoding: Encoding): void {
    this.writer.writeChar(character, encoding);
  }
  writeChars(characters: string | number[], encoding: Encoding): void {
    this.writer.writeChars(characters, encoding);
  }
  clear(): void {
    this.writer.clear();
  }
  toArray(): number[] {
    return this.writer.toArray();
  }
  toUint8Array(): Uint8Array {
    return this.writer.toUint8Array();
  }

  public appendByte(value: number): this {
    this.writeByte(value);
    return this;
  }

  public appendBytes(bytes: Uint8Array): void {
    for (let i = 0; i < bytes.length; i++) {
      this.appendByte(bytes[i]);
    }
  }

  public writeEnum(value: number): this {
    const bytes = new Uint8Array(4);

    for (let i = 0; i < bytes.length; i++) {
      const byte = value & 0xff;
      bytes[i] = byte;
      value = (value - byte) / 256;
    }

    this.appendBytes(bytes);
    return this;
  }

  writeBytes(bytes: byte[]): this {
    for (let i = 0; i < bytes.length; i++) this.appendByte(bytes[i]);

    // writer.Write(bytes);
    return this;
  }

  public writeVarInt(value: number): this {
    if (value < 0) throw 'negative value invalid';

    if (value < 0xfd) {
      this.appendByte(value);
    } else if (value <= 0xffff) {
      const B = (value & 0x0000ff00) >> 8;
      const A = value & 0x000000ff;

      // VM variable integers append the least significant byte first.
      this.appendByte(0xfd);
      this.appendByte(A);
      this.appendByte(B);
    } else if (value <= 0xffffffff) {
      const C = (value & 0x00ff0000) >> 16;
      const B = (value & 0x0000ff00) >> 8;
      const A = value & 0x000000ff;

      // VM variable integers append the least significant byte first.
      this.appendByte(0xfe);
      this.appendByte(A);
      this.appendByte(B);
      this.appendByte(C);
    } else {
      const D = (value & 0xff000000) >> 24;
      const C = (value & 0x00ff0000) >> 16;
      const B = (value & 0x0000ff00) >> 8;
      const A = value & 0x000000ff;

      // VM variable integers append the least significant byte first.
      this.appendByte(0xff);
      this.appendByte(A);
      this.appendByte(B);
      this.appendByte(C);
      this.appendByte(D);
    }
    return this;
  }

  public writeTimestamp(obj: Timestamp): this {
    const num = obj.value;

    const a = (num & 0xff000000) >> 24;
    const b = (num & 0x00ff0000) >> 16;
    const c = (num & 0x0000ff00) >> 8;
    const d = num & 0x000000ff;

    const bytes = Uint8Array.from([d, c, b, a]);
    this.appendBytes(bytes);
    return this;
  }

  public writeDateTime(obj: Date): this {
    const num = (obj.getTime() / 1000) | 0;

    const a = (num & 0xff000000) >> 24;
    const b = (num & 0x00ff0000) >> 16;
    const c = (num & 0x0000ff00) >> 8;
    const d = num & 0x000000ff;

    const bytes = Uint8Array.from([d, c, b, a]);
    this.appendBytes(bytes);
    return this;
  }

  rawString(value: string): number[] {
    const data = [];
    for (let i = 0; i < value.length; i++) {
      data.push(value.charCodeAt(i));
    }
    return data;
  }

  public writeByteArray(bytes: number[] | Uint8Array) {
    if (bytes instanceof Uint8Array) {
      bytes = Array.from(bytes);
    }
    this.writeVarInt(bytes.length);
    this.writeBytes(bytes);
    return this;
  }

  public writeString(text: string): this {
    const bytes = this.rawString(text);
    this.writeVarInt(bytes.length);
    this.writeBytes(bytes);
    return this;
  }

  public emitUInt32(value: number): this {
    if (value < 0) throw 'negative value invalid';

    const D = (value & 0xff000000) >> 24;
    const C = (value & 0x00ff0000) >> 16;
    const B = (value & 0x0000ff00) >> 8;
    const A = value & 0x000000ff;

    // VM integers append the least significant byte first.
    this.appendByte(0xff);
    this.appendByte(A);
    this.appendByte(B);
    this.appendByte(C);
    this.appendByte(D);

    return this;
  }

  public writeBigInteger(value: bigint) {
    return this.writeBigIntegerString(value.toString());
  }

  public writeBigIntegerString(value: string) {
    let bytes: number[] = [];

    if (value == '0') {
      bytes = [0];
    } else if (value.startsWith('-1')) {
      throw new Error('Unsigned bigint serialization not suppoted');
    } else {
      let hex = BigInt(value).toString(16);
      if (hex.length % 2) hex = '0' + hex;
      const len = hex.length / 2;
      let i = 0;
      let j = 0;
      while (i < len) {
        bytes.unshift(parseInt(hex.slice(j, j + 2), 16)); // little endian
        i += 1;
        j += 2;
      }
      bytes.push(0); // add sign at the end
    }
    return this.writeByteArray(bytes);
  }

  public writeSignature(signature: Signature): this {
    if (!signature) {
      this.writeByte(SignatureKind.None);
      return this;
    }
    this.writeByte(signature.Kind);
    signature.SerializeData(this);
    return this;
  }

  public AppendHexEncoded(bytesHex: string): this {
    const bytes = hexToBytes(bytesHex);
    this.writeVarInt(bytes.length);
    this.appendBytes(bytes);
    return this;
  }
}
