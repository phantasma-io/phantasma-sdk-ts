import { Signature } from '../../../../interfaces/signature.js';

/**
 * Anything that can witness a Carbon transaction: keys held in memory (`PhantasmaKeys`), a hardware
 * wallet, a remote signing service. A signer signs the serialized `TxMsg` bytes it is given and
 * returns the Ed25519 signature; a hardware or remote signer may resolve asynchronously, which is
 * why the result may be a promise.
 *
 * This is `KeyPair` with the two things an external signer cannot promise removed: it does not ask
 * for a private key, which lives on the device, and it allows the signature to arrive later. A
 * `KeyPair` therefore satisfies it as it is, and passing `PhantasmaKeys` where a `TxSigner` is
 * expected needs no adapter.
 */
export interface TxSigner {
  /** The 32-byte Ed25519 public key that identifies this witness in the transaction. */
  readonly publicKey: Uint8Array;
  sign(message: Uint8Array): Signature | Promise<Signature>;
}
