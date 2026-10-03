---
status: accepted
date: 2026-10-06
decision-makers: Phantasma Link maintainers
consulted: wallet maintainers
informed: Phantasma SDK maintainers
---

# Write a decision record only for a decision with real alternatives

## Context and Problem Statement

Record 0000 chose MADR 4.0 for the reasons behind the specification. Its house rules asked for
a record for every change to a wire contract, a transport binding, a size rule, a security rule
or a naming rule, and a change without one was not merged.

Version 1.2 changed many such rules. Most changes corrected or completed the text: a field that
no section defined, a code that no rule said when to send, two sections that said different
things. A record for each of them would hold no real alternative and would hide the few
decisions that had one.

When is a decision record written?

## Decision Drivers

- The records that matter stay easy to find.
- A record must not cost more than the decision.
- Every change still says why it was made.

## Considered Options

- Keep the house rule of record 0000: a record for every change to a wire contract, a binding,
  a size rule, a security rule or a naming rule.
- A record only for a decision that had real alternatives; the changelog gives the reason of
  every other change.

## Decision Outcome

Chosen option: "A record only for a decision that had real alternatives", because only such a
decision is reopened by a later reader, and the changelog explains every other change in one
sentence.

House rules for this repository, in place of those of record 0000. The format stays MADR 4.0.

- Records live in `spec/decisions/`. The file name is `NNNN-short-title.md`, numbered
  from `0000` in the order the records are created.
- A record follows `adr-template.md` in this folder. Unused optional sections are removed.
- Status values: `proposed`, `accepted`, `rejected`, `deprecated`,
  `superseded by ADR-NNNN`. A record is never edited into a different decision. A new
  decision gets a new record, and the old one is marked superseded.
- Every record is written in plain language: short sentences, one thought per sentence,
  common words, exact names of fields and files.
- A record is written only for a decision that had real alternatives and that a later
  reader would otherwise reopen: a transport binding, the encryption scheme, a size budget,
  a naming scheme. A correction or a completion of the text needs no record. Its changelog
  entry gives the reason in one sentence.
- The specification text holds the contract. The record holds the reasons, the rejected
  options and how compliance is checked. The changelog entry names the record.

### Consequences

- Good, because a reader of this folder finds the decisions that had alternatives.
- Good, because the changelog still gives the reason of every change.
- Neutral, because few changes need a record. A change that turns out to be a real decision
  gets its record when that becomes clear.

### Confirmation

A change that makes a decision of the kind above is reviewed together with its record, and
its changelog entry links the record. Every other change is reviewed with its changelog
entry.

## More Information

This record supersedes record 0000, whose house rules it replaces.
