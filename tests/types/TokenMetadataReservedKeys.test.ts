import { CarbonBinaryReader } from '../../src/types/carbon-serialization';
import { Bytes32 } from '../../src/types/carbon/bytes32';
import { TokenMetadataBuilder } from '../../src/types/carbon/blockchain/modules/builders/token-metadata-builder';
import { StandardMeta } from '../../src/types/carbon/blockchain/modules/standard-meta';
import { TxMsgCall } from '../../src/types/carbon/blockchain/tx-msg-call';
import { UpdateTokenMetadataTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/update-token-metadata-tx-helper';
import {
  VmDynamicStruct,
  VmNamedDynamicVariable,
  VmType,
} from '../../src/types/carbon/blockchain/vm';
import { SmallString } from '../../src/types/carbon/small-string';

// The chain keeps the token metadata keys that start with `_` for its own settings: staking, inflation
// and the contract seal. It refuses any other such key in the metadata a token is left with. It also
// refuses `_brn` in an update, because only genesis sets it. An update may still name another `_` key
// to remove it, with an empty Array_Dynamic, the only value the chain reads as a removal. These tests
// hold the builders of the SDK to the same rule.

const creationFields = {
  name: 'Reserve probe',
  icon: 'data:image/png;base64,iVBORw0KGgo=',
  url: 'https://example.invalid/reserve',
  description: 'A token with ordinary metadata',
};

const owner = new Bytes32(new Uint8Array(32).fill(3));

const update = (...fields: VmNamedDynamicVariable[]): VmDynamicStruct => {
  const struct = new VmDynamicStruct();
  struct.fields = fields;
  return struct;
};

const removal = (key: string): VmNamedDynamicVariable =>
  VmNamedDynamicVariable.from(key, VmType.Array_Dynamic, []);

describe('TokenMetadataBuilder reserved keys', () => {
  // `_sl` is a chain key. The chain takes it only as an Int64, and these fields are strings.
  it.each(['_note', '_sl', '_brn', '_phs'])('refuses the string field %s', (key) => {
    expect(() => TokenMetadataBuilder.buildAndSerialize({ ...creationFields, [key]: 'x' })).toThrow(
      `${key} is reserved for the chain`
    );
  });

  it('takes a key whose underscore is not its first character', () => {
    const struct = VmDynamicStruct.read(
      new CarbonBinaryReader(
        TokenMetadataBuilder.buildAndSerialize({ ...creationFields, my_note: 'a', note_: 'b' })
      )
    );

    expect(struct.getValue(new SmallString('my_note'))?.data).toBe('a');
    expect(struct.getValue(new SmallString('note_'))?.data).toBe('b');
  });
});

describe('UpdateTokenMetadataTxHelper reserved keys', () => {
  it('refuses _brn as a value and as a removal, because only genesis sets it', () => {
    const value = VmNamedDynamicVariable.from(StandardMeta.Token.pre_burn, VmType.Int256, 70n);

    expect(() => UpdateTokenMetadataTxHelper.buildTx(42n, update(value), owner)).toThrow(
      '_brn is set at genesis only'
    );
    expect(() => UpdateTokenMetadataTxHelper.buildTx(42n, update(removal('_brn')), owner)).toThrow(
      '_brn is set at genesis only'
    );
  });

  it('refuses a value for a _ key the chain does not define', () => {
    const values = [
      VmNamedDynamicVariable.from('_note', VmType.String, 'x'),
      // The chain reads `_phs` in block 0 only, so an update may not set it.
      VmNamedDynamicVariable.from('_phs', VmType.Bytes, new Uint8Array([1])),
      // A key that resembles the contract seal is not the seal.
      VmNamedDynamicVariable.from('_sealed', VmType.Int64, 1n),
    ];

    for (const value of values) {
      expect(() => UpdateTokenMetadataTxHelper.buildTx(42n, update(value), owner)).toThrow(
        `${value.name.data} is reserved for the chain`
      );
    }
  });

  it('refuses the Dynamic null for such a key, because the chain stores it as a value', () => {
    const value = VmNamedDynamicVariable.from('_note', VmType.Dynamic, null);

    expect(() => UpdateTokenMetadataTxHelper.buildTx(42n, update(value), owner)).toThrow(
      '_note is reserved for the chain'
    );
  });

  it('removes such a key with an empty Array_Dynamic', () => {
    const call = UpdateTokenMetadataTxHelper.buildTx(42n, update(removal('_note')), owner)
      .msg as TxMsgCall;

    // The token id as a u64, a u32 field count, the length-prefixed name, then the type byte of
    // Array_Dynamic (0x01) and its u32 item count 0. The chain reads exactly this value as a removal.
    expect(Buffer.from(call.args).toString('hex')).toBe(
      '2a00000000000000' +
        '01000000' +
        '05' +
        Buffer.from('_note').toString('hex') +
        '01' +
        '00000000'
    );
  });

  // The keys an update may set, as the chain names them. The SDK checks the reserve only, so an Int64
  // stands for every value here; the chain checks the type of each setting itself. `_sealed_c` is not
  // here: it takes only the Int64 1, which the seal tests check.
  it.each([
    '_soi',
    '_sot',
    '_srt',
    '_srp',
    '_srm',
    '_srd',
    '_sl',
    '_sbt',
    '_sbm',
    '_sbd',
    '_sbl',
    '_ip',
    '_ia',
    '_iib',
    '_iie',
    '_ifr',
  ])('lets an update set the chain key %s', (key) => {
    const value = VmNamedDynamicVariable.from(key, VmType.Int64, 1n);

    expect(() => UpdateTokenMetadataTxHelper.buildTx(42n, update(value), owner)).not.toThrow();
  });
});
