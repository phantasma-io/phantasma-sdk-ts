import Buffer from 'buffer';
import { PollChoice } from '../../src';
import {
  Address,
  Base16,
  Ed25519Signature,
  PBinaryWriter,
  PhantasmaKeys,
  ScriptBuilder,
  SignatureKind,
  Serialization,
  stringToUint8Array,
  Timestamp,
  Transaction,
  bytesToHex,
} from '../../src/core';

describe('test phantasma_ts', function () {
  test('test phantasma-sdk-ts.Transaction.SerializeData', function (done) {
    // Behavior: signing + SerializeData should not throw for valid hex script/payload.
    const writer = new PBinaryWriter();
    const keys = PhantasmaKeys.generate();

    const nexusName = 'nexus';
    const chainName = 'main';
    const script = bytesToHex(new TextEncoder().encode('script'));
    const expiration = new Date(17898129498);
    const payload = bytesToHex(new TextEncoder().encode('payload'));
    /*let signatures = [*/ new Ed25519Signature() /*]*/;
    writer.writeString(nexusName);
    const tx = new Transaction(nexusName, chainName, script, expiration, payload);
    tx.signWithKeys(keys);
    tx.SerializeData(writer);
    /*expect(writer.toUint8Array()).toBe([
      5, 110, 101, 120, 117, 115, 5, 110, 101, 120, 117, 115, 5, 109, 97, 105,
      110,
    ]);*/
    done();
  });

  test('signature', function (done) {
    // Behavior: signing helpers accept valid hex script/payload without throwing.
    // const writer = new PBinaryWriter();
    const keys = PhantasmaKeys.generate();

    const wifTest = 'L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx';
    const keyFromWif = PhantasmaKeys.fromWIF(wifTest);

    expect(keyFromWif.toWIF()).toBe(wifTest);

    const nexusName = 'nexus';
    const chainName = 'main';
    const script = bytesToHex(new TextEncoder().encode('script'));
    const expiration = new Date(17898129498);
    const payload = bytesToHex(new TextEncoder().encode('payload'));
    const tx = new Transaction(nexusName, chainName, script, expiration, payload);

    const wif = keys.toWIF();
    const pk = bytesToHex(keys.privateKey);

    tx.sign(wif);

    tx.signWithPrivateKey(pk);

    /*let wif = getWifFromPrivateKey(
      uint8ArrayToString(Array.from(keys.privateKey) as Uint8Array)
    );
    let pk = uint8ArrayToString(Array.from(keys.privateKey));

    console.log(wif, getAddressFromWif(wif), pk);

    tx.sign(pk);
    tx.SerializeData(writer);*/
    done();
  });

  test('Test signature ts and c#', function (done) {
    // Behavior: TS tx matches C# serialized fields after round-trip.
    const nexusName = 'testnet';
    const chainName = 'main';
    const wif = 'L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx';
    const uintArray = Uint8Array.from([0x01, 0x02, 0x03]);
    const script = bytesToHex(uintArray);
    const time = new Timestamp(1234567890);
    const date = new Date(time.toString());
    const payload = bytesToHex(new TextEncoder().encode('payload'));
    const keys = PhantasmaKeys.fromWIF(wif);
    const tx = new Transaction(nexusName, chainName, script, date, payload);

    tx.signWithKeys(keys);

    const fromCsharp =
      '07746573746E6574046D61696E03010203D2029649077061796C6F61640101404C033859A20A4FC2E469B3741FB05ACEDFEC24BFE92E07633680488665D79F916773FF40D0E81C4468E1C1487E6E1E6EEFDA5C5D7C53C15C4FB349C2349A1802';
    const fromCsharpBytes = Buffer.Buffer.from(fromCsharp, 'hex');
    /*const bytes =*/ stringToUint8Array(fromCsharp);
    const fromCsharpTx = Transaction.deserialize(fromCsharpBytes);

    expect(fromCsharpTx.chainName).toBe(tx.chainName);
    expect(fromCsharpTx.nexusName).toBe(tx.nexusName);
    expect(fromCsharpTx.script).toBe(tx.script);
    expect(fromCsharpTx.payload).toBe(tx.payload);
    expect(fromCsharpTx.expiration).toStrictEqual(tx.expiration);
    expect(fromCsharpTx.signatures.length).toBe(tx.signatures.length);
    expect(fromCsharpTx.signatures[0].Kind).toBe(tx.signatures[0].Kind);
    expect(fromCsharpTx.signatures[0].toByteArray()).toStrictEqual(tx.signatures[0].toByteArray());

    done();
  });

  test('Transaction Serialized to bytes', function (done) {
    // Behavior: serialized tx bytes match the expected reference.
    const nexusName = 'testnet';
    const chainName = 'main';
    const subject = 'system.nexus.protocol.version';
    const wif = 'L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx';
    // const mode = 1;
    const choice = new PollChoice('myChoice');
    const choice2 = new PollChoice('myChoice');
    const choices = [choice, choice2];
    /*const choicesSerialized =*/ Serialization.Serialize(choices);
    const time = new Timestamp(1234567890);
    const date = new Date(time.toString());
    // const startTime = time;
    /*const endTime =*/ new Timestamp(time.value + 86400);
    const payload = Base16.encode('Consensus'); // hex string

    const keys = PhantasmaKeys.fromWIF(wif);
    const sb = new ScriptBuilder();

    const gasLimit = 10000;
    const gasPrice = 210000;

    const script = sb
      .allowGas(keys.address, Address.nullAddress, gasLimit, gasPrice)
      .callContract('consensus', 'SingleVote', [keys.address.text, subject, 0])
      .spendGas(keys.address)
      .endScript();

    expect(script).toBe(
      '0D00040632313030303003000D000405313030303003000D000223220000000000000000000000000000000000000000000000000000000000000000000003000D000223220100AA53BE71FC41BC0889B694F4D6D03F7906A3D9A21705943CAF9632EEAFBB489503000D000408416C6C6F7747617303000D0004036761732D00012E010D0004013003000D00041D73797374656D2E6E657875732E70726F746F636F6C2E76657273696F6E03000D00042F50324B464579466576705166536157384734566A536D6857555A585234517247395951523148624D7054554370434C03000D00040A53696E676C65566F746503000D000409636F6E73656E7375732D00012E010D000223220100AA53BE71FC41BC0889B694F4D6D03F7906A3D9A21705943CAF9632EEAFBB489503000D0004085370656E6447617303000D0004036761732D00012E010B'
    );

    const tx = new Transaction(nexusName, chainName, script, date, payload);

    tx.signWithKeys(keys);

    expect(bytesToHex(tx.toByteArray(true)).toUpperCase()).toBe(
      '07746573746E6574046D61696EFD48010D00040632313030303003000D000405313030303003000D000223220000000000000000000000000000000000000000000000000000000000000000000003000D000223220100AA53BE71FC41BC0889B694F4D6D03F7906A3D9A21705943CAF9632EEAFBB489503000D000408416C6C6F7747617303000D0004036761732D00012E010D0004013003000D00041D73797374656D2E6E657875732E70726F746F636F6C2E76657273696F6E03000D00042F50324B464579466576705166536157384734566A536D6857555A585234517247395951523148624D7054554370434C03000D00040A53696E676C65566F746503000D000409636F6E73656E7375732D00012E010D000223220100AA53BE71FC41BC0889B694F4D6D03F7906A3D9A21705943CAF9632EEAFBB489503000D0004085370656E6447617303000D0004036761732D00012E010BD202964909436F6E73656E737573010140016F0F8D6C38E37F00C9CE9969104F42AF933BEB8C4291CBC9107CD11FDC6CBBDA86ACCD731742EA01642A26D14CA7E56361E73997BB3BEA55BAA3911AB62002'
    );
    done();
  });

  test('Transaction roundtrip preserves script/payload hex (leading zeros)', () => {
    // Behavior: Unserialize should preserve hex bytes, including leading zeros.
    const nexusName = 'simnet';
    const chainName = 'main';
    const keys = PhantasmaKeys.fromWIF('L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx');
    const scriptBytes = Uint8Array.from([0x00, 0x01, 0x02, 0x0f, 0x10, 0x2a, 0xff]);
    const payloadBytes = Uint8Array.from([0x00, 0x00, 0x01, 0x0a, 0x0b, 0x0c]);
    const script = bytesToHex(scriptBytes);
    const payload = bytesToHex(payloadBytes);
    const expiration = new Date(1700000000000);
    const tx = new Transaction(nexusName, chainName, script, expiration, payload);
    tx.signWithKeys(keys);

    const serialized = tx.toByteArray(true);
    const roundtrip = Transaction.deserialize(serialized);

    expect(roundtrip.script).toBe(script);
    expect(roundtrip.payload).toBe(payload);
  });

  test('Transaction roundtrip preserves bytes exactly', () => {
    // Behavior: serializing and deserializing should not mutate tx bytes.
    const nexusName = 'simnet';
    const chainName = 'main';
    const keys = PhantasmaKeys.fromWIF('L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx');
    const scriptBytes = Uint8Array.from([0x00, 0x01, 0x10, 0x11, 0x20, 0x2f, 0xff]);
    const payloadBytes = Uint8Array.from([0x00, 0x05, 0x0a, 0x0f, 0x10, 0xff]);
    const script = bytesToHex(scriptBytes);
    const payload = bytesToHex(payloadBytes);
    const expiration = new Date(1700001234000);
    const tx = new Transaction(nexusName, chainName, script, expiration, payload);
    tx.signWithKeys(keys);

    const serialized = tx.toByteArray(true);
    const roundtrip = Transaction.deserialize(serialized);
    const reserialized = roundtrip.toByteArray(true);

    expect(Base16.encodeUint8Array(reserialized)).toBe(Base16.encodeUint8Array(serialized));
  });

  test('Transaction.fromBytes and fromHex parse signed and unsigned serialized transactions', () => {
    // Behavior: byte and hex constructors should preserve the same transaction data for both signed and unsigned wire shapes.
    const keys = PhantasmaKeys.fromWIF('L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx');
    const script = bytesToHex(Uint8Array.from([0x01, 0x02, 0x03]));
    const payload = bytesToHex(Uint8Array.from([0x04, 0x05]));
    const tx = new Transaction('simnet', 'main', script, new Date(1700000000000), payload);
    tx.signWithKeys(keys);

    const unsignedBytes = tx.toByteArray(false);
    const unsignedHex = tx.toStringEncoded(false);
    const signedBytes = tx.toByteArray(true);
    const signedHex = tx.toStringEncoded(true);
    const unsignedFromBytes = Transaction.fromBytes(unsignedBytes);
    const unsignedFromHex = Transaction.fromHex(unsignedHex);
    const signedFromBytes = Transaction.fromBytes(signedBytes);
    const signedFromHex = Transaction.fromHex(signedHex);

    expect(Base16.encodeUint8Array(unsignedFromBytes.toByteArray(false))).toBe(unsignedHex);
    expect(Base16.encodeUint8Array(unsignedFromHex.toByteArray(false))).toBe(unsignedHex);
    expect(unsignedFromBytes.signatures).toHaveLength(0);
    expect(unsignedFromHex.signatures).toHaveLength(0);
    expect(Base16.encodeUint8Array(signedFromBytes.toByteArray(true))).toBe(signedHex);
    expect(Base16.encodeUint8Array(signedFromHex.toByteArray(true))).toBe(signedHex);
    expect(signedFromBytes.verifySignature(keys.address)).toBe(true);
    expect(signedFromHex.verifySignature(keys.address)).toBe(true);
  });

  test('Transaction.VerifySignature returns true for the signer and false for others', () => {
    // Behavior: VerifySignature should only pass for addresses that actually signed the tx.
    const keyBytesA = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
    const keyBytesB = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 0xff - i));
    const keysA = new PhantasmaKeys(keyBytesA);
    const keysB = new PhantasmaKeys(keyBytesB);
    const script = bytesToHex(Uint8Array.from([0x01, 0x02, 0x03]));
    const payload = bytesToHex(Uint8Array.from([0x04, 0x05]));
    const tx = new Transaction('simnet', 'main', script, new Date(1700000000000), payload);
    tx.signWithKeys(keysA);

    expect(tx.verifySignature(keysA.address)).toBe(true);
    expect(tx.verifySignature(keysA.address.text)).toBe(true);
    expect(tx.verifySignature(keysB.address)).toBe(false);
  });

  test('Transaction.VerifySignature returns false when no signatures exist', () => {
    // Behavior: unsigned transactions should not verify for any address.
    const keyBytes = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
    const keys = new PhantasmaKeys(keyBytes);
    const script = bytesToHex(Uint8Array.from([0x00]));
    const payload = bytesToHex(Uint8Array.from([0x01]));
    const tx = new Transaction('simnet', 'main', script, new Date(1700000000000), payload);

    expect(tx.verifySignature(keys.address)).toBe(false);
  });

  test('Transaction.VerifySignature survives roundtrip with multiple signatures', () => {
    // Behavior: VerifySignature remains valid after serialize/unserialize with multiple signers.
    const keyBytesA = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
    const keyBytesB = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 0xaa - i));
    const keysA = new PhantasmaKeys(keyBytesA);
    const keysB = new PhantasmaKeys(keyBytesB);
    const script = bytesToHex(Uint8Array.from([0x10, 0x20]));
    const payload = bytesToHex(Uint8Array.from([0x30, 0x40]));
    const tx = new Transaction('simnet', 'main', script, new Date(1700000000000), payload);
    tx.signWithKeys(keysA);
    tx.signWithKeys(keysB);

    const raw = tx.toByteArray(true);
    const roundtrip = Transaction.deserialize(raw);

    expect(roundtrip.verifySignature(keysA.address)).toBe(true);
    expect(roundtrip.verifySignature(keysB.address)).toBe(true);
  });

  test('Transaction.VerifySignatures returns matched signer addresses', () => {
    // Behavior: VerifySignatures should identify which provided addresses signed the tx.
    const keyBytesA = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
    const keyBytesB = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 0xaa - i));
    const keyBytesC = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 0x55 - i));
    const keysA = new PhantasmaKeys(keyBytesA);
    const keysB = new PhantasmaKeys(keyBytesB);
    const keysC = new PhantasmaKeys(keyBytesC);
    const script = bytesToHex(Uint8Array.from([0x11, 0x22]));
    const payload = bytesToHex(Uint8Array.from([0x33, 0x44]));
    const tx = new Transaction('simnet', 'main', script, new Date(1700000000000), payload);
    tx.signWithKeys(keysA);
    tx.signWithKeys(keysB);

    const result = tx.verifySignatures([keysA.address, keysB.address.text, keysC.address.text]);
    expect(result.ok).toBe(true);
    expect(result.matched).toStrictEqual([keysA.address.text, keysB.address.text]);

    const noMatch = tx.verifySignatures([keysC.address.text]);
    expect(noMatch.ok).toBe(false);
    expect(noMatch.matched).toStrictEqual([]);
  });

  test('Transaction.GetUnsignedBytes matches ToByteAray(false)', () => {
    // Behavior: GetUnsignedBytes must return the same bytes as ToByteAray(false).
    const keyBytes = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
    const keys = new PhantasmaKeys(keyBytes);
    const script = bytesToHex(Uint8Array.from([0x01]));
    const payload = bytesToHex(Uint8Array.from([0x02]));
    const tx = new Transaction('simnet', 'main', script, new Date(1700000000000), payload);
    tx.signWithKeys(keys);

    const unsigned = tx.getUnsignedBytes();
    const expected = tx.toByteArray(false);
    expect(Base16.encodeUint8Array(unsigned)).toBe(Base16.encodeUint8Array(expected));
    const signed = tx.toByteArray(true);
    expect(unsigned.length).toBeLessThan(signed.length);
  });

  test('Transaction.GetSignatureInfo reports kind and length', () => {
    // Behavior: GetSignatureInfo should expose signature kind/length without raw bytes.
    const keyBytesA = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
    const keyBytesB = Uint8Array.from(Array.from({ length: 32 }, (_, i) => 0xaa - i));
    const keysA = new PhantasmaKeys(keyBytesA);
    const keysB = new PhantasmaKeys(keyBytesB);
    const script = bytesToHex(Uint8Array.from([0x10, 0x20]));
    const payload = bytesToHex(Uint8Array.from([0x30, 0x40]));
    const tx = new Transaction('simnet', 'main', script, new Date(1700000000000), payload);
    tx.signWithKeys(keysA);
    tx.signWithKeys(keysB);

    const info = tx.getSignatureInfo();
    expect(info.length).toBe(2);
    expect(info[0].kind).toBe(SignatureKind.Ed25519);
    expect(info[0].length).toBe(64);
    expect(info[1].kind).toBe(SignatureKind.Ed25519);
    expect(info[1].length).toBe(64);
  });

  test('Transaction.VerifySignature fails after unsigned bytes change', () => {
    // Behavior: modifying unsigned fields after signing must invalidate the signature.
    const keyBytes = Uint8Array.from(Array.from({ length: 32 }, (_, i) => i + 1));
    const keys = new PhantasmaKeys(keyBytes);
    const script = bytesToHex(Uint8Array.from([0x01, 0x02]));
    const payload = bytesToHex(Uint8Array.from([0x03, 0x04]));
    const tx = new Transaction('simnet', 'main', script, new Date(1700000000000), payload);
    tx.signWithKeys(keys);

    expect(tx.verifySignature(keys.address)).toBe(true);
    tx.script = bytesToHex(Uint8Array.from([0x01, 0x02, 0x03]));
    expect(tx.verifySignature(keys.address)).toBe(false);
  });

  test('New MultiSig Tests', function (done) {
    // Behavior: multisig tx with empty script serializes to expected bytes.
    const keys = PhantasmaKeys.fromWIF('L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx');
    const nexusName = 'testnet';
    const chainName = 'main';
    const subject = 'teste';
    const listOfUsers: Array<string> = [
      keys.address.text,
      'P2KFEyFevpQfSaW8G4VjSmhWUZXR4QrG9YQR1HbMpTUCpCL',
    ];

    const time = new Timestamp(1234567890);
    const date = new Date(time.toString());
    const payload = Base16.encode(subject); // hex string
    const transaction = new Transaction(nexusName, chainName, '', date, payload);

    // const gasLimit = 100000;
    // const gasPrice = 210000;
    // const txBytes = '';
    const sb = new ScriptBuilder();

    expect(Base16.encodeUint8Array(transaction.toByteArray(false))).toBe(
      '07746573746E6574046D61696E00D2029649057465737465'
    );

    const script = sb
      //.allowGas(keys.address, Address.nullAddress, gasLimit, gasPrice)
      .callContract('consensus', 'CreateTransaction', [1, listOfUsers])
      //.spendGas(keys.address)
      .endScript();

    expect(script).toBe(
      '0E0000000D01042F50324B464579466576705166536157384734566A536D6857555A585234517247395951523148624D7054554370434C0D020301002F0100020D01042F50324B464579466576705166536157384734566A536D6857555A585234517247395951523148624D7054554370434C0D020301012F01000203000D0004013103000D0004114372656174655472616E73616374696F6E03000D000409636F6E73656E7375732D00012E010B'
    );

    done();
  });

  test('New MultiSig With addressTests', function (done) {
    // Behavior: multisig tx with address list serializes to expected bytes.
    const keys = PhantasmaKeys.fromWIF('L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx');
    const nexusName = 'testnet';
    const chainName = 'main';
    const subject = 'teste';
    const listOfUsers: Array<string> = [
      'P2KFEyFevpQfSaW8G4VjSmhWUZXR4QrG9YQR1HbMpTUCpCL',
      'P2KFEyFevpQfSaW8G4VjSmhWUZXR4QrG9YQR1HbMpTUCpCL',
    ];

    const listUserAddr = listOfUsers.map((user) => Address.fromText(user));

    const time = new Timestamp(1234567890);
    const date = new Date(time.toString());
    const payload = Base16.encode(subject); // hex string
    const transaction = new Transaction(nexusName, chainName, '', date, payload);

    const gasLimit = 100000;
    const gasPrice = 210000;
    //let txBytes = transaction.SerializeData();
    const sb = new ScriptBuilder();

    expect(Base16.encodeUint8Array(transaction.toByteArray(false))).toBe(
      '07746573746E6574046D61696E00D2029649057465737465'
    );

    expect(Base16.encodeUint8Array(Serialization.Serialize(transaction))).toBe(
      '07746573746E6574046D61696E00D202964905746573746500'
    );

    const script = sb
      .allowGas(keys.address, Address.nullAddress, gasLimit, gasPrice)
      .callContract('consensus', 'CreateTransaction', [
        keys.address.text,
        subject,
        Serialization.Serialize(transaction),
        listUserAddr,
      ])
      .spendGas(keys.address)
      .endScript();

    expect(script).toBe(
      '0D00040632313030303003000D00040631303030303003000D000223220000000000000000000000000000000000000000000000000000000000000000000003000D000223220100AA53BE71FC41BC0889B694F4D6D03F7906A3D9A21705943CAF9632EEAFBB489503000D000408416C6C6F7747617303000D0004036761732D00012E010E0000000D010223220100AA53BE71FC41BC0889B694F4D6D03F7906A3D9A21705943CAF9632EEAFBB48950D020301002F0100020D010223220100AA53BE71FC41BC0889B694F4D6D03F7906A3D9A21705943CAF9632EEAFBB48950D020301012F01000203000D00021907746573746E6574046D61696E00D20296490574657374650003000D000405746573746503000D00042F50324B464579466576705166536157384734566A536D6857555A585234517247395951523148624D7054554370434C03000D0004114372656174655472616E73616374696F6E03000D000409636F6E73656E7375732D00012E010D000223220100AA53BE71FC41BC0889B694F4D6D03F7906A3D9A21705943CAF9632EEAFBB489503000D0004085370656E6447617303000D0004036761732D00012E010B'
    );

    done();
  });
  test('SimpleScript', function (done) {
    // Behavior: ScriptBuilder can build a simple contract call without throwing.
    const keys = PhantasmaKeys.fromWIF('L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx');

    const sb = new ScriptBuilder();

    /*const script =*/ sb.callContract('stake', 'Stake', [
      keys.address.text,
      keys.address.text,
    ]).endScript();

    done();
  });

  test('Test ScriptBuilder', function (done) {
    // Behavior: ScriptBuilder can build allowGas + transferTokens + spendGas flow.
    const keys = PhantasmaKeys.fromWIF('L5UEVHBjujaR1721aZM5Zm5ayjDyamMZS9W35RE9Y9giRkdf3dVx');

    const sb = new ScriptBuilder();

    const amount = 10000000;
    /*const script =*/ sb.allowGas(keys.address.text, Address.nullText, 10000, 21000)
      .callInterop('Runtime.TransferTokens', [keys.address.text, keys.address.text, 'SOUL', amount])
      .spendGas(keys.address.text)
      .endScript();

    // console.log('script', script);

    done();
  });
});
