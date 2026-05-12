import bigInt from 'big-integer';
import { ISignature, SignatureKind } from '../interfaces/index.js';
import { VMType } from './VMType.js';
import { logger } from '../utils/logger.js';

export class Decoder {
  str: string;

  constructor(str: string) {
    this.str = str;
  }

  isEnd() {
    return this.str.length == 0;
  }

  readCharPair() {
    const res = this.str.substr(0, 2);
    this.str = this.str.slice(2);
    return res;
  }

  readByte() {
    return parseInt(this.readCharPair(), 16);
  }

  read(numBytes: number): string {
    const res = this.str.substr(0, numBytes * 2);
    this.str = this.str.slice(numBytes * 2);
    return res;
  }

  readString(): string {
    const len = this.readVarInt();
    return this.readStringBytes(len);
  }

  readStringBytes(numBytes: number) {
    let res = '';
    for (let i = 0; i < numBytes; ++i) {
      res += String.fromCharCode(this.readByte());
    }
    return res;
  }

  readByteArray() {
    const length = this.readVarInt();
    if (length == 0) return [];

    const res = this.read(length);
    return res;
  }

  readSignature() {
    const kind = this.readByte() as SignatureKind;
    const signature: ISignature = new ISignature();
    signature.kind = kind;
    switch (kind) {
      case SignatureKind.None:
        return null;

      case SignatureKind.Ed25519:
        const len = this.readVarInt();
        signature.signature = this.read(len);
        break;
      case SignatureKind.ECDSA:
        this.readByte();
        signature.signature = this.readString();
        break;
      default:
        throw 'read signature: ' + kind;
    }

    return signature;
  }

  readTimestamp() {
    //var len = this.readByte();
    let result = 0;
    const bytes = this.read(4);
    (bytes.match(/.{1,2}/g) ?? [])
      .reverse()
      .forEach((c) => (result = result * 256 + parseInt(c, 16)));
    return result;
  }

  readVarInt() {
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

  readBigInt() {
    // TO DO: implement negative numbers
    const len = this.readVarInt();
    let res = 0;
    const stringBytes = this.read(len);
    [...(stringBytes.match(/.{1,2}/g) ?? [])]
      .reverse()
      .forEach((c) => (res = res * 256 + parseInt(c, 16)));
    return res;
  }

  readBigIntAccurate() {
    const len = this.readVarInt();
    let res = bigInt();
    const stringBytes = this.read(len);
    [...(stringBytes.match(/.{1,2}/g) ?? [])].reverse().forEach((c) => {
      res = res.times(256).plus(parseInt(c, 16));
    });
    return res.toString();
  }

  readVmObject() {
    const type = this.readByte();
    logger.log('type', type);
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
          logger.log('  key', key);
          const value = this.readVmObject();
          logger.log('  value', value);
          res[key] = value;
        }
        return res;
      case VMType.Enum:
        return this.readVarInt();
      case VMType.Object:
        const numBytes = this.readVarInt();
        return this.read(numBytes);
      default:
        return 'unsupported type ' + type;
    }
  }
}
