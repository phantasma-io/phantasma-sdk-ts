import { CarbonBinaryReader } from '../../src/types/carbon-serialization';
import { Bytes32 } from '../../src/types/carbon/bytes32';
import { ModuleId } from '../../src/types/carbon/blockchain/module-id';
import { TokenMetadataBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-metadata-builder';
import { StandardMeta } from '../../src/types/carbon/blockchain/modules/standard-meta';
import { TokenContractMethods } from '../../src/types/carbon/blockchain/modules/token-contract-methods';
import { TxMsgCall } from '../../src/types/carbon/blockchain/tx-msg-call';
import { UpdateTokenMetadataTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/update-token-metadata-tx-helper';
import {
  VmDynamicStruct,
  VmNamedDynamicVariable,
  VmType,
} from '../../src/types/carbon/blockchain/vm';
import { TxTypes } from '../../src/types/carbon/tx-types';

// The contract seal of a token is its metadata field `_sealed_c` holding the Int64 1. The chain refuses
// a VM contract for such a token and any removal of the field, and it refuses `_sealed_c` with any
// other type or value. These tests hold the SDK to that one form.

const creationFields = {
  name: 'Sealed token',
  icon: 'data:image/png;base64,iVBORw0KGgo=',
  url: 'https://example.invalid/sealed',
  description: 'A token without a contract',
};

const readStruct = (bytes: Uint8Array): VmDynamicStruct =>
  VmDynamicStruct.read(new CarbonBinaryReader(bytes));

const owner = new Bytes32(new Uint8Array(32).fill(3));

describe('TokenMetadataBuilder contract seal', () => {
  it('writes _sealed_c as the Int64 1 next to the string fields when sealContract is set', () => {
    const struct = readStruct(
      TokenMetadataBuilder.buildAndSerialize(creationFields, { sealContract: true })
    );

    const sealed = struct.getValue(StandardMeta.Token.sealed_contract);
    expect(sealed?.type).toBe(VmType.Int64);
    expect(sealed?.data).toBe(1n);
    expect(struct.fields).toHaveLength(5);
    expect(struct.fields.find((f) => f.name.data === 'name')?.value.type).toBe(VmType.String);
  });

  it('writes no _sealed_c field without the option', () => {
    const struct = readStruct(TokenMetadataBuilder.buildAndSerialize(creationFields));

    expect(struct.getValue(StandardMeta.Token.sealed_contract)).toBeUndefined();
    expect(struct.fields).toHaveLength(4);
  });

  it('refuses _sealed_c passed as a string field, which the chain refuses', () => {
    expect(() =>
      TokenMetadataBuilder.buildAndSerialize({ ...creationFields, _sealed_c: '1' })
    ).toThrow(/sealContract: true/);
  });

  it('builds a seal update that holds the seal alone, so the chain keeps every other field', () => {
    const update = TokenMetadataBuilder.buildContractSealUpdate();

    expect(update.fields).toHaveLength(1);
    expect(update.fields[0].name.data).toBe('_sealed_c');
    expect(update.fields[0].value.type).toBe(VmType.Int64);
    expect(update.fields[0].value.data).toBe(1n);
  });
});

describe('UpdateTokenMetadataTxHelper', () => {
  it('builds a Token.UpdateTokenMetadata call whose arguments are the token id, then the update', () => {
    const msg = UpdateTokenMetadataTxHelper.buildTx(
      42n,
      TokenMetadataBuilder.buildContractSealUpdate(),
      owner
    );
    const call = msg.msg as TxMsgCall;

    expect(msg.type).toBe(TxTypes.Call);
    expect(msg.gasFrom).toEqual(owner);
    expect(call.moduleId).toBe(ModuleId.Token);
    expect(call.methodId).toBe(TokenContractMethods.UpdateTokenMetadata);
    // The chain reads a u64 token id, then a dynamic struct: a u32 field count, and per field a
    // length-prefixed name, a type byte (Int64 is 0x0c) and the value.
    expect(Buffer.from(call.args).toString('hex')).toBe(
      '2a00000000000000' +
        '01000000' +
        '09' +
        Buffer.from('_sealed_c').toString('hex') +
        '0c' +
        '0100000000000000'
    );
  });

  it('refuses a token id the chain cannot hold or never assigns', () => {
    const update = TokenMetadataBuilder.buildContractSealUpdate();

    expect(() => UpdateTokenMetadataTxHelper.buildTx(0n, update, owner)).toThrow(RangeError);
    expect(() => UpdateTokenMetadataTxHelper.buildTx(-1n, update, owner)).toThrow(RangeError);
    expect(() => UpdateTokenMetadataTxHelper.buildTx(1n << 64n, update, owner)).toThrow(RangeError);
  });

  it('refuses an update without fields, which would change nothing and still pay the fee', () => {
    expect(() => UpdateTokenMetadataTxHelper.buildTx(42n, new VmDynamicStruct(), owner)).toThrow(
      /at least one field/
    );
  });

  it('refuses a seal of any other type or value than the Int64 1', () => {
    const update = (variable: VmNamedDynamicVariable): VmDynamicStruct => {
      const struct = new VmDynamicStruct();
      struct.fields = [variable];
      return struct;
    };

    expect(() =>
      UpdateTokenMetadataTxHelper.buildTx(
        42n,
        update(VmNamedDynamicVariable.from(StandardMeta.Token.sealed_contract, VmType.String, '1')),
        owner
      )
    ).toThrow(/Int64 1/);
    expect(() =>
      UpdateTokenMetadataTxHelper.buildTx(
        42n,
        update(VmNamedDynamicVariable.from(StandardMeta.Token.sealed_contract, VmType.Int64, 2n)),
        owner
      )
    ).toThrow(/Int64 1/);
  });
});
