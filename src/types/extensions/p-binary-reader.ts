import { BinaryReader, Encoding } from 'csharp-binary-stream';
import { SignatureKind, Signature } from '../../interfaces/index.js';
import { bytesToHex, stringToUint8Array } from '../../utils/index.js';
import { VMType } from '../../vm/index.js';
import { Ed25519Signature } from '../ed25519-signature.js';
import { Timestamp } from '../timestamp.js';
import { twosComplementLEToBigInt } from '../carbon-serialization.js';

export class PBinaryReader {
  reader: BinaryReader;
  get length(): number {
    return this.reader.length;
  }
  get position(): number {
    return this.reader.position;
  }
  set position(value: number) {
    this.reader.position = value;
  }
  get isEndOfStream(): boolean {
    return this.reader.isEndOfStream;
  }
  readBoolean(): boolean {
    return this.reader.readBoolean();
  }
  readByte(): number {
    return this.reader.readByte();
  }
  readBytes(bytesToRead: number): number[] {
    return this.reader.readBytes(bytesToRead);
  }
  readSignedByte(): number {
    return this.reader.readSignedByte();
  }
  readShort(): number {
    return this.reader.readShort();
  }
  readUnsignedShort(): number {
    return this.reader.readUnsignedShort();
  }
  readInt(): number {
    return this.reader.readInt();
  }
  readUnsignedInt(): number {
    return this.reader.readUnsignedInt();
  }
  readLongString(): string {
    return this.reader.readLongString();
  }
  readLong(): number {
    return this.reader.readLong();
  }
  readUnsignedLongString(): string {
    return this.reader.readUnsignedLongString();
  }
  readUnsignedLong(): number {
    return this.reader.readUnsignedLong();
  }
  readFloat(): number {
    return this.reader.readFloat();
  }
  readDouble(): number {
    return this.reader.readDouble();
  }
  readChar(encoding: Encoding): string {
    return this.reader.readChar(encoding);
  }
  readChars(charactersToRead: number, encoding: Encoding): string {
    return this.reader.readChars(charactersToRead, encoding);
  }
  readCharBytes(bytesToRead: number, encoding: Encoding): string {
    return this.reader.readCharBytes(bytesToRead, encoding);
  }

  constructor(arg1: Buffer | Uint8Array) {
    this.reader = new BinaryReader(arg1);
  }

  public read(numBytes: number): string {
    const res = bytesToHex(this.readBytes(numBytes)).substr(0, numBytes * 2);
    //this.position += numBytes;
    return res;
  }

  public readString(): string {
    const len = this.readVarInt();
    return this.readStringBytes(len);
  }

  public readStringBytes(numBytes: number) {
    let res = '';
    for (let i = 0; i < numBytes; ++i) {
      res += String.fromCharCode(this.readByte());
    }
    return res;
  }

  public readBigInteger(): bigint {
    const len = this.readVarInt();
    return twosComplementLEToBigInt(Uint8Array.from(this.readBytes(len)));
  }

  public readBigIntAccurate() {
    return this.readBigInteger().toString();
  }

  public readSignatureV2(): Signature | null {
    const kind = this.readByte() as SignatureKind;
    const signature: Signature = new Ed25519Signature();
    signature.kind = kind;

    switch (kind) {
      case SignatureKind.None:
        return null;

      case SignatureKind.Ed25519:
        const len = this.readVarInt();
        signature.bytes = new Uint8Array(this.readBytes(len));
        break;
      case SignatureKind.ECDSA:
        this.readByte();
        signature.bytes = stringToUint8Array(this.readString());
        break;
      default:
        throw new Error(`read signature: unsupported kind ${kind}`);
    }

    return signature;
  }

  public readSignature(): Signature | null {
    const kind = this.readByte() as SignatureKind;
    const signature: Signature = new Ed25519Signature();
    signature.kind = kind;
    switch (kind) {
      case SignatureKind.None:
        return null;

      case SignatureKind.Ed25519:
        const len = this.readVarInt();
        signature.bytes = stringToUint8Array(this.read(len));
        break;
      case SignatureKind.ECDSA:
        this.readByte();
        signature.bytes = stringToUint8Array(this.readString());
        break;
      default:
        throw new Error(`read signature: unsupported kind ${kind}`);
    }

    return signature;
  }

  public readByteArray(): string {
    const length = this.readVarInt();
    if (length == 0) return '';

    const res = this.read(length);
    return res;
  }

  public readTimestamp(): Timestamp {
    //var len = this.readByte();
    let result = 0;
    const bytes = this.read(4);
    (bytes.match(/.{1,2}/g) ?? [])
      .reverse()
      .forEach((c) => (result = result * 256 + parseInt(c, 16)));

    const timestamp = new Timestamp(result);
    return timestamp;
  }

  public readVarInt(): number {
    const len = this.readByte();
    let res = 0;
    if (len === 0xfd) {
      [...(this.read(2).match(/.{1,2}/g) ?? [])]
        .reverse()
        .forEach((c) => (res = res * 256 + parseInt(c, 16)));
      return res;
    } else if (len === 0xfe) {
      [...(this.read(4).match(/.{1,2}/g) ?? [])]
        .reverse()
        .forEach((c) => (res = res * 256 + parseInt(c, 16)));
      return res;
    } else if (len === 0xff) {
      [...(this.read(8).match(/.{1,2}/g) ?? [])]
        .reverse()
        .forEach((c) => (res = res * 256 + parseInt(c, 16)));
      return res;
    }
    return len;
  }

  public readVarString(): string {
    const len = this.readVarInt();
    if (len == 0) return '';
    return this.readStringBytes(len);
  }

  public readVmObject() {
    const type = this.readByte();
    switch (type) {
      case VMType.String:
        return this.readString();
      case VMType.Number:
        return this.readBigIntAccurate();
      case VMType.Bool:
        return this.readByte() != 0;
      case VMType.Struct:
        const numFields = this.readVarInt();
        const res: Record<string, unknown> = {};
        for (let i = 0; i < numFields; ++i) {
          const key = String(this.readVmObject());
          const value = this.readVmObject();
          res[key] = value;
        }
        return res;
      case VMType.Enum:
        return this.readVarInt();
      case VMType.Object:
        const numBytes = this.readVarInt();
        return this.read(numBytes);
      default:
        throw new Error(`read VM object: unsupported type ${type}`);
    }
  }
}
