import { PBinaryReader, PBinaryWriter } from '../types/extensions/index.js';

export interface Serializable {
  serializeData(writer: PBinaryWriter): void;
  unserializeData(reader: PBinaryReader): void;
}

export interface LegacySerializable {
  SerializeData(writer: PBinaryWriter): void;
  UnserializeData(reader: PBinaryReader): void;
}

export type SerializableLike = Serializable | LegacySerializable;

export function isSerializableLike(value: unknown): value is SerializableLike {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<Serializable & LegacySerializable>;
  const hasCanonical =
    typeof candidate.serializeData === 'function' &&
    typeof candidate.unserializeData === 'function';
  const hasLegacy =
    typeof candidate.SerializeData === 'function' &&
    typeof candidate.UnserializeData === 'function';

  return hasCanonical || hasLegacy;
}

export function serializeSerializable(value: SerializableLike, writer: PBinaryWriter): void {
  if ('serializeData' in value && typeof value.serializeData === 'function') {
    value.serializeData(writer);
    return;
  }

  if ('SerializeData' in value && typeof value.SerializeData === 'function') {
    value.SerializeData(writer);
    return;
  }

  throw new Error('Serializable object is missing serializeData.');
}

export function unserializeSerializable(value: SerializableLike, reader: PBinaryReader): void {
  if ('unserializeData' in value && typeof value.unserializeData === 'function') {
    value.unserializeData(reader);
    return;
  }

  if ('UnserializeData' in value && typeof value.UnserializeData === 'function') {
    value.UnserializeData(reader);
    return;
  }

  throw new Error('Serializable object is missing unserializeData.');
}

/** @deprecated Implement `Serializable` for new code. This legacy shape will be removed in v1.0. */
export abstract class ISerializable implements LegacySerializable {
  abstract SerializeData(writer: PBinaryWriter): void;
  abstract UnserializeData(reader: PBinaryReader): void;
}
