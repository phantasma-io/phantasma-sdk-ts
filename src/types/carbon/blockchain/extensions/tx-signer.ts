import { Signature } from '../../../../interfaces/signature.js';

/**
 * Anything that can witness a Carbon transaction. It can be keys held in memory (`PhantasmaKeys`), a
 * hardware wallet or a remote signing service.
 *
 * A signer signs the serialized `TxMsg` bytes it is given and returns the Ed25519 signature. A
 * hardware or remote signer may resolve asynchronously, so the result may be a promise.
 *
 * This interface is `KeyPair` without the two things an external signer cannot promise. It does not
 * ask for a private key, which stays on the device, and it lets the signature arrive later. A
 * `KeyPair` therefore satisfies it as it is, and passing `PhantasmaKeys` where a `TxSigner` is
 * expected needs no adapter.
 */
export interface TxSigner {
  /** The 32-byte Ed25519 public key that identifies this witness in the transaction. */
  readonly publicKey: Uint8Array;
  sign(message: Uint8Array): Signature | Promise<Signature>;
}
