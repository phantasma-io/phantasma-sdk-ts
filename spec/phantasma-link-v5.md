# Phantasma Link v5 - protocol specification

Status: v1.0 (stable). Supersedes the v1-v4 string protocol, which remains supported
during a deprecation window (see §12).

This is an engineering specification and the source of truth for the dApp↔wallet
connection protocol.

Design constraints:
- Own relay (self-hosted), JSON envelope, keep loopback.
- Deeplink ping-pong = primary path for the ~99% small requests AND relay-independent
  (a relay outage must not break normal signing). Relay = large payloads (~1% "fat" tx)
  + cross-device. Universal-link domain = the dedicated subdomain `link.phantasma.info`
  (not the main site; see §17).
- Budget from chain: 1 MiB metadata struct (~750 KB image) / 32 MiB max tx.

---

## 1. Goals / non-goals

Goals:
1. **iOS support** via deeplink (the immediate driver). Works without a wallet-hosted
   local server (impossible on iOS).
2. **Remove the artificial size cap.** Carry transactions up to the real chain
   ceiling (1 MiB metadata / 32 MiB tx), not the current ~32 KB.
3. **One message schema, several transports** - implement once, works everywhere.
4. **Robust by construction**: structured envelope, typed params, numeric error
   codes, capability negotiation, E2E encryption, real sessions with revocation.
5. **Resilient**: simple signing keeps working when the relay is down (deeplink path
   is relay-independent).
6. **One reference implementation + cross-SDK conformance vectors** (kill the 6-way
   drift).

Non-goals (v5):
- Replacing on-chain data with hash-references; images stay on-chain, inside the tx.
- Multi-wallet-aggregator UX, WalletConnect interop (this protocol runs its own relay;
  WC bridging could be a later additive capability).
- Changing any chain/validator/RPC behavior. v5 is purely the transport+envelope.

## 2. Terminology
- **dApp**: the requesting app (web page, native app, game). Holds NO keys.
- **Wallet**: holds keys, shows approval UI, signs. (PoltergeistLite desktop, Ecto
  extension, ecto-mobile, future native apps.)
- **Envelope**: the JSON message format (§4).
- **Transport / binding**: a concrete channel carrying envelopes (§6): injected,
  loopback, deeplink, relay.
- **Session**: persistent, mutually-authenticated trust between a specific dApp and a
  specific wallet account, with capabilities + a shared encryption key + expiry (§7).
- **Pairing**: the one-time exchange that creates a session.
- **Relay**: a self-hosted, E2E-blind pub/sub server that forwards ciphertext between a
  dApp and a wallet that can't reach each other directly (§6.4).

## 3. Architecture at a glance
```
            ┌─────────────── ONE JSON envelope (§4) ───────────────┐
            │                                                        │
  dApp SDK ─┤  injected   loopback   deeplink            relay       ├─ Wallet
            │ (extension) (desktop)  (mobile small)  (big / x-device) │
            └────────────────────────────────────────────────────────┘
  selection: injected → loopback → deeplink(small) → relay(big/x-device)
  resilience: deeplink(small) works even if relay is down.
```
The dApp calls high-level SDK methods (`signTransaction`, …). The SDK builds an
envelope and picks a transport. The wallet implements ONE envelope handler regardless
of transport. Wake/handoff on mobile is always via deeplink; data moves over the
chosen transport.

## 4. Message envelope (JSON-RPC 2.0 profile)

All messages are UTF-8 JSON. Binary fields are **base64** (NOT hex - halves wire
size vs the old protocol). One logical request = one envelope; correlation by `id`.

Request:
```json
{
  "plv": 5,
  "id": "f1c2…",            // unique per request (uuid v4 or monotonic+session)
  "session": "s_9a8b…",     // omitted only on the very first connect/pair
  "method": "pha_signTransaction",
  "params": { /* method-specific, named fields */ }
}
```
Success response:
```json
{ "plv": 5, "id": "f1c2…", "result": { /* method-specific */ } }
```
Error response:
```json
{ "plv": 5, "id": "f1c2…", "error": { "code": 4001, "message": "User rejected", "data": null } }
```
Wallet→dApp events (no `id` reply expected):
```json
{ "plv": 5, "type": "event", "session": "s_9a8b…", "event": "pha_accountsChanged", "data": { … } }
```
Rules:
- `plv` MUST be 5. A peer that doesn't recognize it errors `-32600`.
- Unknown `method` → `-32601`; bad params → `-32602`; malformed JSON → `-32700`.
- No positional args, no `,`/`/` delimiters, no version-gated arg layouts. New fields
  are additive and optional; capability negotiation (§5) gates new behavior, not the
  envelope shape.
- Concurrency: requests are independent by `id`; a wallet MAY serialize UI prompts but
  MUST correlate responses by `id` (no global single-in-flight flag like v1-v4).

## 5. Capability handshake (replaces the magic version int)
At connect/pair, both sides exchange capabilities once; cached in the session.

Wallet → dApp (in the `pha_connect` result):
```json
{
  "wallet": { "name": "Poltergeist Lite", "version": "x.y.z", "icon": "https://…" },
  "plvVersions": [5],
  "methods": ["pha_connect","pha_getAccounts","pha_signMessage","pha_signTransaction","pha_sendTransaction","pha_invokeScript"],
  "chains": ["phantasma:mainnet","phantasma:testnet"],   // CAIP-2-like ids
  "txFormats": ["script","carbon"],                      // routes to SendRawTransaction / SendCarbonTransaction (§9.4)
  "signatureKinds": ["Ed25519","ECDSA"],
  "features": ["batch","events"],
  "maxPayloadBytes": { "relay": 33554432, "deeplink": 8192, "loopback": 33554432 },
  "account": { "address": "P2K…", "name": "…", "balances": [ … ] }
}
```
dApp → wallet (in `pha_connect` params): dApp metadata `{ name, url, icon, description }`,
requested `chains`, `methods`, desired `features`, and the dApp public key for E2E (§8).

Effect: a dApp can KNOW before sending whether the wallet supports Carbon, a given
chain, or a payload of size N - instead of guessing from "version 4". New wallet/dApp
features are additive capabilities; no new protocol version forks every implementation.

## 6. Transports (bindings of the same envelope)

The SDK selects in this order; each is described below.

### 6.1 Injected (browser extension wallet - Ecto)
- The extension injects a provider on the page. Envelopes pass page→content→background
  via the extension messaging bridge (as today, but carrying the v5 envelope).
- Detection: provider object present on `window`.
- No size concern beyond extension messaging limits (large payloads fine).
- Best UX on desktop when the extension is installed.

### 6.2 Loopback (desktop browser/app ↔ desktop wallet) - KEPT
- The desktop wallet runs a **loopback-only** WebSocket server (rebuilt on a vetted
  library, bound to 127.0.0.1/localhost ONLY - fix the v1-v4 `IPAddress.Any`), path
  `/phantasma/v5`, carrying v5 envelopes (text frames; large messages allowed).
- Detection: SDK probes `localhost` (and `127.0.0.1`).
- Pros: fully offline, lowest latency, nothing leaves the machine.
- Cons: same-desktop only; localhost quirks (ports, Brave loopback permission), which
  the SDK already mitigates.
- Origin check: the wallet binds the session to the requesting browser origin where
  available; loopback callers without a verifiable origin get a clearly-labeled prompt.

### 6.3 Deeplink ping-pong (mobile, small requests) - PRIMARY, RELAY-INDEPENDENT
For the ~99% of requests that fit in a URL. No server, no relay.

Flow (request):
1. SDK serializes the envelope, seals it with the session key (§8, §18.2), base64url-encodes
   the sealed frame, and builds a link routed by the pairing topic:
   `https://link.phantasma.info/v5/req#t=<topic>&f=<b64url(sealed frame)>`
   (payload in the URL FRAGMENT, never the query, so it never reaches a server; the session id
   travels inside the sealed envelope, and the return URL is the callback fixed at pairing
   (§15), not a per-request param. Universal link; the wallet also registers the `phantasma://`
   custom scheme as a fallback for app-not-installed / non-universal-link cases).
2. The OS opens the wallet app (universal link → the verified app).
3. Wallet decrypts, shows the approval UI, signs.
4. Wallet returns by opening the pairing callback URL with the sealed result in the fragment:
   `<callback>#plv=5&t=<topic>&f=<b64url(sealed frame)>`. For a NATIVE-app dApp the callback is
   its own custom scheme / universal link; for a WEB dApp it is an https URL (the browser tab
   reopens and the SDK reads the result from the fragment - clunkier, but works and is
   relay-independent).
5. SDK decrypts the result.

Size gate: if `b64url(ciphertext)` would exceed a conservative URL budget (default
8192 bytes; configurable, never above the wallet's advertised `maxPayloadBytes.deeplink`),
the SDK MUST fall back to the relay (§6.4). Small signs (authorize, signMessage, small
tx) stay on deeplink even with the relay down - satisfying the resilience rule.

dApp-type routing:
- NATIVE-app dApp ↔ wallet app: clean deeplink ping-pong (return via the dApp's own
  scheme/universal link). Relay-independent.
- WEB-page dApp on mobile: the return would reopen the browser tab (page reload). So
  for web dApps the SDK DEFAULTS small requests to the relay (smooth, no reload), and
  automatically FALLS BACK to the https-return deeplink when the relay is unreachable -
  smooth normally, still works when the relay is down.

Security notes:
- Universal links are domain-verified (only the app the OS associated with
  link.phantasma.info can claim them) → resistant to the custom-scheme hijack where a
  malicious app registers `phantasma://`. Custom scheme is fallback only.
- Payloads in URLs are encrypted with the session key, so even a hijacking app on the
  fallback scheme can't read request/result contents.

### 6.4 Relay (large payloads + cross-device) - self-hosted, E2E-blind
For "fat" transactions (image-bearing, up to chain limits) and desktop-dApp↔phone-wallet.

Model: a self-hosted pub/sub server. Each session has a **topic**. Either side
publishes an **encrypted** envelope to the topic; the other (subscribed) receives it.
The relay sees only ciphertext + topic; it holds no keys and cannot read or forge
messages. The wallet connects to the relay with an **outbound** WebSocket - which works
on iOS while the app is in the foreground (it was just woken by a deeplink).

Stack: **Rust** (tokio + axum/tokio-tungstenite for WSS), **self-hosted on the
same server as the explorer / supporting software**. Because the relay is E2E-BLIND it
needs NO crypto and NO Phantasma SDK - it just routes opaque ciphertext by topic, with
TTL, per-topic auth, rate-limiting, and message-size caps. This makes it the SIMPLEST
component (a small single binary), not a chain-aware service. (The Phantasma Rust SDK is
useful elsewhere - Rust dApp tooling / any future chain-aware relay feature - but the
core relay does not depend on it.)

Flow (request, mobile):
1. (Session already paired - see §7.) dApp encrypts the envelope, publishes to the topic.
2. dApp opens a small deeplink to WAKE the wallet (no payload in the URL - just a nudge to
   foreground the wallet, which then drains its pairings' mailboxes): `https://link.phantasma.info/v5/wake`.
3. Wallet (now foreground) opens its outbound WS to the relay, pulls the pending
   ciphertext, decrypts, shows UI, signs.
4. Wallet publishes the encrypted result to the topic; SDK receives it (its own WS /
   subscription), decrypts. Wallet MAY deeplink back to return focus to the dApp.

Flow (cross-device, desktop dApp + phone wallet): pairing via QR (the pairing URI in a
QR code); thereafter identical (the phone wallet polls/subscribes the relay; the desktop
dApp subscribes too). No deeplink needed to wake an already-connected desktop session;
on mobile the wake-deeplink is used.

Size: relay messages are not URL-bounded; `maxPayloadBytes.relay` is set to the chain
ceiling (default 32 MiB). Chunking: if a single relay frame is impractical, large
messages MAY be chunked at the transport layer (sequence + reassembly), transparent to
the envelope. (Chunking format: §11.)

Relay is NOT on the critical path for small same-device signing (those use deeplink).
Relay outage degrades gracefully: big tx + cross-device unavailable; everyday signing
keeps working.

## 7. Pairing & sessions
- **Pairing** (one-time) creates a Session. Two entry points:
  - Same-device mobile: dApp opens a `…/link/v5/pair?…` universal link; wallet prompts
    the user to approve, returns its capabilities + account + its E2E public key.
  - Cross-device: dApp shows a QR encoding the pairing URI; the phone wallet scans it.
- **Session** (persistent on BOTH sides, surviving wallet restarts):
  `{ sessionId, dappMeta, account, chains, methods, features, sharedKey(material),
  createdAt, expiresAt }`. The user picks the lifetime at approval (session / 1h / 1d /
  1mo / always). The wallet has a **revocation UI** listing active sessions.
- Re-connect: `pha_connect` with an existing `sessionId` resumes without a new prompt
  (until expiry/revoke). Account/chain changes are pushed as events (§9).
- Origin/identity: the wallet shows dApp `{name, url, icon}` in every approval and binds
  the session to it. (Stronger origin proofs - signed manifest / well-known file - are a
  later additive feature.)
- **Session-store lifecycle (bounded, NOT immortal).** Persistence above means "remember
  recent sessions for promptless resume", NOT "keep everything forever". Both sides MUST:
  - **Expire by inactivity.** Activity (any delivered request) slides `lastSeenAt`; the
    effective expiry is `lastSeenAt + idleTTL` (default 7 days, WalletConnect-v2 parity).
    The `always` lifetime sets no hard calendar expiry, but `always` means "do not auto-expire
    while in use", NOT "immortal regardless of use": an `always` session is still subject to
    the relay cap below and to explicit revoke.
  - **Bound concurrent RELAY subscriptions to the relay per-connection topic cap (§16).** A
    wallet keeps all its relay sessions on ONE relay connection, so how many it may subscribe
    at once is hard-capped by the relay. The wallet MUST subscribe only the N most-recently-used
    relay sessions (N below the cap, e.g. 6 against a cap of 8) and evict the rest LRU by
    `lastSeenAt`. Otherwise the (cap+1)-th session's `subscribe` is rejected and that dApp
    can never receive a request.
  - **Evict / revoke explicitly.** On inactivity-expiry, LRU eviction, or user revoke, the
    wallet unsubscribes the topic on the relay AND best-effort notifies the dApp with a
    `pha_sessionDeleted` event over the channel, so the dApp re-pairs instead of hanging.
  - **On reconnect**, subscribe only live (non-expired, within-cap) sessions - never the
    full history.

## 8. Encryption & keys
- Every transport EXCEPT injected/loopback-with-trusted-origin carries E2E-encrypted
  payloads. Deeplink and relay payloads are ALWAYS encrypted (they traverse the OS / the
  relay).
- **CHOSEN scheme: the NaCl `box` construction** = X25519 (ECDH key agreement) +
  XSalsa20-Poly1305 (authenticated encryption), 24-byte random nonce per message.
  Rationale: it bundles key-agreement + AEAD correctly in one hard-to-misuse primitive,
  has a 192-bit nonce (random nonces are safe - no counter coordination), and is
  available as a RELIABLE, cross-language-interoperable package in every SDK language -
  AND is ALREADY a dependency of the TS SDK (`tweetnacl`). Signing stays Ed25519 (already
  everywhere). Encryption keys are EPHEMERAL X25519 keypairs generated per session,
  SEPARATE from the account signing key (never reuse the Ed25519 account key for ECDH).
- Pairing: each side generates an ephemeral X25519 keypair; ONLY public keys go into the
  pairing URI / QR / deeplink. `box(message, nonce, theirPub, myPriv)` for every
  encrypted envelope. **No secret ever appears in a URL** → resistant to deeplink/scheme
  hijack (the decisive reason to use ECDH-box, not WalletConnect's symKey-in-URI style).
- Per-language packages (all interoperate with the NaCl box wire format):
  - TS: **`tweetnacl`** (`nacl.box`) - already a dependency.
  - Rust: **`crypto_box`** (RustCrypto, interops with tweetnacl; sits next to the SDK's
    existing `ed25519-dalek`/`sha2`). The relay itself needs NO crypto (E2E-blind).
  - C# server: `NSec`/`Geralt` (libsodium) or `NaCl.Net`; Unity (pure-managed, no native
    lib): **`NaCl.Net`** / `Chaos.NaCl`.
  - Go: **`golang.org/x/crypto/nacl/box`** (official).
  - C++: **libsodium** `crypto_box`.
- signMessage stays NON-forgeable as a transaction. Exact construction:
  the wallet signs `DOMAIN_TAG || random || message`, where `DOMAIN_TAG` is the fixed
  ASCII bytes `"PHANTASMA_LINK_V5_MSG\n"` (a domain separator that can never be the prefix
  of a valid serialized transaction → a signMessage signature can never be replayed as a
  transaction signature), `random` is **32 bytes from a CSPRNG**, and `message` is the
  dApp's bytes. The wallet returns
  `{ signature, random }`; a verifier reconstructs `DOMAIN_TAG || random || message`. The
  wallet SHOULD display the message to the user (UTF-8 if decodable, else a hash + byte
  length); the dApp MAY pass a `display` hint string.
- Replay protection: envelopes carry `id` + the session binds a nonce/sequence; the
  wallet rejects duplicate `id`s within a session.

## 9. Method catalog (v5)

### 9.1 Naming principles (durability)
The v1-v4 names are NOT durable and are redesigned here. Rules:
1. **No internal codenames in public names.** `signCarbonTxAndBroadcast` bakes the
   Gen3 codename "Carbon" into the API - it ages the moment the codename changes or a
   second format exists. Methods are named by WHAT they do; the tx format is advertised
   via capabilities/params, never in the method name.
2. **No one-off platform leaks.** `getN3Address` (Neo N3) was a special-case leak -
   REMOVED in v5 (per-platform addresses, if ever needed, become fields on
   `pha_getAccounts`, not a dedicated method).
3. **Verb + clear object, no abbreviations.** `signTransaction` not `signTx`;
   `signMessage` not the vague `signData`; drop cryptic `getPeer`.
4. **Align with the de-facto wallet standard (EIP-1193 / CAIP).** `eth_*`-style
   namespaced methods, `sendTransaction` vs `signTransaction` semantics, plural
   `accountsChanged`/`chainChanged` events, CAIP-2 chain ids (`phantasma:mainnet`).
   This maximizes durability and external-dev familiarity (and any future WC bridge).
5. Keep genuine Phantasma domain terms (e.g. `nexus`) as FIELDS, not as cryptic method
   names.
Prefix: **`pha_`** (mirrors `eth_`).

Names are namespaced `pha_*`. Params/results are JSON objects (named). Binary = base64.

### 9.2 Methods
Connection / session:
- `pha_connect` - pair or resume. Params: dappMeta, requested chains/methods/features,
  dApp pubkey. Result: capability handshake (§5) incl. account(s) + session.
- `pha_disconnect` - end session.
- `pha_getAccounts` - account(s): address, name, balances (incl. NFT ids), avatar.
- `pha_getChains` - supported chains (CAIP-2 ids) + current; `nexus` returned as a field
  (subsumes `getNexus`).
- `pha_getWalletInfo` - wallet name, version, capabilities, RPC endpoint (subsumes
  `getWalletVersion` and `getPeer`).

Signing / sending (the transaction FORMAT is an explicit param - see §9.4):
- `pha_signMessage` - sign an arbitrary message (base64). Result: signature + the random
  the wallet prepended. Non-tx-forgeable (§8). (was `signData`)
- `pha_signTransaction` - `{ format, tx }` → sign ONLY, return the assembled signed tx
  (base64); the dApp broadcasts it itself. Covers the production "wallet-as-signer,
  dApp-broadcasts" flow. (was `signTx` no-broadcast / `signTxSignature` /
  `signPrebuiltTransaction`)
- `pha_sendTransaction` - `{ format, tx }` → sign AND broadcast via the format's RPC
  endpoint; Result: tx hash. Main path for token/NFT/image txs. (was `signTx`-with-
  broadcast / `signCarbonTxAndBroadcast`)

Read:
- `pha_invokeScript` - read-only VM invoke (eth_call-like); Result: decoded results[].
  (was `invokeScript` / `invokeRawScript`)

DROPPED in v5: `getN3Address`, `writeArchive`, and `multiSig` (the v1-v4 `multiSig` stub
was non-functional; real multisig is a future ADDITIVE capability, not a carried-over
broken stub).

Events (wallet→dApp): `pha_accountsChanged`, `pha_chainChanged`, `pha_sessionDeleted`,
`pha_sessionExpired`, `pha_sessionEstablished` (the §15 step-3 handshake completion: an
unsolicited connect result pushed right after pairing approval; see §9.5).

### 9.3 Legacy → v5 name map (for migration + the compat shim)
| v1-v4 | v5 |
|---|---|
| `authorize` | `pha_connect` |
| `getAccount` | `pha_getAccounts` |
| `getNexus` | `pha_getChains` (nexus as field) |
| `getPeer` / `getWalletVersion` | `pha_getWalletInfo` |
| `signData` | `pha_signMessage` |
| `signTx` (no broadcast) / `signTxSignature` / `signPrebuiltTransaction` | `pha_signTransaction` (sign-only, `format`) |
| `signTx` (broadcast) / `signCarbonTxAndBroadcast` | `pha_sendTransaction` (`format`) |
| `invokeScript` / `invokeRawScript` | `pha_invokeScript` |
| `getN3Address`, `writeArchive`, `multiSig` | DROPPED in v5 |

### 9.4 Transaction formats (how the wallet picks the RPC endpoint)
The chain accepts two DISTINCT signed-transaction formats, each via its OWN RPC
submission endpoint:
- **`script`** - the classic Phantasma `Transaction` (nexus/chain/script/payload/
  expiration/signatures) → RPC `SendRawTransaction` (`Transaction.Unserialize`,
  `network.SendRawPhantasmaTransaction`). Still used on Gen3 for VM/contract-lifecycle
  txs (e.g. token-deployment's prebuilt txs).
- **`carbon`** - the Gen3-native `SignedTxMsg` (a typed `TxMsg`: TransferFungible,
  MintNonFungible, Call, Trade, … plus `Phantasma`/`Phantasma_Raw` variants that WRAP a
  classic script) → RPC `SendCarbonTransaction` (`CarbonBlob.New<SignedTxMsg>`,
  `network.SendTransaction`).

Because the two go to DIFFERENT endpoints, the wallet MUST know the format. v5 makes it
an EXPLICIT `format` field on `pha_signTransaction` / `pha_sendTransaction`
(values `"script"` | `"carbon"`) - NOT baked into the method name, NOT byte-sniffed.
The wallet routes `format` → the correct RPC endpoint and advertises supported formats in
the capability handshake (`txFormats`); an unsupported format returns `5004`. A new
format later = a new enum value + capability, never a new method. This is exactly what
keeps the signing surface durable while honoring the real two-endpoint RPC.

### 9.5 Method contracts
Per-method params, results, and edge cases.

**`pha_connect`** - params `{ dapp:{name,url,icon,description}, pubkey, chains[],
methods[], features[] }`; result = capability handshake (§5) + the granted `account` +
`session{ id, expiresAt }`.
- The wallet returns the GRANTED capabilities, which MAY be a subset of what was
  requested (WC-style partial approval); the dApp inspects what it actually got.
- Resume = `pha_connect` carrying an existing `session` id → no prompt unless
  expired/revoked.

**`pha_disconnect`** - params `{}` (session implicit); result `{ ok:true }`. Idempotent -
disconnecting an unknown/closed session is a success no-op.

**`pha_getAccounts`** - params `{}`; result `{ accounts:[{ address, name, avatar,
balances:[{symbol,value,decimals,ids[]}] }] }`. Returns ONLY the account(s) authorized
for THIS session (default exactly one - no enumerating the user's other addresses).
Multi-account exposure is a future additive capability.

**`pha_getChains`** - params `{}`; result `{ chains:[caip2…], current:caip2, nexus }`.

**`pha_getWalletInfo`** - params `{}`; result `{ name, version, capabilities, rpc }`.
`rpc` (the wallet's configured node URL) is informational so a dApp can read chain state
via the same node; no keys/approval involved.

**`pha_signMessage`** - params `{ message:base64, display?:string }`; result
`{ signature:base64, random:base64 }`. Construction + non-forgeability: §8.
- `signature` is the RAW 64-byte Ed25519 DETACHED signature over
  `DOMAIN_TAG || random || message` (not a kind-prefixed envelope), signed by the
  account's Phantasma key - verifiable with any NaCl stack against the public key
  derived from the account address.

**`pha_signTransaction`** - params `{ format:"script"|"carbon", tx:base64,
signatureKind?, pow? }`; result `{ signedTx:base64 }` (does NOT broadcast - the dApp
submits it). Covers the prebuilt-sign flow (e.g. token deployment).
- `pow` (ProofOfWork enum: None/Minimal/Moderate/Hard/Heavy/Extreme) is meaningful ONLY
  for `format:"script"` (Phantasma-VM PoW); ignored for `carbon`.
- For PREBUILT script transactions the wallet does NOT mine pow: mining would mutate the
  payload the dApp already assembled. Proof-of-work on a prebuilt tx is the builder's job;
  the parameter is accepted for wire compatibility. Carbon witnesses are Ed25519-only:
  `signatureKind:"ECDSA"` with `format:"carbon"` returns 5003.
- The wallet parses `tx` per `format`, shows a human-readable description, and requires
  user approval.
- `signatureKind: "Ed25519"|"ECDSA"` selects the signing key (default Ed25519); see §9.7.

**`pha_sendTransaction`** - params `{ format:"script"|"carbon", tx:base64,
signatureKind?, pow? }`; result `{ hash }`. Wallet signs AND broadcasts via the format's
RPC endpoint (§9.4: script→SendRawTransaction, carbon→SendCarbonTransaction). Same
`pow`/`signatureKind` rules as above. Main path for token/NFT/image txs.

**`pha_invokeScript`** - params `{ chain, script:base64 }`; result `{ results:[…] }`
(decoded VM objects). Read-only, NO user approval, NO keys. Kept as a convenience so a
dApp without its own RPC can read via the wallet's node; a dApp that has RPC access can
equally call the node directly.

**Events** (wallet→dApp): `pha_accountsChanged{accounts}`, `pha_chainChanged{chain}`,
`pha_sessionDeleted{session}`, `pha_sessionExpired{session}`,
`pha_sessionEstablished{<pha_connect result>}`.
- Transport caveat: live events require a PERSISTENT transport (injected / loopback /
  relay subscription). A stateless deeplink-ping-pong session has no open channel, so it
  does NOT receive pushed events; such a dApp re-queries account/chain on its next
  interaction.
- EXCEPTION: `pha_sessionEstablished` DOES ride the deeplink transport - it is not a
  spontaneous push but the reply leg of the §15 pairing handshake (step 3): the wallet is
  foreground at the approval moment and opens the pairing callback with the sealed event.
  The wallet sends it only when the pairing meta carries a dApp name (the consent dialog
  must show a real identity before any account data is granted) and the wallet is unlocked
  with an account; otherwise nothing is pushed and the dApp falls back to the classic
  explicit `pha_connect` (which prompts). One pairing approval = one usable session: the
  first connection is a single user gesture.

### 9.6 `format` values: `"script"` | `"carbon"`
Classic `Transaction` is, in practice, the **script-carrying** tx (its only present-day
use is a VM script), so `"script"` (not the ambiguous `"phantasma"`). Carbon stays
`"carbon"` (the real system term: `SendCarbonTransaction`/`CarbonBlob`). Nuance kept
honest: a Carbon `TxMsgPhantasma` ALSO wraps a script, but it is still the `carbon`
envelope - routing is by ENVELOPE/serialization, not by "contains a script".

### 9.7 Multi-platform signing
`signatureKind` selects WHICH KEY signs a **Phantasma** transaction/message:
- `Ed25519` → the Phantasma key; `ECDSA` → the secp256k1 key (used by ETH/BSC-interop
  accounts). Both sign the SAME Phantasma tx bytes (`transaction.ToByteArray(false)`) - a
  Phantasma tx can carry an ECDSA signature when the account is ETH-key-backed.
- It is NOT native foreign-chain signing: the wallet always broadcasts to PHANTASMA. It
  never builds an Ethereum RLP tx or broadcasts to the Ethereum network. `Neo` is not
  supported in any signing path.
- Both the sign-only and broadcast paths MUST honor the requested `signatureKind`;
  `pha_sendTransaction` must not silently fall back to the default key.

v5: `signatureKind: "Ed25519" | "ECDSA"` on `pha_signTransaction` /
`pha_sendTransaction` / `pha_signMessage` (default Ed25519); advertise `signatureKinds`.
The value selects the key that signs the Phantasma payload. Native Ethereum/BSC RLP
signing and broadcast is NOT part of v5 (a possible future additive capability).

## 10. Error codes
JSON-RPC reserved:
- `-32700` parse error, `-32600` invalid request, `-32601` method not found,
  `-32602` invalid params, `-32603` internal error.
App-level (EIP-1193-aligned where sensible):
- `4001` user rejected, `4100` unauthorized / no valid session, `4900` wallet
  disconnected / locked, `4902` unsupported chain.
Phantasma-specific:
- `5001` payload too large (carries `maxPayloadBytes` in `data`), `5002` nexus/chain
  mismatch, `5003` unsupported signature kind, `5004` capability not supported,
  `5100` session expired, `5101` session revoked.
Errors are STRUCTURED (`{code,message,data}`) - no more free-text string matching like
v1-v4 (e.g. `startsWith('nexus mismatch')`).

## 11. Sizes & budget
- `maxPayloadBytes` advertised per transport in the handshake. Defaults: deeplink 8192
  (conservative URL budget), loopback/relay 32 MiB (chain max-tx).
- An image-bearing token/NFT tx is bounded by the chain's 1 MiB metadata struct
  (~750 KB image after base64+JSON) - the SDK validates against the advertised limit and
  the chain limit BEFORE sending, with a clear `5001` error instead of a silent fail.
- Transport encoding overhead: base64 (~33%) over the serialized tx (vs hex 100% in
  v1-v4). The on-chain `icon` field's own base64 is a chain-format concern, not the
  transport's.
- Chunking (relay only, for payloads above the per-frame cap): the
  `{ msgId, seq, total, chunk }` frames defined in §16, reassembled before decryption.

## 12. Backward compatibility & migration
- Wallets run BOTH dispatchers in parallel:
  - Legacy v1-v4 string protocol (`{id},authorize/…`) - unchanged, for existing dApps.
  - v5 envelope - detected by the structured `pha_connect` / `plv:5` handshake (and the
    new transport endpoints, e.g. `/phantasma/v5`).
- New dApps adopt v5 via the SDK; old dApps keep working untouched.
- Deprecation window: announce → grace period → remove legacy (date/criteria TBD).
  Track which dApps still use v1-v4 before removal.
- ecto-mobile MUST stop vendoring an old SDK copy and consume the canonical SDK.

## 13. Reference implementation & conformance
- ONE reference implementation of the v5 envelope + transports in `phantasma-sdk-ts`
  (`src/link/v5/`; canonical per workspace rule; never reimplement VM/script/serialization - reuse the
  SDK). Wallets consume it: Ecto/ecto-mobile via the TS SDK; PoltergeistLite via the C#
  core (`phantasmaphoenix-sdk-cs`) mirroring the same envelope.
- Parity SDKs (C#, Unity, Go, C++) implement the SAME envelope against a shared set of
  **conformance test vectors** (encode/decode of every method's request/response, error
  cases, handshake, encryption KATs). Parity is already a mandatory SDK rule.

## 14. Security considerations (summary)
- E2E encryption on deeplink + relay; relay is blind; no secret in any URL (ECDH).
- Universal links (domain-verified) primary; custom scheme fallback only;
  `link.phantasma.info` must serve `apple-app-site-association` + Android `assetlinks.json`.
- Loopback bound to loopback only + origin binding; replace the hand-rolled HTTP/WS
  server with a vetted library.
- Session expiry + revocation UI; per-method/per-chain scoping; dApp identity shown on
  every approval.
- signMessage non-forgeable (CSPRNG random + domain tag).
- Replay protection via `id` + session sequence.
- Relay abuse controls (rate-limit, topic auth, message TTL) - design in the relay spec.

## 15. Pairing URI + handshake
A pairing URI carries everything needed to bootstrap an encrypted session. It is shown as
a QR (cross-device: desktop dApp → phone wallet) or opened as a deeplink (same-device).

The pairing material is delivered by ONE of two channels, and the channel decides the
key-establishment method (full crypto in §18). Everything sensitive sits in the URL
**fragment** (`#…`), which browsers never send to the server, so link.phantasma.info's
logs never see it; the OS still hands the full URL (incl. fragment) to the app.

PRIMARY - universal link or QR (channels a relay/other app cannot intercept):
```
https://link.phantasma.info/v5/pair#v=5&t=<topic>&relay=<host>&sk=<symKey b64url>&meta=<dappMetaB64>
```
- `sk` = a random 32-byte SESSION KEY (CSPRNG). Safe to place here because a universal link
  is domain-verified (only the link.phantasma.info-associated app receives it - no
  scheme-squatter) and a QR is optical/user-mediated. The relay NEVER sees `sk`. → no MITM.

FALLBACK - custom scheme `phantasma://v5/pair#…` (last resort; a scheme-squatting app
could read it), so NO secret goes in it:
```
phantasma://v5/pair#v=5&t=<topic>&relay=<host>&pk=<dappX25519Pub b64url>
```
- `pk` = the dApp's EPHEMERAL X25519 PUBLIC key; the session key is derived by ECDH (§18).
  No secret in the URL.

Common fields: `t` = topic (32 random bytes, b64url, the relay channel id); `relay` = host
(or omitted → default); `meta` (dApp name/url/icon) MAY instead be sent encrypted.

Handshake:
1. dApp creates the topic + the key material (a `symKey` for the primary channel, OR an
   ephemeral X25519 keypair for the custom-scheme fallback), builds the URI, subscribes to
   the topic on the relay, and shows the QR / opens the deeplink.
2. Wallet reads the URI, establishes the session key (§18: use `sk` directly, or
   `box.before(dappPub, walletPriv)` for the fallback), and shows dApp metadata + approval.
3. On approval, the wallet publishes the ENCRYPTED `pha_connect` result (capabilities +
   account + `session{id,expiresAt}`) to the topic (fallback path: prefixed with the
   wallet's ephemeral public key).
   - The result rides as the unsolicited
     `pha_sessionEstablished` event envelope (see §9.5). sym: an ordinary sealed relay
     payload (or the deeplink callback when the pairing has no relay). ecdh: one relay
     payload `{ "wpk": <wallet X25519 pub, base64url>, "nonce": ..., "ct": ... }` - the
     public key in the clear beside the first sealed frame; the dApp derives the key
     (box.before) and opens it. The hop fires once; receivers ignore later `wpk`s, so a
     forged re-key of a live channel is impossible.
4. dApp decrypts → session established. ALL later envelopes (any transport) use this session
   key with `secretbox` (§18).

Crypto construction, MITM analysis, nonces, and replay handling are specified in §18.

## 16. Relay protocol
A dumb, E2E-blind pub/sub over WSS. Self-hosted with the explorer (§6.4).

Frames (JSON): `{ op, topic, id?, payload? }`, `op ∈ { subscribe, unsubscribe, publish,
deliver, ack, error }`. `payload` is OPAQUE ciphertext (NaCl box, §8) - the relay never
decrypts.
- **Routing**: by `topic` (the 32-byte pairing id). The relay forwards a `publish` on a
  topic to every other subscriber of that topic as `deliver`.
- **Mailbox / TTL**: if no subscriber is currently connected (e.g. the wallet hasn't been
  woken yet), the relay HOLDS the message up to a TTL (default 300 s), then drops it. So a
  deeplink-woken wallet can fetch a just-published request. `ack` confirms delivery.
- **Auth**: the topic is a bearer capability (knowing it = being in the session). Plus
  per-connection limits (below). No account/identity needed (E2E-blind).
- **Limits / abuse**: per-connection + per-IP rate limits; max topics per connection
  (fixed protocol limit, default 8 - clients MUST keep their active subscriptions under it
  per §7); message-size cap = `frameCap` (default 1 MiB per frame) - larger messages are
  CHUNKED (below); idle-connection timeout; topic auto-expiry with the session.
- **`error` frames are NOT optional for clients.** A `subscribe` may be refused (e.g.
  `topic_limit` at the max-topics cap). The relay replies with an `error` frame and the
  client MUST surface it - fail the affected session/operation - and NEVER silently ignore
  it. Silently dropping a failed `subscribe` makes the wallet believe it is listening while
  the relay never routes to it, so every request on that topic hangs (see the §7 lifecycle
  rules).
- **Chunking** (for payloads above `frameCap`, up to the 32 MiB chain max-tx): a logical
  message is split into frames `{ msgId, seq, total, chunk }`; the receiver reassembles by
  `msgId` before decryption. `total` and a per-`msgId` byte ceiling are enforced to bound
  memory.
- The relay needs NO Phantasma SDK and does NO chain logic.

## 17. Deeplinks & universal-link hosting
Paths under `https://link.phantasma.info/v5/` (and mirrored `phantasma://v5/…`):
- `/pair` - pairing (§15).
- `/req`  - small same-device request: `#t=<topic>&f=<b64url(sealed frame)>`
  (sealed payload in the fragment, routed by the pairing topic; the session id is inside the
  envelope and the callback is the one fixed at pairing; size-gated per §6.3).
- `/wake` - foreground the wallet so it reconnects to the relay and drains its pairings'
  mailboxes; carries no payload.
- result return - the wallet opens the pairing callback (native: its own scheme/universal
  link; web: an https URL) with `#plv=5&t=<topic>&f=<b64url(sealed frame)>`.

Hosting - on a DEDICATED SUBDOMAIN `link.phantasma.info`, NOT the main website:
- Why a subdomain: universal links / App Links are per-host; a subdomain is its own host
  for verification, so it works identically to a root domain. This keeps the whole feature
  off the main phantasma.info site. The ONLY change to existing infra is a DNS record.
- Setup (no main-site changes): (1) add a DNS A/AAAA (or CNAME) record
  `link.phantasma.info` → the SAME box that runs the relay/explorer; (2) TLS via
  Let's Encrypt (Caddy/certbot); (3) the relay server (or its reverse proxy) ALSO serves,
  on that host, the two `.well-known` files + the static `/v5/*` fallback pages + the
  relay WSS endpoint. One subdomain, one box, serves everything.
- iOS: `https://link.phantasma.info/.well-known/apple-app-site-association` (JSON; lists the
  wallet app's `<TeamID>.<BundleID>` and the `/v5/*` paths). Served as `application/json`,
  no redirect, over HTTPS. App entitlement: `applinks:link.phantasma.info`.
- Android: `https://link.phantasma.info/.well-known/assetlinks.json` (the wallet app package
  name + signing-cert SHA-256 fingerprint, `delegate_permission/common.handle_all_urls`).
  Intent-filter host = `link.phantasma.info`.
- The web `/v5/*` pages double as the graceful fallback when the app is NOT installed
  (e.g. an "install the wallet" page) - a property custom schemes lack.
- Custom scheme `phantasma://` is registered by each wallet as the fallback transport
  only; universal/app links are primary (domain-verified, anti-hijack).

## 18. Cryptographic construction
Primitive: NaCl **`secretbox` (XSalsa20-Poly1305)** for EVERY session message, under one
32-byte session key. X25519 is used ONLY for the custom-scheme fallback's key
establishment. Everything is standard NaCl, wire-interoperable across the §8 packages
(`tweetnacl` / `crypto_box` / `NaCl.Net` / `x/crypto/nacl` / libsodium).

### 18.1 Session-key establishment (channel decides)
Refinement of the earlier "no secret in URL" rule - the accurate rule is "no secret in a
HIJACKABLE url". A symmetric key is the simplest STRONG design where the delivery channel
is itself safe; ECDH is the fallback for the one hijackable channel:

- **Universal link / QR (PRIMARY):** the dApp generates `symKey` = 32 CSPRNG bytes; it
  rides in the universal-link fragment or the QR. MITM-proof because the relay never sees
  it AND the channel is not software-interceptable (universal link = domain-verified → only
  the app; QR = optical). This is the WalletConnect-style symmetric model, and it is
  correct here precisely BECAUSE these channels are safe - simpler and strictly stronger
  than ECDH on these paths.
- **Custom scheme (FALLBACK, hijackable):** no `symKey` in the URL. X25519 ECDH instead -
  dApp ephemeral pub in the URL (public, useless to a squatter), wallet ephemeral pub
  returned over the relay, both derive the key via `box.before`. 
  - MITM analysis: only PUBLIC keys travel; a passive relay/3rd party cannot derive the
    key. An ACTIVE compromised relay could swap the wallet's returned pubkey - but this is
    ONE-SIDED: the relay can spoof the wallet→dApp direction, yet it CANNOT derive the
    wallet-side key (the wallet used the dApp pubkey from the out-of-band URL, which the
    relay can't change) and therefore CANNOT get the wallet to sign anything. Bound: a
    confusing/failed connect, NOT signature or fund theft. For high-value sessions the
    wallet MAY require a Short-Authentication-String (SAS) compare (both sides show a short
    hash of the real transcript; user confirms). The relay is also self-hosted + E2E-blind,
    so an "active compromised relay" means the relay infra is compromised - out of the normal
    threat model.

Either path yields one 32-byte session key; the channel is uniform `secretbox` thereafter.

### 18.2 Per-message
- `nonce` = 24 CSPRNG bytes per message (XSalsa20's 192-bit nonce → random nonces are
  collision-safe; no cross-transport counter coordination needed).
- `ct` = `secretbox(utf8(envelope_json), nonce, sessionKey)`.
- Frame: relay/deeplink carry `{ nonce:b64, ct:b64 }` (b64url in URL fragments). Chunked
  messages (§16) are reassembled to the full `ct` BEFORE one `secretbox` open.
- Replay: the wallet rejects a duplicate envelope `id` within a session and a reused
  `nonce`; the session binds a monotonic sequence.

### 18.3 Key hygiene
- The session key and any X25519 ephemerals are EPHEMERAL per pairing, in-memory only,
  rotated on re-pair, destroyed on disconnect/expiry/revoke.
- They are NEVER the account signing key: Ed25519/ECDSA are used strictly for signing
  (txs, messages), never for the channel; the channel key is never used to sign.
- Channel crypto (this section) is independent of the on-chain signature crypto - the
  `signMessage` domain separation (§8) and tx signatures protect the on-chain layer; the
  channel protects the transport.

Summary: standard NaCl; MITM is closed on the primary paths and bounded (no key or fund
theft) on the fallback.
