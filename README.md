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

Under gas model v2 there are two things to know, and `sendTransaction` handles both for you:

1. **Plan before you sign.** The chain bills every byte the transaction puts in the block and
   escrows every storage row it creates, so a message carries a gas offer and a storage ceiling that
   have to be set before signing - a message signed with a zero offer is never admitted.
2. **What the plan cannot know, it assumes expensive.** Some of the price depends on chain state the
   message does not carry: whether the recipient already holds the token, which mode a series mints
   in. Each is taken at the value that costs MORE, because unused gas is refunded while a short
   offer is rejected. `plan.exact` says whether any such assumption actually decided this number.

- `api.fees` is the fee planner of the chain the client talks to. It reads `getGasConfig` once,
  keeps it for a minute, and prices every message from the message itself: the signed size is
  computed without a key, and the storage rows, call result bytes and gas sites of each native
  operation are priced with the chain's own formula (`planFees`). `plan.kinds` says which operations
  were priced - a `Call_Multi` performs several, and each is priced and then summed, because the
  chain bills a batch as the sum of its calls with the envelope counted once. The one kind that is a
  budget rather than a formula is `NativeFeeKind.Script` - VM scripts and unmodelled calls, whose
  work depends on execution.
- `FeePlanOptions` is where you tighten point 2 by telling the planner a fact it would otherwise
  assume. Every field is optional and most callers pass none.
- `plan.exact` says whether the number is a prediction or a ceiling: `true` when nothing the plan had
  to assume could have changed it, `false` when an unstated fact decided part of the price or a part
  of the message had to be budgeted. Show `plan.exact ? amount : "up to " + amount`. It is answered
  by pricing the message a second time with every unstated fact at its cheaper reading, so it is
  about THIS message, not about which fields you filled in: a KCAL transfer is exact without stating
  anything, because the chain's own token rows are free and `recipientHoldsToken` cannot move its
  price. It promises nothing about facts you stated yourself - a wrong stated fact gives a wrong bill.

### Which fact each operation reads

Only the facts an operation reads can move its price, so this is the whole of what is worth stating.
Every default is the reading that costs MORE. One storage quantum is `dataEscrowPerRow` of escrow
plus 25 gas units of block data, both scaled by the chain's `feeMultiplier`; balance rows of the gas
and data tokens are free, so for those tokens `recipientHoldsToken` changes nothing.

| `NativeFeeKind`            | facts it reads                                                     | what the default assumes                                                                                          | what the default costs                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TransferFungible`         | `recipientHoldsToken`                                              | the recipient has no row for this token                                                                           | 1 quantum                                                                                                                                                                                                                                                                                                                                         |
| `TransferNonFungible`      | `recipientHoldsToken`                                              | the recipient has no row for this token                                                                           | 1 quantum                                                                                                                                                                                                                                                                                                                                         |
| `MintFungible`             | `recipientHoldsToken`, `supplyRowExists`, `bigFungible`            | no recipient row; the supply row was dropped and must be recreated; the resulting balance needs the widest answer | 1 quantum each, and 24 more result bytes (33 against 9)                                                                                                                                                                                                                                                                                           |
| `BurnFungible`             | `tokenBurnedBefore`, `supplyRowExists`, `bigFungible`              | the token's burnt counter does not exist yet; the supply row must be recreated; widest answer                     | 1 quantum each, and 24 more result bytes                                                                                                                                                                                                                                                                                                          |
| `MintNonFungible`          | `recipientHoldsToken`, `supplyRowExists`, `romHasMetaId`           | as above, plus: the ROM carries an `_i` id, which is indexed in one more row                                      | 1 quantum each, and 1 quantum per instance for the id                                                                                                                                                                                                                                                                                             |
| `MintPhantasmaNonFungible` | `recipientHoldsToken`, `supplyRowExists`, `duplicatedSeries`       | as above, plus: the series mints duplicates                                                                       | 1 quantum each, and one query fee per instance plus one per distinct series                                                                                                                                                                                                                                                                       |
| `BurnNonFungible`          | `tokenBurnedBefore`, `supplyRowExists`, **`infusions` (required)** | burnt counter does not exist; supply row must be recreated                                                        | 1 quantum each. `infusions` has no default at all - a burn returns whatever the NFT holds, there is no upper bound on that, so the plan demands the list and `api.fees` reads it from the chain. `romHasMetaId` is read here too but cannot move the bill: a burn deletes more rows than it creates, so its net storage growth is zero either way |
| `CreateToken`              | none                                                               | —                                                                                                                 | the price comes entirely from the message: the symbol length, the serialized `TokenInfo`, and which keys its metadata carries                                                                                                                                                                                                                     |
| `CreateTokenSeries`        | `seriesHasMetaId`                                                  | the series metadata carries an `_i` id                                                                            | 1 quantum                                                                                                                                                                                                                                                                                                                                         |
| `RegisterName`             | none                                                               | —                                                                                                                 | governance rows are free data; the price is the length-shifted policy fee and the envelope                                                                                                                                                                                                                                                        |
| `Script`                   | none                                                               | 5000 work units, 512 event bytes and 4 storage quanta, per unmodelled call                                        | a budget, never a prediction - `plan.exact` is `false` whenever one is present                                                                                                                                                                                                                                                                    |

- A message the caller has already planned (`maxGas > 0`) is sent as it is. Signing an unplanned
  message is refused, because a zero offer is never admitted.
- `sendTransaction` runs a pre-flight before signing a **token creation**. `Token.CreateToken` is
  charged its policy fee - the largest single price in the protocol, set by governance and readable
  from `getGasConfig` - **before** the contract checks whether the symbol is free, so sending one
  that is already taken costs that fee and gets nothing back. One lookup avoids it
  (`preflightTransaction`). Every other message goes straight through.
- The pre-flight never reads a verdict out of an error message. A symbol that resolves is `taken`;
  one that does not comes back as an ordinary RPC error, which a broken or proxied node produces
  just as readily, so the check asks a second question it knows the answer to - the gas token, by
  id, a lookup that does not touch symbols. If that answers, the node is answering and the symbol is
  `free`; if it does not, the verdict is `unknown` and nothing was established. `sendTransaction`
  refuses on `taken` and on `unknown`. A caller who would rather decide for itself - warn before
  spending the fee, retry against another node - calls `preflightTransaction`, reads the verdict and
  sends with `{ preflight: false }`.
- A burn returns whatever the NFT holds at its own address, and the chain charges for each
  returned asset: a transfer fee and an owner lookup per fungible token, an instance query, a
  transfer per instance and that lookup per NFT token, plus a balance row for a returned token the
  burner does not hold. That set is chain state with no costlier bound, so `planFees` demands
  `infusions` for a burn - an empty list says the NFT holds nothing - while `api.fees.plan`, and so
  `sendTransaction`, reads it from the chain (`api.infusedAssets`).
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
