# Phantasma Link v5 protocol - changelog

## 1.2 - 2026-10-07

- Section 5: the `pha_connect` result keeps the capabilities in their own `capabilities`
  object, the object that section 9.5 returns from `pha_getWalletInfo`.
  `capabilities.features` is required and is `[]` in this version. `session.expiresAt` is
  required and is `null` when the lifetime has no fixed end. Sections 9.5 and 15 refer to
  that shape. Decision record `decisions/0002-connect-result-shape.md`.
- Section 12: a wallet may serve v1-v4 beside v5 and may stop serving v1-v4 at any time,
  so a dApp that has to work with every wallet uses v5. The status line and section 6.1
  no longer speak of a deprecation window.
- Section 13 states the conformance rule only. Sections 6.1, 8, 12 and 13 no longer name
  implementations, SDK packages or wallets.
- Section 14 no longer lists per-method and per-chain scoping, because no section says what
  a wallet does with a request outside the granted methods and chains. The granted `chains`
  and `methods` (section 5) tell a dApp what the wallet supports.
- Sections 1, 2, 3, 5, 6.2, 6.4, 7, 9.1, 9.3, 9.4, 9.5, 9.6, 9.7, 14, 15, 16, 17 and 18 no
  longer carry implementation details or the names of other protocols and products: the
  server library, the relay stack and its hosting, package, class and function names, wallet
  and product names. A primitive is named by its NaCl name.
- Sections 6.1, 7, 9.2, 9.5 and 9.7 no longer announce capabilities of later versions. The
  specification states the contract in force.
- Section 16: relay chunking carries the 32 MiB transaction. Chunks hold exactly 900 000
  characters, `seq` counts from 0, a message has at most 67 chunks, and the relay mailbox
  and the per-connection limit admit 67 frames. The size is fixed so that every receiver
  knows its limit. `ack` means that the relay accepted the frame; the `error` frame carries
  `code`, `message`, the publish `id`, and the `topic` of a refused `subscribe`, because a
  wallet keeps several topics on one connection and has to know which session the refusal
  ends; a connection holds at most 8 topics.
- Sections 8, 14, 16 and 18 describe the encryption of section 18: `secretbox` under the
  session key, the key itself in a universal link or a QR code, X25519 only on the custom
  scheme. Injected and loopback frames are plain, because both stay on the user's machine.
- Section 6.2 gives the loopback port 7090. Section 15 defines the pairing fields `cb` and
  `relay` (a `wss://` URL; without it the pairing has no relay). A wallet refuses a `ws://`
  relay and a `phantasma://` URI with `sk`, because another app can read that URI.
- Sections 7, 9.5, 10 and 18.3: the resume id travels in the envelope `session` field, as
  section 4 already said for every request. The lifetime `session` ends when the wallet
  locks. The session key stays in protected storage until the session ends, because a key
  kept in memory only would end every session at a restart. `pha_sessionExpired` with
  `5100` marks an expired session, `pha_sessionDeleted` with `5101` a revoked one.
- Sections 5, 9.2, 9.5 and 9.7: `pubkey` and `pow` are removed, because neither could ever
  take effect. The wallet signs the dApp's transaction unchanged. `pha_signMessage` is
  Ed25519 only, because no format exists for an ECDSA message signature: `"ECDSA"` gets
  `5003` there, and an unknown kind gets `-32602` as on every method. `pha_invokeScript`
  returns serialized VM objects in base64 and takes a chain name. `pha_getWalletInfo`
  returns the session's capabilities.
- Sections 8, 14 and 18.2: the wallet handles each request `id` of a session once, keeps the
  ids for at least 10 minutes and drops a duplicate without an answer, because an error
  answer to a re-sent copy could make the dApp lose the real answer. The ids survive a
  restart of the wallet, because the relay hands its held messages to the restarted wallet.
  The sequence number is gone; the envelope never had a field for it.
- Sections 5, 6.3 and 11: `maxPayloadBytes` counts the bytes of the largest payload of a
  request: the serialized transaction, the message to sign or the script, because that is
  the number a dApp can compare. The deeplink default becomes 3072, the size that fits the
  8192-character URL budget.
- Sections 9.4, 9.7 and 10: `-32602` for an unknown `signatureKind` and a missing `format`.
  A client reports an unreachable wallet or relay as `4900`. The new code `5005` means that
  no answer came in time, so a dApp can tell a user who has not decided from a lost
  connection.
- Sections 6.3 and 10: a pairing without a relay refuses a request above the deeplink budget
  with `5001`, because it has nothing to fall back to. `5001` carries `maxPayloadBytes` as a
  number, or `maxUrlChars` for a request above the URL budget, so a dApp learns which limit
  it hit. A client whose pairing ended with its session reports `4900`.
- Sections 6.4, 15 and 16: a pairing uses one relay topic per direction, `<t>.dapp` and
  `<t>.wallet`. A side never receives its own messages, so a page that subscribes again
  cannot take a waiting request away from the wallet. The relay holds every message for the
  TTL and hands it to each new subscription, because a page in the background loses a
  message delivered into its frozen connection. Receivers drop repeats. A wallet refuses a
  `t` that is not 32 bytes in base64url (43 characters), because `t` is the bearer
  capability of the pairing and the relay topics are built from it.
- Sections 7, 9.5 and 10: a session holds one account, and the wallet answers and signs for it
  with that account only. While the user has another account selected, a wallet either serves
  the session with its account and shows it in every prompt, or answers `5006` with the
  session's address and pushes `pha_accountsChanged` when the account is selected again. The
  session stays on both sides, so a phone dApp never has to pair again after an account
  switch. `4100` keeps one meaning, no valid session.
- Section 4: a method that the wallet does not implement gets `-32601` before any check of
  the session or of the lock, because the methods of a wallet depend on neither.
- Sections 3, 6, 6.1, 6.2, 6.3, 6.4, 11 and 16 state the rules for a client without naming
  an SDK. Section 6.3: a web page on the wallet's phone SHOULD send small requests over the
  relay and fall back to the deeplink when the relay cannot be reached. Section 6 gives the
  transport order of section 3 and that exception. Section 7: the pairing link carries its
  material in the fragment, as section 15 says.
- Sections 7, 9.5 and 18.3: a pairing ends with its session. Over deeplink and relay a request
  on an ended session gets no answer and the dApp sees `5005`; a dApp that resumed a session
  from an earlier page load SHOULD then offer to pair again. A wallet that finds the session
  ended while it still holds the pairing answers `5100`, the resume included, and never opens
  a second session on a pairing. A `pha_connect` without a session on a pairing whose session
  lives resumes that session, so a late copy of the first `pha_connect` changes nothing. A
  dApp ends its session on `5100`, `5101` and `4100` to a request made in it.
- Section 2 defines network and chain. Section 4: a receiver ignores fields it does not know.
  Section 10 says when a wallet answers `4902` and `5002`.
- Section 11: a wallet lists in `maxPayloadBytes` only the transports it serves.
- Section 15: a custom-scheme pairing carries `relay` and `meta`, because the wallet's key
  returns over the relay after the user saw the dApp. A pairing with neither `relay` nor `cb`
  is refused. `meta` is the base64url of the UTF-8 JSON of the dApp metadata. `sk` and `pk`
  are 32 bytes.
- Section 16: a payload is a sealed frame as a JSON string, a chunk object or the key hop
  object; a sealed frame is chunked when its text is longer than 900 000 characters. The
  relay echoes the publish `id` in `deliver` and MAY close the connection after an error.
  `frameCap` is fixed at 1 MiB. Sections 6.4 and 11 name the same threshold.
- Section 16: the relay bounds the bytes it holds for one client address and in total, and
  refuses a `publish` past the bound (`hold_limit`, `relay_full`), because every held
  message stays in its memory for the TTL. It MAY close a connection that does not read
  what it is sent.
- Sections 8 and 18.2: the check of a reused nonce is gone. A random 24-byte nonce does not
  repeat in practice, and a replayed frame repeats its request `id`, which the wallet checks.
  Section 18.3: the X25519 private keys of the fallback live only until the session key
  exists; the wallet keeps its public key with the pairing.
- Section 4: a request `id` is drawn at random and holds at most 128 characters, because the
  wallet keeps the ids it saw (section 18.2) and a page that reloads must not repeat them. A
  longer `id` gets `-32600`. A field of a request set to `null` counts as absent.
- Sections 6.1 and 18.2: over the injected binding a request whose `id` the wallet remembers
  gets `-32600`, because each call waits for its own answer. A `pha_connect` without a
  session is remembered with the channel it came on, and a copy of it is dropped also after
  the answer, so a relay replay never prompts again. A wallet that cannot keep more ids
  answers `-32603`.
- Sections 6.3, 9.5, 10 and 15: a pairing without `cb` gets every answer over the relay. A
  result whose URL would exceed the budget goes over the relay, or gets `5001` with
  `maxUrlChars` on a pairing without one; an event too large for the URL is not sent. The
  connect result and `pha_sessionEstablished` carry no NFT ids, so that they fit a URL.
- Section 7: over deeplink and relay the name, the url and the icon of a dApp are what it
  declared, and the wallet shows them as declared. A session is served, resumed and sent its
  events only on the channel it was made on: the origin over injected and loopback, the
  pairing over deeplink and relay; a request from elsewhere gets `4100`, `pha_disconnect`
  included, and a session made over a pairing is never served over injected or loopback. A
  session made by a caller without an origin is bound to no origin: any injected or loopback
  caller that names it is served, its resume is held to its dApp name, and its events go to
  the connections it was served on (section 6.1 for the extension). A locked wallet asks the
  user to unlock it or
  answers `4900` when a request needs a key or a prompt, and never opens a second session in
  place of a live one. The bound of relay sessions counts relay sessions only and ends an
  evicted session with `pha_sessionDeleted`, also for a wallet with one relay connection per
  pairing.
- Sections 5 and 10: a wallet serves the network it uses now, grants that network only, and
  answers `4902` when a `pha_connect` names other networks only.
- Section 9.5: `hash` is the hex text that the chain's RPC uses.
- Section 15: `v` is the text `5`; a pairing carries exactly one of `sk` and `pk`; a `relay`
  or `cb` that is present is not empty. A pairing URI for a topic with a live pairing opens no
  second session, and the wallet pushes the live session again, so opening a pairing link
  twice is harmless; for a custom-scheme pairing the push is the key hop again, with the same
  `wpk`, and a receiver takes the first hop only. A dApp waits for a pairing with a timeout of
  its own, because a declined
  pairing may get no answer.
- Section 16: the mailbox depth (default 80) and the push-out of the oldest frame are stated.
  A sender publishes a chunk only after the previous one was acknowledged, also after a
  reconnect, so that one message never meets the rate limit. A topic and a publish `id` are 1
  to 128 printable ASCII characters without spaces, and an error does not echo a topic that
  breaks the rule, also on an `unsubscribe`; which error codes close the connection is
  stated, and a connection that does not read the relay's own `ack` and `error` frames may be
  closed.
- Section 17: a fallback page never opens a link that carries `sk` on the custom scheme,
  whatever its path, because whatever app owns the scheme would get the key. One device has one Link
  wallet.
- Decision record 0001 no longer names wallets or the code of an SDK. Its decision is
  unchanged.

## 1.1 - 2026-09-30

- Section 6.1 defines the injected binding for browser-extension wallets to the wire:
  the page provider `window.phantasmaLink`, its fields and methods, text frames, the
  detection rule, the origin rule, events, sizes, and coexistence with the v1-v4
  socket. Decision record `decisions/0001-injected-provider-binding.md`.
- Decision records are introduced under `spec/decisions/`: record 0000 (the format and
  the house rules) and `adr-template.md`.
- Section 5: the capabilities example advertises `maxPayloadBytes.injected`. Section
  11: the injected default is the chain maximum.
- Sections 2 and 13 name the current wallets (Aura, PoltergeistLite). Section 12: a
  wallet consumes the published SDK.
- Section 14: the injected origin comes from the extension runtime.

## 1.0 - 2026-06-15

Initial stable release of the Phantasma Link v5 protocol specification: message envelope
(JSON-RPC 2.0 profile), capability handshake, transports (injected, loopback, deeplink,
relay), pairing & sessions, encryption (NaCl), method catalog, error codes, sizes &
budget, backward compatibility, pairing URI, relay protocol, deeplink &
universal-link hosting, and the cryptographic construction.
