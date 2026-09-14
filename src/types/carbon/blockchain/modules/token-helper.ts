import { CarbonBinaryWriter } from '../../../carbon-serialization.js';
import { Bytes32 } from '../../bytes32.js';

export type CarbonNftAddressInfo = {
  carbonTokenId: bigint;
  instanceId: bigint;
  seriesId: number;
  mintNumber: number;
};

export class TokenHelper {
  static getNftAddress(carbonTokenId: bigint, instanceId: bigint): Bytes32 {
    const w = new CarbonBinaryWriter();
    w.write(
      new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]) // Carbon NFT ID prefix
    );

    w.write8u(carbonTokenId);
    w.write8u(instanceId);

    return new Bytes32(w.toUint8Array());
  }

  /**
   * Returns true if a 32-byte address is an NFT-derived address. Every minted instance owns such an
   * address, and assets infused into that NFT are sent to it.
   *
   * The test is syntactic and is the one the chain applies: fifteen zero bytes, a 0x01 marker, then
   * a nonzero token id and a nonzero instance id. `planFees` uses it to price the recipient's owner
   * lookup.
   */
  static isNftAddress(address: Bytes32 | Uint8Array): boolean {
    const bytes = address instanceof Bytes32 ? address.bytes : address;
    if (bytes.length !== 32 || bytes[15] !== 1) return false;
    for (let i = 0; i !== 15; i++) {
      if (bytes[i] !== 0) return false;
    }
    const unpacked = this.unpackNftAddress(bytes);
    return unpacked.carbonTokenId !== 0n && unpacked.instanceId !== 0n;
  }

  private static readUint64LE(bytes: Uint8Array, offset: number): bigint {
    let result = 0n;
    for (let i = 0; i < 8; i++) {
      result |= BigInt(bytes[offset + i]) << (BigInt(i) * 8n);
    }
    return result;
  }

  /**
   * Unpacks a Carbon NFT address (32 bytes) into its logical parts:
   * - carbonTokenId: identifies the NFT token contract
   * - instanceId: 64-bit composite id (series + mint)
   * - seriesId / mintNumber: 32-bit halves of instanceId
   */
  static unpackNftAddress(address: Uint8Array): CarbonNftAddressInfo {
    const carbonTokenId = this.readUint64LE(address, 16);
    const instanceId = this.readUint64LE(address, 24);

    const seriesId = Number(instanceId & 0xffffffffn);
    const mintNumber = Number((instanceId >> 32n) & 0xffffffffn);

    return {
      carbonTokenId,
      instanceId,
      seriesId,
      mintNumber,
    };
  }
}
