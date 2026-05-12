import {
  Address,
  Bytes32,
  PBinaryWriter,
  PhantasmaKeys,
  ScriptBuilder,
  Transaction,
  VMObject,
} from '../../src/core';

const TEST_WIF = 'L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx';

describe('deprecated compatibility aliases', () => {
  test('Address aliases delegate to the idiomatic API', () => {
    const keys = PhantasmaKeys.fromWIF(TEST_WIF);
    const bytes = keys.address.toByteArray();

    // Behavior: deprecated aliases should keep their old compatibility semantics.
    expect(Address.NullText).toBe(Address.nullText);
    expect(Address.Null.Text).toBe(Address.nullAddress.text);
    expect(Address.FromText(keys.address.text).text).toBe(Address.fromText(keys.address.text).text);
    expect(Address.FromBytes(bytes).text).toBe(Address.fromBytes(bytes).text);
    expect(Address.FromKey(keys).text).toBe(Address.fromKey(keys).text);
    expect(Address.FromPublickKey(bytes).text).toBe(Address.fromBytes(bytes).text);
    expect(keys.address.GetPublicKey()).toStrictEqual(keys.address.getPublicKey());
  });

  test('Transaction aliases delegate to the idiomatic API', () => {
    const keys = PhantasmaKeys.fromWIF(TEST_WIF);
    const script = new ScriptBuilder().beginScript().emitVarString('compat').endScript();
    const tx = new Transaction('testnet', 'main', script, new Date('2026-01-01T00:00:00Z'), '');

    tx.signWithKeys(keys);

    // Behavior: old transaction aliases should delegate without changing serialized output.
    expect(tx.ToByteAray(false)).toStrictEqual(tx.toByteArray(false));
    expect(tx.GetUnsignedBytes()).toStrictEqual(tx.getUnsignedBytes());
    expect(tx.GetSignatureInfo()).toStrictEqual(tx.getSignatureInfo());
    expect(tx.ToStringEncoded(true)).toBe(tx.toStringEncoded(true));
    expect(tx.VerifySignature(keys.address)).toBe(tx.verifySignature(keys.address));
    expect(tx.VerifySignatures([keys.address])).toStrictEqual(tx.verifySignatures([keys.address]));
    const fromDeprecatedHex = Transaction.FromBytes(tx.toStringEncoded(true));
    expect(fromDeprecatedHex.toStringEncoded(true)).toBe(tx.toStringEncoded(true));
    expect(fromDeprecatedHex.verifySignature(keys.address)).toBe(true);
  });

  test('ScriptBuilder aliases delegate to the idiomatic API', () => {
    const modern = new ScriptBuilder().beginScript().emitVarString('compat').endScript();
    const deprecated = new ScriptBuilder().BeginScript().EmitVarString('compat').EndScript();

    // Behavior: deprecated ScriptBuilder calls should emit the same script bytes as canonical calls.
    expect(deprecated).toBe(modern);
    expect(new ScriptBuilder().EmitThorw(0).GetScript()).toBe(
      new ScriptBuilder().emitThrow(0).getScript()
    );
  });

  test('VMObject and Carbon value aliases delegate to the idiomatic API', () => {
    const vm = VMObject.fromObject('compat');
    if (!vm) {
      throw new Error('VMObject.fromObject returned null');
    }

    const writer = new PBinaryWriter();
    vm.SerializeData(writer);
    const bytes = writer.toUint8Array();

    // Behavior: deprecated VMObject and Carbon aliases should delegate to canonical methods.
    expect(VMObject.FromBytes(bytes).AsString()).toBe(VMObject.fromBytes(bytes).asString());
    expect(new VMObject().SetValue(123n).AsNumber()).toBe(new VMObject().setValue(123n).asNumber());
    expect(vm.ToString()).toBe(vm.asString());

    const b32 = new Bytes32(Uint8Array.from({ length: 32 }, (_, i) => i));
    expect(b32.ToHex()).toBe(b32.toHex());
  });
});
