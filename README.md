# Phantasma TypeScript SDK

TypeScript SDK for Phantasma RPC access, transaction construction, VM script helpers, wallet/link integration, and Carbon binary types.

## Install

```bash
npm install phantasma-sdk-ts
```

The package ships CommonJS, ESM, and type declarations.

## Entry Points

Use the curated public entrypoint for new code:

```ts
import {
  Address,
  PhantasmaAPI,
  PhantasmaKeys,
  ScriptBuilder,
  Transaction,
} from 'phantasma-sdk-ts/public';
```

Deep imports are available for stable source areas:

```ts
import { Transaction } from 'phantasma-sdk-ts/tx/transaction';
import { ScriptBuilder } from 'phantasma-sdk-ts/vm';
import { Bytes32 } from 'phantasma-sdk-ts/types/carbon/bytes32';
```

The root export and `core/**` deep imports remain for existing consumers that still depend on the old SDK layout:

```ts
import { PhantasmaTS } from 'phantasma-sdk-ts';
import { Transaction } from 'phantasma-sdk-ts/core/tx/Transaction';
```

Those compatibility paths are deprecated. New code should use `/public` or the lowercase module paths shown above.

## Phantasma Link v5 protocol

The dApp↔wallet connection protocol (envelope, transports, pairing, sessions, encryption)
is specified in [`spec/phantasma-link-v5.md`](spec/phantasma-link-v5.md). This package is
its reference implementation, exposed under the `phantasma-sdk-ts/link/v5` entry point.

## RPC Example

```ts
import { PhantasmaAPI } from 'phantasma-sdk-ts/public';

const api = new PhantasmaAPI('http://localhost:5172/rpc', null, 'localnet');
const height = await api.getBlockHeight('main');
const latestBlock = await api.getLatestBlock('main');

console.log({ height, latestBlockHash: latestBlock.hash });
```

High-level RPC methods keep the historical `Promise<T>` shape for existing consumers. New code that wants explicit result-style handling can call `JSONRPCResult<T>()` and check `isRpcErrorResult(result)` or use `unwrapRpcResult(result)`.

## Transaction Example

This builds and signs a local transaction object. It does not broadcast anything.

```ts
import { PhantasmaKeys, ScriptBuilder, Transaction } from 'phantasma-sdk-ts/public';

const keys = PhantasmaKeys.generate();
const script = new ScriptBuilder().beginScript().emitVarString('example').endScript();
const tx = new Transaction('localnet', 'main', script, new Date(Date.now() + 5 * 60 * 1000), '');

tx.signWithKeys(keys);

console.log(tx.toStringEncoded(true));
```

## Carbon Transactions and Fees

Carbon transactions are built, planned, signed and sent as four separate steps, so that the same
message works whether the key is in memory, in a hardware wallet, or in a wallet reached over
Phantasma Link.

```ts
import {
  Bytes32,
  NativeTxHelper,
  PhantasmaAPI,
  PhantasmaKeys,
  parseUnits,
  summarizeFeePlan,
} from 'phantasma-sdk-ts/public';

const api = new PhantasmaAPI('http://localhost:5172/rpc', null, 'localnet');
const keys = PhantasmaKeys.fromWIF(process.env.WIF!);
const receiverPublicKey = new Uint8Array(32); // the recipient's 32-byte public key

// 1. Build: the message only. Builders carry no prices; `maxGas` stays 0 until the fee is planned.
const transfer = NativeTxHelper.transferFungible({
  from: new Bytes32(keys.publicKey),
  to: new Bytes32(receiverPublicKey),
  tokenId: 1n, // KCAL
  amount: parseUnits('10', 10), // 10 KCAL in atoms
});

// 2. Plan: the gas bill and storage deposit for this message, from the chain's own prices.
const plan = await api.fees.plan(transfer);
console.log(summarizeFeePlan(plan)); // { gasBill: '0.00426', gasOffer: '0.00426', storageCeiling: '0' }

// 3-4. Sign and send - or let sendTransaction do 2-4 in one call.
const hash = await api.sendTransaction(transfer, keys);
```

- `api.fees` is the fee planner of the chain the client talks to. It reads `getGasConfig` once,
  keeps it for a minute, and prices every message from the message itself: the signed size is
  computed without a key, and the storage rows, call result bytes and gas sites of each native
  operation are priced with the chain's own formula (`planFees`, `estimateNativeFee`). `plan.kind`
  says which operation was priced; the one kind that is a budget rather than a formula is
  `NativeFeeKind.Script` - VM scripts and unmodelled calls, whose work depends on execution.
- A fact the message does not carry - whether the recipient already holds the token, which mode a
  series mints in - is assumed in the direction that costs MORE, because unused gas is refunded
  while a short offer is rejected. Pass what you know (`FeePlanOptions`) and the plan tightens.
- A message the caller has already planned (`maxGas > 0`) is sent as it is. Signing an unplanned
  message is refused, because a zero offer is never admitted.
- `sendTransaction` runs a pre-flight first. Creating a token and registering a name are charged
  their policy fee - the largest single price in the protocol, set by governance and readable from
  `getGasConfig` - **before** the contract checks whether the symbol or the name is free, so sending
  one that is already taken costs that fee and gets nothing back. The pre-flight asks the chain
  first, so the transaction is never signed (`preflightTransaction`). It fails closed: if the lookup
  itself fails, the transaction is refused rather than signed on an unknown chain state.
  `{ preflight: false }` skips the check, at the cost of the fee if the guess is wrong.
- Any witness that implements `TxSigner` (`publicKey` + `sign(bytes)`) can sign, and
  `TxMsgSigner.signWith` accepts several - the gas-payer transaction types take two. A wallet
  that signs elsewhere plans with `api.fees.plan` and hands `plan.apply(msg)` over.
- A contract call (`Call`, `Call_Multi`, `Trade`, `Phantasma`) chooses its own witnesses, and each
  one is 96 bytes the chain bills, so `planFees` asks for `witnessCount` instead of assuming one
  and under-offering every multi-party transaction. `sendTransaction` fills it in from the signers
  it was given. The gas payer must be one of them - the chain rejects a transaction its payer did
  not sign.
- A message expires. Builders stamp `DEFAULT_TX_EXPIRY_MS` from now, which is sized for a
  transaction signed on the spot; when a person has to approve it first, take the chain's whole
  window instead: `expiryWithin((await api.fees.chainParams()).expiryWindow)`.
- `parseUnits` / `formatUnits` convert between decimal amounts and atoms (KCAL has 10 decimals,
  SOUL 8); `summarizeFeePlan` renders a plan in KCAL and SOUL for display.

## Examples

The `examples/` folder contains TypeScript examples that are compiled by `npm run test:package-exports`.

- `examples/read-only-rpc.ts` reads block height and latest block data from an RPC endpoint.
- `examples/build-transaction.ts` builds and signs a local transaction object without broadcasting.
- `examples/logging.ts` enables and disables SDK logging.
- `examples/invoke-raw-script.ts` invokes `Runtime.GetTokenDecimals("SOUL")` through RPC and decodes the VM result.
- `examples/scan-token-events.ts` reads one block and decodes token send/receive event data.
- `examples/wallet-link.ts` shows the Phantasma Link and EasyConnect wallet connection shape.
- `examples/carbon-link-signing.ts` builds a Carbon transfer message, plans its fee without a key, and forwards it to a Link v4 wallet for signing.

## Compatibility Aliases

The SDK keeps legacy PascalCase methods and typoed aliases where existing consumers may still import them, for example `Transaction.FromBytes`, `ScriptBuilder.BeginScript`, `GetAddressFromLedeger`, `CarbonBlob.Serialize`, and `Serialization.Unserialize`.

For new code, prefer the canonical camelCase APIs:

```ts
Transaction.fromBytes(bytes);
new ScriptBuilder().beginScript().endScript();
CarbonBlob.serialize(value);
Serialization.deserialize(bytes, SomeType);
```

Deprecated aliases are intentionally covered by compatibility tests and deprecated-usage checks so new SDK code does not keep spreading them internally.

For consumer projects that want CI-visible diagnostics for legacy SDK calls,
enable the type-aware ESLint rule `@typescript-eslint/no-deprecated`. TypeScript
and editors read the SDK's `@deprecated` declarations, but `tsc` does not fail
builds on deprecated API use by itself.

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run test:package-exports
```

Examples under `examples/` are type-checked by `npm run test:package-exports`.
