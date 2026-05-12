import type { PBinaryReader, PBinaryWriter } from './extensions/index.js';

export class Timestamp {
  public value: number;

  constructor(value: number) {
    this.value = value;
  }

  public toString() {
    return new Date(this.value * 1000).toUTCString();
  }

  public toStringFormat(_format?: string) {
    void _format;
    return new Date(this.value * 1000).toUTCString();
  }

  public static now = Date.now();
  public static null = new Timestamp(0);

  public compareTo(other: Timestamp) {
    if (other.value === this.value) {
      return 0;
    }

    if (this.value < other.value) {
      return -1;
    }

    return 1;
  }

  public equals(obj: unknown) {
    if (!(obj instanceof Timestamp)) {
      return false;
    }

    return this.value === obj.value;
  }

  public getHashCode() {
    return this.value;
  }

  public getSize() {
    return 4;
  }

  public static equal(A: Timestamp, B: Timestamp) {
    return A.value === B.value;
  }

  public static notEqual(A: Timestamp, B: Timestamp) {
    return !(A.value === B.value);
  }

  public static lessThan(A: Timestamp, B: Timestamp) {
    return A.value < B.value;
  }

  public static greaterThan(A: Timestamp, B: Timestamp) {
    return A.value > B.value;
  }

  public static lessThanOrEqual(A: Timestamp, B: Timestamp) {
    return A.value <= B.value;
  }

  public static greaterThanOrEqual(A: Timestamp, B: Timestamp) {
    return A.value >= B.value;
  }

  public static subtract(A: Timestamp, B: Timestamp) {
    return A.value - B.value;
  }

  public static fromNumber(ticks: number) {
    return new Timestamp(ticks);
  }

  public static fromDate(time: Date) {
    return new Timestamp(time.getTime() / 1000);
  }

  public static addTimeSpan(A: Timestamp, B: number) {
    return A.value + B;
  }
  public static subtractTimeSpan(A: Timestamp, B: number) {
    return A.value - B;
  }

  public serializeData(writer: PBinaryWriter): void {
    writer.writeTimestamp(this);
  }

  public unserializeData(reader: PBinaryReader): void {
    this.value = reader.readTimestamp().value;
  }

  static serialize(timestamp: Timestamp, writer: PBinaryWriter): void {
    timestamp.serializeData(writer);
  }

  static deserialize(reader: PBinaryReader): Timestamp {
    return reader.readTimestamp();
  }

  /** @deprecated Use `serializeData` or `Timestamp.serialize` instead. This alias will be removed in v1.0. */
  public static Serialize(timestamp?: Timestamp, writer?: PBinaryWriter): void {
    if (timestamp !== undefined && writer !== undefined) {
      Timestamp.serialize(timestamp, writer);
    }
  }

  /** @deprecated Use `Timestamp.deserialize` instead. This alias will be removed in v1.0. */
  public static Unserialize(reader?: PBinaryReader): Timestamp | undefined {
    return reader === undefined ? undefined : Timestamp.deserialize(reader);
  }
}
