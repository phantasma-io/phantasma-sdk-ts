import { IKeyPair, KeyPair } from '../interfaces/key-pair.js';
import { Signature, SignatureKind } from '../interfaces/signature.js';
import { Address } from './address.js';

import { stringToUint8Array } from '../utils/index.js';
import { PBinaryWriter, PBinaryReader } from './extensions/index.js';
import { signEd25519, verifyEd25519 } from './ed25519.js';

export class Ed25519Signature implements Signature {
  public Bytes: Uint8Array;
  public Kind: SignatureKind = SignatureKind.Ed25519;

  constructor(bytes: Uint8Array = new Uint8Array()) {
    this.Bytes = bytes;
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
      if (verifyEd25519(message, this.Bytes, pubKey)) {
        return true;
      }
    }
    return false;
  }

  /** @deprecated Use `verifyMultiple` instead. This alias will be removed in v1.0. */
  public VerifyMultiple(message: Uint8Array, addresses: Address[]): boolean {
    return this.verifyMultiple(message, addresses);
  }

  public SerializeData(writer: PBinaryWriter) {
    //writer.writeString(uint8ArrayToString(this.Bytes));
    writer.writeByteArray(this.Bytes);
  }

  public UnserializeData(reader: PBinaryReader) {
    this.Bytes = stringToUint8Array(reader.readString());
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
