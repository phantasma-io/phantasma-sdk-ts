import { Address, PhantasmaKeys } from '../../src/core';

describe('test Addresses', function () {
  const testWif = 'L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx';

  test('test address', function (done) {
    const keys = PhantasmaKeys.fromWIF(testWif);
    const address = keys.address;

    expect(address.text).toBe('P2KFEyFevpQfSaW8G4VjSmhWUZXR4QrG9YQR1HbMpTUCpCL');

    done();
  });

  test('test address from text', function (done) {
    const addr = Address.fromText('P2KFEyFevpQfSaW8G4VjSmhWUZXR4QrG9YQR1HbMpTUCpCL');
    const address = addr.text;

    expect(address).toBe('P2KFEyFevpQfSaW8G4VjSmhWUZXR4QrG9YQR1HbMpTUCpCL');

    done();
  });

  test('GetPublicKey returns the 32-byte public key slice', () => {
    const keys = PhantasmaKeys.fromWIF(testWif);

    const publicKey = keys.address.getPublicKey();

    expect(publicKey).toHaveLength(32);
    expect(Array.from(publicKey)).toEqual(Array.from(keys.publicKey));
  });

  test('fromPublicKey builds a user address from a 32-byte Ed25519 public key', () => {
    // Behavior: the canonical API accepts real public keys, while address bytes use fromBytes.
    const keys = PhantasmaKeys.fromWIF(testWif);

    expect(Address.fromPublicKey(keys.publicKey).text).toBe(keys.address.text);
    expect(Address.fromBytes(keys.address.toByteArray()).text).toBe(keys.address.text);
    expect(() => Address.fromPublicKey(keys.address.toByteArray())).toThrow(
      'publicKey length must be 32'
    );
  });

  test('GetPublicKey for Address.nullAddress returns 32 zeroed bytes', () => {
    const publicKey = Address.nullAddress.getPublicKey();

    expect(publicKey).toHaveLength(32);
    expect(Array.from(publicKey).every((value) => value === 0)).toBe(true);
  });
});
