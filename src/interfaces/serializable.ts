import { PBinaryReader, PBinaryWriter } from '../types/extensions/index.js';

export abstract class ISerializable {
  abstract SerializeData(writer: PBinaryWriter): void;
  abstract UnserializeData(reader: PBinaryReader): void;
}
