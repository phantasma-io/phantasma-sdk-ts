import { IKeyPair } from '../interfaces/IKeyPair.js';
import { Signature, SignatureKind } from '../interfaces/Signature.js';
import { Address } from './Address.js';

import { stringToUint8Array } from '../utils/index.js';
import { PBinaryWriter, PBinaryReader } from './Extensions/index.js';
import { signEd25519, verifyEd25519 } from './Ed25519.js';

export class Ed25519Signature implements Signature {
  public Bytes: Uint8Array;
  public Kind: SignatureKind = SignatureKind.Ed25519;

  constructor(bytes?: Uint8Array) {
    this.Bytes = bytes;
  }

  Verify(message: Uint8Array, address: Address): boolean {
    return this.VerifyMultiple(message, [address]);
  }

  public VerifyMultiple(message: Uint8Array, addresses: Address[]): boolean {
    for (const address of addresses) {
      if (!address.IsUser) {
        continue;
      }
      const pubKey = address.ToByteArray().slice(2);
      if (verifyEd25519(message, this.Bytes, pubKey)) {
        return true;
      }
    }
    return false;
  }

  public SerializeData(writer: PBinaryWriter) {
    //writer.writeString(uint8ArrayToString(this.Bytes));
    writer.writeByteArray(this.Bytes);
  }

  public UnserializeData(reader: PBinaryReader) {
    this.Bytes = stringToUint8Array(reader.readString());
  }

  ToByteArray(): Uint8Array {
    const stream = new Uint8Array(64);
    const writer = new PBinaryWriter(stream);
    this.SerializeData(writer);
    return new Uint8Array(stream);
  }

  public static Generate(keypair: IKeyPair, message: Uint8Array): Ed25519Signature {
    return new Ed25519Signature(signEd25519(message, keypair.PrivateKey));
  }
}
