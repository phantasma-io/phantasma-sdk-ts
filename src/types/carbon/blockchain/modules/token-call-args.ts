import { CarbonBinaryReader } from '../../../carbon-serialization.js';

/**
 * Arguments of the token-module calls that carry a token movement, read back out of a `TxMsgCall`.
 *
 * A wallet that batches operations sends them as module calls and not as native transaction types.
 * The fee model prices the two identically. The planner therefore has to recover from the call what
 * the native message would have carried in named fields: which token moves, where it goes and how
 * many instances.
 *
 * Only the leading fields the fee model needs are read. The amount that follows them is a
 * variable-length IntX, and nothing here depends on it.
 *
 * Each reader throws on a buffer too short to hold its fields. A caller planning a malformed call
 * then gets an error. The chain would refuse that call anyway.
 */
export class TokenCallArgs {
  /** `Token.TransferFungible(to, from, tokenId, amount)`. */
  static transferFungible(args: Uint8Array): { to: Uint8Array; tokenId: bigint } {
    const r = new CarbonBinaryReader(args);
    const to = r.read32();
    r.read32(); // from
    return { to, tokenId: r.read8u() };
  }

  /** `Token.TransferNonFungible(to, from, tokenId, instanceIds)`. */
  static transferNonFungible(args: Uint8Array): {
    to: Uint8Array;
    tokenId: bigint;
    instanceCount: number;
  } {
    const r = new CarbonBinaryReader(args);
    const to = r.read32();
    r.read32(); // from
    const tokenId = r.read8u();
    return { to, tokenId, instanceCount: r.readArray64u().length };
  }

  /** `Token.MintFungible(tokenId, to, amount)`. */
  static mintFungible(args: Uint8Array): { to: Uint8Array; tokenId: bigint } {
    const r = new CarbonBinaryReader(args);
    const tokenId = r.read8u();
    return { to: r.read32(), tokenId };
  }

  /** `Token.BurnFungible(tokenId, from, amount)`. */
  static burnFungible(args: Uint8Array): { tokenId: bigint } {
    return { tokenId: new CarbonBinaryReader(args).read8u() };
  }

  /** `Token.BurnNonFungible(tokenId, address, instanceIds)`. */
  static burnNonFungible(args: Uint8Array): { tokenId: bigint; instanceIds: bigint[] } {
    const r = new CarbonBinaryReader(args);
    const tokenId = r.read8u();
    r.read32(); // the holder whose instances are burned
    return { tokenId, instanceIds: r.readArray64u() };
  }
}
