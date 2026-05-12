import { CarbonBlobLike } from '../../interfaces/carbon/carbon-blob-like.js';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../carbon-serialization.js';
import { bytesToHex } from '../../utils/hex.js';

export class Bytes32 implements CarbonBlobLike {
  static readonly Empty = new Bytes32(new Uint8Array(32));
  constructor(public bytes: Uint8Array = new Uint8Array(32)) {
    if (bytes.length !== 32) throw new Error('Bytes32 length must be 32');
    this.bytes = new Uint8Array(bytes);
  }
  write(w: CarbonBinaryWriter): void {
    w.write32(this.bytes);
  }
  read(r: CarbonBinaryReader): void {
    this.bytes = r.read32();
  }
  static read(r: CarbonBinaryReader): Bytes32 {
    const v = new Bytes32();
    v.read(r);
    return v;
  }
  equals(other: Bytes32): boolean {
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
    return `Bytes32(${this.toHex()})`;
  }
}
