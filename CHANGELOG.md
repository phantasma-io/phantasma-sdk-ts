# Changelog

## 0.20.0

The Phantasma Link v5 client follows specification 1.2 (`spec/phantasma-link-v5.md`; what changed
in the specification and why: `spec/CHANGELOG.md`). A dApp and a wallet must both use 1.2 to talk
over the relay.

### Breaking changes

Link v5 pairing and transports:

- The relay uses one topic per direction of a pairing: the dApp publishes to `<t>.dapp` and the
  wallet to `<t>.wallet`. A side on 0.20.0 and a side on 0.19.0 do not hear each other over the
  relay. `RelayTransportOptions` has a new required field `side` (`'dapp'` or `'wallet'`); the
  `PhantasmaLink5` factories set it.
- `buildPairingUri` and `parsePairingUri` refuse a topic that is not 32 bytes in base64url
  (43 characters), a `relay` that is not a `wss://` URL, a key that is not 32 bytes, a symmetric key
  in a `phantasma://` URI, a custom-scheme pairing without `relay` or `meta`, and a pairing with
  neither `relay` nor `cb`. `parsePairingUri` also refuses a `v` other than the text `5`, a pairing
  with both `sk` and `pk`, and an empty `cb`. `PhantasmaLink5.relayEcdh` requires `dapp`.
- A pairing ends with its session. The session ends on `disconnect()` and `forgetSession()`, on the
  wallet's `pha_sessionExpired` or `pha_sessionDeleted` for it, and on a `5100`, `5101` or `4100`
  answer to a request made in it. It also ends when its `expiresAt` has passed or the wallet has not
  answered for 7 days (`idleTtlMs`; an error answer counts as an answer), checked before each
  request and when `webDeeplink` loads. A deeplink or relay client then deletes the key and closes
  (`isClosed`), and its later requests fail with `4900`: build a new client to pair again.
  `webDeeplink` deletes the stored pairing, and its next call makes a new one.
- `PhantasmaLink5.webDeeplink` pairs with a relay (`relayUrl`, default the public relay) and sends
  its requests there, opening the wake link to bring the wallet to the front. While the relay is not
  connected, a request that fits a URL goes over a deeplink. When the relay refuses the page's
  subscription, the requests sent over the relay fail at once with `4900`. A record stored by 0.19.0
  has no relay and is dropped, so such a page pairs again.
  `createWebDeeplinkRecord(callback, relay)` takes the relay.
- Request and wake links open the universal link `https://link.phantasma.info/v5/...` by default
  (`WALLET_LINK_BASE`); 0.19.0 opened `phantasma://`. Pass `walletBase: WALLET_SCHEME_BASE` to keep
  the custom scheme.
- `RelayTransportOptions.onWalletKey` receives the sealed frame of the key hop and returns whether
  it opens with the derived key: `(publicKeyB64Url, sealedFrame) => boolean`.
- Every transport waits 5 minutes for an answer by default (`DEEPLINK_REQUEST_TIMEOUT_MS`); the
  loopback client and a bare `LinkSessionClient` waited 60 s.

Link v5 types:

- `capabilities.features` of the connect result is always present (`[]` in this version), and
  `session.expiresAt` is a number or `null` (a lifetime without a fixed end). A connect result
  without either fails with `-32603` and is not adopted.
- `decodeEnvelope` refuses an `id` longer than 128 characters (`MAX_ENVELOPE_ID_CHARS`) with
  `-32600`, and reads a field of a request or of its `params` that is `null` as absent
  (specification 1.2 §4).
- `ConnectParams` has no `pubkey` and no `session`. A held session id rides in the envelope of every
  request, `connect()` included.
- `getWalletInfo()` returns `{ name, version, capabilities, rpc }` (`GetWalletInfoResult`).
  `WalletInfo`, the `wallet` block of the connect result, has no `rpc`.
- `SignMessageParams` has no `signatureKind`: a wallet signs messages with the Ed25519 key only.
  `TransactionParams` has no `pow`: a wallet signs a transaction exactly as the dApp built it.
- `InvokeScriptResult.results` holds one VM result object per element, serialized, in base64.
- `LinkBalance` has no `ids`: no account in a Link answer or event carries NFT ids (specification
  1.2 §9.5). Read the NFTs of an account from the chain's RPC (`GetAccountNFTs`, page by page).

Link v5 error codes:

- A request without an answer before the timeout fails with `5005` (`LinkErrorCode.Timeout`); it
  failed with `-32603`.
- A frame that the relay refuses fails with `4900`; it failed with `-32603`. A message too large for
  the relay fails with `5001` and `data.maxPayloadBytes` before anything is sent; it failed with
  `-32602`.
- A request sent before the key hop of a custom-scheme pairing arrived fails with `4900`; it failed
  with `4100`.
- A `LinkError` that a transport throws keeps its code; the client turned every send failure into
  `4900`.

Other:

- `PBinaryReader.readSignatureV2` is now `readSignature`. The former `readSignature`, which read
  signatures wrongly, is removed.
- `hexStringToUint8Array` is removed, because it did not decode hex. Use `hexToBytes`.
- `TxMsgSigner` refuses to sign a native fungible transfer (`TransferFungible`,
  `TransferFungible_GasPayer`) of zero atoms, a negative amount, or 2^63 atoms or more. The chain
  refuses such a transfer and still bills it. A larger amount needs a `Token.TransferFungible`
  module call or a script transfer.
- `ScriptBuilder` writes the targets of jumps and calls when the script is built. Labels match
  without regard to case. A jump to a label the script never defines throws, and so does a target
  above `0x7FFF` (`0xFFFF` for a call).
- `base64ToBytes` and `base64UrlToBytes` refuse a character above U+00FF; such a character decoded
  as zero bits before.

### New

Link v5:

- The signing permission of specification 1.2 §9.8: `requestSigningPermission()`,
  `getSigningPermission()` and `revokeSigningPermission()` (which may name the permission it ends)
  on `PhantasmaLink5`, the event `pha_signingPermissionChanged`
  (`LinkEvent.SigningPermissionChanged`), the types `RequestSigningPermissionParams`,
  `SigningPermission` and `SigningPermissionCall`. For wallets: `matchSigningPermission`,
  `readSigningPermissionRequest`, `BUILT_IN_CONTRACTS` and the `SIGNING_PERMISSION_*` limits.
  `gasLimit` and `gasReserved` count the smallest unit of KCAL.
- Every request carries `sentAt`, the time it was sent (specification 1.2 §4).
- `PhantasmaLink5.sessionId` and `isClosed`; the option `idleTtlMs` (default
  `SESSION_IDLE_TTL_MS`, 7 days; a value that is no positive number fails with `-32602`).
- `account` takes the new name, avatar and balances of the session's account from
  `pha_accountsChanged`, and `onSessionChange` reports them.
- `LinkErrorCode.AccountNotSelected` (`5006`): the session's account is not the account selected
  in the wallet. The session stays, and `data.address` names its account.
- Before sending, the client refuses with `5001` a transaction, a message to sign or a script
  above the wallet's advertised limit or the chain maximum (`MAX_TX_BYTES`, 32 MiB;
  `data.maxPayloadBytes`), and a deeplink request above the URL budget
  (`DEEPLINK_URL_BUDGET_CHARS`; `data.maxUrlChars`). `DEEPLINK_MAX_PAYLOAD_BYTES` is the default
  deeplink limit of a payload.
- `webDeeplink` takes `onUnmatchedResponse`: it gets every wallet answer that arrives with no
  request waiting for it, also an answer that the relay hands to the page after a reload.
  `UnmatchedResponse.request` names the session of a request that this client sent and whose
  answer came after the timeout.
- `onRequestSent`, on every client and on `webDeeplink`, reports the id, the method and the
  session of each request right before it leaves (`SentRequest`), so a dApp can match an answer
  that arrives after a reload to its operation by id.
- `relayEcdh` takes `onSessionKey`, which gets the session key once the wallet's key hop derived
  it, and `onSessionChange`, so a dApp can keep a custom-scheme pairing across page loads and build
  a client from it later.
- `PhantasmaLink5Options.restore` builds a client that holds a session an earlier page load kept:
  the last connect result that `onSessionChange` reported and the time of the last answer, which
  `PhantasmaLink5.lastSeenAt` gives. The client then knows the session's account, capabilities and
  payload limits, and ends the session when its lifetime or the inactivity limit is over, as after
  the connect.
- `LinkSessionClientOptions.handledAnswers` and `onAnswerHandled` carry the ids of handled answers
  across page loads; `webDeeplink` keeps them in its record (`WebDeeplinkRecord.answered`, at most
  `WEB_DEEPLINK_STORED_ANSWERS`).
- `DeeplinkRelayTransport`, `buildWakeUrl`, `RelayTransport.reconnect()`, `relayTopic`,
  `RelaySide`, `isPairingTopic`, `base64DecodedLength`, and the `kind` field of a transport
  (`TransportKind`).

VM:

- `readContractCalls` returns the contract calls of a script that `ScriptBuilder` built, or
  `undefined` for any other script (`ScriptContractCall`, `ScriptValue`).
- `readScriptCalls` returns the contract calls and the interop calls of such a script, a transfer
  through `Runtime.TransferTokens` for example, so that a wallet can describe it in its prompt
  (`ScriptCall`, `ScriptInteropCall`). `readContractCalls` stays `undefined` for a script with an
  interop call.

### Fixes

- `PBinaryWriter` writes the four- and eight-byte forms of a variable integer in full. Values above
  `0xFFFF` were written wrong.
- `ScriptBuilder.appendHexEncoded` writes the bytes that the hex text encodes; it wrote the text
  itself. `ScriptBuilder.beginScript` forgets the labels and the jumps of the previous script.
- The callback of the v4 `PhantasmaLink.getPeer` receives the wallet's RPC URL.
- Link v5 relay: the chunks of a message go out one at a time, and a message carries a 32 MiB
  transaction (67 chunks). The ack timeout of a publish adds the time its frame needs to leave the
  device on a slow uplink (16 KiB/s). An answer that the relay delivers again is handled once, also
  after a reload of a `webDeeplink` page. A frame that is no JSON object is ignored. A refused
  subscription of the transport's topic, and `bad_topic` for a topic the relay takes as invalid,
  end the transport; an error for a publish the transport no longer waits for is only logged; any
  other relay error fails the publishes in flight with `4900`.
- Link v5 client: a wallet notice about another session leaves the current session alone. A
  malformed connect result fails with `-32603` and is not adopted. An answer that comes after the
  timeout ends no session that came after its request's. A request that its transport
  refuses at once fails at once. The key hop of a custom-scheme pairing counts only when its sealed
  frame opens with the announced key. A handler passed in `onUnmatchedResponse` is called; the
  client replaced it with its own. The request timeout counts from the last part of a request
  that left the device (`SendOptions.onProgress`), so the upload of a large transaction to the
  relay does not use up the time the wallet has to answer.
- base64 encoding of a 32 MiB transaction needs about 175 MB of memory instead of 1.6 GB, and
  decoding makes no copy of the text.
