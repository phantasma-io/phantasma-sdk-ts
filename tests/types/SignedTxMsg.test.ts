import { Bytes32 } from '../../src/types/carbon/bytes32';
import { Bytes64 } from '../../src/types/carbon/bytes64';
import { CarbonBlob } from '../../src/types/carbon/carbon-blob';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import { IntX } from '../../src/types/carbon/int-x';
import { SmallString } from '../../src/types/carbon/small-string';
import { TxTypes } from '../../src/types/carbon/tx-types';
import { Witness } from '../../src/types/carbon/witness';
import { SignedTxMsg } from '../../src/types/carbon/blockchain/signed-tx-msg';
import { TxMsg } from '../../src/types/carbon/blockchain/tx-msg';
import { TxMsgCall } from '../../src/types/carbon/blockchain/tx-msg-call';
import { TxMsgBurnFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-burn-fungible-gas-payer';
import { TxMsgBurnNonFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-burn-non-fungible-gas-payer';
import { TxMsgTransferFungible } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible';
import { TxMsgTransferFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible-gas-payer';
import { TxMsgTransferNonFungibleMultiGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-non-fungible-multi-gas-payer';
import { TxMsgTransferNonFungibleSingleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-non-fungible-single-gas-payer';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';
import { verifyEd25519 } from '../../src/types/ed25519';

// Deterministic, non-funded keys: the gas payer and the token owner of a gas-payer transaction.
const PAYER = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');
const OWNER = PhantasmaKeys.fromWIF('KwVG94yjfVg1YKFyRxAGtug93wdRbmLnqqrFV6Yd2CiA9KZDAp4H');
const payerPub = new Bytes32(PAYER.publicKey);
const ownerPub = new Bytes32(OWNER.publicKey);
const receiverPub = new Bytes32(PhantasmaKeys.generate().publicKey);

function baseTx(type: TxTypes): TxMsg {
  return new TxMsg(type, 1_759_711_416_000n, 10_000_000n, 1_000n, payerPub, new SmallString('p'));
}

// One message of every gas-payer type, each with OWNER as the token owner and PAYER paying gas.
function gasPayerMessages(): Array<[string, TxMsg]> {
  const transferFt = baseTx(TxTypes.TransferFungible_GasPayer);
  transferFt.msg = new TxMsgTransferFungibleGasPayer({
    to: receiverPub,
    from: ownerPub,
    tokenId: 1n,
    amount: 100_000_000n,
  });
  const transferNftSingle = baseTx(TxTypes.TransferNonFungible_Single_GasPayer);
  transferNftSingle.msg = new TxMsgTransferNonFungibleSingleGasPayer({
    to: receiverPub,
    from: ownerPub,
    tokenId: 7n,
    instanceId: 42n,
  });
  const transferNftMulti = baseTx(TxTypes.TransferNonFungible_Multi_GasPayer);
  transferNftMulti.msg = new TxMsgTransferNonFungibleMultiGasPayer({
    to: receiverPub,
    from: ownerPub,
    tokenId: 7n,
    instanceIds: [42n, 43n],
  });
  const burnFt = baseTx(TxTypes.BurnFungible_GasPayer);
  burnFt.msg = new TxMsgBurnFungibleGasPayer({
    tokenId: 1n,
    from: ownerPub,
    amount: IntX.fromI64(5n),
  });
  const burnNft = baseTx(TxTypes.BurnNonFungible_GasPayer);
  burnNft.msg = new TxMsgBurnNonFungibleGasPayer({ tokenId: 7n, from: ownerPub, instanceId: 42n });
  return [
    ['TransferFungible_GasPayer', transferFt],
    ['TransferNonFungible_Single_GasPayer', transferNftSingle],
    ['TransferNonFungible_Multi_GasPayer', transferNftMulti],
    ['BurnFungible_GasPayer', burnFt],
    ['BurnNonFungible_GasPayer', burnNft],
  ];
}

function signatureOf(key: PhantasmaKeys, msg: TxMsg): Bytes64 {
  return new Bytes64(key.sign(CarbonBlob.serialize(msg)).bytes);
}

function serialize(signed: SignedTxMsg): Uint8Array {
  const w = new CarbonBinaryWriter();
  signed.write(w);
  return w.toUint8Array();
}

describe('SignedTxMsg gas-payer envelopes', () => {
  // The chain reads the gas payer's signature first and the owner's second, so the envelope is the
  // unsigned message followed by exactly those two bare signatures in that order. A wrong order is
  // not a decoding error - both signatures verify against addresses the chain resolves itself - so
  // only the byte layout can catch it.
  it.each(gasPayerMessages())(
    'writes the gas signature before the from signature for %s',
    (_, msg) => {
      const unsigned = CarbonBlob.serialize(msg);
      const gasSig = signatureOf(PAYER, msg);
      const fromSig = signatureOf(OWNER, msg);
      const bytes = serialize(
        new SignedTxMsg(msg, [new Witness(payerPub, gasSig), new Witness(ownerPub, fromSig)])
      );

      expect(bytes.length).toBe(unsigned.length + 128);
      expect(bytes.subarray(0, unsigned.length)).toEqual(unsigned);
      expect(bytes.subarray(unsigned.length, unsigned.length + 64)).toEqual(gasSig.bytes);
      expect(bytes.subarray(unsigned.length + 64)).toEqual(fromSig.bytes);
      expect(verifyEd25519(unsigned, gasSig.bytes, PAYER.publicKey)).toBe(true);
      expect(verifyEd25519(unsigned, fromSig.bytes, OWNER.publicKey)).toBe(true);
    }
  );

  // The envelope does not carry the second witness's address; the reader must recover it from the
  // message's `from` field, exactly as the node does.
  it.each(gasPayerMessages())('reads both witnesses back with their addresses for %s', (_, msg) => {
    const signed = new SignedTxMsg(msg, [
      new Witness(payerPub, signatureOf(PAYER, msg)),
      new Witness(ownerPub, signatureOf(OWNER, msg)),
    ]);
    const decoded = SignedTxMsg.read(new CarbonBinaryReader(serialize(signed)));

    expect(decoded.msg.type).toBe(msg.type);
    expect(decoded.witnesses).toHaveLength(2);
    expect(decoded.witnesses[0].address.equals(payerPub)).toBe(true);
    expect(decoded.witnesses[0].signature.equals(signed.witnesses[0].signature)).toBe(true);
    expect(decoded.witnesses[1].address.equals(ownerPub)).toBe(true);
    expect(decoded.witnesses[1].signature.equals(signed.witnesses[1].signature)).toBe(true);
    expect(serialize(decoded)).toEqual(serialize(signed));
  });

  it('refuses a witness set that does not match the message', () => {
    const [, msg] = gasPayerMessages()[0];
    const gas = new Witness(payerPub, signatureOf(PAYER, msg));
    const from = new Witness(ownerPub, signatureOf(OWNER, msg));

    expect(() => serialize(new SignedTxMsg(msg, [gas]))).toThrow('Expected 2 witnesses');
    expect(() => serialize(new SignedTxMsg(msg, [from, gas]))).toThrow(
      'Gas witness address mismatch'
    );
    expect(() => serialize(new SignedTxMsg(msg, [gas, gas]))).toThrow(
      'From witness address mismatch'
    );
  });

  // The envelope size decides the v2 gas bill, and a wallet must know it before anyone signs:
  // the placeholder-witness size must equal the size of the really signed transaction.
  it('predicts the signed size without a key', () => {
    for (const [, msg] of gasPayerMessages()) {
      const signed = serialize(
        new SignedTxMsg(msg, [
          new Witness(payerPub, signatureOf(PAYER, msg)),
          new Witness(ownerPub, signatureOf(OWNER, msg)),
        ])
      );
      expect(SignedTxMsg.envelopeBytes(msg)).toBe(signed.length);
      expect(SignedTxMsg.envelopeBytes(msg, 2)).toBe(signed.length);
      expect(() => SignedTxMsg.envelopeBytes(msg, 1)).toThrow('carries 2 witness(es)');
    }

    const native = baseTx(TxTypes.TransferFungible);
    native.msg = new TxMsgTransferFungible(receiverPub, 1n, 1n);
    const nativeSigned = serialize(
      new SignedTxMsg(native, [new Witness(payerPub, signatureOf(PAYER, native))])
    );
    expect(SignedTxMsg.envelopeBytes(native)).toBe(nativeSigned.length);

    const call = baseTx(TxTypes.Call);
    const body = new TxMsgCall();
    body.moduleId = 1;
    body.methodId = 2;
    body.args = new Uint8Array(10);
    call.msg = body;
    for (const witnesses of [1, 2, 3]) {
      const signers = [PAYER, OWNER, PhantasmaKeys.generate()].slice(0, witnesses);
      const signed = serialize(
        new SignedTxMsg(
          call,
          signers.map((k) => new Witness(new Bytes32(k.publicKey), signatureOf(k, call)))
        )
      );
      expect(SignedTxMsg.envelopeBytes(call, witnesses)).toBe(signed.length);
    }
    expect(SignedTxMsg.envelopeBytes(call)).toBe(SignedTxMsg.envelopeBytes(call, 1));
  });

  it('names the witnesses each message type requires, in envelope order', () => {
    for (const [, msg] of gasPayerMessages()) {
      const required = SignedTxMsg.requiredWitnesses(msg);
      expect(required?.map((a) => a.toHex())).toEqual([payerPub.toHex(), ownerPub.toHex()]);
    }

    const native = baseTx(TxTypes.TransferFungible);
    native.msg = new TxMsgTransferFungible(receiverPub, 1n, 1n);
    expect(SignedTxMsg.requiredWitnesses(native)?.map((a) => a.toHex())).toEqual([
      payerPub.toHex(),
    ]);

    // Witness-array types leave the witness set to the caller.
    expect(SignedTxMsg.requiredWitnesses(baseTx(TxTypes.Call))).toBeUndefined();
  });
});
