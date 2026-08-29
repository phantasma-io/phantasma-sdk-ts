import { Bytes32 } from '../../src/types/carbon/bytes32';
import { CarbonBinaryReader } from '../../src/types/carbon-serialization';
import { IntX } from '../../src/types/carbon/int-x';
import { TxTypes } from '../../src/types/carbon/tx-types';
import { GasConfig } from '../../src/types/carbon/blockchain/gas-config';
import { SignedTxMsg } from '../../src/types/carbon/blockchain/signed-tx-msg';
import { TxMsgBurnFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-burn-fungible-gas-payer';
import { TxMsgBurnNonFungible } from '../../src/types/carbon/blockchain/tx-msg-burn-non-fungible';
import { TxMsgMintFungible } from '../../src/types/carbon/blockchain/tx-msg-mint-fungible';
import { TxMsgTransferFungible } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible';
import { TxMsgTransferFungibleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-fungible-gas-payer';
import { TxMsgTransferNonFungibleMulti } from '../../src/types/carbon/blockchain/tx-msg-transfer-non-fungible-multi';
import { TxMsgTransferNonFungibleSingleGasPayer } from '../../src/types/carbon/blockchain/tx-msg-transfer-non-fungible-single-gas-payer';
import { TxMsgSigner } from '../../src/types/carbon/blockchain/extensions/tx-msg-signer';
import { planFees } from '../../src/types/carbon/blockchain/tx-helpers/fee-plan';
import { NativeTxHelper } from '../../src/types/carbon/blockchain/tx-helpers/native-tx-helper';
import { NativeFeeKind } from '../../src/types/carbon/blockchain/tx-helpers/native-fee-estimator';
import { PhantasmaKeys } from '../../src/types/phantasma-keys';

const OWNER = PhantasmaKeys.fromWIF('KwPpBSByydVKqStGHAnZzQofCqhDmD2bfRgc9BmZqM3ZmsdWJw4d');
const PAYER = PhantasmaKeys.fromWIF('KwVG94yjfVg1YKFyRxAGtug93wdRbmLnqqrFV6Yd2CiA9KZDAp4H');
const owner = new Bytes32(OWNER.publicKey);
const payer = new Bytes32(PAYER.publicKey);
const receiver = new Bytes32(PhantasmaKeys.generate().publicKey);

// Mainnet gas-model-v2 prices; only what a native transfer needs.
const config = new GasConfig({
  version: 1,
  feeMultiplier: 10_000n,
  gasTokenId: 1n,
  dataTokenId: 2n,
  minimumGasOffer: 10n,
  dataEscrowPerRow: 200_000n,
  gasFeeTransfer: 10n,
  gasFeeQuery: 10n,
  minimumGasBill: 10_000_000n,
});

describe('NativeTxHelper', () => {
  it('builds a plain transfer paid by the sender, unplanned until fees are set', () => {
    const msg = NativeTxHelper.transferFungible({
      from: owner,
      to: receiver,
      tokenId: 1n,
      amount: 5n,
    });
    expect(msg.type).toBe(TxTypes.TransferFungible);
    expect(msg.gasFrom.equals(owner)).toBe(true);
    expect(msg.maxGas).toBe(0n);
    expect(msg.maxData).toBe(0n);
    expect(msg.expiry).toBeGreaterThan(BigInt(Date.now()));
    const inner = msg.msg as TxMsgTransferFungible;
    expect(inner.to.equals(receiver)).toBe(true);
    expect(inner.amount).toBe(5n);

    // A zero offer can never be admitted, so signing an unplanned message is refused.
    expect(() => TxMsgSigner.signWithKeys(msg, [OWNER])).toThrow('no gas offer');

    const planned = planFees(msg, config).apply(msg);
    expect(planned.maxGas).toBe(42_600_000n);
    const bytes = TxMsgSigner.signAndSerializeWithKeys(planned, [OWNER]);
    expect(SignedTxMsg.read(new CarbonBinaryReader(bytes)).witnesses).toHaveLength(1);
  });

  it('switches to the gas-payer form when another account pays', () => {
    const msg = NativeTxHelper.transferFungible({
      from: owner,
      to: receiver,
      tokenId: 1n,
      amount: 5n,
      gasPayer: payer,
      maxGas: 60_000_000n,
    });
    expect(msg.type).toBe(TxTypes.TransferFungible_GasPayer);
    expect(msg.gasFrom.equals(payer)).toBe(true);
    const inner = msg.msg as TxMsgTransferFungibleGasPayer;
    expect(inner.from.equals(owner)).toBe(true);

    // Both sign: the payer first, the owner second, as the node reads them.
    const signed = TxMsgSigner.signWithKeys(msg, [OWNER, PAYER]);
    expect(signed.witnesses.map((w) => w.address.toHex())).toEqual([payer.toHex(), owner.toHex()]);
    expect(planFees(msg, config).kind).toBe(NativeFeeKind.TransferFungible);
  });

  it('picks the single- or multi-instance NFT transfer by the instance count', () => {
    const single = NativeTxHelper.transferNonFungible({
      from: owner,
      to: receiver,
      tokenId: 7n,
      instanceIds: [42n],
      gasPayer: payer,
    });
    expect(single.type).toBe(TxTypes.TransferNonFungible_Single_GasPayer);
    expect((single.msg as TxMsgTransferNonFungibleSingleGasPayer).instanceId).toBe(42n);

    const multi = NativeTxHelper.transferNonFungible({
      from: owner,
      to: receiver,
      tokenId: 7n,
      instanceIds: [42n, 43n],
    });
    expect(multi.type).toBe(TxTypes.TransferNonFungible_Multi);
    expect((multi.msg as TxMsgTransferNonFungibleMulti).instanceIds).toEqual([42n, 43n]);
    expect(planFees(multi, config).newStorageQuanta).toBe(3);

    expect(() =>
      NativeTxHelper.transferNonFungible({
        from: owner,
        to: receiver,
        tokenId: 7n,
        instanceIds: [],
      })
    ).toThrow('instanceIds must not be empty');
  });

  it('builds mints and burns with the limits given', () => {
    const mint = NativeTxHelper.mintFungible({
      owner,
      to: receiver,
      tokenId: 9n,
      amount: IntX.fromI64(1000n),
      maxGas: 1n,
      maxData: 2n,
      expiry: 3n,
    });
    expect(mint.type).toBe(TxTypes.MintFungible);
    expect(mint.gasFrom.equals(owner)).toBe(true);
    expect((mint.msg as TxMsgMintFungible).amount.toBigInt()).toBe(1000n);
    expect([mint.maxGas, mint.maxData, mint.expiry]).toEqual([1n, 2n, 3n]);

    const burn = NativeTxHelper.burnFungible({
      from: owner,
      tokenId: 9n,
      amount: IntX.fromI64(1n),
      gasPayer: payer,
    });
    expect(burn.type).toBe(TxTypes.BurnFungible_GasPayer);
    expect((burn.msg as TxMsgBurnFungibleGasPayer).from.equals(owner)).toBe(true);

    const burnNft = NativeTxHelper.burnNonFungible({ from: owner, tokenId: 7n, instanceId: 42n });
    expect(burnNft.type).toBe(TxTypes.BurnNonFungible);
    expect((burnNft.msg as TxMsgBurnNonFungible).instanceId).toBe(42n);
    expect(planFees(burnNft, config).kind).toBe(NativeFeeKind.BurnNonFungible);
  });
});
