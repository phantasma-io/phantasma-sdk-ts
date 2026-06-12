// Phantasma Link v5: a WEB dApp talking to the wallet over deeplink (spec §19).
//
// `PhantasmaLink5.webDeeplink()` bundles the per-dApp glue: it generates and persists the
// pairing material (localStorage by default), exposes the pairing URI to show the user,
// restores the session across page loads, and consumes the response URLs the wallet opens
// back at the page (initial URL + hashchange). In a real browser the one required option
// is `dapp`; every platform hook is injectable, which is also what makes this example
// runnable outside a browser.
//
// UX contract on mobile: browsers only allow app-opening navigation from a user gesture,
// so the factory NEVER opens URLs by itself. The flow is:
//   1) first visit - render `client.pairingUri` as a link/QR; the user taps it, approves
//      the pairing in the wallet, and switches back to the page;
//   2) any later gesture - call `connect()` (resumes the stored session promptlessly per
//      spec §7, or falls back to a fresh consent in the wallet) and the typed methods.

import { PhantasmaLink5 } from 'phantasma-sdk-ts/link/v5';

export interface WebDappUi {
  /** Render the one-time pairing link/QR for the user to tap. */
  showPairing(pairingUri: string): void;
  /** Show the connected account address. */
  showAccount(address: string): void;
}

/** Page-load wiring: restore the channel and show whatever is already known. */
export async function onPageLoad(ui: WebDappUi): Promise<PhantasmaLink5> {
  const client = await PhantasmaLink5.webDeeplink({
    dapp: { name: 'My dApp', url: 'https://dapp.example' },
  });

  if (client.account) {
    // Cached from the last successful connect - shown without any wallet hop.
    ui.showAccount(client.account.address);
  } else {
    // Not paired yet (or pairing was reset): the user must tap the pairing URI once.
    ui.showPairing(client.pairingUri!);
  }
  return client;
}

/** Click handler for a "Connect" button: resume or freshly consent, then use the session. */
export async function onConnectClick(client: PhantasmaLink5, ui: WebDappUi): Promise<void> {
  // The dApp identity was set in the factory options, so connect() needs no arguments;
  // an established session resumes promptlessly, otherwise the wallet prompts the user.
  const result = await client.connect();
  ui.showAccount(result.account.address);
}

/** Click handler for a "Send" button: the money path over the same deeplink channel. */
export async function onSendClick(client: PhantasmaLink5, signedCarbonTxBase64: string) {
  return client.sendTransaction({ format: 'carbon', tx: signedCarbonTxBase64 });
}
