import { logger } from '../utils/logger.js';
import { ScriptBuilder } from '../vm/index.js';
import { bytesToHex, hexToBytes, getDifficulty } from '../utils/index.js';
import hexEncoding from 'crypto-js/enc-hex.js';
import SHA256 from 'crypto-js/sha256.js';
import { ISerializable, Signature } from '../interfaces/index.js';
import { Address, Base16, PBinaryReader, PBinaryWriter, PhantasmaKeys } from '../types/index.js';
import { getWifFromPrivateKey } from './utils.js';
import { signEd25519 } from '../types/ed25519.js';

export class Transaction implements ISerializable {
  script: string; // Should be HexString
  nexusName: string;
  chainName: string;
  payload: string; // Should be HexString
  expiration: Date;
  signatures: Array<Signature>;
  hash = '';

  public static fromHex(serializedData: string): Transaction {
    return Transaction.deserialize(Base16.decodeUint8Array(serializedData));
  }

  public static fromBytes(serializedData: Uint8Array): Transaction {
    return Transaction.deserialize(serializedData);
  }

  /** @deprecated Use `fromHex` for serialized hex strings. This alias will be removed in v1.0. */
  public static FromBytes(serializedData: string): Transaction {
    return Transaction.fromHex(serializedData);
  }

  constructor(
    nexusName: string,
    chainName: string,
    script: string, // Should be HexString
    expiration: Date,
    payload: string // Should be HexString
  ) {
    this.nexusName = nexusName;
    this.chainName = chainName;
    this.script = script;
    this.expiration = expiration;
    this.payload = payload == null || payload == '' ? '7068616e7461736d612d7473' : payload;
    this.signatures = [];
  }

  public sign(wif: string) {
    const _keys = PhantasmaKeys.fromWIF(wif);
    const msg = this.toByteArray(false);
    const sig: Signature = _keys.sign(msg);
    let sigs: Signature[] = [];
    if (this.signatures != null && this.signatures.length > 0) {
      sigs = this.signatures;
    }
    sigs.push(sig);

    this.signatures = sigs;
    //const signature = this.getSign(this.toString(false), privateKey);
    //this.signatures.unshift({ signature, kind: 1 });
  }

  public signWithPrivateKey(privateKey: string) {
    const msg = this.toByteArray(false);
    const sig: Signature = PhantasmaKeys.fromWIF(getWifFromPrivateKey(privateKey)).sign(msg);
    let sigs: Signature[] = [];
    if (this.signatures != null && this.signatures.length > 0) {
      sigs = this.signatures;
    }
    sigs.push(sig);

    this.signatures = sigs;
  }

  public signWithKeys(keys: PhantasmaKeys) {
    const msg = this.toByteArray(false);
    const sig: Signature = keys.sign(msg);
    let sigs: Signature[] = [];
    if (this.signatures != null && this.signatures.length > 0) {
      sigs = this.signatures;
    }
    sigs.push(sig);

    this.signatures = sigs;
  }

  public verifySignature(address: Address | string): boolean {
    // Verify that at least one stored signature matches the given address for the unsigned tx bytes.
    if (!this.signatures || this.signatures.length === 0) {
      return false;
    }
    const addr = typeof address === 'string' ? Address.fromText(address) : address;
    const message = this.toByteArray(false);
    for (const sig of this.signatures) {
      if (sig.verify(message, addr)) {
        return true;
      }
    }
    return false;
  }

  /** @deprecated Use `verifySignature` instead. This alias will be removed in v1.0. */
  public VerifySignature(address: Address | string): boolean {
    return this.verifySignature(address);
  }

  public verifySignatures(addresses: Array<Address | string>): { ok: boolean; matched: string[] } {
    // Verify which of the provided addresses signed this transaction (no public-key recovery).
    if (!this.signatures || this.signatures.length === 0 || !addresses || addresses.length === 0) {
      return { ok: false, matched: [] };
    }
    const message = this.toByteArray(false);
    const matched = new Set<string>();
    for (const address of addresses) {
      const addr = typeof address === 'string' ? Address.fromText(address) : address;
      for (const sig of this.signatures) {
        if (sig.verify(message, addr)) {
          matched.add(addr.text);
          break;
        }
      }
    }
    const result = Array.from(matched);
    return { ok: result.length > 0, matched: result };
  }

  /** @deprecated Use `verifySignatures` instead. This alias will be removed in v1.0. */
  public VerifySignatures(addresses: Array<Address | string>): { ok: boolean; matched: string[] } {
    return this.verifySignatures(addresses);
  }

  public getUnsignedBytes(): Uint8Array {
    // Expose unsigned bytes for diagnostics and SDK-level verification helpers.
    return this.toByteArray(false);
  }

  /** @deprecated Use `getUnsignedBytes` instead. This alias will be removed in v1.0. */
  public GetUnsignedBytes(): Uint8Array {
    return this.getUnsignedBytes();
  }

  public getSignatureInfo(): Array<{ kind: number; length: number }> {
    // Return signature metadata without exposing signature contents.
    if (!this.signatures || this.signatures.length === 0) {
      return [];
    }
    return this.signatures.map((sig) => ({
      kind: sig.Kind,
      length: sig.Bytes ? sig.Bytes.length : 0,
    }));
  }

  /** @deprecated Use `getSignatureInfo` instead. This alias will be removed in v1.0. */
  public GetSignatureInfo(): Array<{ kind: number; length: number }> {
    return this.getSignatureInfo();
  }

  public toByteArray(withSignature: boolean): Uint8Array {
    const writer = new PBinaryWriter();
    writer.writeString(this.nexusName);
    writer.writeString(this.chainName);
    writer.appendHexEncoded(this.script);
    writer.writeDateTime(this.expiration);
    writer.appendHexEncoded(this.payload);
    if (withSignature) {
      writer.writeVarInt(this.signatures.length);
      this.signatures.forEach((sig) => {
        writer.writeSignature(sig);
        //writer.writeByte(sig.kind);
        //writer.writeByteArray(stringToUint8Array(sig.signature));
      });
    }

    return writer.toUint8Array();
  }

  /** @deprecated Use `toByteArray` instead. This typoed alias will be removed in v1.0. */
  public ToByteAray(withSignature: boolean): Uint8Array {
    return this.toByteArray(withSignature);
  }

  public unserializeData(reader: PBinaryReader) {
    this.nexusName = reader.readString();
    this.chainName = reader.readString();
    this.script = reader.readByteArray();
    const time = reader.readTimestamp();
    this.expiration = new Date(time.toString());
    this.payload = reader.readByteArray();
    this.signatures = [];

    // Unsigned transaction bytes intentionally stop after payload. Signed
    // transaction bytes append a signature count and the signatures.
    if (reader.isEndOfStream) {
      return;
    }

    const sigCount = reader.readVarInt();
    for (let i = 0; i < sigCount; i++) {
      const sig = reader.readSignatureV2();
      if (sig !== null) {
        this.signatures.push(sig);
      }
    }
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  public UnserializeData(reader: PBinaryReader) {
    this.unserializeData(reader);
  }

  public serializeData(writer: PBinaryWriter) {
    writer.writeString(this.nexusName);
    writer.writeString(this.chainName);
    writer.writeByteArray(Base16.decodeUint8Array(this.script));
    writer.writeDateTime(this.expiration);
    writer.writeByteArray(Base16.decodeUint8Array(this.payload));
    writer.writeVarInt(this.signatures.length);
    this.signatures.forEach((sig) => {
      writer.writeSignature(sig);
    });
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  public SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  public toString(withSignature: boolean): string {
    /*const utc = Date.UTC(
      this.expiration.getUTCFullYear(),
      this.expiration.getUTCMonth(),
      this.expiration.getUTCDate(),
      this.expiration.getUTCHours(),
      this.expiration.getUTCMinutes(),
      this.expiration.getUTCSeconds()
    );
    let num = utc / 1000;

    let a = (num & 0xff000000) >> 24;
    let b = (num & 0x00ff0000) >> 16;
    let c = (num & 0x0000ff00) >> 8;
    let d = num & 0x000000ff;

    let expirationBytes = [d, c, b, a];*/

    const sb = new ScriptBuilder()
      .emitVarString(this.nexusName)
      .emitVarString(this.chainName)
      .emitVarInt(this.script.length / 2)
      .appendHexEncoded(this.script)
      .emitTimestamp(this.expiration)
      .emitVarInt(this.payload.length / 2)
      .appendHexEncoded(this.payload);

    if (withSignature) {
      sb.emitVarInt(this.signatures.length);
      this.signatures.forEach((sig) => {
        logger.log('adding signature ', sig);
        if (sig.Kind == 1) {
          sb.appendByte(1); // Signature Type
          sb.emitVarInt(sig.Bytes.length / 2);
          sb.appendHexEncoded(bytesToHex(sig.Bytes));
        } else if (sig.Kind == 2) {
          sb.appendByte(2); // ECDSA Signature
          sb.appendByte(1); // Curve type secp256k1
          sb.emitVarInt(sig.Bytes.length / 2);
          sb.appendHexEncoded(bytesToHex(sig.Bytes));
        }
      });
    }
    return sb.str;
  }

  public toStringEncoded(withSignature: boolean): string {
    return Base16.encodeUint8Array(this.toByteArray(withSignature));
  }

  /** @deprecated Use `toStringEncoded` instead. This alias will be removed in v1.0. */
  public ToStringEncoded(withSignature: boolean): string {
    return this.toStringEncoded(withSignature);
  }

  public getHash() {
    const generatedHash = SHA256(hexEncoding.parse(this.toString(false)));
    this.hash = bytesToHex(hexToBytes(generatedHash.toString(hexEncoding)).reverse());
    return this.hash;
  }

  public mineTransaction(difficulty: number) {
    if (difficulty < 0 || difficulty > 256) {
      logger.log('Error adding difficulty');
      return;
    }

    let nonce = 0;
    const deepCopy = new Transaction(
      JSON.parse(JSON.stringify(this.nexusName)),
      JSON.parse(JSON.stringify(this.chainName)),
      JSON.parse(JSON.stringify(this.script)),
      this.expiration,
      JSON.parse(JSON.stringify(this.payload))
    );
    const payload = Buffer.alloc(4);

    while (true) {
      if (getDifficulty(deepCopy.getHash()) >= difficulty) {
        this.payload = deepCopy.payload;
        logger.log('It took ' + nonce + ' iterations to get a difficulty of >' + difficulty);
        return;
      }

      nonce++;

      payload[0] = (nonce >> 0) & 0xff;
      payload[1] = (nonce >> 8) & 0xff;
      payload[2] = (nonce >> 16) & 0xff;
      payload[3] = (nonce >> 24) & 0xff;

      deepCopy.payload = bytesToHex(payload);
    }
  }

  private getSign(msgHex: string, privateKey: string): string {
    return bytesToHex(signEd25519(hexToBytes(msgHex), hexToBytes(privateKey))).toUpperCase();
  }

  public unserialize(serializedData: string): Transaction {
    return Transaction.fromHex(serializedData);
  }

  public static deserialize(serialized: Uint8Array) {
    const reader = new PBinaryReader(serialized);
    const tx = new Transaction('', '', '', new Date(), '');
    tx.unserializeData(reader);
    return tx;
  }

  /** @deprecated Use `deserialize` instead. This alias will be removed in v1.0. */
  public static Unserialize(serialized: Uint8Array) {
    return Transaction.deserialize(serialized);
  }
}
