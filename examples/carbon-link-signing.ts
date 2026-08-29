import {
  Bytes32,
  expiryWithin,
  NativeTxHelper,
  parseUnits,
  PhantasmaAPI,
  PhantasmaLink,
  TxMsg,
} from 'phantasma-sdk-ts/public';

// A wallet-link dapp never holds the sending key. It builds the message, plans the fee against the
// chain it talks to, and hands the planned message to the wallet, which signs and broadcasts it.
// The plan needs no key: the signed size is known from the message alone.
export async function buildCarbonTransferForWalletSigning(
  api: PhantasmaAPI,
  senderPublicKeyBytes: Uint8Array,
  receiverPublicKeyBytes: Uint8Array
): Promise<TxMsg> {
  // A person now stands between this message and its signature: the wallet has to open, show the
  // transaction and wait to be approved. The builder's default lifetime is sized for a transaction
  // signed on the spot, so this one takes the whole window the chain allows instead.
  const { expiryWindow } = await api.fees.chainParams();
  const transfer = NativeTxHelper.transferFungible({
    from: new Bytes32(senderPublicKeyBytes),
    to: new Bytes32(receiverPublicKeyBytes),
    tokenId: 1n, // KCAL
    amount: parseUnits('0.1', 10), // KCAL has ten decimals
    expiry: expiryWithin(expiryWindow),
  });
  const plan = await api.fees.plan(transfer);
  return plan.apply(transfer);
}

export function requestCarbonSignature(link: PhantasmaLink, txMsg: TxMsg): void {
  link.version = 4;

  link.signCarbonTxAndBroadcast(
    txMsg,
    (result) => {
      console.log(result);
    },
    (message) => {
      console.error(message ?? 'Carbon transaction signing failed');
    }
  );
}
