import { SignatureKind } from '../../src/interfaces/signature';
import { PBinaryReader } from '../../src/types/extensions/p-binary-reader';
import { PBinaryWriter } from '../../src/types/extensions/p-binary-writer';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';

describe('PBinaryReader.readSignature', () => {
  // The reader gets back exactly the signature the SDK's own writer wrote: the same 64 bytes,
  // still valid for the message and the key that made it.
  it('reads back an Ed25519 signature that writeSignature wrote', () => {
    const keys = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');
    const message = Buffer.from('hello world', 'utf8');
    const signature = keys.sign(message);

    const bytes = new PBinaryWriter().writeSignature(signature).toUint8Array();
    const read = new PBinaryReader(bytes).readSignature();

    expect(read?.kind).toBe(SignatureKind.Ed25519);
    expect(Array.from(read!.bytes)).toEqual(Array.from(signature.bytes));
    expect(read!.verify(message, keys.address)).toBe(true);
  });

  it('reads the kind None as no signature', () => {
    const bytes = new PBinaryWriter().writeSignature(null).toUint8Array();
    expect(new PBinaryReader(bytes).readSignature()).toBeNull();
  });
});
