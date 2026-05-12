import { IKeyPair, KeyPair } from '../interfaces/key-pair.js';
import { Signature, SignatureKind } from '../interfaces/signature.js';
import { Address } from './address.js';

import { stringToUint8Array } from '../utils/index.js';
import { PBinaryWriter, PBinaryReader } from './extensions/index.js';
import { signEd25519, verifyEd25519 } from './ed25519.js';

export class Ed25519Signature implements Signature {
  public bytes: Uint8Array;
  public kind: SignatureKind = SignatureKind.Ed25519;

  constructor(bytes: Uint8Array = new Uint8Array()) {
    this.bytes = bytes;

    // Preserve the old public-field reflection shape while routing behavior to
    // the canonical lower-camel storage. Some consumers inspect or spread SDK
    // objects instead of only reading properties.
    Object.defineProperties(this, {
      Bytes: {
        configurable: true,
        enumerable: true,
        get: () => this.bytes,
        set: (value: Uint8Array) => {
          this.bytes = value;
        },
      },
      Kind: {
        configurable: true,
        enumerable: true,
        get: () => this.kind,
        set: (value: SignatureKind) => {
          this.kind = value;
        },
      },
    });
  }

  /** @deprecated Use `bytes` instead. This alias will be removed in v1.0. */
  public get Bytes(): Uint8Array {
    return this.bytes;
  }

  public set Bytes(value: Uint8Array) {
    this.bytes = value;
  }

  /** @deprecated Use `kind` instead. This alias will be removed in v1.0. */
  public get Kind(): SignatureKind {
    return this.kind;
  }

  public set Kind(value: SignatureKind) {
    this.kind = value;
  }

  verify(message: Uint8Array, address: Address): boolean {
    return this.verifyMultiple(message, [address]);
  }

  /** @deprecated Use `verify` instead. This alias will be removed in v1.0. */
  Verify(message: Uint8Array, address: Address): boolean {
    return this.verify(message, address);
  }

  public verifyMultiple(message: Uint8Array, addresses: Address[]): boolean {
    for (const address of addresses) {
      if (!address.isUser) {
        continue;
      }
      const pubKey = address.toByteArray().slice(2);
      if (verifyEd25519(message, this.bytes, pubKey)) {
        return true;
      }
    }
    return false;
  }

  /** @deprecated Use `verifyMultiple` instead. This alias will be removed in v1.0. */
  public VerifyMultiple(message: Uint8Array, addresses: Address[]): boolean {
    return this.verifyMultiple(message, addresses);
  }

  public serializeData(writer: PBinaryWriter) {
    writer.writeByteArray(this.bytes);
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  public SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  public unserializeData(reader: PBinaryReader) {
    this.bytes = stringToUint8Array(reader.readString());
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  public UnserializeData(reader: PBinaryReader) {
    this.unserializeData(reader);
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

  public static generate(keypair: KeyPair, message: Uint8Array): Ed25519Signature;
  public static generate(keypair: IKeyPair, message: Uint8Array): Ed25519Signature;
  public static generate(keypair: KeyPair | IKeyPair, message: Uint8Array): Ed25519Signature {
    const privateKey = 'privateKey' in keypair ? keypair.privateKey : keypair.PrivateKey;
    return new Ed25519Signature(signEd25519(message, privateKey));
  }

  /** @deprecated Use `generate` instead. This alias will be removed in v1.0. */
  public static Generate(keypair: IKeyPair, message: Uint8Array): Ed25519Signature {
    return Ed25519Signature.generate(keypair, message);
  }
}
