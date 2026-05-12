import { Address, PBinaryReader, PBinaryWriter } from '../types/index.js';
import { ISerializable } from './ISerializable.js';

export enum SignatureKind {
  None,
  Ed25519,
  ECDSA,
}

export class ISignature {
  signature = '';
  kind: SignatureKind = SignatureKind.None;
}

export abstract class Signature implements ISerializable {
  abstract Bytes: Uint8Array;
  abstract Kind: SignatureKind;
  abstract SerializeData(writer: PBinaryWriter): void;
  abstract UnserializeData(reader: PBinaryReader): void;
  abstract verifyMultiple(message: Uint8Array, addresses: Address[]): boolean;

  verify(message: Uint8Array, address: Address): boolean {
    return this.verifyMultiple(message, [address]);
  }

  /** @deprecated Use `verifyMultiple` instead. This alias will be removed in v1.0. */
  VerifyMultiple(message: Uint8Array, addresses: Address[]): boolean {
    return this.verifyMultiple(message, addresses);
  }

  /** @deprecated Use `verify` instead. This alias will be removed in v1.0. */
  Verify(message: Uint8Array, address: Address): boolean {
    return this.verify(message, address);
  }

  toByteArray(): Uint8Array {
    const stream = new Uint8Array(64);
    const writer = new PBinaryWriter(stream);
    this.SerializeData(writer);
    return new Uint8Array(stream);
  }

  /** @deprecated Use `toByteArray` instead. This alias will be removed in v1.0. */
  ToByteArray(): Uint8Array {
    return this.toByteArray();
  }
}
