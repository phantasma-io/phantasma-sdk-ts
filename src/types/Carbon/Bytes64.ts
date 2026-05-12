import { CarbonBlobLike } from '../../interfaces/Carbon/ICarbonBlob.js';
import { bytesToHex } from '../../utils/Hex.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../CarbonSerialization.js';

export class Bytes64 implements CarbonBlobLike {
  static readonly Empty = new Bytes64(new Uint8Array(64));
  constructor(public bytes: Uint8Array = new Uint8Array(64)) {
    if (bytes.length !== 64) throw new Error('Bytes64 length must be 64');
    this.bytes = new Uint8Array(bytes);
  }
  write(w: CarbonBinaryWriter): void {
    w.write64(this.bytes);
  }
  read(r: CarbonBinaryReader): void {
    this.bytes = r.read64();
  }
  static read(r: CarbonBinaryReader): Bytes64 {
    const v = new Bytes64();
    v.read(r);
    return v;
  }
  equals(other: Bytes64): boolean {
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
    return `Bytes64(${this.toHex()})`;
  }
}
