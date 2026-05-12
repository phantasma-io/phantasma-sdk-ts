import { CarbonBinaryReader, CarbonBinaryWriter } from '../../types/CarbonSerialization.js';

export interface CarbonBlobLike {
  write(w: CarbonBinaryWriter): void;
  read(r: CarbonBinaryReader): void;
}

/** @deprecated Use `CarbonBlobLike` instead. This compatibility interface will be removed in v1.0. */
export type ICarbonBlob = CarbonBlobLike;
