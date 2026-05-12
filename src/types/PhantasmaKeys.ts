import { IKeyPair, KeyPair } from '../interfaces/IKeyPair.js';
import { Address } from './Address.js';
import base58 from 'bs58';
import { encode as encodeWif } from 'wif';
import { Signature } from '../interfaces/Signature.js';
import { bytesToHex } from '../utils/index.js';
import { Ed25519Signature } from './Ed25519Signature.js';
import { Entropy } from './Entropy.js';
import { getEd25519PublicKey } from './Ed25519.js';

export class PhantasmaKeys implements KeyPair, IKeyPair {
  private _privateKey: Uint8Array;
  public get privateKey() {
    return this._privateKey;
  }

  /** @deprecated Use `privateKey` instead. This alias will be removed in v1.0. */
  public get PrivateKey() {
    return this.privateKey;
  }

  private _publicKey: Uint8Array;
  public get publicKey() {
    return this._publicKey;
  }

  /** @deprecated Use `publicKey` instead. This alias will be removed in v1.0. */
  public get PublicKey() {
    return this.publicKey;
  }

  private readonly _address: Address;
  public get address(): Address {
    return this._address;
  }

  /** @deprecated Use `address` instead. This alias will be removed in v1.0. */
  public get Address(): Address {
    return this.address;
  }

  public static readonly PrivateKeyLength = 32;

  constructor(privateKey: Uint8Array) {
    if (privateKey.length == 64) {
      privateKey = privateKey.slice(0, 32);
    }

    if (privateKey.length != PhantasmaKeys.PrivateKeyLength) {
      throw new Error(
        `privateKey should have length ${PhantasmaKeys.PrivateKeyLength} but has ${privateKey.length}`
      );
    }

    this._privateKey = new Uint8Array(PhantasmaKeys.PrivateKeyLength);
    this._privateKey.set(privateKey);
    this._publicKey = getEd25519PublicKey(this._privateKey);

    this._address = Address.fromKey(this);
  }

  public toString() {
    return this.address.text;
  }

  public static generate(): PhantasmaKeys {
    const privateKey = Entropy.getRandomBytes(PhantasmaKeys.PrivateKeyLength);

    const pair = new PhantasmaKeys(privateKey);
    return pair;
  }

  public static fromWIF(wif: string): PhantasmaKeys {
    if (!wif) {
      throw new Error('WIF required');
    }

    let data = base58.decode(wif); // checkdecode
    if (data.length == 38) {
      data = data.slice(0, 34);
    }

    if (data.length != 34 || data[0] != 0x80 || data[33] != 0x01) {
      throw new Error('Invalid WIF format');
    }

    const privateKey = data.slice(1, 33);
    return new PhantasmaKeys(privateKey);
  }

  public toWIF(): string {
    const privateKeyString = bytesToHex(this._privateKey);
    const privatekeyBuffer = Buffer.from(privateKeyString, 'hex');
    const wif = encodeWif({
      version: 128,
      privateKey: Uint8Array.from(privatekeyBuffer),
      compressed: true,
    }); //uint8ArrayToHex(data); // .base58CheckEncode();
    return wif;
  }

  public static xor(x: Uint8Array, y: Uint8Array): Uint8Array {
    if (x.length != y.length) {
      throw new Error('x and y should have the same length');
    }
    const result = new Uint8Array(x.length);
    for (let i = 0; i < x.length; i++) {
      result[i] = x[i] ^ y[i];
    }
    return result;
  }

  public sign(msg: Uint8Array): Signature {
    return Ed25519Signature.generate(this, msg);
  }

  /** @deprecated Use `sign` instead. This alias will be removed in v1.0. */
  public Sign(
    msg: Uint8Array,
    customSignFunction?: (
      msg: Uint8Array,
      privateKey: Uint8Array,
      publicKey: Uint8Array
    ) => Uint8Array
  ): Signature {
    void customSignFunction;
    return this.sign(msg);
  }
}
