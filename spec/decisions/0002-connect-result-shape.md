---
status: accepted
date: 2026-10-06
decision-makers: Phantasma Link maintainers
informed: wallet and SDK maintainers
---

# The `pha_connect` result keeps its capabilities in their own object, with `features` and `expiresAt` always present

## Context and Problem Statement

Section 5 showed the capability fields at the top level of the `pha_connect` result, next
to `wallet` and `account`. Section 9.5 returns the capabilities from `pha_getWalletInfo` as
one object: `{ name, version, capabilities, rpc }`. The protocol described the same data in
two shapes.

Two fields were not defined either. The example listed `features: ["batch","events"]`, and no
section defines either value. Section 9.5 gave the session as `session{ id, expiresAt }`, and
section 7 offers the `always` lifetime, which has no end date. The specification did not say
what `expiresAt` holds for such a session.

Which shape does the `pha_connect` result have, and what do `features` and `expiresAt` hold?

## Decision Drivers

- One object describes the capabilities wherever the protocol returns them.
- A field whose absence would have two meanings is always present: `features` and
  `expiresAt`. A dApp can then tell an empty value from a missing one, and a wallet that leaves
  one of them out does not comply.
- A field states only what the protocol defines. A session without a fixed end has no date.
- Additive evolution (section 4): a receiver ignores a value it does not know.

## Considered Options

- The capabilities in their own `capabilities` object, with `features` and `expiresAt` always
  present.
- The same object, with `features` and `expiresAt` optional.
- The capabilities at the top level, as the old example showed.

## Decision Outcome

Chosen option: "The capabilities in their own `capabilities` object, with `features` and
`expiresAt` always present", because it gives the capabilities one shape across the protocol
and leaves no field whose absence has two meanings.

- `features` lists the granted additive features. This version defines none, so a wallet sends
  `[]`.
- `expiresAt` is the end of the lifetime the user picked, in Unix milliseconds, or `null` when
  the lifetime has no fixed end.

### Consequences

- Good, because `pha_connect` and `pha_getWalletInfo` share one `capabilities` object.
- Good, because a dApp reads the end of the session without guessing why a field is absent.
- Neutral, because `features` stays empty until a later version defines a feature.
- Bad, because a wallet built from the old example has to move its fields and send both
  fields.

### Confirmation

A wallet complies when its `pha_connect` result and its `pha_getWalletInfo` result carry
this shape. A change of the shape needs a new record.

## Pros and Cons of the Options

### The capabilities in their own object, `features` and `expiresAt` always present

- Good, because the capability names cannot collide with the identity, account and session
  fields.
- Good, because an absent `features` or `expiresAt` is always a defect of the sender.
- Neutral, because a dApp reads one more level of nesting.

### The same object, with `features` and `expiresAt` optional

- Good, because a wallet without lifetimes or features has nothing to send.
- Bad, because an absent `expiresAt` then means either "no fixed end" or "the wallet does not
  report it".

### The capabilities at the top level

- Good, because the old example showed it.
- Bad, because section 9.5 already returns the capabilities as one object, so the protocol
  would keep two shapes for the same data.
- Bad, because the capability names and the other fields would share one namespace.

## More Information

The inactivity expiry of section 7 applies in addition to `expiresAt`. It moves with every
request, so a single date cannot describe it, and the result does not report it.
