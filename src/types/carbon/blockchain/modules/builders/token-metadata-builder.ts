import { CarbonBinaryWriter } from '../../../../carbon-serialization.js';
import { VmDynamicStruct, VmNamedDynamicVariable, VmType } from '../../vm/index.js';
import { StandardMeta } from '../standard-meta.js';

/** Options of {@link TokenMetadataBuilder.buildAndSerialize}. */
export interface TokenMetadataOptions {
  /**
   * Seals the token against VM contracts at creation: the metadata gets `_sealed_c` = 1 as an Int64.
   * A sealed token never gets a VM contract, from its owner or from governance. Only a token without a
   * contract can be sealed, and the seal cannot be removed. The seal blocks VM contracts only. A sealed
   * token can be minted, transferred and burned, and it can get new NFT series and NFT mints. Its other
   * metadata fields can be changed.
   */
  sealContract?: boolean;
}

/** Builds token metadata: the fields a token is created with, and the update that seals a token. */
export class TokenMetadataBuilder {
  private static readonly iconDataUriPrefixPattern = /^data:image\/(png|jpeg|webp);base64,/i;
  private static readonly base64PayloadPattern = /^[A-Za-z0-9+/]+={0,2}$/;

  /**
   * Returns the serialized metadata of a new token. `fields` are strings and must hold `name`, `icon`,
   * `url` and `description`; `icon` is a base64 data URI of a PNG, JPEG or WebP image.
   */
  static buildAndSerialize(
    fields?: Record<string, unknown>,
    options: TokenMetadataOptions = {}
  ): Uint8Array {
    const requiredFields = ['name', 'icon', 'url', 'description'] as const;

    if (!fields || Object.keys(fields).length < requiredFields.length) {
      throw new Error('Token metadata is mandatory');
    }

    // The chain takes the seal only as the Int64 1, and these fields are strings. So the seal key is
    // refused here with a message that names the option.
    if (Object.keys(fields).includes(StandardMeta.Token.sealed_contract.data)) {
      throw new Error(
        'Pass { sealContract: true } to seal a token against contracts: _sealed_c holds the Int64 1, which a string field cannot carry'
      );
    }

    if (Object.values(fields).some((v) => typeof v !== 'string')) {
      throw new Error('All metadata fields must be strings');
    }

    const missing = requiredFields.filter(
      (field) => typeof fields[field] !== 'string' || (fields[field] as string).trim() === ''
    );

    if (missing.length > 0) {
      throw new Error(`Token metadata is missing required fields: ${missing.join(', ')}`);
    }

    this.validateIcon(fields['icon'] as string);

    const metadataFields: VmNamedDynamicVariable[] = [];
    for (const [key, value] of Object.entries(fields)) {
      metadataFields.push(VmNamedDynamicVariable.from(key, VmType.String, value as string));
    }
    if (options.sealContract) {
      metadataFields.push(this.contractSealField());
    }

    const struct = new VmDynamicStruct();
    struct.fields = metadataFields;

    const wMetadata = new CarbonBinaryWriter();
    struct.write(wMetadata);
    return wMetadata.toUint8Array();
  }

  /**
   * Returns the metadata update that seals an existing token against VM contracts, for
   * `UpdateTokenMetadataTxHelper`. The chain merges an update into the stored metadata, so every other
   * field keeps its value. The rules of the seal are those of {@link TokenMetadataOptions.sealContract};
   * a token that has a VM contract cannot be sealed.
   */
  static buildContractSealUpdate(): VmDynamicStruct {
    const struct = new VmDynamicStruct();
    struct.fields = [this.contractSealField()];
    return struct;
  }

  private static contractSealField(): VmNamedDynamicVariable {
    return VmNamedDynamicVariable.from(StandardMeta.Token.sealed_contract, VmType.Int64, 1n);
  }

  private static validateIcon(icon: string): void {
    const candidate = icon?.trim();
    if (!candidate || candidate.length === 0) {
      throw new Error('Token metadata icon must be a base64-encoded data URI (PNG, JPEG, or WebP)');
    }

    if (!this.iconDataUriPrefixPattern.test(candidate)) {
      throw new Error('Token metadata icon must be a base64-encoded data URI (PNG, JPEG, or WebP)');
    }

    const payload = candidate.slice(candidate.indexOf(',') + 1).trim();
    if (!payload) {
      throw new Error('Token metadata icon must include a non-empty base64 payload');
    }

    if (!this.base64PayloadPattern.test(payload) || payload.length % 4 !== 0) {
      throw new Error('Token metadata icon payload is not valid base64');
    }

    try {
      const decoded = Buffer.from(payload, 'base64');
      if (decoded.length === 0) {
        throw new Error('Token metadata icon must include a non-empty base64 payload');
      }
      const normalizedPayload = decoded.toString('base64').replace(/=+$/, '');
      const normalizedInput = payload.replace(/=+$/, '');
      if (normalizedPayload !== normalizedInput) {
        throw new Error('Token metadata icon payload is not valid base64');
      }
    } catch {
      throw new Error('Token metadata icon payload is not valid base64');
    }
  }
}
