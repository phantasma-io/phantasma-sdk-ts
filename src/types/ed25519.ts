import nacl from 'tweetnacl';
import { bytesToHex, hexToBytes } from '../utils/index.js';

function requireLength(name: string, bytes: Uint8Array, expected: number): void {
  if (bytes.length !== expected) {
    throw new Error(`${name} should have length ${expected} but has ${bytes.length}`);
  }
}

export function getEd25519PublicKey(privateKey: Uint8Array): Uint8Array {
  requireLength('privateKey', privateKey, 32);
  return nacl.sign.keyPair.fromSeed(privateKey).publicKey;
}

export function getEd25519PublicKeyHex(privateKeyHex: string): string {
  return bytesToHex(getEd25519PublicKey(hexToBytes(privateKeyHex)));
}

export function signEd25519(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  requireLength('privateKey', privateKey, 32);
  const keyPair = nacl.sign.keyPair.fromSeed(privateKey);
  return nacl.sign.detached(message, keyPair.secretKey);
}

export function verifyEd25519(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) {
    return false;
  }
  return nacl.sign.detached.verify(message, signature, publicKey);
}
