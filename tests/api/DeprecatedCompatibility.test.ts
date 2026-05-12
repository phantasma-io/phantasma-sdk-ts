import {
  Address,
  Bytes32,
  CarbonBlob,
  ContractEvent,
  ContractInterface,
  ContractMethod,
  Ed25519Signature,
  PBinaryReader,
  PBinaryWriter,
  PhantasmaKeys,
  ScriptBuilder,
  Serialization,
  SignatureKind,
  Timestamp,
  TokenContract_Methods,
  TokenContractMethods,
  Transaction,
  VMObject,
  VMType,
} from '../../src/core';
import {
  getBip44Path,
  getDateAsUTCSeconds,
  GetBip44Path,
  GetDateAsUTCSeconds,
  privateToDer,
  PrivateToDer,
  toWholeNumber,
  ToWholeNumber,
} from '../../src/ledger';
import type { LedgerAccountSigner, LedgerSigner } from '../../src/ledger';

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

  test('Signature aliases delegate to the idiomatic API', () => {
    const keys = PhantasmaKeys.fromWIF(TEST_WIF);
    const message = new TextEncoder().encode('compat-signature');
    const signature = Ed25519Signature.generate(keys, message);

    // Behavior: old signature properties and serialization methods remain
    // source-compatible while lower-camel members are the canonical API.
    expect(signature.Kind).toBe(SignatureKind.Ed25519);
    expect(signature.Bytes).toStrictEqual(signature.bytes);
    expect(Object.keys(signature)).toEqual(expect.arrayContaining(['Bytes', 'Kind']));
    expect({ ...signature }).toMatchObject({ Bytes: signature.bytes, Kind: signature.kind });

    const writer = new PBinaryWriter();
    signature.SerializeData(writer);
    const restored = new Ed25519Signature();
    restored.UnserializeData(new PBinaryReader(writer.toUint8Array()));

    expect(restored.Bytes).toStrictEqual(signature.Bytes);
    expect(signature.Verify(message, keys.address)).toBe(signature.verify(message, keys.address));
    expect(signature.VerifyMultiple(message, [keys.address])).toBe(
      signature.verifyMultiple(message, [keys.address])
    );
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
    vm.Type = VMType.String;
    vm.Data = 'compat';

    const writer = new PBinaryWriter();
    vm.SerializeData(writer);
    const bytes = writer.toUint8Array();

    // Behavior: deprecated VMObject and Carbon aliases should delegate to canonical methods.
    expect(VMObject.FromBytes(bytes).AsString()).toBe(VMObject.fromBytes(bytes).asString());
    expect(new VMObject().SetValue(123n).AsNumber()).toBe(new VMObject().setValue(123n).asNumber());
    expect(vm.ToString()).toBe(vm.asString());
    expect(vm.Type).toBe(vm.type);
    expect(vm.Data).toBe(vm.data);

    const b32 = new Bytes32(Uint8Array.from({ length: 32 }, (_, i) => i));
    expect(b32.ToHex()).toBe(b32.toHex());
  });

  test('Contract aliases delegate to the idiomatic API', () => {
    const method = new ContractMethod('getName', VMType.String, 3, []);
    const event = new ContractEvent(1, 'updated', VMType.String, new Uint8Array([1, 2]));
    const contract = new ContractInterface([method], [event]);

    // Behavior: old ContractInterface and contract member names remain
    // source-compatible while lower-camel members are the canonical API.
    expect(ContractInterface.Empty).toBe(ContractInterface.empty);
    expect(contract.Methods).toStrictEqual(contract.methods);
    expect(contract.MethodCount).toBe(contract.methodCount);
    expect(Object.keys(contract)).toEqual(expect.arrayContaining(['Methods', 'MethodCount']));
    expect({ ...contract }).toMatchObject({
      Methods: contract.methods,
      MethodCount: contract.methodCount,
    });
    expect(contract.Events()).toStrictEqual(contract.events);
    expect(contract.EventCount()).toBe(contract.eventCount);
    expect(contract.HasMethod(method.name)).toBe(contract.hasMethod(method.name));
    expect(contract.FindMethod(method.name)).toBe(contract.findMethod(method.name));
    expect(contract.FindEvent(event.value)).toBe(contract.findEvent(event.value));
    expect(contract.ImplementsMethod(method)).toBe(contract.implementsMethod(method));
    expect(contract.ImplementsEvent(event)).toBe(contract.implementsEvent(event));
    expect(contract.ImplementsInterface(contract)).toBe(contract.implementsInterface(contract));

    const canonicalWriter = new PBinaryWriter();
    const legacyWriter = new PBinaryWriter();
    method.serialize(canonicalWriter);
    method.Serialize(legacyWriter);
    expect(legacyWriter.toUint8Array()).toStrictEqual(canonicalWriter.toUint8Array());
    expect(ContractMethod.Unserialize(new PBinaryReader(canonicalWriter.toUint8Array()))).toEqual(
      ContractMethod.deserialize(new PBinaryReader(canonicalWriter.toUint8Array()))
    );
  });

  test('serialization, CarbonBlob, token method, and ledger aliases delegate', () => {
    const b32 = new Bytes32(Uint8Array.from({ length: 32 }, (_, i) => i));

    expect(Serialization.Serialize('compat')).toStrictEqual(Serialization.serialize('compat'));
    expect(CarbonBlob.Serialize(b32)).toStrictEqual(CarbonBlob.serialize(b32));
    expect(TokenContract_Methods.CreateToken).toBe(TokenContractMethods.CreateToken);
    expect(GetBip44Path('3')).toBe(getBip44Path('3'));
    expect(GetDateAsUTCSeconds(new Date('2026-01-01T00:00:00Z'))).toBe(
      getDateAsUTCSeconds(new Date('2026-01-01T00:00:00Z'))
    );
    expect(ToWholeNumber('12345', 2)).toBe(toWholeNumber('12345', 2));
    expect(PrivateToDer('00'.repeat(32))).toStrictEqual(privateToDer('00'.repeat(32)));

    // Behavior: legacy LedgerSigner implementations remain source-compatible
    // with the old PascalCase-only contract.
    const legacySigner: LedgerSigner = {
      GetPublicKey: () => b32.toHex(),
      GetAccount: () => Address.nullAddress,
    };

    // Behavior: the canonical SDK-returned signer carries both the new
    // lower-camel methods and the legacy aliases.
    const accountSigner: LedgerAccountSigner = {
      getPublicKey: () => b32.toHex(),
      getAccount: () => Address.nullAddress,
      GetPublicKey: () => b32.toHex(),
      GetAccount: () => Address.nullAddress,
    };
    expect(legacySigner.GetPublicKey()).toBe(b32.toHex());
    expect(accountSigner.GetPublicKey()).toBe(accountSigner.getPublicKey());
    expect(accountSigner.GetAccount().text).toBe(accountSigner.getAccount().text);
  });

  test('Timestamp static aliases delegate when called with explicit reader and writer', () => {
    const timestamp = new Timestamp(1234567890);
    const writer = new PBinaryWriter();

    Timestamp.Serialize(timestamp, writer);

    expect(Timestamp.Unserialize(new PBinaryReader(writer.toUint8Array()))?.value).toBe(
      timestamp.value
    );
    expect(Timestamp.Unserialize()).toBeUndefined();
  });
});
