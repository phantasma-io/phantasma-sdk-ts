import { Bytes32 } from '../../src/types/carbon/bytes32';
import { TokenHelper } from '../../src/types/carbon/blockchain/modules/token-helper';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';

describe('TokenHelper NFT addresses', () => {
  it('round-trips an address through pack and unpack', () => {
    const address = TokenHelper.getNftAddress(9n, (5n << 32n) | 3n);
    const unpacked = TokenHelper.unpackNftAddress(address.bytes);
    expect(unpacked.carbonTokenId).toBe(9n);
    expect(unpacked.instanceId).toBe((5n << 32n) | 3n);
    expect(unpacked.seriesId).toBe(3);
    expect(unpacked.mintNumber).toBe(5);
  });

  // The form is what the chain tests: fifteen zero bytes, a 0x01 marker, then a nonzero token id
  // and instance id. A user key, the null address and the zero-id shapes all fail it.
  it('recognises the NFT address form and nothing else', () => {
    expect(TokenHelper.isNftAddress(TokenHelper.getNftAddress(9n, 1n))).toBe(true);
    expect(TokenHelper.isNftAddress(TokenHelper.getNftAddress(9n, 1n).bytes)).toBe(true);

    expect(TokenHelper.isNftAddress(new Bytes32(PhantasmaKeys.generate().publicKey))).toBe(false);
    expect(TokenHelper.isNftAddress(Bytes32.Empty)).toBe(false);
    expect(TokenHelper.isNftAddress(TokenHelper.getNftAddress(0n, 1n))).toBe(false);
    expect(TokenHelper.isNftAddress(TokenHelper.getNftAddress(9n, 0n))).toBe(false);
    expect(TokenHelper.isNftAddress(new Uint8Array(16))).toBe(false);

    // A nonzero byte anywhere in the leading run breaks the form even with the marker in place.
    const smudged = TokenHelper.getNftAddress(9n, 1n).bytes.slice();
    smudged[3] = 1;
    expect(TokenHelper.isNftAddress(smudged)).toBe(false);
  });
});
