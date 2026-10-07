# Phantasma Link v5 - protocol specification

Status: v1.2 (stable). Supersedes the v1-v4 string protocol (see §12).

This is an engineering specification and the source of truth for the dApp↔wallet
connection protocol.

Design constraints:

- Own relay (self-hosted), JSON envelope, keep loopback.
- Deeplink ping-pong = primary path for the ~99% small requests AND relay-independent
  (a relay outage must not break normal signing). Relay = large payloads (~1% "fat" tx)
  - cross-device. Universal-link domain = the dedicated subdomain `link.phantasma.info`
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
6. **Shared conformance vectors** (§13): every implementation is checked against the
   same vectors, so the implementations cannot drift apart.

Non-goals (v5):

- Replacing on-chain data with hash-references; images stay on-chain, inside the tx.
- Multi-wallet-aggregator UX and bridges to other wallet-connection protocols (this
  protocol runs its own relay).
- Changing any chain/validator/RPC behavior. v5 is purely the transport+envelope.

## 2. Terminology

- **dApp**: the requesting app (web page, native app, game). Holds NO keys.
- **Wallet**: holds keys, shows approval UI, signs. It runs as a browser extension, a
  desktop app or a mobile app.
- **Envelope**: the JSON message format (§4).
- **Transport / binding**: a concrete channel carrying envelopes (§6): injected,
  loopback, deeplink, relay.
- **Session**: persistent, mutually-authenticated trust between a specific dApp and a
  specific wallet account, with capabilities + a shared encryption key + expiry (§7).
- **Pairing**: the one-time exchange that creates a session.
- **Relay**: a self-hosted, E2E-blind pub/sub server that forwards ciphertext between a
  dApp and a wallet that can't reach each other directly (§6.4).
- **Network** and **chain**: the `chains` and `current` of §5 and §9.5 and the `chain` of
  `pha_chainChanged` are networks, named by CAIP-2 ids such as `phantasma:mainnet`. The
  `chain` param of `pha_invokeScript` (§9.5) is the name of a chain of the network's nexus,
  such as `main`.

## 3. Architecture at a glance

```
            ┌─────────────── ONE JSON envelope (§4) ───────────────┐
            │                                                        │
dApp client─┤  injected   loopback   deeplink            relay       ├─ Wallet
            │ (extension) (desktop)  (mobile small)  (big / x-device) │
            └────────────────────────────────────────────────────────┘
  selection: injected → loopback → deeplink(small) → relay(big/x-device)
  resilience: deeplink(small) works even if relay is down.
```

The dApp calls the high-level methods of its client (sign a transaction, …). The client
builds an envelope and picks a transport. The wallet implements ONE envelope handler
regardless of transport. Wake/handoff on mobile is always via deeplink; data moves over the
chosen transport.

## 4. Message envelope (JSON-RPC 2.0 profile)

All messages are UTF-8 JSON. Binary fields are **base64** (NOT hex - halves wire
size vs the old protocol). One logical request = one envelope; correlation by `id`.

Request:

```json
{
  "plv": 5,
  "id": "f1c2…", // random, unique per request, at most 128 characters
  "session": "s_9a8b…", // omitted only on the very first connect/pair
  "sentAt": 1767225600000, // when the dApp sent it, Unix ms
  "method": "pha_signTransaction",
  "params": {
    /* method-specific, named fields */
  }
}
```

Success response:

```json
{
  "plv": 5,
  "id": "f1c2…",
  "result": {
    /* method-specific */
  }
}
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
- `id` is a string of 1 to 128 characters, drawn at random, so that the requests of a page
  that reloads never repeat ids that the wallet remembers (§18.2). A request whose `id` is
  longer gets `-32600`.
- In a request, a field of the envelope or of `params` whose value is `null` counts as
  absent.
- Unknown `method` → `-32601`; bad params → `-32602`; malformed JSON → `-32700`.
- A method that the wallet does not implement gets `-32601` before any check of the session
  (`4100`, `5006`, `5100`, `5101`) or of the lock (`4900`), because the methods of a wallet
  depend on neither.
- No positional args, no `,`/`/` delimiters, no version-gated arg layouts. New fields
  are additive and optional; capability negotiation (§5) gates new behavior, not the
  envelope shape.
- A receiver ignores a field of an envelope, of `params`, of a result or of an event that it
  does not know, so that a later version can add one.
- `sentAt` is the time at which the dApp sent the request, in Unix milliseconds. It travels
  sealed with the request, so a relay cannot change it, and a copy of the request carries the
  same value. A request without it stays valid; it only never gets a signature without a
  prompt (§9.8).
- Concurrency: requests are independent by `id`; a wallet MAY serialize UI prompts but
  MUST correlate responses by `id` (no global single-in-flight flag like v1-v4).

## 5. Capability handshake (replaces the magic version int)

At connect/pair, both sides exchange capabilities once; cached in the session.

Wallet → dApp, the `pha_connect` result:

```json
{
  "wallet": { "name": "Example Wallet", "version": "x.y.z", "icon": "https://…" },
  "capabilities": {
    "plvVersions": [5],
    "methods": ["pha_connect","pha_disconnect","pha_getAccounts","pha_getChains","pha_getWalletInfo","pha_signMessage","pha_signTransaction","pha_sendTransaction","pha_invokeScript","pha_requestSigningPermission","pha_getSigningPermission","pha_revokeSigningPermission"],
    "chains": ["phantasma:mainnet"],                       // CAIP-2-like ids; the network in use (§10)
    "txFormats": ["script","carbon"],                      // routes to SendRawTransaction / SendCarbonTransaction (§9.4)
    "signatureKinds": ["Ed25519","ECDSA"],
    "features": [],
    "maxPayloadBytes": { "relay": 33554432, "deeplink": 3072, "loopback": 33554432, "injected": 33554432 }
  },
  "account": { "address": "P2K…", "name": "…", "balances": [ … ] },
  "session": { "id": "s_9a8b…", "expiresAt": 1767225600000 }
}
```

- The capabilities sit in their own `capabilities` object, the object that `pha_getWalletInfo`
  returns as well (§9.5). The wallet identity, the account and the session sit beside it.
- `capabilities.features` is required. It lists the granted additive features. This version
  defines no feature value, so a wallet sends `[]`. A dApp ignores a value it does not know.
- `session.expiresAt` is required. It is the end of the lifetime the user picked (§7), in
  Unix milliseconds, or `null` when the lifetime has no fixed end, as with `always`. The
  inactivity expiry of §7 applies in addition and is not reported.
- The reasons for this shape: decision record 0002 in `spec/decisions/`.

dApp → wallet (in `pha_connect` params): dApp metadata `{ name, url, icon, description }`,
requested `chains`, `methods` and desired `features`.

Effect: a dApp can KNOW before sending whether the wallet supports Carbon, a given
chain, or a payload of size N - instead of guessing from "version 4". New wallet/dApp
features are additive capabilities; no new protocol version forks every implementation.

## 6. Transports (bindings of the same envelope)

A client that picks the transport itself uses the order of §3: injected, loopback, deeplink
for small requests, relay for large ones and across devices. A web page on the wallet's phone
is the exception: it sends over the relay first and falls back to the deeplink (§6.3).

### 6.1 Injected (browser-extension wallet)

The wallet is a browser extension. It puts a provider object on the page, and the dApp
talks to that object directly. The rules below are the whole contract between a dApp and
an extension wallet. How the extension moves a frame between the page and its background
process is the wallet's own business and is not part of the contract. The reasons behind
this binding and the rejected options: decision record 0001 in `spec/decisions/`.

**Provider object.** The extension defines `window.phantasmaLink` in the page's main
world before any page script runs (a content script at `document_start` in the `MAIN`
world). The object has this shape:

```ts
interface PhantasmaLinkProvider {
  /** Protocol generations the wallet speaks. Contains 5. */
  readonly plvVersions: readonly number[];
  /** Sends one request envelope and returns its response envelope. */
  request(frame: string): Promise<string>;
  /** Subscribes to event envelopes. Returns the function that unsubscribes. */
  onEvent(handler: (frame: string) => void): () => void;
}

declare global {
  interface Window {
    phantasmaLink?: PhantasmaLinkProvider;
  }
}
```

**Frames.** Every frame is the UTF-8 JSON text of one envelope (§4), in plain text. This
binding has no channel encryption (§8). The page and the extension run in the same
browser on the same machine. Encryption would add nothing: a key held by the page is
visible to every script that can call the provider.

**Requests.** One call to `request` carries one request envelope. The promise resolves
with the response envelope that carries the same `id`. Any number of calls may be in
flight at the same time, and the wallet answers each one by its `id` (§4). Each call waits
for its own answer, so a request whose `id` the wallet remembers (§18.2) gets a `-32600`
error envelope here instead of being dropped. The promise
rejects only when the bridge itself fails: the extension is gone, or its background
process cannot be reached. A wallet error, a protocol error or a rejected approval never
rejects the promise. It arrives as an error envelope (§10). A client reports a rejected
promise to the dApp as `4900`.

**Events.** `onEvent` delivers the event envelopes of §9.5. The wallet delivers an event
only to the pages that own the session named in the event, and only when the page's
origin is the origin bound to that session; the event of a session bound to no origin goes
to the pages it was served on (§7).

**Detection.** A provider is present when `window.phantasmaLink` exists, its `request`
is a function, and `plvVersions` contains `5`. The check is synchronous. No readiness
event is defined, because the provider exists before the page's scripts run. When a
provider is present, a client that picks the transport itself uses it before any other
transport (§3).

**Origin.** The extension learns the page origin from its own runtime (the sender of the
message), never from the frame. The wallet binds the session to that origin (§7) and
shows it in every approval. The `dapp.url` given in `pha_connect` is information for the
user. When its origin differs from the runtime origin, the wallet SHOULD say so in the
approval. When the runtime gives no origin, the wallet labels the caller as unverified,
as §6.2 does for loopback callers.

**Iframes.** An iframe gets its own provider and is treated as its own origin.

**Sizes.** The wallet advertises `maxPayloadBytes.injected` (§5). The default is the
chain maximum, 32 MiB. The limits of the browser's extension messaging are the wallet's
concern. The wallet answers `5001` when a frame is too large for it.

**One provider.** A page has one provider slot. When two extensions define it, the later
one wins.

**Coexistence with v1-v4.** An extension that also serves v1-v4 dApps (§12) MAY define
`window.PhantasmaLinkSocket` and `window._PhantasmaLinkDetected` for them. A v5 client
never reads them.

### 6.2 Loopback (desktop browser/app ↔ desktop wallet) - KEPT

- The desktop wallet runs a **loopback-only** WebSocket server (bound to
  127.0.0.1/localhost ONLY) on port 7090, path `/phantasma/v5`, carrying v5 envelopes
  (text frames; large messages allowed).
- Detection: a client connects to `localhost` (or `127.0.0.1`).
- Pros: fully offline, lowest latency, nothing leaves the machine.
- Cons: same-desktop only; localhost quirks (ports, browser permissions for local network
  access).
- Origin check: the wallet binds the session to the requesting browser origin where
  available; loopback callers without a verifiable origin get a clearly-labeled prompt.

### 6.3 Deeplink ping-pong (mobile, small requests) - PRIMARY, RELAY-INDEPENDENT

For the ~99% of requests that fit in a URL. No server, no relay.

Flow (request):

1. The client serializes the envelope, seals it with the session key (§8, §18.2),
   base64url-encodes the sealed frame, and builds a link routed by the pairing topic:
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
   reopens and the client reads the result from the fragment - clunkier, but works and is
   relay-independent). A pairing without a callback (§15) has no way back by deeplink: the
   wallet publishes the result on the pairing's relay (§16) instead.
5. The client decrypts the result.

Size gate: the client MUST fall back to the relay (§6.4) when the `f` value of the request URL
would exceed a conservative URL budget (default 8192 characters; configurable), or when the
payload of the request is larger than the wallet's `maxPayloadBytes.deeplink` (§11). A pairing
without a relay (§15) has nothing to fall back to: the client refuses such a request with
`5001` and sends nothing. Small signs (authorize, signMessage, small tx) stay on deeplink even with the
relay down - satisfying the resilience rule.

The same budget holds for the way back: a wallet whose result URL would carry an `f` value
above 8192 characters publishes the result on the pairing's relay instead, and on a pairing
without a relay it answers `5001` by the callback, with `data: { "maxUrlChars": 8192 }` (§10).
An event too large for the callback URL, such as a large `pha_sessionEstablished` on a pairing
without a relay, answers no request: the wallet does not send it, and the dApp's own timeout
of §15 applies.

dApp-type routing:

- NATIVE-app dApp ↔ wallet app: clean deeplink ping-pong (return via the dApp's own
  scheme/universal link). Relay-independent.
- WEB-page dApp on mobile: the return would reopen the browser tab (page reload). So
  for web dApps a client SHOULD send small requests over the relay (smooth, no reload),
  and FALL BACK to the https-return deeplink when the relay is unreachable -
  smooth normally, still works when the relay is down.

Security notes:

- Universal links are domain-verified (only the app the OS associated with
  link.phantasma.info can claim them) → resistant to the custom-scheme hijack where a
  malicious app registers `phantasma://`. Custom scheme is fallback only.
- Payloads in URLs are encrypted with the session key, so even a hijacking app on the
  fallback scheme can't read request/result contents.

### 6.4 Relay (large payloads + cross-device) - self-hosted, E2E-blind

For "fat" transactions (image-bearing, up to chain limits) and desktop-dApp↔phone-wallet.

Model: a self-hosted pub/sub server. Each direction of a pairing has its own **topic**
(§16). A side publishes an **encrypted** envelope to its topic; the other side, subscribed
to that topic, receives it. The relay sees only ciphertext + topic; it holds no keys and
cannot read or forge messages. The wallet connects to the relay with an **outbound**
WebSocket - which works on iOS while the app is in the foreground (it was just woken by a
deeplink).

Because the relay is E2E-BLIND it needs NO crypto and NO chain logic. It routes opaque
ciphertext by topic, with TTL, per-topic auth, rate-limiting, and message-size caps (§16).

Flow (request, mobile):

1. (Session already paired - see §7.) dApp encrypts the envelope, publishes to its topic.
2. dApp opens a small deeplink to WAKE the wallet (no payload in the URL - just a nudge to
   foreground the wallet, which then reads its pairings' mailboxes): `https://link.phantasma.info/v5/wake`.
3. Wallet (now foreground) opens its outbound WS to the relay, pulls the pending
   ciphertext, decrypts, shows UI, signs.
4. Wallet publishes the encrypted result to its topic; the client receives it (its own WS /
   subscription to that topic), decrypts. Wallet MAY deeplink back to return focus to the
   dApp.

Flow (cross-device, desktop dApp + phone wallet): pairing via QR (the pairing URI in a
QR code); thereafter identical (the phone wallet polls/subscribes the relay; the desktop
dApp subscribes too). No deeplink needed to wake an already-connected desktop session;
on mobile the wake-deeplink is used.

Size: relay messages are not URL-bounded; `maxPayloadBytes.relay` is set to the chain
ceiling (default 32 MiB). A sealed frame longer than 900 000 characters is chunked at the
transport layer (sequence + reassembly), transparent to the envelope, so every frame stays
below the relay frame cap. The chunk rules: §16.

Relay is NOT on the critical path for small same-device signing (those use deeplink).
Relay outage degrades gracefully: big tx + cross-device unavailable; everyday signing
keeps working.

## 7. Pairing & sessions

- **Pairing** (one-time) creates a Session. Two entry points:
  - Same-device mobile: dApp opens the pairing universal link
    `https://link.phantasma.info/v5/pair#…` (§15); wallet prompts the user to approve and
    returns its capabilities and the account. On the custom-scheme fallback it also returns
    its X25519 public key (§15).
  - Cross-device: dApp shows a QR encoding the pairing URI; the phone wallet scans it.
- **Session** (persistent on BOTH sides, surviving wallet restarts):
  `{ sessionId, dappMeta, account, chains, methods, features, sharedKey(material),
createdAt, expiresAt }`. The user picks the lifetime at approval (session / 1h / 1d /
  1mo / always). The wallet has a **revocation UI** listing active sessions.
  - The lifetime `session` ends when the wallet locks, and a restart locks the wallet. It
    has no fixed end date, so `expiresAt` is `null` (§5).
  - `always` has no fixed end either. Every lifetime also ends by inactivity (below) and by
    revoke.
- Re-connect: `pha_connect` with the existing session id in the envelope `session` field
  (§4, §9.5) resumes without a new prompt while the session lives. Account/chain changes are
  pushed as events (§9).
- Origin/identity: the wallet shows dApp `{name, url, icon}` in every approval. Over
  injected and loopback the wallet learns the caller's origin from its own runtime (§6.1,
  §6.2) and shows it too. Over deeplink and relay the name, the url and the icon are only
  what the dApp declared in `meta` (§15) or in `pha_connect`; nothing verifies them, so the
  wallet shows them as declared, never as a verified origin.
- **Channel.** A session belongs to the channel it was made on, and the wallet serves it,
  the resume of §9.5 included, and sends its events only there:
  - Over injected and loopback the channel is the caller's origin. A request that names a
    session bound to an origin gets `4100` from another origin or from a caller without
    one.
  - A session made by a caller without an origin (§6.1, §6.2) is bound to no origin, so it
    is the exception to this rule: any injected or loopback caller that names it is served,
    and a `pha_connect` that resumes it with another `dapp.name` than the one it was
    approved for gets `4100`. Its events go to the connections that it was served on. For
    the ids of §18.2 the channel of such a caller is its connection.
  - Over deeplink and relay the channel is the pairing, which carries one session (§18.3).
    A request that names another session than the pairing's gets `4100`, and no request
    moves a pairing to another session. A session made over a pairing is served over that
    pairing only: an injected or loopback request that names it gets `4100`.
- **Locked wallet.** A locked wallet MAY answer a request that needs neither a key nor a
  prompt, such as a read or the resume of a live session. For any other request it asks the
  user to unlock it first, or answers `4900` when it cannot ask. It never opens a second
  session in place of a live one because it is locked.
- **Account.** A session holds the one account the user approved for it (§9.5). The wallet
  answers and signs for the session with that account only, never with another one. While
  the user has another account selected, the wallet either serves the session with its
  account and shows that account in every prompt, or answers every request in the session
  except `pha_disconnect` with `5006`, the resume of §9.5 included. `5006` carries
  `data: { "address": <the session's account> }`, and the session stays on both sides: the
  dApp can ask the user to select that account and send the request again. A wallet that
  answers `5006` pushes `pha_accountsChanged` to the session when the user selects its
  account again.
- **Session-store lifecycle (bounded, NOT immortal).** Persistence above means "remember
  recent sessions for promptless resume", NOT "keep everything forever". Both sides MUST:
  - **Expire by inactivity.** Activity (any delivered request) slides `lastSeenAt`; the
    effective expiry is `lastSeenAt + idleTTL` (default 7 days).
    The `always` lifetime sets no hard calendar expiry, but `always` means "do not auto-expire
    while in use", NOT "immortal regardless of use": an `always` session is still subject to
    the relay cap below and to explicit revoke.
  - **Bound the RELAY sessions by the relay per-connection topic cap (§16).** A wallet that
    keeps all its relay sessions on ONE relay connection can subscribe only as many as the
    relay allows on it. The wallet MUST keep only the N most-recently-used relay sessions (N
    below the cap, e.g. 6 against a cap of 8) and evict the rest LRU by `lastSeenAt`:
    eviction ends the session with `pha_sessionDeleted` (below). Only relay sessions count;
    a session of another transport never takes a relay session's place. The rule holds as
    well for a wallet that opens one relay connection per pairing. Otherwise the (cap+1)-th
    session's `subscribe` is rejected and that dApp can never receive a request.
  - **Evict / revoke explicitly.** When a session ends, the wallet notifies the dApp over the
    channel, best effort, so the dApp re-pairs instead of hanging: `pha_sessionExpired` when
    its lifetime or the inactivity limit ended it, `pha_sessionDeleted` when LRU eviction, the
    user's revoke or `pha_disconnect` ended it. A pairing ends with its session (§18.3): the
    wallet then unsubscribes from the session's dApp topic (§16) and deletes the key.
  - **Requests on an ended session.** Over injected and loopback the wallet answers `5100`
    when the session expired and `5101` when the user revoked it; a wallet that no longer
    keeps the record of the session answers `4100`. Over deeplink and relay the pairing ended
    with the session, so a request in it gets no answer, and the dApp sees `5005` (§10). A
    wallet that finds the session ended when a request arrives, while it still holds the
    pairing, answers `5100` over it, the resume of §9.5 included.
  - **The dApp ends its session** on `5100`, `5101` or `4100` to a request made in it, and on
    `pha_sessionExpired` or `pha_sessionDeleted` for it. A dApp that keeps a session from an
    earlier page load and gets `5005` in it SHOULD offer the user to pair again: the wallet
    may have ended the session while the dApp was not listening.
  - **On reconnect**, subscribe only live (non-expired, within-cap) sessions - never the
    full history.

## 8. Encryption & keys

- Deeplink and relay payloads are ALWAYS encrypted (they traverse the OS / the relay).
- Injected and loopback frames are plain envelopes. Both stay on the user's machine, where
  the caller would hold any key itself, so encryption would protect nothing. The wallet
  binds the session to the caller's origin instead and labels a caller without one (§6.1,
  §6.2).
- **CHOSEN scheme: NaCl `secretbox`** = XSalsa20-Poly1305 authenticated encryption under
  one 32-byte session key, with a 24-byte random nonce per message (§18). Rationale: a
  hard-to-misuse AEAD with a 192-bit nonce (random nonces are safe, so no counter
  coordination is needed), available as a standard, cross-language-interoperable NaCl
  primitive. Signing stays Ed25519. The session key, and the X25519 keys of the fallback
  pairing, are SEPARATE from the account signing key (never reuse the Ed25519 account key
  for ECDH).
- Pairing establishes the session key (§15, §18.1). A universal link or a QR code carries
  the key itself, because no other app can intercept those channels. The custom scheme
  `phantasma://` can be hijacked, so it carries only the dApp's ephemeral X25519 public
  key, and both sides derive the session key by X25519 key agreement. **No secret appears
  in a URL that another app can intercept.**
- signMessage stays NON-forgeable as a transaction. Exact construction:
  the wallet signs `DOMAIN_TAG || random || message`, where `DOMAIN_TAG` is the fixed
  ASCII bytes `"PHANTASMA_LINK_V5_MSG\n"` (a domain separator that can never be the prefix
  of a valid serialized transaction → a signMessage signature can never be replayed as a
  transaction signature), `random` is **32 bytes from a CSPRNG**, and `message` is the
  dApp's bytes. The wallet returns
  `{ signature, random }`; a verifier reconstructs `DOMAIN_TAG || random || message`. The
  wallet SHOULD display the message to the user (UTF-8 if decodable, else a hash + byte
  length); the dApp MAY pass a `display` hint string.
- Replay protection: the wallet handles each request `id` of a session once (§18.2).

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
   This maximizes durability and familiarity for external developers.
5. Keep genuine Phantasma domain terms (e.g. `nexus`) as FIELDS, not as cryptic method
   names.
   Prefix: **`pha_`** (mirrors `eth_`).

Names are namespaced `pha_*`. Params/results are JSON objects (named). Binary = base64.

### 9.2 Methods

Connection / session:

- `pha_connect` - pair or resume. Params: dappMeta, requested chains/methods/features.
  Result: capability handshake (§5) incl. account(s) + session.
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

- `pha_invokeScript` - read-only VM invoke (eth_call-like); Result: the VM result objects,
  serialized, in base64. (was `invokeScript` / `invokeRawScript`)

Signing permission (§9.8):

- `pha_requestSigningPermission` - ask once for the permission to have the transactions that
  call only some contract methods signed without a prompt. Result: the permission.
- `pha_getSigningPermission` - the session's permission, or `null`.
- `pha_revokeSigningPermission` - end the session's permission.

DROPPED in v5: `getN3Address`, `writeArchive`, and `multiSig` (the v1-v4 `multiSig` stub
was non-functional).

Events (wallet→dApp): `pha_accountsChanged`, `pha_chainChanged`, `pha_sessionDeleted`,
`pha_sessionExpired`, `pha_sessionEstablished` (the §15 step-3 handshake completion: an
unsolicited connect result pushed right after pairing approval; see §9.5),
`pha_signingPermissionChanged` (§9.8).

### 9.3 Legacy → v5 name map (for migration)

| v1-v4                                                                   | v5                                          |
| ----------------------------------------------------------------------- | ------------------------------------------- |
| `authorize`                                                             | `pha_connect`                               |
| `getAccount`                                                            | `pha_getAccounts`                           |
| `getNexus`                                                              | `pha_getChains` (nexus as field)            |
| `getPeer` / `getWalletVersion`                                          | `pha_getWalletInfo`                         |
| `signData`                                                              | `pha_signMessage`                           |
| `signTx` (no broadcast) / `signTxSignature` / `signPrebuiltTransaction` | `pha_signTransaction` (sign-only, `format`) |
| `signTx` (broadcast) / `signCarbonTxAndBroadcast`                       | `pha_sendTransaction` (`format`)            |
| `invokeScript` / `invokeRawScript`                                      | `pha_invokeScript`                          |
| `getN3Address`, `writeArchive`, `multiSig`                              | DROPPED in v5                               |

### 9.4 Transaction formats (how the wallet picks the RPC endpoint)

The chain accepts two DISTINCT signed-transaction formats, each via its OWN RPC
submission endpoint:

- **`script`** - the classic Phantasma `Transaction` (nexus/chain/script/payload/
  expiration/signatures) → RPC `SendRawTransaction`. Still used on Gen3 for
  VM/contract-lifecycle txs.
- **`carbon`** - the Gen3-native `SignedTxMsg` (a typed `TxMsg`: TransferFungible,
  MintNonFungible, Call, Trade, … plus `Phantasma`/`Phantasma_Raw` variants that WRAP a
  classic script) → RPC `SendCarbonTransaction`.

Because the two go to DIFFERENT endpoints, the wallet MUST know the format. v5 makes it
an EXPLICIT `format` field on `pha_signTransaction` / `pha_sendTransaction`
(values `"script"` | `"carbon"`) - NOT baked into the method name, NOT byte-sniffed.
The wallet routes `format` → the correct RPC endpoint and advertises supported formats in
the capability handshake (`txFormats`); a `format` the wallet does not support returns
`5004`, and a missing or non-string `format` returns `-32602`. A new
format later = a new enum value + capability, never a new method. This is exactly what
keeps the signing surface durable while honoring the real two-endpoint RPC.

### 9.5 Method contracts

Per-method params, results, and edge cases.

**`pha_connect`** - params `{ dapp:{name,url,icon,description}, chains[], methods[],
features[] }`; result `{ wallet, capabilities, account, session:{ id,
expiresAt } }`, the shape of §5.

- The wallet returns the GRANTED capabilities, which MAY be a subset of what was
  requested; the dApp inspects what it actually got.
- Resume: the dApp sends `pha_connect` with the existing session id in the envelope
  `session` field (§4). The params carry no session id. The wallet resumes without a prompt
  while the session lives. Over injected and loopback, for a session that ended or that the
  wallet does not know, it runs the full approval and returns a new session. Over deeplink
  and relay a pairing carries one session and ends with it (§18.3): the wallet answers `5100`
  for a session that ended (§7) and `4100` for a session id it does not know, and never opens
  a second session on a pairing. The account, channel and lock rules of §7 apply to the
  resume too.
- The account in the result carries its balances without NFT ids (`ids`), so that the
  result fits the way back of a deeplink (§6.3); `pha_getAccounts` returns them. The same
  holds for `pha_sessionEstablished`.
- Over deeplink and relay, a `pha_connect` without a session on a pairing whose session lives
  resumes that session, without a prompt. A late copy of the first `pha_connect` of a pairing
  (§16) therefore changes nothing.

**`pha_disconnect`** - params `{}` (session implicit); result `{ ok:true }`. Idempotent -
disconnecting an unknown/closed session is a success no-op. A live session of another
channel is neither: the request gets `4100`, and the session stays (§7).

**`pha_getAccounts`** - params `{}`; result `{ accounts:[{ address, name, avatar,
balances:[{symbol,value,decimals,ids[]}] }] }`. Returns ONLY the account(s) authorized
for THIS session (default exactly one - no enumerating the user's other addresses).

**`pha_getChains`** - params `{}`; result `{ chains:[caip2…], current:caip2, nexus }`.

**`pha_getWalletInfo`** - params `{}`; result `{ name, version, capabilities, rpc }`.
`capabilities` is the object granted to this session, the same as in the `pha_connect`
result (§5). `rpc` (the wallet's configured node URL) is informational so a dApp can read
chain state via the same node; no keys/approval involved.

**`pha_signMessage`** - params `{ message:base64, display?:string }`; result
`{ signature:base64, random:base64 }`. Construction + non-forgeability: §8.

- `signature` is the RAW 64-byte Ed25519 DETACHED signature over
  `DOMAIN_TAG || random || message` (not a kind-prefixed envelope), signed by the
  account's Phantasma key - verifiable with any NaCl stack against the public key
  derived from the account address.
- The wallet signs messages with the account's Ed25519 key only. When the params carry
  `signatureKind`, `"Ed25519"` is accepted, `"ECDSA"` gets `5003`, and any other value gets
  `-32602`, as for every method (§9.7).

**`pha_signTransaction`** - params `{ format:"script"|"carbon", tx:base64,
signatureKind? }`; result `{ signedTx:base64 }` (does NOT broadcast - the dApp submits
it). Covers the prebuilt-sign flow.

- The wallet signs the transaction exactly as the dApp built it. It changes nothing in it
  before signing: not the script, not the payload, not the expiration. Proof-of-work on a
  transaction is the builder's job.
- Carbon witnesses are Ed25519-only: `signatureKind:"ECDSA"` with `format:"carbon"`
  returns 5003.
- The wallet parses `tx` per `format`, shows a human-readable description, and requires
  user approval.
- `signatureKind: "Ed25519"|"ECDSA"` selects the signing key (default Ed25519); see §9.7.

**`pha_sendTransaction`** - params `{ format:"script"|"carbon", tx:base64,
signatureKind? }`; result `{ hash }`. Wallet signs AND broadcasts via the format's RPC
endpoint (§9.4: script→SendRawTransaction, carbon→SendCarbonTransaction). Same rules as
above; `hash` is the hash of the transaction the dApp built, as the hex text that the
chain's RPC uses for it. Main path for token/NFT/image txs.

**`pha_invokeScript`** - params `{ chain, script:base64 }`; result
`{ results:[base64…] }`. `chain` is the name of a chain of the nexus, for example `main`.
Each element of `results` is one VM result object as the chain serializes it, in base64
(§4). Read-only, NO user approval, NO keys. Kept as a convenience so a dApp without its
own RPC can read via the wallet's node; a dApp that has RPC access can equally call the
node directly.

**`pha_requestSigningPermission`** - params `{ chain?:string, calls:[{ contract:string,
methods:string[] }], duration:number, gasLimit?:string }`; result `{ permission }`. `chain`
is the name of a chain of the nexus, default `main`. `duration` is in seconds. `gasLimit` is
a decimal string, default `"0"`, in the unit of `price × limit` of `AllowGas` (§9.8): the
smallest unit of KCAL, the chain's gas token, so `"10000000000"` is 1 KCAL. The checks, the
prompt and the rules of use: §9.8.

**`pha_getSigningPermission`** - params `{}`; result `{ permission }`, where `permission` is
`null` when the session has none.

**`pha_revokeSigningPermission`** - params `{ id? }`; result `{ ok:true }`. With `id`, the
wallet ends the session's permission only when it has this id, so a late copy of an old revoke
cannot end a newer permission; without it, the permission in force ends. Idempotent - a session
without that permission still succeeds.

The permission object is `{ id, chain, calls, expiresAt, gasLimit, gasReserved }`: the
wallet's id, the granted chain and calls, the end in Unix milliseconds, and the gas budget and
the gas reserved so far against it, both as decimal strings in the smallest unit of KCAL
(§9.8).

**Events** (wallet→dApp): `pha_accountsChanged{accounts}`, `pha_chainChanged{chain}`,
`pha_sessionDeleted{session}`, `pha_sessionExpired{session}`,
`pha_sessionEstablished{<pha_connect result>}`, `pha_signingPermissionChanged{permission}`
(the permission in force, or `null` when it ended).

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
  explicit `pha_connect` (which prompts). A custom-scheme pairing has no such fallback,
  because its dApp gets the session key only with this event, so it always carries `meta`
  (§15). One pairing approval = one usable session: the first connection is a single user
  gesture.

### 9.6 `format` values: `"script"` | `"carbon"`

Classic `Transaction` is, in practice, the **script-carrying** tx (its only present-day
use is a VM script), so `"script"` (not the ambiguous `"phantasma"`). Carbon stays
`"carbon"` (the name of the RPC method `SendCarbonTransaction`). Nuance kept
honest: a Carbon `TxMsgPhantasma` ALSO wraps a script, but it is still the `carbon`
envelope - routing is by ENVELOPE/serialization, not by "contains a script".

### 9.7 Multi-platform signing

`signatureKind` selects WHICH KEY signs a **Phantasma** transaction:

- `Ed25519` → the Phantasma key; `ECDSA` → the secp256k1 key (used by ETH/BSC-interop
  accounts). Both sign the SAME Phantasma tx bytes, the transaction without its signatures.
  A Phantasma tx can carry an ECDSA signature when the account is ETH-key-backed.
- It is NOT native foreign-chain signing: the wallet always broadcasts to PHANTASMA. It
  never builds an Ethereum RLP tx or broadcasts to the Ethereum network. `Neo` is not
  supported in any signing path.
- Both the sign-only and broadcast paths MUST honor the requested `signatureKind`;
  `pha_sendTransaction` must not silently fall back to the default key.
- A `signatureKind` that is not `"Ed25519"` or `"ECDSA"` gets `-32602`. A known kind that
  the wallet or the format does not support gets `5003`.

v5: `signatureKind: "Ed25519" | "ECDSA"` on `pha_signTransaction` /
`pha_sendTransaction` (default Ed25519); advertise `signatureKinds`. `pha_signMessage` is
Ed25519 only (§9.5).
The value selects the key that signs the Phantasma payload. Native Ethereum/BSC RLP
signing and broadcast is NOT part of v5.

### 9.8 Signing permission

A dApp that sends many small transactions, a game for example, can ask once for the
permission to have them signed without a prompt. The wallet keeps the permission with the
session. It signs a transaction request of that session without asking when the transaction
does nothing but call the permitted contract methods. Every other request still gets the
normal prompt. The reasons and the rejected options: decision record 0003 in
`spec/decisions/`.

The chain has no key delegation, so nothing but the wallet enforces a permission. The wallet
sees which methods a transaction calls, never what those methods do. The user's signature
covers the whole transaction, and a contract written to move the account's assets can do so
inside a permitted method. A permission therefore trusts the site and the contracts it names,
including every change their owners make to their code while the permission lasts and every
contract they call. A wallet MAY grant permissions only for contracts it trusts, for example
from a list it keeps.

**Request.** `pha_requestSigningPermission` (§9.5). The wallet answers `-32602` and grants
nothing when:

- `calls` is empty or names more than 8 contracts, or names a contract twice;
- a method list is empty, holds more than 32 names, or names a method twice;
- a name is not 1 to 255 printable ASCII characters without a space;
- a contract is one of the chain's built-in contracts: `gas`, `stake`, `account`, `block`,
  `consensus`, `exchange`, `friends`, `governance`, `interop`, `mail`, `market`, `privacy`,
  `ranking`, `relay`, `sale`, `storage`, `swap`, `token`, `validator`;
- `duration` is not a whole number of seconds from 60 to 86 400;
- `gasLimit` is not a decimal string of a number up to 2^63 - 1.

**Prompt.** One approval shows the dApp and its origin as §7 describes them, the account, the
network, the chain, each contract with its methods, how long the permission lasts (counted
from the approval), and the gas: the most the account may pay in total, or that it pays none.
It says plainly that the wallet will sign these calls without asking, that a contract can move
the account's assets inside them, and that its owner can change its code while the permission
lasts. A wallet MAY let the user shorten the duration. A rejection is `4001`.

**Lifetime.** A session holds at most one permission; a granted request replaces the previous
one. A permission ends at `expiresAt`, with its session (§7), on
`pha_revokeSigningPermission`, and when the user revokes it in the wallet. The wallet keeps
it, `gasReserved` included, for as long as the
session lives, also across a restart. It pushes `pha_signingPermissionChanged` when a
permission starts, when it adds gas to `gasReserved`, when the dApp or the user revokes it, and
when the wallet finds that it ended, so a dApp always knows how much of the budget is left. A
wallet on a phone may be asleep at `expiresAt`, so a dApp treats its permission as ended at
`expiresAt` without waiting for the event.

**Signing without a prompt.** The wallet signs a `pha_signTransaction` or
`pha_sendTransaction` request of the session without a prompt only when all of the following
hold. Otherwise the request gets the normal prompt; a locked wallet asks the user to unlock it
first, or answers `4900` when it cannot ask (§10).

1. The session's account is the wallet's current account (§7), the wallet is unlocked, and it
   uses the network on which the user approved the permission (§10).
2. `format` is `"script"`, and `signatureKind` is absent or `"Ed25519"`.
3. The transaction is on the permission's chain and has not expired. It expires no later than
   the permission ends, and no later than 5 minutes after the request's `sentAt` (§4). A
   request without `sentAt` never qualifies.
4. The script is exactly `gas.AllowGas(from, to, price, limit)`, one or more calls of
   permitted methods, `gas.SpendGas(from)` and a closing `RET`, in the standard call form:
   each call is a run of `LOAD r0 <value>` + `PUSH r0` pairs (the arguments, last first, then
   the method name as a String), then `LOAD r0 <contract name as a String>`, `CTX r0 r1` and
   `SWITCH r1`. A literal length uses one byte below 0xFD and the `0xFD` form above it. No
   other opcode, register or byte is allowed, so the script calls no interop and no other
   contract.
5. Both gas calls name the same `from`: an address text (String), or the 34 address bytes
   (Bytes, with or without the length byte 34 in front). `AllowGas` has four arguments,
   `SpendGas` one. `price` and `limit` are non-negative Numbers or decimal Strings.
6. When `from` is the account, `price × limit` fits in `gasLimit - gasReserved`, and the
   wallet adds it to `gasReserved` when it signs. The wallet signs before the chain charges the
   fee, so it reserves the most the transaction can cost. The real fee is usually lower, and
   the reservation is not returned, so the account never pays more than the budget. When
   another address pays the gas, nothing is reserved.
   The `to` of `AllowGas` only receives the dApp share of the gas bill, so it is not checked.

The answer is the same as after a prompt. The wallet keeps the id of a request that it signed
without a prompt at least until the transaction expires (§18.2). A copy of the request is
therefore dropped while its transaction is valid. A copy that arrives later carries an
expired transaction: rule 3 sends it to the normal prompt, and the chain refuses it. Rule 3
counts from the send time written in the request, so a
request held back and delivered late is signed without a prompt at most once, within 5 minutes
after it was sent. A dApp sends an action again only after the transaction of its earlier
request expired, so that a late delivery of the earlier request cannot repeat the action; a
client that waits 5 minutes for an answer meets this. A wallet MAY add checks of its own; such
a check may send a request to the prompt, and never signs one that these rules refuse. A phone
wallet still comes to the front for each request (§6.3, §6.4): the permission removes the
prompt, not the wake.

## 10. Error codes

JSON-RPC reserved:

- `-32700` parse error, `-32600` invalid request, `-32601` method not found,
  `-32602` invalid params, `-32603` internal error.
  App-level (EIP-1193-aligned where sensible):
- `4001` user rejected, `4100` unauthorized / no valid session, `4900` wallet
  disconnected / locked, `4902` unsupported chain.
  Phantasma-specific:
- `5001` payload too large (`data` is `{ "maxPayloadBytes": <number> }`, the limit of §11 in
  bytes; for a request or an answer above the URL budget of §6.3 it is
  `{ "maxUrlChars": <number> }`, that budget in characters), `5002` nexus/chain mismatch, `5003` unsupported signature
  kind, `5004` capability not supported, `5100` session expired, `5101` session revoked
  (when to use them: §7), `5005` no answer before the client's timeout, `5006` the
  session's account is not the wallet's current account (§7; `data` is
  `{ "address": <the session's account> }`).
  Errors are STRUCTURED (`{code,message,data}`) - no more free-text string matching like
  v1-v4 (e.g. `startsWith('nexus mismatch')`).

A wallet serves the network it uses now, one at a time. It answers `4902` when a
`pha_connect` names networks in `chains` (§5) and none of them is that network, and it grants
in `chains` that network only. It answers `5002` when a transaction is for another nexus than
the one of that network (§9.4).

Codes that the client reports itself, without an answer from the wallet:

- `4900` when the wallet cannot be reached: the bridge of an extension failed (§6.1), the
  loopback socket closed, the relay cannot be reached or did not acknowledge a frame, the
  relay refused a frame with an `error` frame (§16), or the session ended and its pairing
  with it (§18.3).
- `5005` when the wallet was reached but no answer came before the client's timeout. The
  user may still be deciding. The dApp may ask again with a new request; for a transaction
  it waits until the transaction of the earlier request expired (§9.8).
- `5001` when the client refuses to send a request whose payload is above the advertised
  limit (§11), or a request above the URL budget on a pairing without a relay (§6.3).

## 11. Sizes & budget

- `maxPayloadBytes` is advertised per transport in the handshake. Each value is the size,
  in bytes, of the largest payload the wallet accepts in one request over that transport.
  The payload is the serialized transaction of `pha_signTransaction` and
  `pha_sendTransaction`, the message of `pha_signMessage` and the script of
  `pha_invokeScript`. A wallet lists only the transports it serves. Defaults:
  loopback/relay/injected 33 554 432 (32 MiB, the chain max-tx); deeplink 3072, because a
  request with a 3 KiB payload still fits the 8192-character URL budget of §6.3. On that
  path the payload is encoded three times: base64 in the envelope, base64 in the sealed
  frame, base64url in the URL.
- An image-bearing token/NFT tx is bounded by the chain's 1 MiB metadata struct
  (~750 KB image after base64+JSON). A client checks every payload against the advertised
  limit and the chain limit BEFORE sending, with a clear `5001` error instead of a silent
  fail.
- Transport encoding overhead: base64 (~33%) over the serialized tx (vs hex 100% in
  v1-v4). The on-chain `icon` field's own base64 is a chain-format concern, not the
  transport's.
- Chunking (relay only, for a sealed frame longer than 900 000 characters): the
  `{ msgId, seq, total, chunk }` frames defined in §16, reassembled before decryption.

## 12. Backward compatibility & migration

- A wallet MAY serve both protocols side by side:
  - the v1-v4 string protocol (`{id},authorize/…`);
  - the v5 envelope, detected by the structured `pha_connect` / `plv:5` handshake (and the
    new transport endpoints, e.g. `/phantasma/v5`).
- A wallet MAY stop serving v1-v4 at any time. A dApp that has to work with every wallet
  uses v5.

## 13. Conformance

- A shared set of conformance test vectors covers the encoding and decoding of every
  method's request and response, the error cases, the handshake, and known-answer tests
  for the encryption.
- An implementation conforms to this specification when it produces and accepts every
  vector of that set.

## 14. Security considerations (summary)

- E2E encryption on deeplink + relay; relay is blind; no secret in a URL that another app
  can intercept (§18.1).
- Universal links (domain-verified) primary; custom scheme fallback only;
  `link.phantasma.info` must serve `apple-app-site-association` + Android `assetlinks.json`.
- Loopback bound to loopback only + origin binding.
- Injected: the page origin comes from the extension runtime, so the page cannot forge
  it; the session is bound to it (§6.1).
- Session expiry + revocation UI; dApp identity shown on every approval.
- signMessage non-forgeable (CSPRNG random + domain tag).
- Replay protection via the request `id` (§18.2).
- Signing permission (§9.8): enforced by the wallet alone. It covers only scripts in the
  standard call form with permitted calls between the gas calls and to a gas budget, and it
  lasts at most a day. A transaction signed under it expires within 5 minutes after its request
  was sent, so a copy of the request is never signed again without a prompt. It trusts the
  site and the contracts it names.
- Relay abuse controls (rate-limit, topic auth, message TTL), §16.

## 15. Pairing URI + handshake

A pairing URI carries everything needed to bootstrap an encrypted session. It is shown as
a QR (cross-device: desktop dApp → phone wallet) or opened as a deeplink (same-device).

The pairing material is delivered by ONE of two channels, and the channel decides the
key-establishment method (full crypto in §18). Everything sensitive sits in the URL
**fragment** (`#…`), which browsers never send to the server, so link.phantasma.info's
logs never see it; the OS still hands the full URL (incl. fragment) to the app.

PRIMARY - universal link or QR (channels a relay/other app cannot intercept):

```
https://link.phantasma.info/v5/pair#v=5&t=<topic>&relay=<relay URL>&sk=<symKey b64url>&meta=<dApp meta b64url>
```

- `sk` = a random 32-byte SESSION KEY (CSPRNG). Safe to place here because a universal link
  is domain-verified (only the link.phantasma.info-associated app receives it - no
  scheme-squatter) and a QR is optical/user-mediated. The relay NEVER sees `sk`. → no MITM.

FALLBACK - custom scheme `phantasma://v5/pair#…` (last resort; a scheme-squatting app
could read it), so NO secret goes in it:

```
phantasma://v5/pair#v=5&t=<topic>&relay=<relay URL>&pk=<dappX25519Pub b64url>&meta=<dApp meta b64url>
```

- `pk` = the dApp's EPHEMERAL X25519 PUBLIC key; the session key is derived by ECDH (§18).
  No secret in the URL.
- A wallet refuses a `phantasma://` pairing URI that carries `sk`.
- A custom-scheme pairing carries `relay` and `meta`, and a wallet refuses one without either:
  the wallet returns its public key over the relay (step 3 below), and only after the user
  saw the dApp named in `meta`.

Common fields:

- `v` = the text `5`; a wallet refuses any other value.
- `t` = topic (32 random bytes, b64url, the pairing id): 43 characters, no padding. The two
  relay topics of the pairing are derived from it (§16). A wallet refuses a pairing whose `t`
  has another form.
- `relay` = the URL-encoded `wss://` URL of the relay endpoint, for example
  `wss://link.phantasma.info/relay`. A pairing without `relay` has no relay, and the
  wallet answers by deeplink to `cb`. A wallet refuses a `relay` that is not a `wss://`
  URL.
- `cb` = the URL-encoded callback URL that the wallet opens to return a deeplink result
  (§6.3, §17), present when the dApp receives results by deeplink. Without it the wallet
  answers every request over the relay, a request that came by deeplink included. A wallet
  refuses a pairing with neither `relay` nor `cb`, because it would have no way to answer,
  and a pairing whose `relay` or `cb` is present but empty.
- `meta` = the base64url of the UTF-8 JSON of the dApp metadata
  `{ name, url, icon?, description? }`, the `dapp` object of `pha_connect` (§9.5). `name` and
  `url` are required in it.
- A pairing carries exactly one of `sk` and `pk`, 32 bytes each; a wallet refuses one with
  both, with neither, or with a key of another length.

Handshake:

1. dApp creates the topic + the key material (a `symKey` for the primary channel, OR an
   ephemeral X25519 keypair for the custom-scheme fallback), builds the URI, subscribes to
   the wallet's topic on the relay (§16) when the pairing has one, and shows the QR / opens
   the deeplink.
2. Wallet reads the URI, establishes the session key (§18: use `sk` directly, or for the
   fallback an X25519 key agreement of `pk` and its own ephemeral private key, NaCl
   `crypto_box_beforenm`), and shows dApp metadata + approval.
3. On approval, the wallet publishes the ENCRYPTED `pha_connect` result (§5: wallet,
   capabilities, account, session) to its topic (§16). On the fallback path the wallet's
   ephemeral public key travels beside the result.
   - The result rides as the unsolicited
     `pha_sessionEstablished` event envelope (see §9.5). sym: an ordinary sealed relay
     payload (or the deeplink callback when the pairing has no relay). ecdh: one relay
     payload `{ "wpk": <wallet X25519 pub, base64url>, "nonce": ..., "ct": ... }` - the
     public key in the clear beside the first sealed frame; the dApp derives the key by the
     same key agreement and opens it. A receiver takes the first hop only and ignores a later
     `wpk`, so a forged re-key of a live channel is impossible.
4. dApp decrypts → session established. ALL later envelopes (any transport) use this session
   key with `secretbox` (§18).

A dApp waits for the session of a pairing with a timeout of its own: a wallet whose user
declines the pairing may send nothing.

A pairing URI for a topic on which the wallet holds a live pairing opens no second session,
for example when the user opens the same pairing link again. The wallet keeps that pairing,
its key and its session, and pushes the live session again as `pha_sessionEstablished`
(step 3), so a dApp that missed the first push gets it. For a custom-scheme (ecdh) pairing
that push is the key hop again, with the same `wpk`: a dApp that holds the key ignores it, and
one that missed the first hop derives the key from it. The wallet keeps its public key with
the pairing for this, never its private key (§18.3).

Crypto construction, MITM analysis, nonces, and replay handling are specified in §18.

## 16. Relay protocol

A dumb, E2E-blind pub/sub over WSS (§6.4).

Frames (JSON), each with an `op` field:

- client to relay: `{ op:"subscribe", topic }`, `{ op:"unsubscribe", topic }`,
  `{ op:"publish", topic, id?, payload }`;
- relay to client: `{ op:"deliver", topic, id?, payload }`, `{ op:"ack", topic, id? }`,
  `{ op:"error", code, message, id?, topic? }`.

`payload` is OPAQUE ciphertext (NaCl `secretbox`, §18) - the relay never decrypts. `id` is
chosen by the publisher; the relay echoes it in the `ack` and in the `deliver`. A topic and an
`id` are 1 to 128 printable ASCII characters without spaces, so that their echoes stay short.

A `payload` has one of three forms, and a receiver tells them apart by the JSON type and the
fields:

- a whole sealed frame: the frame text of §18.2 as a JSON string, for example
  `"{\"nonce\":\"…\",\"ct\":\"…\"}"`;
- one chunk of a larger frame: the object `{ msgId, seq, total, chunk }` (Chunking, below);
- the key hop of the custom-scheme pairing: the object `{ wpk, nonce, ct }` (§15 step 3).

A receiver drops a payload of any other form.

- **Routing**: by `topic`. A pairing uses two topics, one per direction: the dApp publishes
  to `<t>.dapp` and subscribes to `<t>.wallet`; the wallet publishes to `<t>.wallet` and
  subscribes to `<t>.dapp` (`t` is the pairing topic, §15). A side never subscribes to the
  topic it publishes to, so it never receives its own messages. The relay forwards a
  `publish` on a topic to every other subscriber of that topic as `deliver`.
- **Mailbox / TTL**: the relay HOLDS every message of a topic up to a TTL (default 300 s),
  delivered or not, and hands the held messages to each new subscription of the topic. So a
  deeplink-woken wallet fetches a just-published request, and a side whose connection died
  (a phone page in the background) gets what it missed when it subscribes again. A receiver
  drops a message it already handled: a wallet drops a request whose id it remembers
  (§18.2), and a dApp drops an answer whose id it handled. An event has no id; a repeated
  event carries the same state again. `ack` confirms that the relay accepted the frame. The
  mailbox of a topic holds the latest frames up to its depth (default 80), which is at least
  67 frames, one whole chunked message of the largest size (see Chunking). A frame published
  to a full mailbox pushes the oldest held frame out, without an error to either side.
- **Auth**: the topic is a bearer capability (knowing it = being in the session). Plus
  per-connection limits (below). No account/identity needed (E2E-blind).
- **Limits / abuse**: per-connection + per-IP rate limits (a connection may send 67 frames
  at once, one whole chunked message of the largest size); at most 8 topics per connection
  (a protocol limit; clients MUST keep their active subscriptions under it per §7);
  message-size cap = `frameCap` (1 MiB per frame) - larger messages are CHUNKED (below);
  idle-connection timeout; topic auto-expiry with the session; a bound on the bytes the
  relay holds for one client address and in total, past which it refuses a `publish` with
  an `error` frame and keeps the connection. The relay MAY close a connection that does
  not read what it is sent, its own `ack` and `error` frames to it included; the client
  reconnects, and the mailbox gives it what it missed.
- **`error` frames are NOT optional for clients.** `code` is a short reason such as
  `topic_limit`, `bad_topic`, `bad_frame`, `rate_limited`, `frame_too_large`, `hold_limit`
  (the bound for one client address) or `relay_full` (the bound in total); `id` is present
  when the error refers to one `publish` with a valid `id`, and `topic` is present when the
  error refuses one `subscribe` of a valid topic: it is the topic of that `subscribe`. A
  frame the relay cannot read, or a `publish` whose `id` breaks the rule above, gets
  `bad_frame` without `id`; a `subscribe`, an `unsubscribe` or a `publish` whose topic breaks
  it gets `bad_topic` without `topic`. `bad_frame`, `bad_topic`, `rate_limited`
  and `frame_too_large` close the connection; `topic_limit`, `hold_limit` and `relay_full`
  keep it. A `subscribe` may be refused (e.g. `topic_limit` at the max-topics cap). The
  relay replies with an `error` frame and the client MUST surface it - fail the affected
  session/operation - and NEVER silently ignore it. A wallet keeps several topics on one
  connection (§7), and the `topic` tells it which session the refusal ends. Silently
  dropping a failed `subscribe` makes the wallet believe it is listening while the relay
  never routes to it, so every request on that topic hangs (see the §7 lifecycle rules).
- **Chunking** (for a sealed frame whose text is longer than 900 000 characters, up to the
  32 MiB chain max-tx; a chunk with its `publish` then stays below `frameCap`): the sender
  cuts the sealed frame text into chunks of exactly 900 000 characters; the last chunk holds
  the rest. Each chunk travels in its own `publish` as `{ msgId, seq, total, chunk }`:
  `msgId` is the same random id for every chunk of the message, `seq` counts from 0 to
  `total - 1`, and `total` is the number of chunks. The receiver reassembles by `msgId` in
  `seq` order before decryption.
  - A sender publishes the next chunk only after the relay acknowledged the previous one,
    and sends again after a reconnect at the same pace, so one message never meets the
    per-connection rate limit.
  - A message has at most 67 chunks (60 300 000 characters of sealed frame). That carries
    a 32 MiB transaction: the transaction is base64 inside the envelope and the sealed
    envelope is base64 again, which gives about 59.7 million characters. A sender fails a
    larger message with `5001` before it sends anything; a receiver drops a message that
    announces more than 67 chunks.
  - The chunk size is fixed so that every receiver knows its limit and every frame splits
    the same way.
- The relay does NO chain logic.

## 17. Deeplinks & universal-link hosting

Paths under `https://link.phantasma.info/v5/` (and mirrored `phantasma://v5/…`):

- `/pair` - pairing (§15).
- `/req` - small same-device request: `#t=<topic>&f=<b64url(sealed frame)>`
  (sealed payload in the fragment, routed by the pairing topic; the session id is inside the
  envelope and the callback is the one fixed at pairing; size-gated per §6.3).
- `/wake` - foreground the wallet so it reconnects to the relay and reads its pairings'
  mailboxes; carries no payload.
- result return - the wallet opens the pairing callback (native: its own scheme/universal
  link; web: an https URL) with `#plv=5&t=<topic>&f=<b64url(sealed frame)>`.

Hosting - on a DEDICATED SUBDOMAIN `link.phantasma.info`, NOT the main website:

- Why a subdomain: universal links / App Links are per-host; a subdomain is its own host
  for verification, so it works identically to a root domain. This keeps the whole feature
  off the main phantasma.info site.
- The host `link.phantasma.info` serves over HTTPS the two `.well-known` files below, the
  static `/v5/*` fallback pages and the relay WSS endpoint.
- iOS: `https://link.phantasma.info/.well-known/apple-app-site-association` (JSON; lists the
  wallet app's `<TeamID>.<BundleID>` and the `/v5/*` paths). Served as `application/json`,
  no redirect, over HTTPS. App entitlement: `applinks:link.phantasma.info`.
- Android: `https://link.phantasma.info/.well-known/assetlinks.json` (the wallet app package
  name + signing-cert SHA-256 fingerprint, `delegate_permission/common.handle_all_urls`).
  Intent-filter host = `link.phantasma.info`.
- The web `/v5/*` pages double as the graceful fallback when the app is NOT installed
  (e.g. an "install the wallet" page) - a property custom schemes lack. A fallback page MAY
  offer to open the same link on the custom scheme, for a wallet that the system did not
  open, but never a link that carries `sk`, whatever its path: whatever app owns the scheme
  would get the session key (§15, §18.1).
- Custom scheme `phantasma://` is registered by each wallet as the fallback transport
  only; universal/app links are primary (domain-verified, anti-hijack).
- One device has one Link wallet. The universal links of `link.phantasma.info` and the
  `phantasma://` scheme open one app, and this version defines no way to route a link to one
  of several wallets on the same device.

## 18. Cryptographic construction

Primitive: NaCl **`secretbox` (XSalsa20-Poly1305)** for EVERY session message on deeplink
and relay, under one 32-byte session key. X25519 is used ONLY for the custom-scheme fallback's key
establishment. Everything is standard NaCl, so any NaCl implementation interoperates.

### 18.1 Session-key establishment (channel decides)

The rule is "no secret in a HIJACKABLE url". A symmetric key is the simplest STRONG design
where the delivery channel is itself safe; ECDH is the fallback for the one hijackable
channel:

- **Universal link / QR (PRIMARY):** the dApp generates `symKey` = 32 CSPRNG bytes; it
  rides in the universal-link fragment or the QR. MITM-proof because the relay never sees
  it AND the channel is not software-interceptable (universal link = domain-verified → only
  the app; QR = optical). A symmetric key is correct here precisely BECAUSE these channels
  are safe: it is simpler and strictly stronger than ECDH on these paths.
- **Custom scheme (FALLBACK, hijackable):** no `symKey` in the URL. X25519 ECDH instead -
  dApp ephemeral pub in the URL (public, useless to a squatter), wallet ephemeral pub
  returned over the relay, both derive the key by X25519 key agreement (NaCl
  `crypto_box_beforenm`).
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
- Frame: relay/deeplink carry `{ nonce:b64, ct:b64 }`. In a URL fragment the whole frame
  text is base64url-encoded once more (§6.3). Chunked messages (§16) are reassembled to the
  full frame BEFORE one `secretbox` open.
- Replay: the wallet handles each request `id` of a session once. It remembers the ids of
  a session for at least 10 minutes, and the id of a request whose transaction it signed
  without a prompt at least until that transaction expires (§9.8). The memory survives a
  restart of the wallet, because the relay hands the messages it holds to the first
  subscription after the restart (§16). A request with an `id` it remembers is dropped
  without an answer, because the first copy gets the answer. A frame that is replayed
  repeats its request `id`, so the same check stops it. This also makes a client's re-send
  after a reconnect (§16) safe. A wallet never forgets an id early because it holds many; a
  wallet that cannot keep more ids refuses new requests of the session with `-32603`
  instead.
- A `pha_connect` without a session belongs to no session yet. The wallet remembers its `id`
  for the same time with the channel it came on (§7): the pairing, the caller's origin, or
  the connection of a caller without an origin. It drops a copy while the prompt of
  the first one is open and after the answer.

### 18.3 Key hygiene

- The session key belongs to one pairing. A wallet keeps it for the life of the session in
  the platform's protected storage (a keychain, a keystore or encrypted storage), never in
  plain files or plain preferences. A dApp keeps it in the storage its platform offers. Both
  sides delete it when the session ends (disconnect, expiry, eviction, revoke), and a new
  pairing makes a new key.
- The X25519 private keys of the fallback pairing live only until the session key is derived.
  The wallet keeps its public key with the pairing, to push the session again (§15).
- They are NEVER the account signing key: Ed25519/ECDSA are used strictly for signing
  (txs, messages), never for the channel; the channel key is never used to sign.
- Channel crypto (this section) is independent of the on-chain signature crypto - the
  `signMessage` domain separation (§8) and tx signatures protect the on-chain layer; the
  channel protects the transport.

Summary: standard NaCl; MITM is closed on the primary paths and bounded (no key or fund
theft) on the fallback.
