---
status: accepted
date: 2026-10-07
decision-makers: Phantasma Link maintainers
informed: wallet and SDK maintainers
---

# A signing permission is enforced by the wallet over scripts in the standard call form

## Context and Problem Statement

Before version 1.2, every signature needed the user's approval. A dApp that sends many small
transactions, a browser game for example, makes the user confirm each move. Developers asked
for a limited approval: this site may call these methods of this contract for the next hour,
and nothing else.

Other ecosystems enforce such limits on the chain: a key restricted to some methods of one
contract, an account contract that checks a delegation, an authorization module. The
Phantasma chain has none of these. An address is one Ed25519 key, and a signature in a
transaction makes the signer a witness of the whole script, including every contract that the
script calls.

How can the protocol offer a limited approval that the user can trust, when only the wallet
can enforce it?

## Decision Drivers

- The limit must hold against a hostile or hijacked site that sends any request it likes.
- The wallet must never sign a transaction whose effect it reads differently from the chain.
- The user's assets are at stake: the rules must keep everything closed that the wallet can
  close, and the spec must state plainly what the wallet cannot see.
- No change to the chain, the validator or the RPC (section 1, non-goals).
- One rule for every wallet, so a dApp behaves the same everywhere.

## Considered Options

- A session key on the chain: the dApp holds a key that the chain lets call only some methods.
- A wallet rule over the script: the wallet signs without a prompt only a script in the
  standard call form, with permitted calls between the gas calls, and a gas budget.
- The same rule plus a simulation that refuses a transaction that would move the user's assets.
- An approval per site without a call list: the wallet signs every request of the site for a
  while.

## Decision Outcome

Chosen option: "A wallet rule over the script", because it is the only option that the chain
supports today and that keeps every part closed that the wallet can see.

### Consequences

- Good, because a script that calls an interop, a built-in contract or a method outside the
  permission never passes, and the reader accepts only the byte forms that ScriptBuilder writes,
  each with one reading, so it cannot read a script differently from the VM.
- Good, because the gas the account can lose is bounded by the budget the user approved, and
  a signed transaction never outlives the permission.
- Good, because a transaction signed without a prompt expires at most 5 minutes after its
  request was sent, and the wallet keeps the request id until then. A copy of the request,
  from a relay or from an app that caught a deeplink, is never signed again without a prompt.
- Bad, because the wallet cannot see what a permitted method does. A contract written to move
  the account's assets can do so inside the permission, its owner can change its code while the
  permission lasts, and the contracts it calls can change too. A phishing site can ask for a
  permission on such a contract. The permission trusts the site and its contracts; the prompt
  has to say so, and a wallet may limit permissions to contracts it trusts.
- Bad, because a phone wallet still comes to the front for each request; only the confirm
  button goes away.
- Neutral, because only script transactions qualify. Carbon transactions and messages always
  get the prompt.

### Confirmation

Tests run the rules against scripts built in the standard call form and against every
rejected form: another opcode, register or length form, an interop, another contract or
method, a `SpendGas` for another address than the `AllowGas` payer, a spent budget, another
chain, a late expiry, a missing `sentAt`, and a transaction that expires more than 5 minutes
after `sentAt`. Each rule is checked by a change of the code that the tests must catch.

## Pros and Cons of the Options

### A session key on the chain

The pattern of NEAR function-call keys, ERC-7710 delegations, Cosmos authz and Starknet
session keys.

- Good, because the chain enforces the limit, whatever the wallet does.
- Bad, because the Phantasma chain has no key delegation; adding it is a consensus change and
  out of the scope of this protocol.
- Neutral, because a contract can already accept a key of its own for its methods; that needs
  no protocol at all.

### A wallet rule over the script

The pattern of the wallet-enforced approvals that sign with the user's own key.

- Good, because it needs no change outside the wallet and the SDK.
- Good, because the dApp never holds a key, so no key can leak from a site.
- Bad, because it trusts the named contracts.

### The rule plus a simulation

- Good, because a simulation could catch a transfer out of the account before the signature.
- Bad, because no RPC method runs a signed transaction and returns its asset moves: the script
  invoke runs without the user's signature, and the estimate returns fees only.
- Neutral, because a wallet may add such a check later, as long as it only sends more requests
  to the prompt.

### An approval per site without a call list

- Good, because it is simple.
- Bad, because a hijacked or hostile site could make the wallet sign anything, transfers
  included. Wallets that offered it withdrew it after phishing campaigns.

## More Information

Section 9.8 holds the rules.
