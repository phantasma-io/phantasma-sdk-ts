---
status: accepted
date: 2026-09-30
decision-makers: Phantasma Link maintainers
consulted: wallet maintainers
informed: SDK maintainers
---

# Injected provider binding for browser-extension wallets

## Context and Problem Statement

Section 6.1 of the specification names the injected transport, the one a browser
extension provides to a web page. Until this decision the section had five lines. It did
not name the object on `window`, its methods, how a response is matched to its request,
how events reach the page, or how a dApp detects the wallet. Sections 6.2 to 6.4 define
their bindings down to paths, URL formats and relay frames. Section 6.1 did not.

No client had an injected transport either. So the first extension wallet on v5 defined
its own provider object in September 2026: `window.PhantasmaLinkV5` with a vendor flag
and `protocol: 5`, a method `request(frame)` that returns a promise of the response, and
`onEvent(handler)`. A dApp could not rely on it, because no other wallet would define the
same object.

What is the wire contract between a web page and a browser-extension wallet?

## Decision Drivers

- Durability. The contract must survive the next protocol generation and the next
  wallet. No vendor name and no generation number in a name that dApps hard-code.
- One envelope over every transport. A client moves opaque text frames over every
  transport, and the binding must fit that shape without a special case.
- Capability negotiation instead of a magic version (section 5). The generation is
  negotiated, not read from a name.
- The wallet identity comes from `pha_connect` (`wallet.name`, `wallet.version`). No
  second identity channel.
- Trusted local channel: plain text (section 8), origin known from the extension
  runtime, concurrent requests correlated by `id` (section 4), events over a persistent
  channel (section 9.5).
- Coexistence with the v1-v4 socket for wallets that also serve v1-v4 (section 12).
- Familiarity. Web developers know `window.ethereum` and `window.solana`: an object with
  a request method and an event subscription.
- A small change for the first extension wallet. It has not shipped, so a rename costs
  little now and a lot later.

## Considered Options

- A version-free provider `window.phantasmaLink` with `plvVersions`, `request` and
  `onEvent`.
- The provider as the first extension wallet shipped it: `window.PhantasmaLinkV5` with a
  vendor flag, `protocol`, `request` and `onEvent`.
- Reuse of the v1-v4 `window.PhantasmaLinkSocket` object, carrying v5 envelopes through
  it.
- Announce-and-discover events for several wallets at once, in the style of EIP-6963.
- A provider named after the chain, `window.phantasma`.

## Decision Outcome

Chosen option: "A version-free provider `window.phantasmaLink` with `plvVersions`,
`request` and `onEvent`", because it keeps the sound design of that first provider (one
object, one request per promise, text frames, plain text, events by subscription) and
removes the two parts that age: the generation in the name and the vendor flag. The generation is negotiated
through `plvVersions`, exactly as section 5 does for capabilities. The identity comes
from `pha_connect`.

The contract is written in section 6.1 of the specification. In short:

- `window.phantasmaLink` exists before any page script runs.
- `plvVersions` lists the generations the wallet speaks and contains `5`.
- `request(frame)` takes one request envelope as JSON text and resolves with its response
  envelope as JSON text. It rejects only when the bridge to the extension fails.
- `onEvent(handler)` delivers event envelopes as JSON text and returns the function that
  unsubscribes.
- The page origin comes from the extension runtime and is bound to the session.
- How the extension moves a frame between the page and its background process is the
  wallet's own business and not part of the contract.

### Consequences

- Good, because the name and the fields stay valid for a later generation. A wallet that
  speaks two generations lists both in `plvVersions` and keeps one object.
- Good, because a dApp never checks a vendor. Every wallet that follows section 6.1
  works with the same client code.
- Good, because a client transport is a few lines: it sends through `request` and receives
  the response and the events as text.
- Bad, because a page has one provider slot. Two installed wallet extensions overwrite
  each other. A discovery mechanism is a later additive capability.
- Bad, because the first extension wallet changes three things before its first release:
  the global name, the identity fields, and the events, which it passes to the page as
  objects.

### Confirmation

- Section 6.1 of the specification is the normative text of this decision.
- A client complies when it detects the provider by the rule of section 6.1 and talks to
  it only through `request` and `onEvent`.
- A wallet complies when a dApp can connect, sign a message and send a transaction
  through `window.phantasmaLink` alone.

## Pros and Cons of the Options

### A version-free provider `window.phantasmaLink`

- Good, because the name does not age. The generation is data, not a name.
- Good, because the object is minimal: two methods and one list.
- Good, because the wallet identity has one source, `pha_connect`.
- Neutral, because the check `plvVersions.includes(5)` replaces the check `protocol === 5`.
  Both are one line.
- Bad, because the first extension wallet renames its global before release.

### The provider as the first extension wallet shipped it

- Good, because it already exists and has tests.
- Good, because the request and event methods are the right shape.
- Bad, because `PhantasmaLinkV5` puts the generation in the name. The next generation
  needs a new global or keeps a wrong name.
- Bad, because the vendor flag names one wallet. Every other wallet would need its own flag,
  and every dApp would need to know every flag.
- Bad, because events reach the page as objects while every other frame of the protocol
  is text.

### Reuse of the v1-v4 `window.PhantasmaLinkSocket` object

- Good, because no new global is needed.
- Bad, because the socket has one `onmessage` handler and no promise per request. A
  client would have to correlate responses itself, on top of the session layer that already
  does it.
- Bad, because v1-v4 strings and v5 JSON would share one channel. The wallet would have
  to sniff the format of every message.
- Bad, because the v5 contract would inherit the shape of the protocol it replaces.

### Announce-and-discover events for several wallets

- Good, because several wallet extensions can coexist on one page.
- Bad, because it adds a handshake and a race at page load for a case that does not
  exist yet: the ecosystem has one extension wallet.
- Neutral, because it can be added later without breaking this decision. The provider
  object stays the default; discovery would only add a way to find other providers.

### A provider named after the chain, `window.phantasma`

- Good, because it follows `window.ethereum` and `window.solana` literally.
- Bad, because the object is the Link provider, not the chain. The name
  `phantasmaLink` says what the object does and stays distinct from the legacy
  `PhantasmaLinkSocket`.
- Bad, because `window.phantasma` is a name other page-level Phantasma tooling may want.

## More Information

Prior art: the first v5 extension wallet, September 2026, which shipped the first injected
provider and proved the shape (one object, `request` with a promise, `onEvent`,
plain text, page origin from the runtime, events scoped by session and origin). This
decision keeps that design and changes the names.

Conventions this decision follows: EIP-1193 for the shape of a page provider; section
9.1 of the specification for naming; text frames, as on every other transport.

Revisit when a second wallet extension appears in the ecosystem. Then the discovery
option becomes a real need.
