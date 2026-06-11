export * from './interfaces/index.js';

// Phantasma Link v5 (new generation; parallel to the legacy v1–v4 `PhantasmaLink`).
// NOT re-exported flatly here: v5 defines its own `SignatureKind` (string union) that
// would clash with the contract `SignatureKind` enum aggregated by `src/core/index.ts`.
// Import v5 via the `phantasma-sdk-ts/link/v5` subpath or the `PhantasmaLinkV5` namespace
// (exported from the package root and `phantasma-sdk-ts/public`).
