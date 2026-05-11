import {} from '../../src';
import crypto from 'crypto';
import { encode as encodeWif } from 'wif';

describe('Address Transcode', () => {
  test('Get a new address', () => {
    const privateKey = crypto.randomBytes(32).toString('hex').toUpperCase();
    /*const walletWif = */ encodeWif({
      version: 128,
      privateKey: Uint8Array.from(Buffer.from(privateKey, 'hex')),
      compressed: true,
    });
    //const expectedAddress = phantasmaJS.getAddressFromWif(walletWif);
    //const actualAddress = addressTranscodeUtil.getAddressFromPrivateKey(privateKey);
  });
});
