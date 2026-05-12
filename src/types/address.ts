import base58 from 'bs58';
import { uint8ArrayToString } from '../utils/index.js';
import SHA256 from 'crypto-js/sha256.js';
import hexEncoding from 'crypto-js/enc-hex.js';
import { IKeyPair, ISerializable, KeyPair } from '../interfaces/index.js';
import { getPrivateKeyFromWif, getPublicKeyFromPrivateKey } from '../tx/index.js';
import { Base16, PBinaryWriter, PBinaryReader } from './extensions/index.js';

export enum AddressKind {
  Invalid = 0,
  User = 1,
  System = 2,
  Interop = 3,
}

export class Address implements ISerializable {
  public static readonly nullText: string = 'NULL';
  /** @deprecated Use `nullText` instead. This alias will be removed in v1.0. */
  public static readonly NullText: string = Address.nullText;

  public static readonly lengthInBytes: number = 34;
  /** @deprecated Use `lengthInBytes` instead. This alias will be removed in v1.0. */
  public static readonly LengthInBytes: number = Address.lengthInBytes;

  public static readonly maxPlatformNameLength: number = 10;
  /** @deprecated Use `maxPlatformNameLength` instead. This alias will be removed in v1.0. */
  public static readonly MaxPlatformNameLength: number = Address.maxPlatformNameLength;

  private static nullPublicKey = new Uint8Array(Address.lengthInBytes);
  public static readonly nullAddress: Address = new Address(Address.nullPublicKey);
  /** @deprecated Use `nullAddress` instead. This alias will be removed in v1.0. */
  public static readonly Null: Address = Address.nullAddress;

  private _bytes: Uint8Array;

  /*public get Kind(): AddressKind {
        return this.IsNull ? AddressKind.System : (this._bytes[0] >= 3) ? AddressKind.Interop 
            : (AddressKind)this._bytes[0];
    }*/

  public get kind(): AddressKind {
    if (this.isNull) {
      return AddressKind.System;
    } else if (this._bytes[0] >= 3) {
      return AddressKind.Interop;
    } else {
      return this._bytes[0] as AddressKind;
    }
  }

  /** @deprecated Use `kind` instead. This alias will be removed in v1.0. */
  public get Kind(): AddressKind {
    return this.kind;
  }

  public get isSystem(): boolean {
    return this.kind == AddressKind.System;
  }

  /** @deprecated Use `isSystem` instead. This alias will be removed in v1.0. */
  public get IsSystem(): boolean {
    return this.isSystem;
  }

  public get isInterop(): boolean {
    return this.kind == AddressKind.Interop;
  }

  /** @deprecated Use `isInterop` instead. This alias will be removed in v1.0. */
  public get IsInterop(): boolean {
    return this.isInterop;
  }

  public get isUser(): boolean {
    return this.kind == AddressKind.User;
  }

  /** @deprecated Use `isUser` instead. This alias will be removed in v1.0. */
  public get IsUser(): boolean {
    return this.isUser;
  }

  /*public get TendermintAddress(): string {
        return encodeBase16(this._bytes.slice(2).SHA256().slice(0, 20));
    }
    public get TendermintAddress() {
        return SHA256(this._bytes.slice(2)).slice(0, 20).toString('hex');
    }   
    */

  public get isNull(): boolean {
    if (this._bytes == null || this._bytes.length == 0) {
      return true;
    }

    for (let i = 1; i < this._bytes.length; i++) {
      if (this._bytes[i] != 0) {
        return false;
      }
    }

    return true;
  }

  /** @deprecated Use `isNull` instead. This alias will be removed in v1.0. */
  public get IsNull(): boolean {
    return this.isNull;
  }

  private _text: string | null;

  private static _keyToTextCache = new Map<Uint8Array, string>();

  public get text(): string {
    if (this.isNull) {
      return Address.nullText;
    }

    if (!this._text) {
      if (Address._keyToTextCache.has(this._bytes)) {
        const cachedText = Address._keyToTextCache.get(this._bytes);
        if (cachedText !== undefined) {
          this._text = cachedText;
        }
      }

      if (!this._text) {
        let prefix: string;

        switch (this.kind) {
          case AddressKind.User:
            prefix = 'P';
            break;
          case AddressKind.Interop:
            prefix = 'X';
            break;
          default:
            prefix = 'S';
            break;
        }
        this._text = prefix + base58.encode(this._bytes);
        Address._keyToTextCache.set(this._bytes, this._text);
      }
    }

    return this._text;
  }

  /** @deprecated Use `text` instead. This alias will be removed in v1.0. */
  public get Text(): string {
    return this.text;
  }

  private constructor(bytes: Uint8Array) {
    if (bytes.length != Address.lengthInBytes) {
      throw new Error(
        `address byte length must be ${Address.lengthInBytes}, it was ${bytes.length}`
      );
    }
    this._bytes = new Uint8Array(Address.lengthInBytes);
    this._bytes.set(bytes);
    this._text = null;
  }

  public static fromPublicKey(publicKey: Uint8Array): Address {
    if (publicKey.length !== 32) {
      throw new Error(`publicKey length must be 32, it was ${publicKey.length}`);
    }

    const bytes = new Uint8Array(Address.lengthInBytes);
    bytes[0] = AddressKind.User;
    bytes.set(publicKey, 2);
    return new Address(bytes);
  }

  /** @deprecated Use `fromBytes` for 34-byte address data. This typoed alias will be removed in v1.0. */
  public static FromPublickKey(bytes: Uint8Array): Address {
    return Address.fromBytes(bytes);
  }

  public static fromText(text: string): Address {
    return Address.parse(text);
  }

  /** @deprecated Use `fromText` instead. This alias will be removed in v1.0. */
  public static FromText(text: string): Address {
    return Address.fromText(text);
  }

  public static parse(text: string): Address {
    if (text == null) {
      return Address.nullAddress;
    }

    if (text == Address.nullText) {
      return Address.nullAddress;
    }

    const prefix = text[0];

    text = text.slice(1);
    const bytes = base58.decode(text);

    const addr = new Address(bytes);

    switch (prefix) {
      case 'P':
        if (addr.kind != AddressKind.User) {
          throw new Error(`Invalid address prefix. Expected 'P', got '${prefix}'`);
        }
        break;
      case 'S':
        if (addr.kind != AddressKind.System) {
          throw new Error(`Invalid address prefix. Expected 'S', got '${prefix}'`);
        }
        break;
      case 'X':
        if (addr.kind < AddressKind.Interop) {
          throw new Error(`Invalid address prefix. Expected 'X', got '${prefix}'`);
        }
        break;
      default:
        throw new Error(`Invalid address prefix. Expected 'P', 'S' or 'X', got '${prefix}'`);
    }

    /*this._keyToTextCache.values().forEach((value) => {
      if (value == text) {
        return Address.fromHash(this._keyToTextCache(value));
      }*/

    return addr;
  }

  /** @deprecated Use `parse` instead. This alias will be removed in v1.0. */
  public static Parse(text: string): Address {
    return Address.parse(text);
  }

  public static isValidAddress(text: string): boolean {
    try {
      Address.fromText(text);
      return true;
    } catch {
      return false;
    }
  }

  /** @deprecated Use `isValidAddress` instead. This alias will be removed in v1.0. */
  public static IsValidAddress(text: string): boolean {
    return Address.isValidAddress(text);
  }

  public static fromBytes(bytes: Uint8Array): Address {
    return new Address(bytes);
  }

  /** @deprecated Use `fromBytes` instead. This alias will be removed in v1.0. */
  public static FromBytes(bytes: Uint8Array): Address {
    return Address.fromBytes(bytes);
  }

  public static fromKey(key: KeyPair): Address;
  public static fromKey(key: IKeyPair): Address;
  public static fromKey(key: KeyPair | IKeyPair): Address {
    const publicKey = 'publicKey' in key ? key.publicKey : key.PublicKey;

    if (publicKey.length == 32) {
      return Address.fromPublicKey(publicKey);
    }

    const bytes = new Uint8Array(Address.lengthInBytes);
    bytes[0] = AddressKind.User;
    if (publicKey.length == 33) {
      bytes.set(publicKey, 1);
    } else if (publicKey.length == 64) {
      bytes.set(publicKey.slice(0, 32), 1);
    } else {
      throw new Error('Invalid public key length: ' + publicKey.length);
    }

    return new Address(bytes);
  }

  /** @deprecated Use `fromKey` instead. This alias will be removed in v1.0. */
  public static FromKey(key: IKeyPair): Address {
    return Address.fromKey(key);
  }

  public static fromHash(str: string): Address;
  public static fromHash(input: Uint8Array): Address;
  public static fromHash(input: string | Uint8Array): Address {
    let bytes: Uint8Array;
    if (typeof input === 'string') {
      bytes = new TextEncoder().encode(input);
    } else {
      bytes = input;
    }

    const hash = SHA256(hexEncoding.parse(uint8ArrayToString(bytes)));
    bytes = new Uint8Array(Address.lengthInBytes);
    bytes[0] = AddressKind.User;
    bytes.set(hash.words.slice(0, 32), 2);
    return new Address(bytes);
  }

  /** @deprecated Use `fromHash` instead. This alias will be removed in v1.0. */
  public static FromHash(str: string): Address;
  public static FromHash(input: Uint8Array): Address;
  public static FromHash(input: string | Uint8Array): Address {
    return typeof input === 'string' ? Address.fromHash(input) : Address.fromHash(input);
  }

  public static fromWif(wif: string): Address {
    const privateKey = getPrivateKeyFromWif(wif);
    const publicKey = getPublicKeyFromPrivateKey(privateKey);
    const addressHex = Buffer.from('0100' + publicKey, 'hex');
    return Address.fromBytes(addressHex);
  }

  /** @deprecated Use `fromWif` instead. This alias will be removed in v1.0. */
  public static FromWif(wif: string): Address {
    return Address.fromWif(wif);
  }

  public compareTo(other: Address): number {
    for (let i = 0; i < Address.lengthInBytes; i++) {
      if (this._bytes[i] < other._bytes[i]) {
        return -1;
      } else if (this._bytes[i] > other._bytes[i]) {
        return 1;
      }
    }
    return 0;
  }

  public equals(other: unknown): boolean {
    if (!(other instanceof Address)) {
      return false;
    }
    const address = other as Address;
    return this._bytes.toString() === address._bytes.toString();
  }

  public toString(): string {
    if (this.isNull) {
      return Address.nullText;
    }

    if (!this._text) {
      let prefix: string;
      switch (this.kind) {
        case AddressKind.User:
          prefix = 'P';
          break;
        case AddressKind.Interop:
          prefix = 'X';
          break;
        default:
          prefix = 'S';
          break;
      }
      this._text = prefix + base58.encode(this._bytes);
    }
    return this._text;
  }

  public getPublicKey(): Uint8Array {
    if (!this._bytes || this._bytes.length !== Address.lengthInBytes) {
      throw new Error('invalid address byte length');
    }

    return this._bytes.slice(2, Address.lengthInBytes);
  }

  /** @deprecated Use `getPublicKey` instead. This alias will be removed in v1.0. */
  public GetPublicKey(): Uint8Array {
    return this.getPublicKey();
  }

  public toByteArray(): Uint8Array {
    return this._bytes;
  }

  /** @deprecated Use `toByteArray` instead. This alias will be removed in v1.0. */
  public ToByteArray(): Uint8Array {
    return this.toByteArray();
  }

  public serializeData(writer: PBinaryWriter) {
    writer.writeByteArray(this._bytes);
  }

  /** @deprecated Use `serializeData` instead. This alias will be removed in v1.0. */
  public SerializeData(writer: PBinaryWriter) {
    this.serializeData(writer);
  }

  public unserializeData(reader: PBinaryReader) {
    this._bytes = Base16.decodeUint8Array(reader.readByteArray());
    this._text = null;
  }

  /** @deprecated Use `unserializeData` instead. This alias will be removed in v1.0. */
  public UnserializeData(reader: PBinaryReader) {
    this.unserializeData(reader);
  }
}
