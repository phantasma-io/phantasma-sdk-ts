# Phantasma Link v5 protocol - changelog

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
