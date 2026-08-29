import { Signature } from '../../src/interfaces/signature';
import { Bytes32 } from '../../src/types/carbon/bytes32';
import { CarbonBlob } from '../../src/types/carbon/carbon-blob';
import { CarbonBinaryReader, CarbonBinaryWriter } from '../../src/types/carbon-serialization';
import { SmallString } from '../../src/types/carbon/small-string';
import { TxTypes } from '../../src/types/carbon/tx-types';
import { SignedTxMsg } from '../../src/types/carbon/blockchain/signed-tx-msg';
import { TxMsg } from '../../src/types/carbon/blockchain/tx-msg';
import { TxMsgCall } from '../../src/types/carbon/blockchain/tx-msg-call';
import { TxMsgTransferFungible } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible';
import { TxMsgTransferFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible-gas-payer';
import { TxMsgSigner } from '../../src/types/carbon/blockchain/extensions/tx-msg-signer';
import { TxSigner } from '../../src/types/carbon/blockchain/extensions/tx-signer';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';
import { verifyEd25519 } from '../../src/types/ed25519';

const PAYER = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');
const OWNER = PhantasmaKeys.fromWIF('KwVG94yjfVg1YKFyRxAGtug93wdRbmLnqqrFV6Yd2CiA9KZDAp4H');
const STRANGER = PhantasmaKeys.generate();
const payerPub = new Bytes32(PAYER.publicKey);
const ownerPub = new Bytes32(OWNER.publicKey);

function gasPayerTransfer(from: Bytes32 = ownerPub): TxMsg {
  const msg = new TxMsg(
    TxTypes.TransferFungible_GasPayer,
    1_759_711_416_000n,
    10_000_000n,
    0n,
    payerPub,
    SmallString.empty
  );
  msg.msg = new TxMsgTransferFungibleGasPayer({
    to: new Bytes32(STRANGER.publicKey),
    from,
    tokenId: 1n,
    amount: 5n,
  });
  return msg;
}

function callTx(): TxMsg {
  const msg = new TxMsg(
    TxTypes.Call,
    1_759_711_416_000n,
    10_000_000n,
    0n,
    payerPub,
    SmallString.empty
  );
  const call = new TxMsgCall();
  call.moduleId = 1;
  call.methodId = 1;
  call.args = new Uint8Array([1, 2, 3]);
  msg.msg = call;
  return msg;
}

function serialize(signed: SignedTxMsg): Uint8Array {
  const w = new CarbonBinaryWriter();
  signed.write(w);
  return w.toUint8Array();
}

// A signer that answers asynchronously, the way a hardware wallet or a signing service would.
class DeferredSigner implements TxSigner {
  calls = 0;
  constructor(private readonly keys: PhantasmaKeys) {}
  get publicKey(): Uint8Array {
    return this.keys.publicKey;
  }
  async sign(message: Uint8Array): Promise<Signature> {
    this.calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 1));
    return this.keys.sign(message);
  }
}

describe('TxMsgSigner with several witnesses', () => {
  it('orders in-memory keys into the envelope order the node expects', () => {
    const msg = gasPayerTransfer();
    const signed = TxMsgSigner.signWithKeys(msg, [OWNER, PAYER]);
    const message = CarbonBlob.serialize(msg);

    expect(signed.witnesses.map((w) => w.address.toHex())).toEqual([
      payerPub.toHex(),
      ownerPub.toHex(),
    ]);
    expect(verifyEd25519(message, signed.witnesses[0].signature.bytes, PAYER.publicKey)).toBe(true);
    expect(verifyEd25519(message, signed.witnesses[1].signature.bytes, OWNER.publicKey)).toBe(true);

    const decoded = SignedTxMsg.read(new CarbonBinaryReader(serialize(signed)));
    expect(serialize(decoded)).toEqual(serialize(signed));
  });

  it('signs through asynchronous signers', async () => {
    const msg = gasPayerTransfer();
    const payer = new DeferredSigner(PAYER);
    const owner = new DeferredSigner(OWNER);
    const bytes = await TxMsgSigner.signAndSerializeWith(msg, [owner, payer]);

    expect(bytes).toEqual(TxMsgSigner.signAndSerializeWithKeys(msg, [PAYER, OWNER]));
    expect(payer.calls).toBe(1);
    expect(owner.calls).toBe(1);
  });

  it('asks a signer that fills both witness slots to sign once', async () => {
    // The same account pays the gas and owns the tokens: two envelope slots, one signature.
    const msg = gasPayerTransfer(payerPub);
    const payer = new DeferredSigner(PAYER);
    const signed = await TxMsgSigner.signWith(msg, [payer]);

    expect(payer.calls).toBe(1);
    expect(signed.witnesses).toHaveLength(2);
    expect(signed.witnesses[0].signature.equals(signed.witnesses[1].signature)).toBe(true);
  });

  it('refuses a signer set that does not match the witnesses the message needs', () => {
    const msg = gasPayerTransfer();
    expect(() => TxMsgSigner.signWithKeys(msg, [PAYER])).toThrow(
      `No signer for witness ${ownerPub.toHex()}`
    );
    expect(() => TxMsgSigner.signWithKeys(msg, [PAYER, OWNER, STRANGER])).toThrow(
      'is not a witness of this transaction'
    );

    const native = new TxMsg(TxTypes.TransferFungible, 1n, 1n, 0n, payerPub, SmallString.empty);
    native.msg = new TxMsgTransferFungible(ownerPub, 1n, 1n);
    expect(() => TxMsgSigner.signWithKeys(native, [OWNER])).toThrow('No signer for witness');
  });

  it('keeps the caller order for witness-array transactions', () => {
    const signed = TxMsgSigner.signWithKeys(callTx(), [OWNER, PAYER, STRANGER]);
    expect(signed.witnesses.map((w) => w.address.toHex())).toEqual([
      ownerPub.toHex(),
      payerPub.toHex(),
      new Bytes32(STRANGER.publicKey).toHex(),
    ]);
    const decoded = SignedTxMsg.read(new CarbonBinaryReader(serialize(signed)));
    expect(decoded.witnesses).toHaveLength(3);
  });

  it('still signs a single-witness message the historical way', () => {
    const native = new TxMsg(TxTypes.TransferFungible, 1n, 1n, 0n, payerPub, SmallString.empty);
    native.msg = new TxMsgTransferFungible(ownerPub, 1n, 1n);
    expect(TxMsgSigner.signAndSerialize(native, PAYER)).toEqual(
      TxMsgSigner.signAndSerializeWithKeys(native, [PAYER])
    );
  });
});
