---
status: accepted
date: 2026-09-30
decision-makers: Phantasma Link maintainers
consulted: wallet maintainers
informed: Phantasma SDK maintainers
---

# Use Markdown Any Decision Records for the Phantasma Link specification

## Context and Problem Statement

The specification `spec/phantasma-link-v5.md` holds the contract. It does not hold the
reasons behind the contract. Until now those reasons lived in chat and in private notes.
A wallet team that implements the protocol cannot read them there. When a section is
short or unclear, the team fills the gap on its own, and the implementations drift.

Where do we write down why a decision was made, in a form that people and coding agents
can read next to the specification?

## Decision Drivers

- One place for the reasons, next to the contract they explain.
- A format that is already known, so nobody has to learn ours.
- Records that a developer or a coding agent can read in a few minutes.
- Cheap to write. A record must not cost more than the decision.
- Plain language. The simpler the record, the better people work from it.

## Considered Options

- MADR 4.0, the Markdown Any Decision Records format.
- Michael Nygard's template (context, decision, status, consequences).
- Y-statements (one sentence per decision).
- Free-form notes without a fixed structure.

## Decision Outcome

Chosen option: "MADR 4.0", because it separates the problem, the options and the outcome,
it lists the pros and cons of every option, and it is the format with the widest tooling
and the most readers.

House rules for this repository:

- Records live in `spec/decisions/`. The file name is `NNNN-short-title.md`, numbered
  from `0000` in the order the records are created.
- A record follows `adr-template.md` in this folder. Unused optional sections are removed.
- Status values: `proposed`, `accepted`, `rejected`, `deprecated`, `superseded by
ADR-NNNN`. A record is never edited into a different decision. A new decision gets a
  new record, and the old one is marked superseded.
- Every record is written in plain language: short sentences, one thought per sentence,
  common words, exact names of fields and files.
- A record is required for a change to a wire contract, a transport binding, a size rule,
  a security rule or a naming rule. Editorial changes to the specification need no record.
- The specification text holds the contract. The record holds the reasons, the rejected
  options and how compliance is checked. The changelog entry names the record.

### Consequences

- Good, because a reader of any section can find out why it is written that way.
- Good, because a rejected option stays rejected with its reason, instead of coming back
  in every review.
- Bad, because a contract change now takes one more file. This is the intended cost.

### Confirmation

A change to the specification that touches a wire contract, a transport binding, a size
rule, a security rule or a naming rule is reviewed together with its record. The
changelog entry of the change links the record. A change without a record is not merged.

## Pros and Cons of the Options

### MADR 4.0

- Good, because the structure forces the options and their trade-offs into the open.
- Good, because the format is widely used, documented and stable.
- Good, because the front matter (status, date, who decided) is machine-readable.
- Neutral, because the full template is long; unused sections are removed.

### Michael Nygard's template

- Good, because it is short.
- Bad, because it has no place for the rejected options and their reasons.

### Y-statements

- Good, because a decision fits in one sentence.
- Bad, because one sentence cannot carry a wire contract, its options and its checks.

### Free-form notes

- Good, because there is nothing to learn.
- Bad, because every author invents a structure, and readers cannot compare records.

## More Information

MADR: <https://adr.github.io/madr/>. The template in this folder is the MADR 4.0
template with the placeholders of the original.
