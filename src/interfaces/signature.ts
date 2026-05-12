import { Address, PBinaryReader, PBinaryWriter } from '../types/index.js';
import { ISerializable } from './serializable.js';

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
  /** @deprecated Use `bytes` instead. This alias will be removed in v1.0. */
  abstract Bytes: Uint8Array;
  /** @deprecated Use `kind` instead. This alias will be removed in v1.0. */
  abstract Kind: SignatureKind;
  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  abstract SerializeData(writer: PBinaryWriter): void;
  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  abstract UnserializeData(reader: PBinaryReader): void;
  abstract verifyMultiple(message: Uint8Array, addresses: Address[]): boolean;

  get bytes(): Uint8Array {
    return this.Bytes;
  }

  set bytes(value: Uint8Array) {
    this.Bytes = value;
  }

  get kind(): SignatureKind {
    return this.Kind;
  }

  set kind(value: SignatureKind) {
    this.Kind = value;
  }

  serializeData(writer: PBinaryWriter): void {
    this.SerializeData(writer);
  }

  unserializeData(reader: PBinaryReader): void {
    this.UnserializeData(reader);
  }

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
    this.serializeData(writer);
    return new Uint8Array(stream);
  }

  /** @deprecated Use `toByteArray` instead. This alias will be removed in v1.0. */
  ToByteArray(): Uint8Array {
    return this.toByteArray();
  }
}
