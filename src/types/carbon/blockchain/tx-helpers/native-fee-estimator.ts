import { GasConfig } from '../gas-config.js';

/** Native operations the Tier-1 fee calculator models exactly. */
export enum NativeFeeKind {
  /** Fungible token transfer (TxTypes.TransferFungible and its _GasPayer variant). */
  TransferFungible = 'TransferFungible',
  /** NFT transfer of `count` instances (TxTypes.TransferNonFungible_* and _GasPayer variants). */
  TransferNonFungible = 'TransferNonFungible',
  /** Fungible mint (TxTypes.MintFungible). */
  MintFungible = 'MintFungible',
  /**
   * NFT mint of `count` instances with caller-supplied ROM (TxTypes.MintNonFungible). The ROM is
   * stored exactly as submitted. A deterministic Phantasma mint stores a canonical ROM.
   *
   * The chain refuses this operation where governance has not allowed caller-supplied ROM ids, and
   * that is the state of the public chains today. The SDK carries no builder for it. The model is
   * kept because the calculator prices the operation correctly wherever it is allowed.
   */
  MintNonFungible = 'MintNonFungible',
  /**
   * Deterministic Phantasma NFT mint of `count` instances (TokenContract.MintPhantasmaNonFungible).
   * The chain stores a canonical ROM. It holds the public ROM, the derived Phantasma NFT id and a
   * second copy of the public ROM, so storage grows at twice the ROM size.
   */
  MintPhantasmaNonFungible = 'MintPhantasmaNonFungible',
  /** Fungible burn (TxTypes.BurnFungible and its _GasPayer variant). */
  BurnFungible = 'BurnFungible',
  /** NFT burn of `count` instances (TxTypes.BurnNonFungible and its _GasPayer variant). */
  BurnNonFungible = 'BurnNonFungible',
  /** TokenContract.CreateToken call. Requires `symbolLength` when a symbol is set. */
  CreateToken = 'CreateToken',
  /** TokenContract.CreateTokenSeries call. */
  CreateTokenSeries = 'CreateTokenSeries',
  /** GovernanceContract.RegisterName call. Requires `nameLength`. */
  RegisterName = 'RegisterName',
  /**
   * Generic Phantasma VM script transaction (AllowGas/SpendGas pattern: stake, marketplace, custom
   * contract calls). Script opcode costs depend on chain state, and no formula gives them. The
   * estimate budgets `scriptUnitsAllowance` VM work units and `scriptEventBytes` of events on top
   * of the byte fee. For an exact script bill use the node-side estimator (`estimateTransaction`).
   */
  Script = 'Script',
}

/**
 * Inputs of {@link estimateNativeFee}. Under gas model v2 the chain bills every byte the transaction
 * puts in the block and escrows every new storage row. The inputs are therefore the sizes the chain
 * will see: the signed envelope, the serialized structures the operation stores, and the facts about
 * existing state that decide whether a row is new.
 *
 * The inputs are of two kinds, and they are defaulted differently.
 *
 * - Facts the CALLER CANNOT KNOW without reading chain state. Examples: whether the recipient
 *   already holds the token, whether a ROM carries an `_i` id, which mode a series mints in. Each
 *   defaults to the case that costs MORE. An estimate built from defaults is then an upper bound,
 *   and the settlement can only come out below it.
 * - Facts carried by the MESSAGE ITSELF. Examples: the instance count, the serialized sizes, whether
 *   the token being created is non-fungible or carries `pre_burn`. These are not guesses, so they
 *   have no safe default. Pass them. `planFees` reads every one of them out of the message.
 */
export interface NativeFeeParams {
  /**
   * Full signed transaction size in bytes. This is the envelope the block carries. Required under
   * gas model v2 (see {@link envelopeBytesFor} and `SignedTxMsg`). Ignored under v1, which billed
   * the payload note alone.
   */
  envelopeBytes?: number;
  /** Instance count for NFT kinds (transferred / minted / burned instances). Default 1. */
  count?: number;
  /**
   * Token moved by a transfer / mint / burn. Balance rows of the chain's gas and data tokens are
   * free, so with the token id known the estimate escrows nothing for them.
   */
  tokenId?: bigint;
  /** The recipient already holds this token, so its balance row exists and costs nothing. Default false. */
  recipientHoldsToken?: boolean;
  /**
   * The recipient is an NFT-derived address, which means an infusion. The chain reads that NFT's
   * owner, and that costs one extra query fee. Transfers and every mint kind pay it. A burn has no
   * recipient.
   *
   * This is a fact of the recipient's address form. It says nothing about chain state. `planFees`
   * derives it from the message's own recipient with `TokenHelper.isNftAddress`, so only direct
   * callers of this calculator pass it.
   */
  toIsNftAddress?: boolean;
  /**
   * The token's balances can exceed int64. Such a token is called big-fungible.
   *
   * A fungible mint or burn answers with the RESULTING balance as a variable-length integer. That is
   * 9 bytes while the balance fits int64, and up to 33 bytes for an int256 balance. The resulting
   * balance is chain state, so the default prices the 33-byte maximum. The offer then covers the
   * bill and the difference is refunded. Pass `false` for an ordinary int64 token and the estimate
   * is exact.
   */
  bigFungible?: boolean;
  /** The token has been burned before, so its burnt counter row exists. Default false (first burn creates it). */
  tokenBurnedBefore?: boolean;
  /**
   * The token's supply-tracking row exists. The chain drops that row when its balance reaches
   * exactly zero, so the row can be absent in two cases. A limited-supply token has its entire
   * supply in circulation, and the next burn recreates the row. An unlimited token has nothing
   * outstanding, and the next mint recreates it.
   *
   * When this fact is unstated, every mint and burn prices the recreation. That is one more storage
   * quantum in the bill and in the escrow ceiling, and it covers both cases. Pass `true` for the
   * exact quote whenever the token is in neither of them. Rows of the chain's gas and data tokens
   * are free either way.
   */
  supplyRowExists?: boolean;
  /**
   * What the burned NFTs hold at their own addresses (BurnNonFungible). There is one entry per
   * asset per burned instance.
   *
   * The burn returns every one of them to the burner, and the chain charges for each. A fungible
   * token costs a transfer fee plus the owner-lookup query of the NFT-address source. An NFT token
   * costs an instance query, a transfer per instance, and that same lookup. A returned token the
   * burner does not hold also costs the burner's new balance row.
   *
   * This is chain state that the message does not carry, and an NFT can hold any number of assets,
   * so there is no costlier bound to assume. Undefined prices an empty address, because a direct
   * caller of this calculator states what it knows. `planFees` demands the list, and `api.fees`
   * reads it from the chain.
   */
  infusions?: readonly InfusedAsset[];
  /** Token symbol length in characters (CreateToken). 0 = no symbol. */
  symbolLength?: number;
  /** Serialized `TokenInfo` length (CreateToken). These are the Call arguments, and they become the
   * token-info row. */
  tokenInfoBytes?: number;
  /** The token being created is non-fungible (CreateToken). It costs one more row, the series
   * counter. */
  nonFungible?: boolean;
  /** The token metadata carries `pre_burn` (CreateToken). The burnt counter row is then created at
   * once. */
  hasPreBurn?: boolean;
  /** The token metadata carries an inflation schedule (CreateToken). The next-inflation row is then
   * created. */
  hasInflationSchedule?: boolean;
  /** The token metadata names a staking organisation (CreateToken). The creation looks that
   * organisation up, which costs one query fee. */
  hasStakingOrganisation?: boolean;
  /** The token metadata names a staking reward token (CreateToken). The creation reads that token's
   * info, which costs one query fee. */
  hasStakingRewardToken?: boolean;
  /** Serialized `SeriesInfo` length (CreateTokenSeries). These are the Call arguments after the
   * token id. */
  seriesInfoBytes?: number;
  /**
   * The series metadata carries a `_i` id (CreateTokenSeries). The meta-id lookup row is then
   * created. The metadata is schema-encoded like the ROM, so a caller holding only the bytes cannot
   * tell. The default is true, which is the reading that pays for the row.
   */
  seriesHasMetaId?: boolean;
  /** Registered name length in characters (RegisterName). Required for that kind. */
  nameLength?: number;
  /** ROM bytes per minted or burned instance (MintNonFungible / BurnNonFungible: as stored; MintPhantasmaNonFungible: the public ROM). */
  romBytes?: number | readonly number[];
  /** RAM bytes per instance. Default 0 (no RAM row). */
  ramBytes?: number | readonly number[];
  /**
   * The raw ROM carries a `_i` id, and the chain indexes it in one more row (MintNonFungible /
   * BurnNonFungible). The ROM is schema-encoded, so a caller holding only the bytes cannot tell.
   *
   * The default is true. On a mint that is the reading which escrows for the row. On a burn it is
   * the reading that mirrors what the mint created. A burn never prices on this fact either way
   * (see {@link NativeFeeEstimate.deletedStorageQuanta}). A Phantasma mint always has such an id and
   * ignores this input.
   */
  romHasMetaId?: boolean;
  /**
   * The series mints duplicated NFTs (MintPhantasmaNonFungible). A duplicated series costs one more
   * query fee per instance than a unique one, plus one per distinct series (see
   * {@link distinctSeriesCount}). A call whose instances mix duplicated and unique series is priced
   * as if every instance were duplicated.
   *
   * Default true. A series' mode is chain state that the message does not carry, so only the
   * costlier reading is safe. A duplicated mint priced as unique is short by exactly those query
   * fees, and the planner offers the bill with no headroom, so the transaction aborts. Pass `false`
   * only when the series is known to be unique. The saving is a few query fees.
   */
  duplicatedSeries?: boolean;
  /**
   * How many distinct series a duplicated Phantasma mint writes into (MintPhantasmaNonFungible with
   * `duplicatedSeries`). The chain reads each series' supply once per transaction, not once per
   * instance, so this is the count of distinct series ids in the call. It is never more than
   * `count`. Default 1. Ignored for a unique series, which does not read the supply at all.
   */
  distinctSeriesCount?: number;
  /** User payload bytes attached to the tx (billed under gas model v1 only). */
  payloadBytes?: number;
  /**
   * VM work-unit allowance for the Script kind. The default (5000) exceeds every script seen in
   * mainnet history (max 3392 units) with margin.
   *
   * In a `Call_Multi` the allowance counts once per unmodelled call, because each of them can do
   * that much work. A batch of calls the model does not price therefore offers several times what it
   * will spend. The localnet measured 4.2x for one such call and 10.1x for ten. The difference is
   * refunded, and a caller who knows the calls can bring the offer down with this field.
   */
  scriptUnitsAllowance?: bigint;
  /**
   * Event bytes allowance for the Script kind (Notify payloads count as block data). Default 512,
   * per unmodelled call like {@link scriptUnitsAllowance}.
   */
  scriptEventBytes?: number;
  /**
   * New storage quanta allowance for the Script kind. Default 4, per unmodelled call like
   * {@link scriptUnitsAllowance}.
   */
  scriptStorageQuanta?: number;
}

/**
 * One operation of a batched message. It carries the kind the operation is priced as and the inputs
 * it is priced from. See {@link estimateNativeFeeBatch}.
 */
export interface NativeFeePart {
  kind: NativeFeeKind;
  params?: NativeFeeParams;
}

/**
 * The estimate inputs that belong to the transaction itself. No operation inside it owns them,
 * because the block carries one envelope however many operations the message performs.
 */
export type NativeFeeTransactionParams = Pick<NativeFeeParams, 'envelopeBytes' | 'payloadBytes'>;

/**
 * An asset held at a burned NFT's own address. The burn returns it to the burner. See
 * {@link NativeFeeParams.infusions}.
 */
export interface InfusedAsset {
  /**
   * The token's id. Rows of the chain's gas and data tokens are free, and only the id tells which
   * token this is. Undefined prices the rows as paid, so the escrow ceiling can only come out too
   * high.
   */
  tokenId?: bigint;
  /** True for an NFT token. The burn returns every instance the address holds, see
   * `instanceCount`. */
  nonFungible?: boolean;
  /** How many instances of an NFT token the address holds. Each one costs a transfer and moves a
   * lookup row. Default 1. */
  instanceCount?: number;
  /**
   * The burner already holds this token, so no balance row is created when it comes back. Default
   * false, which is the costlier reading. It moves the escrow ceiling and never the bill, because a
   * burn refunds more rows than the return creates.
   */
  burnerHoldsToken?: boolean;
}

/**
 * A fee quote for one transaction, from the Tier-1 calculator or from the node's own estimator.
 * Gas values are kcal-base (1 KCAL = 1e10 kcal-base); escrow is in data-token atoms
 * (1 SOUL = 1e8 atoms).
 */
export interface FeeQuote {
  /**
   * The gas offer that covers the bill (`TxMsg.maxGas`). The Tier-1 calculator returns the bill
   * itself, floored at the chain's minimum offer. Unused gas is refunded, so a caller who wants
   * headroom adds it on top.
   */
  maxGas: bigint;
  /** The storage-escrow ceiling (`TxMsg.maxData`). It prices every new row at the current row
   * price. */
  maxData: bigint;
  /**
   * The bill the chain formula yields for exactly the provided inputs. It is exact for every native
   * operation when the inputs describe the transaction and the state facts are right. For the Script
   * kind it is the budgeted allowance, and the chain settles below it.
   *
   * One caveat on the word exact. The chain scales each charge as it is made and adds the results.
   * This calculator scales their sum. The two agree when `feeShift` is zero, and that is the case on
   * every network running the v2 model today. Under a non-zero shift the rounding differs. The
   * difference always goes one way: this calculator quotes a few units MORE than the chain settles,
   * so the offer still covers the bill.
   */
  expectedGasBill: bigint;
}

/** Result of a Tier-1 fee estimate. It holds the quote and the storage rows it was computed from. */
export interface NativeFeeEstimate extends FeeQuote {
  /** Storage quanta the operation creates. One quantum is 1024 bytes of a new paid row. */
  newStorageQuanta: number;
  /**
   * Storage quanta the operation deletes. Their escrow is refunded at each row's own price.
   *
   * The field is informational and does not enter the bill. `maxData` covers the rows an operation
   * CREATES. The block-data term uses the net growth, and an operation that deletes more than it
   * creates floors that growth at zero anyway.
   *
   * A burn's figure is a lower bound, because the stored ROM is chain state that the message does
   * not carry. Nothing depends on tightening it.
   */
  deletedStorageQuanta: number;
}

/**
 * Gas model v2 price of block-carried bytes, in gas units per byte.
 *
 * This is a versioned consensus constant of the v2 gas model, and it is kept out of the on-chain
 * config on purpose. It changes only with a new gas model version, so a client can hold it as a
 * constant and never read it per block.
 */
export const GAS_MODEL_V2_UNITS_PER_BLOCK_DATA_BYTE = 25n;

/** Storage is escrowed per 1024-byte quantum of a row's key plus its value. */
export const STORAGE_QUANTUM_BYTES = 1024;

/** Serialized size of one witness-array entry (32-byte address + 64-byte signature). */
export const WITNESS_ARRAY_ENTRY_BYTES = 96;

/** Serialized size of one bare signature (native TxTypes carry no witness array). */
export const NATIVE_SIGNATURE_BYTES = 64;

const U64_MAX = 0xffffffffffffffffn;

// Sizes of the token-module rows a native operation writes, in bytes of key plus value. A row costs
// ceil((key + value) / 1024) quanta. The small fixed rows never leave the first quantum. The
// ROM-bearing rows are computed from the ROM the caller submits.
const NFT_INSTANCE_ROW_OVERHEAD = 17 + 32 + 8 + 1 + 4; // key + originator + created + flags + ROM length prefix
const NFT_RAM_ROW_OVERHEAD = 17; // key; the RAM is stored bare
const TOKEN_INFO_KEY_BYTES = 9;
const SERIES_INFO_KEY_BYTES = 13;
// The canonical ROM of a deterministic Phantasma mint holds three things: the public ROM fields,
// the `_i` id (int256, 32 bytes), and a `rom` field with the public ROM again behind a 4-byte
// length prefix.
const PHANTASMA_CANONICAL_ROM_OVERHEAD = 32 + 4;
// Fungible mint and burn calls return the resulting balance as an IntX. That is 1 header byte plus
// 8 bytes for an int64 balance, and up to 1 plus 32 for an int256 balance on a big-fungible token.
const INTX_SMALL_RESULT_BYTES = 9;
const INTX_BIG_RESULT_BYTES = 33;

interface OperationModel {
  workUnits: bigint;
  policyFee: bigint;
  /** Bytes the Call returns. They are block data, like the envelope. */
  resultBytes: number;
  newQuanta: number;
  deletedQuanta: number;
}

/**
 * Returns the exact gas bill and storage escrow of one native operation. This is the Tier-1
 * calculator. It works under both gas models, selected by `GasConfig.version`, and it reproduces the
 * chain's own settlement arithmetic together with the gas each contract path charges.
 *
 * An offline calculation is safe here because any change to those formulas ships as a new gas-model
 * version. It never changes silently.
 *
 * @param kind - Operation kind.
 * @param config - Current chain gas config (see the getGasConfig RPC method).
 * @param params - The transaction's sizes and the state facts that decide row creation.
 */
export function estimateNativeFee(
  kind: NativeFeeKind,
  config: GasConfig,
  params: NativeFeeParams = {}
): NativeFeeEstimate {
  return estimateNativeFeeBatch([{ kind, params }], config, params);
}

/**
 * Returns the fee of a message that performs SEVERAL operations in one transaction. That message is
 * a `TxTypes.Call_Multi`. The chain runs its calls in a plain loop, with no per-call surcharge and
 * no batch dispatch cost. It accumulates one gas bill, one result buffer and one change set over the
 * whole transaction, and it bills the envelope once. A batch therefore costs the sum of its parts
 * over work, policy fee, result bytes and rows, settled once.
 *
 * Rows are counted per part. Two parts that create the SAME row count it twice. Two burns of one
 * token both count its burnt counter, and two transfers into one fresh address both count its
 * balance row.
 *
 * Carrying "an earlier part already created it" forward is unsound in the direction that matters. A
 * burn that empties a supply to exactly zero deletes the supply row again, so a later mint would be
 * priced short, abort and be billed. Counting twice raises the escrow ceiling alone, and that is
 * refunded.
 *
 * @param parts - The operations the message performs, in call order.
 * @param config - Current chain gas config (see the getGasConfig RPC method).
 * @param transaction - The sizes that belong to the transaction itself. No operation owns them.
 */
export function estimateNativeFeeBatch(
  parts: readonly NativeFeePart[],
  config: GasConfig,
  transaction: NativeFeeTransactionParams = {}
): NativeFeeEstimate {
  return settle(
    parts.map((part) => partModel(part, config)),
    config,
    transaction
  );
}

// The model of one operation, with the input check that belongs to every kind. Split out so the
// single-operation and the batch entry points build their parts the same way.
function partModel(part: NativeFeePart, config: GasConfig): OperationModel {
  const params = part.params ?? {};
  const count = params.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError('count must be a positive integer');
  }
  return operationModel(part.kind, config, params, count);
}

// Turns the operations a transaction performs into its bill, offer and escrow ceiling. One
// transaction is settled once. The work, policy fees, result bytes and rows add up. The envelope is
// counted once. The fee scaling and the minimum-bill floor apply to the total. The chain does the
// same with the counters it accumulates while the transaction runs.
function settle(
  models: readonly OperationModel[],
  config: GasConfig,
  transaction: NativeFeeTransactionParams
): NativeFeeEstimate {
  let workUnits = 0n;
  let policyFee = 0n;
  let resultBytes = 0;
  let newQuanta = 0;
  let deletedQuanta = 0;
  for (const model of models) {
    workUnits = clampU64(workUnits + model.workUnits);
    policyFee = clampU64(policyFee + model.policyFee);
    resultBytes += model.resultBytes;
    newQuanta += model.newQuanta;
    deletedQuanta += model.deletedQuanta;
  }
  // Only the net growth of paid storage is block data. Deleted rows are refunded.
  const netQuanta = Math.max(newQuanta - deletedQuanta, 0);

  let expected: bigint;
  let maxGas: bigint;
  if (usesGasModelV2(config)) {
    const envelope = transaction.envelopeBytes;
    if (envelope === undefined) {
      throw new RangeError('envelopeBytes is required under gas model v2');
    }
    assertNonNegativeInteger(envelope, 'envelopeBytes');
    // v2: bill = mulShiftSat(work + blockData * 25, mult, shift) + policyFee, floored at
    // minimumGasBill, where blockData = envelope + net storage quanta + Call result bytes.
    const blockData = BigInt(envelope + netQuanta + resultBytes);
    const byteUnits = clampU64(blockData * GAS_MODEL_V2_UNITS_PER_BLOCK_DATA_BYTE);
    let bill = mulShift(clampU64(workUnits + byteUnits), config.feeMultiplier, config.feeShift);
    bill = clampU64(bill + policyFee);
    expected = bill < config.minimumGasBill ? config.minimumGasBill : bill;
    maxGas = expected < config.minimumGasOffer ? config.minimumGasOffer : expected;
  } else {
    // v1: bill = (work * mult >> shift) + blockData * gasFeePerByte, where blockData = payload +
    // Call result bytes + net storage quanta. There is no envelope term and no floor. The v1 product
    // prices ride the work term, see operationModel.
    const work = mulShift(workUnits, config.feeMultiplier, config.feeShift);
    const blockData = BigInt((transaction.payloadBytes ?? 0) + resultBytes + netQuanta);
    expected = clampU64(work + clampU64(blockData * config.gasFeePerByte));
    // The offer has the same shape as the validator's own test-agent stdFee. It is a 2x
    // minimum-offer pad plus a flat 1 KiB block-data allowance on top of the work term.
    const byteAllowance = blockData > 1024n ? blockData : 1024n;
    maxGas = clampU64(
      config.minimumGasOffer * 2n + work + clampU64(byteAllowance * config.gasFeePerByte)
    );
  }

  return {
    maxGas,
    maxData: clampU64(BigInt(newQuanta) * config.dataEscrowPerRow),
    expectedGasBill: expected,
    newStorageQuanta: newQuanta,
    deletedStorageQuanta: deletedQuanta,
  };
}

/**
 * Returns the envelope size, which is the signed transaction as the block carries it. It is computed
 * from the length of an already serialized unsigned message and the number of signers. Use it when
 * you hold bytes and no message. With the message in hand use `SignedTxMsg.envelopeBytes`, which
 * reads the witness count out of the message and takes nothing on trust.
 *
 * The witness layout differs by type. The native transaction types append bare 64-byte signatures.
 * The call, trade and script types append a length-prefixed array of entries, each a 32-byte address
 * plus a 64-byte signature.
 *
 * `witnessCount` has no default on purpose. A fee kind does not tell a `_GasPayer` message, which
 * carries two signatures, from the plain form that carries one. Both are the same kind. A default of
 * one would size a two-signature envelope as a one-signature envelope and under-offer the
 * transaction by 64 bytes.
 */
export function envelopeBytesFor(
  kind: NativeFeeKind,
  serializedMessageLength: number,
  witnessCount: number
): number {
  assertNonNegativeInteger(serializedMessageLength, 'serializedMessageLength');
  assertNonNegativeInteger(witnessCount, 'witnessCount');
  switch (kind) {
    case NativeFeeKind.TransferFungible:
    case NativeFeeKind.TransferNonFungible:
    case NativeFeeKind.MintFungible:
    case NativeFeeKind.MintNonFungible:
    case NativeFeeKind.BurnFungible:
    case NativeFeeKind.BurnNonFungible:
      return serializedMessageLength + NATIVE_SIGNATURE_BYTES * witnessCount;
    default:
      // CreateToken, CreateTokenSeries, MintPhantasmaNonFungible and RegisterName ride
      // TxTypes.Call. Script rides TxTypes.Phantasma. Both carry the witness array form.
      return serializedMessageLength + 4 + WITNESS_ARRAY_ENTRY_BYTES * witnessCount;
  }
}

/** Returns the storage quanta of one row, which is ceil((key + value) / 1024). */
export function storageQuantaFor(rowBytes: number): number {
  assertNonNegativeInteger(rowBytes, 'rowBytes');
  return Math.ceil(rowBytes / STORAGE_QUANTUM_BYTES);
}

/**
 * Returns the bytes of the NFT ROM the chain stores for a deterministic Phantasma mint, computed
 * from the public ROM the caller submits. The chain builds a canonical ROM out of the public fields,
 * the derived Phantasma NFT id and a second copy of the public ROM. Storage therefore grows at
 * roughly twice the submitted size.
 */
export function phantasmaCanonicalRomBytes(publicRomBytes: number): number {
  assertNonNegativeInteger(publicRomBytes, 'publicRomBytes');
  return publicRomBytes * 2 + PHANTASMA_CANONICAL_ROM_OVERHEAD;
}

// Work units, policy fee, result bytes and row changes of each operation. A contract path makes
// state lookups internally, and each one is charged as a query fee (gasFeeQuery). Those fees are
// part of the bill even though nothing in the message mentions them.
function operationModel(
  kind: NativeFeeKind,
  config: GasConfig,
  params: NativeFeeParams,
  count: number
): OperationModel {
  const v2 = usesGasModelV2(config);
  const countU = BigInt(count);
  const freeBalanceRows =
    params.tokenId !== undefined &&
    (params.tokenId === config.gasTokenId || params.tokenId === config.dataTokenId);
  const recipientRow = params.recipientHoldsToken || freeBalanceRows ? 0 : 1;
  const burntRow = params.tokenBurnedBefore || freeBalanceRows ? 0 : 1;
  // The supply-tracking row a mint or burn may have to recreate, see NativeFeeParams. Transfers
  // never touch it, and a creation always writes it, so only mints and burns price it.
  const supplyRow = params.supplyRowExists || freeBalanceRows ? 0 : 1;
  const balanceResultBytes =
    (params.bigFungible ?? true) ? INTX_BIG_RESULT_BYTES : INTX_SMALL_RESULT_BYTES;
  const infusionQuery = params.toIsNftAddress ? config.gasFeeQuery : 0n;

  switch (kind) {
    case NativeFeeKind.TransferFungible:
      return {
        workUnits: clampU64(config.gasFeeTransfer + infusionQuery),
        policyFee: 0n,
        resultBytes: 0,
        newQuanta: recipientRow,
        deletedQuanta: 0,
      };
    case NativeFeeKind.TransferNonFungible:
      // Per instance, the owner's lookup row is deleted and the recipient's one is created. The
      // recipient's balance row may be new as well.
      return {
        workUnits: clampU64(config.gasFeeTransfer * countU + infusionQuery),
        policyFee: 0n,
        resultBytes: 0,
        newQuanta: count + recipientRow,
        deletedQuanta: count,
      };
    case NativeFeeKind.MintFungible:
      return {
        workUnits: clampU64(config.gasFeeTransfer + infusionQuery),
        policyFee: 0n,
        resultBytes: balanceResultBytes,
        newQuanta: recipientRow + supplyRow,
        deletedQuanta: 0,
      };
    case NativeFeeKind.BurnFungible:
      return {
        workUnits: config.gasFeeTransfer,
        policyFee: 0n,
        resultBytes: balanceResultBytes,
        newQuanta: burntRow + supplyRow,
        deletedQuanta: 0,
      };
    case NativeFeeKind.MintNonFungible: {
      const roms = perInstance(params.romBytes, count, 'romBytes');
      const rams = perInstance(params.ramBytes, count, 'ramBytes');
      // Per instance the mint writes the instance row with the ROM, the owner row and the lookup
      // row. It writes the RAM row when RAM is given, and the meta-id row when the ROM carries
      // `_i`. On top of that come the recipient's balance row and the supply row when it must be
      // recreated.
      const romHasMetaId = params.romHasMetaId ?? true;
      let quanta = recipientRow + supplyRow;
      for (let i = 0; i < count; i++) {
        quanta += storageQuantaFor(NFT_INSTANCE_ROW_OVERHEAD + roms[i]) + 2;
        if (rams[i] > 0) quanta += storageQuantaFor(NFT_RAM_ROW_OVERHEAD + rams[i]);
        if (romHasMetaId) quanta += 1;
      }
      return {
        workUnits: clampU64(config.gasFeeTransfer * countU + infusionQuery),
        policyFee: 0n,
        resultBytes: 4 + 8 * count, // instance count + one u64 instance id each
        newQuanta: quanta,
        deletedQuanta: 0,
      };
    }
    case NativeFeeKind.MintPhantasmaNonFungible: {
      const roms = perInstance(params.romBytes, count, 'romBytes');
      const rams = perInstance(params.ramBytes, count, 'ramBytes');
      // The same rows as MintNonFungible. The stored ROM is the canonical one and the meta-id row
      // is always present.
      let quanta = recipientRow + supplyRow;
      for (let i = 0; i < count; i++) {
        quanta +=
          storageQuantaFor(NFT_INSTANCE_ROW_OVERHEAD + phantasmaCanonicalRomBytes(roms[i])) + 3;
        if (rams[i] > 0) quanta += storageQuantaFor(NFT_RAM_ROW_OVERHEAD + rams[i]);
      }
      // Per instance the chain charges the mint itself, the series lookup by meta id, and the
      // token-info read that the series-mode check performs.
      //
      // A duplicated series reads the token info a SECOND time per instance, to pick up the series'
      // shared ROM. It also reads that series' supply once per distinct series in the call. The
      // chain remembers a supply it has already read, so the supply fee does not scale with the
      // instance count the way the other three do.
      const duplicatedSeries = params.duplicatedSeries ?? true;
      const queriesPerInstance = duplicatedSeries ? 3n : 2n;
      const seriesSupplyQueries = duplicatedSeries ? BigInt(distinctSeries(params, count)) : 0n;
      return {
        workUnits: clampU64(
          (config.gasFeeTransfer + config.gasFeeQuery * queriesPerInstance) * countU +
            config.gasFeeQuery * seriesSupplyQueries +
            infusionQuery
        ),
        policyFee: 0n,
        resultBytes: 4 + 40 * count, // instance count + (32-byte Phantasma id + u64 instance id) each
        newQuanta: quanta,
        deletedQuanta: 0,
      };
    }
    case NativeFeeKind.BurnNonFungible: {
      const roms = perInstance(params.romBytes, count, 'romBytes');
      const rams = perInstance(params.ramBytes, count, 'ramBytes');
      // The instance, owner and lookup rows are deleted and refunded, and so are the RAM and
      // meta-id rows when they exist. The burnt counter row is created on the token's first burn,
      // and the supply row when it must be recreated.
      //
      // Each instance's infusion sweep reads the NFT address balances twice. Whatever the sweep
      // finds is returned to the burner and charged as the transfers it takes, see `returnedAssets`.
      //
      // The deleted rows mirror what the mint created, and that is why the meta-id row is counted
      // the same way here. On a burn this total is reported and never billed, see
      // `deletedStorageQuanta`.
      const romHasMetaId = params.romHasMetaId ?? true;
      let deleted = 0;
      for (let i = 0; i < count; i++) {
        deleted += storageQuantaFor(NFT_INSTANCE_ROW_OVERHEAD + roms[i]) + 2;
        if (rams[i] > 0) deleted += storageQuantaFor(NFT_RAM_ROW_OVERHEAD + rams[i]);
        if (romHasMetaId) deleted += 1;
      }
      const returned = returnedAssets(params, config);
      return {
        workUnits: clampU64(
          (config.gasFeeTransfer + config.gasFeeQuery * 2n) * countU + returned.workUnits
        ),
        policyFee: 0n,
        resultBytes: 0,
        newQuanta: burntRow + supplyRow + returned.newQuanta,
        deletedQuanta: deleted + returned.deletedQuanta,
      };
    }
    case NativeFeeKind.CreateToken: {
      const symbolLength = params.symbolLength ?? 0;
      const shift = symbolShift(symbolLength, config.maxTokenSymbolLength, 'symbolLength');
      const hasSymbol = symbolLength > 0;
      const infoBytes = params.tokenInfoBytes ?? 0;
      assertNonNegativeInteger(infoBytes, 'tokenInfoBytes');
      // The creation writes the symbol lookup row, the token info row and the null-address supply
      // row. An NFT token adds the series counter. `pre_burn` adds the burnt counter. An inflation
      // schedule adds the next-inflation row.
      const quanta =
        (hasSymbol ? 1 : 0) +
        storageQuantaFor(TOKEN_INFO_KEY_BYTES + infoBytes) +
        1 +
        (params.nonFungible ? 1 : 0) +
        (params.hasPreBurn ? 1 : 0) +
        (params.hasInflationSchedule ? 1 : 0);
      const base = v2 ? config.policyFeeCreateTokenBase : config.gasFeeCreateTokenBase;
      const symbol = hasSymbol
        ? (v2 ? config.policyFeeCreateTokenSymbol : config.gasFeeCreateTokenSymbol) >> shift
        : 0n;
      // Validating the metadata looks up a staking organisation it names and reads a reward token
      // it names. Each costs one query fee, on top of the policy fee.
      const metadataQueries =
        config.gasFeeQuery *
        BigInt((params.hasStakingOrganisation ? 1 : 0) + (params.hasStakingRewardToken ? 1 : 0));
      return {
        workUnits: clampU64((v2 ? 0n : base + symbol) + metadataQueries),
        policyFee: v2 ? clampU64(base + symbol) : 0n,
        resultBytes: 8, // the new token id, u64
        newQuanta: quanta,
        deletedQuanta: 0,
      };
    }
    case NativeFeeKind.CreateTokenSeries: {
      const infoBytes = params.seriesInfoBytes ?? 0;
      assertNonNegativeInteger(infoBytes, 'seriesInfoBytes');
      // The call writes the series info row and the series supply row. The metadata adds the
      // meta-id lookup row when it has `_i`.
      const seriesHasMetaId = params.seriesHasMetaId ?? true;
      const quanta =
        storageQuantaFor(SERIES_INFO_KEY_BYTES + infoBytes) + 1 + (seriesHasMetaId ? 1 : 0);
      return {
        workUnits: v2 ? 0n : config.gasFeeCreateTokenSeries,
        policyFee: v2 ? config.policyFeeCreateTokenSeries : 0n,
        resultBytes: 4, // the new series id, u32
        newQuanta: quanta,
        deletedQuanta: 0,
      };
    }
    case NativeFeeKind.RegisterName: {
      const nameLength = params.nameLength ?? 0;
      if (nameLength <= 0) {
        throw new RangeError('nameLength is required for RegisterName');
      }
      const shift = symbolShift(nameLength, config.maxNameLength, 'nameLength');
      // Governance-module rows are free data, so the two name rows escrow nothing.
      return {
        workUnits: v2 ? 0n : config.gasFeeRegisterName >> shift,
        policyFee: v2 ? config.policyFeeRegisterName >> shift : 0n,
        resultBytes: 0,
        newQuanta: 0,
        deletedQuanta: 0,
      };
    }
    case NativeFeeKind.Script: {
      const quanta = params.scriptStorageQuanta ?? 4;
      assertNonNegativeInteger(quanta, 'scriptStorageQuanta');
      const eventBytes = params.scriptEventBytes ?? 512;
      assertNonNegativeInteger(eventBytes, 'scriptEventBytes');
      return {
        workUnits: params.scriptUnitsAllowance ?? 5000n,
        policyFee: 0n,
        resultBytes: eventBytes,
        newQuanta: quanta,
        deletedQuanta: 0,
      };
    }
    default:
      throw new RangeError(`unknown fee kind: ${kind}`);
  }
}

// Returns how many distinct series a duplicated mint touches. The default is one. More series than
// instances is impossible, because at least one instance writes into every series in the call. The
// check turns a caller's bookkeeping slip into an error. Without it the slip becomes an over-offer
// that nobody notices.
function distinctSeries(params: NativeFeeParams, count: number): number {
  const distinct = params.distinctSeriesCount ?? 1;
  if (!Number.isSafeInteger(distinct) || distinct < 1 || distinct > count) {
    throw new RangeError(`distinctSeriesCount must be an integer between 1 and ${count}`);
  }
  return distinct;
}

// What burning the NFTs gives back to the burner, priced as the transfers the chain performs. A
// fungible token costs one transfer plus the owner lookup of the NFT-address source. An NFT token
// costs one instance query, one transfer per instance, and that same lookup.
//
// Rows: a returned token the burner does not hold creates a balance row. That row is paid unless the
// token is the gas or data token, and only the id tells which token it is, so an unknown id is
// priced as paid. Every returned instance moves its lookup row, and the NFT address's own rows are
// deleted.
//
// The deletions always match or exceed the creations, so the returns never add block data. They add
// work, and they add rows to the escrow ceiling.
function returnedAssets(params: NativeFeeParams, config: GasConfig): OperationModel {
  let workUnits = 0n;
  let newQuanta = 0;
  let deletedQuanta = 0;
  for (const asset of params.infusions ?? []) {
    const freeRows =
      asset.tokenId !== undefined &&
      (asset.tokenId === config.gasTokenId || asset.tokenId === config.dataTokenId);
    const balanceRow = asset.burnerHoldsToken || freeRows ? 0 : 1;
    if (asset.nonFungible) {
      const instances = asset.instanceCount ?? 1;
      assertNonNegativeInteger(instances, 'instanceCount');
      if (instances < 1) {
        throw new RangeError('instanceCount of a returned NFT token must be a positive integer');
      }
      workUnits += config.gasFeeQuery * 2n + config.gasFeeTransfer * BigInt(instances);
      newQuanta += balanceRow + instances;
      deletedQuanta += 1 + instances;
    } else {
      workUnits += config.gasFeeTransfer + config.gasFeeQuery;
      newQuanta += balanceRow;
      deletedQuanta += freeRows ? 0 : 1;
    }
  }
  return {
    workUnits: clampU64(workUnits),
    policyFee: 0n,
    resultBytes: 0,
    newQuanta,
    deletedQuanta,
  };
}

function perInstance(
  value: number | readonly number[] | undefined,
  count: number,
  name: string
): number[] {
  if (value === undefined) return new Array<number>(count).fill(0);
  if (typeof value === 'number') {
    assertNonNegativeInteger(value, name);
    return new Array<number>(count).fill(value);
  }
  if (value.length !== count) {
    throw new RangeError(`${name} must have one entry per instance (${count})`);
  }
  for (const v of value) assertNonNegativeInteger(v, name);
  return [...value];
}

// Chain fee scaling: (value * feeMultiplier) >> feeShift, saturating to u64. The chain saturates
// the same way under gas model v2, so a hostile config cannot wrap a bill. Under v1 the live values
// never approach 64 bits, so this expression is bit-identical to the v1 arithmetic.
function mulShift(value: bigint, multiplier: bigint, shift: number): bigint {
  if (shift >= 64) return 0n; // the chain clamps oversized shifts to a zero delta
  return clampU64((value * multiplier) >> BigInt(shift));
}

/**
 * Longest name or symbol this calculator will price. The chain's length-halved policy fee is defined
 * up to this length. Past it no offline price exists, so the calculator refuses. A quoted number
 * could differ from what the chain charges.
 */
const MAX_PRICEABLE_LENGTH = 64;

function symbolShift(length: number, maxLength: number, paramName: string): bigint {
  assertNonNegativeInteger(length, paramName);
  if (length === 0) return 0n;
  const shift = length - 1;
  // The chain asserts that the shift stays below maxNameLength and maxTokenSymbolLength. A longer
  // input could never be admitted, so it is rejected here. Quoting a fee for an impossible
  // transaction would be worse.
  if (maxLength !== 0 && shift >= maxLength) {
    throw new RangeError(`${paramName} ${length} exceeds the chain maximum ${maxLength}`);
  }
  // The calculator refuses instead of guessing, see MAX_PRICEABLE_LENGTH. The transaction may well
  // be admitted. This says only that no honest price can be quoted for it offline.
  if (length > MAX_PRICEABLE_LENGTH) {
    throw new RangeError(
      `${paramName} ${length} is longer than ${MAX_PRICEABLE_LENGTH} and cannot be priced offline`
    );
  }
  return BigInt(shift);
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function clampU64(value: bigint): bigint {
  return value > U64_MAX ? U64_MAX : value;
}

/**
 * Returns which gas model a config selects. It reads the plain `version` field and not the
 * `GasConfig.hasGasModelV2` accessor.
 *
 * The difference matters because a config does not always arrive as a `GasConfig` instance. Wallets
 * cache prices, and a cached config comes back as a plain object: from a spread, a structured clone,
 * a store. Such an object carries the data fields and not the prototype the accessor lives on. Read
 * through the accessor it reports `undefined`, so the config is billed under the v1 rules and every
 * offer computed from it is short by orders of magnitude. Nothing throws. The version field survives
 * every one of those round trips, so the model is selected by it.
 */
function usesGasModelV2(config: GasConfig): boolean {
  return config.version >= 1;
}
