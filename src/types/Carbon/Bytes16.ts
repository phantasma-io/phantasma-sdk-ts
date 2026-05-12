import { CarbonBlobLike } from '../../interfaces/Carbon/ICarbonBlob.js';
import { bytesToHex } from '../../utils/Hex.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../CarbonSerialization.js';

export class Bytes16 implements CarbonBlobLike {
  static readonly Empty = new Bytes16(new Uint8Array(16));
  constructor(public bytes: Uint8Array = new Uint8Array(16)) {
    if (bytes.length !== 16) throw new Error('Bytes16 length must be 16');
    this.bytes = new Uint8Array(bytes);
  }
  write(w: CarbonBinaryWriter): void {
    w.write16(this.bytes);
  }
  read(r: CarbonBinaryReader): void {
    this.bytes = r.read16();
  }
  static read(r: CarbonBinaryReader): Bytes16 {
    const v = new Bytes16();
    v.read(r);
    return v;
  }
  equals(other: Bytes16): boolean {
    const a = this.bytes,
      b = other.bytes;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  toHex(): string {
    return bytesToHex(this.bytes);
  }

  /** @deprecated Use `toHex` instead. This alias will be removed in v1.0. */
  ToHex(): string {
    return this.toHex();
  }

  // Used by console.log / util.inspect
  [Symbol.for('nodejs.util.inspect.custom')]() {
    // Return a pretty, concise representation
    return `Bytes16(${this.toHex()})`;
  }
}
