import { SignatureKind } from '../../src/core/interfaces/Signature';
import { PhantasmaKeys } from '../../src/core/types/PhantasmaKeys';

describe('PhantasmaKeys signatures', () => {
  it('roundtrips WIF and verifies signatures', () => {
    const testWif = 'KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d';

    const keys = PhantasmaKeys.fromWIF(testWif);
    expect(keys.toWIF()).toBe(testWif);

    const message = Buffer.from('hello world', 'utf8');
    const signature = keys.sign(message);

    expect(signature.kind).toBe(SignatureKind.Ed25519);
    expect(signature.bytes.length).toBe(64);

    expect(signature.verify(message, keys.address)).toBe(true);

    const badMessage = Buffer.from('hello worlds', 'utf8');
    expect(signature.verify(badMessage, keys.address)).toBe(false);
  });
});
