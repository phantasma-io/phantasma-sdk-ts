import { PBinaryReader, PBinaryWriter } from './extensions/index.js';
import { Timestamp } from './timestamp.js';
import {
  isSerializableLike,
  serializeSerializable,
  unserializeSerializable,
} from '../interfaces/index.js';
import { stringToUint8Array } from '../utils/index.js';

export interface CustomReader {
  (reader: PBinaryReader): unknown;
}
export interface CustomWriter {
  (writer: PBinaryWriter, obj: unknown): void;
}
export class CustomSerializer {
  readonly read: CustomReader;
  readonly write: CustomWriter;
  constructor(reader: CustomReader, writer: CustomWriter) {
    this.read = reader;
    this.write = writer;
  }

  /** @deprecated Use `read` instead. This alias will be removed in v1.0. */
  get Read(): CustomReader {
    return this.read;
  }

  /** @deprecated Use `write` instead. This alias will be removed in v1.0. */
  get Write(): CustomWriter {
    return this.write;
  }
}

type Constructor<T = unknown> = new () => T;
export class Serialization {
  private static _customSerializers: Map<string, CustomSerializer> = new Map<
    string,
    CustomSerializer
  >(); //: { [key: string]: CustomSerializer };

  static registerType<T>(type: T, reader: CustomReader, writer: CustomWriter): void {
    Serialization._customSerializers.set(typeof type, new CustomSerializer(reader, writer));
  }

  /** @deprecated Use `registerType` instead. This alias will be removed in v1.0. */
  static RegisterType<T>(type: T, reader: CustomReader, writer: CustomWriter): void {
    this.registerType(type, reader, writer);
  }

  static serializeEnum(obj: unknown): Uint8Array {
    if (!obj) {
      return new Uint8Array();
    }

    if (obj instanceof Uint8Array) {
      return obj;
    }

    const writer = new PBinaryWriter();
    writer.writeEnum(Number(obj));
    return writer.toUint8Array();
  }

  /** @deprecated Use `serializeEnum` instead. This alias will be removed in v1.0. */
  static SerializeEnum(obj: unknown): Uint8Array {
    return this.serializeEnum(obj);
  }

  static serialize(obj: unknown): Uint8Array {
    if (!obj) {
      return new Uint8Array();
    }

    if (obj instanceof Uint8Array) {
      return obj;
    }

    //let jsonString = JSON.stringify(obj);
    const writer = new PBinaryWriter();
    this.serializeObject(writer, obj, typeof obj);
    //let jsonAsUint8 = new TextEncoder().encode(jsonString);
    return writer.toUint8Array();
  }

  /** @deprecated Use `serialize` instead. This alias will be removed in v1.0. */
  static Serialize(obj: unknown): Uint8Array {
    return this.serialize(obj);
  }

  static serializeObject(writer: PBinaryWriter, obj: unknown, type: unknown | null) {
    if (type == null || type == undefined) {
      type = typeof obj;
      this.serializeObject(writer, obj, type);
      return;
    }

    const serializer = Serialization._customSerializers.get(typeof type);
    if (serializer !== undefined) {
      serializer.write(writer, obj);
      return;
    }

    /*if (typeof obj == "void") {
      return;
    }*/
    if (obj instanceof Boolean || typeof obj == 'boolean') {
      writer.writeByte(obj ? 1 : 0);
      return;
    } else if (obj instanceof Number || typeof obj == 'number') {
      writer.writeByte(stringToUint8Array(obj.toString()).length);
      writer.writeVarInt(obj as number);
      return;
    } else if (typeof obj == 'bigint') {
      writer.writeBigInteger(obj);
      return;
    } else if (obj instanceof String || typeof obj == 'string') {
      writer.writeString(obj as string);
      return;
    } else if (obj instanceof Timestamp) {
      writer.writeTimestamp(obj);
      return;
    } else if (obj instanceof Date) {
      writer.writeDateTime(obj);
      return;
    } else if (isSerializableLike(obj)) {
      serializeSerializable(obj, writer);
      return;
    } else if (Array.isArray(obj)) {
      writer.writeVarInt(obj.length);
      obj.forEach((entry) => {
        this.serializeObject(writer, entry, typeof entry);
      });
      return;
    } else if (Object.getPrototypeOf(type) == 'enum') {
      writer.writeByte(obj as unknown as number);
      return;
    } else if (obj instanceof Uint8Array) {
      writer.writeByteArray(Array.from(obj));
      return;
    } else {
      // Plain-object serialization is intentionally field-value only. The wire
      // format is not self-describing, so callers must deserialize with a known type.
      const fields = Object.keys(obj as object);
      fields.forEach((field) => {
        const value = (obj as Record<string, unknown>)[field];
        this.serializeObject(writer, value, typeof value);
      });
    }
  }

  /** @deprecated Use `serializeObject` instead. This alias will be removed in v1.0. */
  static SerializeObject(writer: PBinaryWriter, obj: unknown, type: unknown | null) {
    this.serializeObject(writer, obj, type);
  }

  static deserialize<T>(bytesOrBytes: Uint8Array | PBinaryReader, type?: unknown): T {
    if (bytesOrBytes instanceof PBinaryReader) {
      return Serialization.deserializeObject(bytesOrBytes, type) as T;
    }
    if (!bytesOrBytes || bytesOrBytes.length === 0) {
      return null as T;
    }
    //let type = Object.prototype.propertyIsEnumerable(T);
    const stream: PBinaryReader = new PBinaryReader(bytesOrBytes);
    return Serialization.deserializeObject<T>(stream, type) as T;
  }

  /** @deprecated Use `deserialize` instead. This alias will be removed in v1.0. */
  static Unserialize<T>(bytesOrBytes: Uint8Array | PBinaryReader, type?: unknown): T {
    return this.deserialize<T>(bytesOrBytes, type);
  }

  static deserializeObject<T>(reader: PBinaryReader, type: Constructor<T> | unknown): T {
    const serializer = Serialization._customSerializers.get(typeof type);
    if (serializer !== undefined) {
      return serializer.read(reader) as T;
    }

    if (type == null || type == undefined) {
      return null as T;
    }

    let localType; //: typeof type;

    const constructorType = type as Constructor<T> & { name?: string };

    if (
      typeof type === 'function' &&
      constructorType.name !== 'Boolean' &&
      constructorType.name !== 'Number' &&
      constructorType.name !== 'BigInt' &&
      constructorType.name !== 'String' &&
      constructorType.name !== 'Timestamp'
    ) {
      localType = new constructorType();
    }

    if (
      localType instanceof Boolean ||
      typeof localType == 'boolean' ||
      constructorType.name == 'Boolean'
    ) {
      return reader.readBoolean() as unknown as T;
    } else if (
      localType instanceof Number ||
      typeof localType == 'number' ||
      constructorType.name == 'Number'
    ) {
      return reader.readVarInt() as unknown as T;
    } else if (
      localType instanceof BigInt ||
      typeof localType == 'bigint' ||
      constructorType.name == 'BigInt'
    ) {
      return reader.readBigInteger() as unknown as T;
    } else if (
      localType instanceof String ||
      typeof localType == 'string' ||
      constructorType.name == 'String'
    ) {
      return reader.readVarString() as unknown as T;
    } else if (localType instanceof Timestamp || constructorType.name == 'Timestamp') {
      return new Timestamp(reader.readVarInt()) as unknown as T;
    } else if (isSerializableLike(localType)) {
      const obj = localType;
      unserializeSerializable(obj, reader);
      return obj as T;
    } else if (Array.isArray(type)) {
      const len = reader.readByte();
      const arr = new Array(len);
      for (let i = 0; i < len; i++) {
        arr[i] = this.deserializeObject(reader, type[i]);
      }
      return arr as unknown as T;
    } else if (Object.getPrototypeOf(type) == 'enum') {
      return reader.readByte() as unknown as T;
    } else {
      Object.keys(localType as object);
      /*console.log(fields);
      fields.forEach((field) => {
        localType[field] = this.UnserializeObject(
          reader,
          typeof localType[field]
        );
      });
      return localType as T;*/
      return localType as T;
    }
  }

  /** @deprecated Use `deserializeObject` instead. This alias will be removed in v1.0. */
  static UnserializeObject<T>(reader: PBinaryReader, type: Constructor<T> | unknown): T {
    return this.deserializeObject<T>(reader, type);
  }
}
