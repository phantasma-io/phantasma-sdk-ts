// Phantasma Link v5: a web dApp talking to a browser-extension wallet (spec §6.1).
//
// The extension defines `window.phantasmaLink` before the page's scripts run. The dApp checks
// for it once, builds the client over it, and falls back to the desktop loopback wallet when
// no extension is installed. Both are trusted-local transports: frames are plaintext
// envelopes, and the wallet knows the page origin from its own runtime.

import { PhantasmaLink5, findInjectedProvider } from 'phantasma-sdk-ts/link/v5';

const dapp = { name: 'My dApp', url: 'https://dapp.example' };

/** Builds the client over the extension when one is present, otherwise over loopback. */
export function createClient(): PhantasmaLink5 {
  return findInjectedProvider() ? PhantasmaLink5.injected() : PhantasmaLink5.loopback();
}

/** Click handler for a "Connect" button. The wallet prompts the user once; a stored session
 * resumes without a prompt (spec §7). */
export async function onConnectClick(client: PhantasmaLink5): Promise<string> {
  const result = await client.connect(dapp);
  return result.account.address;
}

/** Click handler for a "Sign" button: a message signature, verifiable with the account key.
 * `message` is base64 of the bytes to sign; `display` is what the wallet shows the user. */
export async function onSignClick(client: PhantasmaLink5, messageBase64: string) {
  return client.signMessage({ message: messageBase64, display: 'Sign in to My dApp' });
}

/** The client subscribes to wallet events for as long as the page lives; the extension
 * pushes them only to the page that owns the session. */
export function watchAccount(client: PhantasmaLink5, onChange: (accounts: unknown) => void) {
  return client.onEvent((event, data) => {
    if (event === 'pha_accountsChanged') {
      onChange(data);
    }
  });
}
