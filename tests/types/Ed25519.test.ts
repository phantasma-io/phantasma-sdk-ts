import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';

import {
  getEd25519PublicKey,
  getEd25519PublicKeyHex,
  signEd25519,
  verifyEd25519,
} from '../../src/core/types/Ed25519.js';
import { PhantasmaKeys } from '../../src/core/types/PhantasmaKeys.js';
import {
  getAddressFromWif,
  getPrivateKeyFromWif,
  getPublicKeyFromPrivateKey,
  signData,
  verifyData,
} from '../../src/core/tx/utils.js';
import { bytesToHex, hexToBytes } from '../../src/core/utils/index.js';

const FIXTURE = path.join(process.cwd(), 'tests', 'fixtures', 'ed25519_vectors.tsv');
const ED25519_FIXTURE_SHA256 = 'dd747f5c49b49a67f1c63d02351be669558bf9da65571ed7311bcd8cf8d2bd01';

type Ed25519Vector = {
  caseId: string;
  source: string;
  seedHex: string;
  publicKeyHex: string;
  messageHex: string;
  signatureHex: string;
  notes: string;
};

describe('Ed25519 golden vectors', () => {
  test('fixture hash is locked', () => {
    const digest = createHash('sha256').update(fs.readFileSync(FIXTURE)).digest('hex');
    expect(digest).toBe(ED25519_FIXTURE_SHA256);
  });

  test.each(ed25519Rows())('matches %s', (vector) => {
    const seed = hexToBytes(vector.seedHex);
    const message = hexToBytes(vector.messageHex);
    const publicKey = hexToBytes(vector.publicKeyHex);

    expect(vector.source).toBeTruthy();
    expect(vector.notes).toBeTruthy();
    expect(bytesToHex(getEd25519PublicKey(seed))).toBe(vector.publicKeyHex);
    expect(getEd25519PublicKeyHex(vector.seedHex)).toBe(vector.publicKeyHex);

    const signature = signEd25519(message, seed);
    expect(bytesToHex(signature)).toBe(vector.signatureHex);
    expect(verifyEd25519(message, signature, publicKey)).toBe(true);

    const wrongMessage = message.length > 0 ? new Uint8Array(message) : Uint8Array.from([0]);
    wrongMessage[0] ^= 0xff;
    expect(verifyEd25519(wrongMessage, signature, publicKey)).toBe(false);
  });

  test('rejects invalid key and signature lengths', () => {
    expect(() => getEd25519PublicKey(new Uint8Array(31))).toThrow(
      'privateKey should have length 32 but has 31'
    );
    expect(() => signEd25519(new Uint8Array(), new Uint8Array(33))).toThrow(
      'privateKey should have length 32 but has 33'
    );
    expect(verifyEd25519(new Uint8Array(), new Uint8Array(63), new Uint8Array(32))).toBe(false);
    expect(verifyEd25519(new Uint8Array(), new Uint8Array(64), new Uint8Array(31))).toBe(false);
  });

  test('Phantasma WIF signing path matches the pinned SDK vector', () => {
    const vector = findVector('sdk_wif_hello_world');
    const wif = 'L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx';
    const address = 'P2KFEyFevpQfSaW8G4VjSmhWUZXR4QrG9YQR1HbMpTUCpCL';

    const keys = PhantasmaKeys.fromWIF(wif);
    const sdkSignature = `0140${vector.signatureHex.toUpperCase()}`;

    expect(getPrivateKeyFromWif(wif)).toBe(vector.seedHex);
    expect(getPublicKeyFromPrivateKey(vector.seedHex)).toBe(vector.publicKeyHex);
    expect(bytesToHex(keys.PublicKey)).toBe(vector.publicKeyHex);
    expect(getAddressFromWif(wif)).toBe(address);
    expect(keys.Address.Text).toBe(address);
    expect(signData(vector.messageHex, vector.seedHex)).toBe(sdkSignature);
    expect(verifyData(vector.messageHex, sdkSignature, address)).toBe(true);
    expect(verifyData(bytesToHex(Buffer.from('hello worlds', 'utf8')), sdkSignature, address)).toBe(
      false
    );
  });
});

function ed25519Rows(): Ed25519Vector[] {
  return fs
    .readFileSync(FIXTURE, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('case_id\t'))
    .map((line) => {
      const [caseId, source, seedHex, publicKeyHex, messageHex, signatureHex, notes] =
        line.split('\t');
      return {
        caseId,
        source,
        seedHex,
        publicKeyHex,
        messageHex,
        signatureHex,
        notes,
      };
    });
}

function findVector(caseId: string): Ed25519Vector {
  const vector = ed25519Rows().find((row) => row.caseId === caseId);
  if (!vector) {
    throw new Error(`Missing Ed25519 fixture vector: ${caseId}`);
  }
  return vector;
}
