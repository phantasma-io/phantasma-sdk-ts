import { GasConfig } from '../gas-config.js';

/** Native operations the Tier-1 fee calculator models exactly. */
export enum NativeFeeKind {
  /** Fungible token transfer (TxTypes.TransferFungible and its _GasPayer variant). */
  TransferFungible = 'TransferFungible',
  /** NFT transfer of `count` instances (TxTypes.TransferNonFungible_* and _GasPayer variants). */
  TransferNonFungible = 'TransferNonFungible',
  /** Fungible mint (TxTypes.MintFungible). */
  MintFungible = 'MintFungible',
  /** NFT mint of `count` instances with caller-supplied ROM (TxTypes.MintNonFungible). The ROM is
   * stored exactly as submitted, unlike a deterministic Phantasma mint. */
  MintNonFungible = 'MintNonFungible',
  /**
   * Deterministic Phantasma NFT mint of `count` instances (TokenContract.MintPhantasmaNonFungible).
   * The chain stores a canonical ROM: the public ROM plus the derived Phantasma NFT id plus a copy
   * of the public ROM, so storage grows at twice the ROM size.
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
   * contract calls). Script opcode costs depend on chain state and are not closed-form; the
   * estimate budgets `scriptUnitsAllowance` VM work units and `scriptEventBytes` of events on top
   * of the byte fee. For an exact script bill use the node-side estimator (`estimateTransaction`).
   */
  Script = 'Script',
}

/**
 * Inputs of {@link estimateNativeFee}. Under gas model v2 every byte the transaction puts in the
 * block is billed and every new storage row is escrowed, so the inputs are the sizes the chain
 * will see: the signed envelope, the serialized structures the operation stores, and the facts
 * about existing state that decide whether a row is new.
 *
 * The inputs are of two kinds, and they are defaulted differently:
 *
 * - Facts the CALLER CANNOT KNOW without reading chain state - whether the recipient already holds
 *   the token, whether a ROM carries an `_i` id, which mode a series mints in. Each defaults to the
 *   case that costs MORE, so an estimate built from defaults is an upper bound the settlement can
 *   only undercut, never a short offer.
 * - Facts carried by the MESSAGE ITSELF - the instance count, the serialized sizes, whether the
 *   token being created is non-fungible or carries `pre_burn`. These have no safe default because
 *   they are not guesses: pass them. `planFees` reads every one of them out of the message.
 */
export interface NativeFeeParams {
  /**
   * Full signed transaction size in bytes - the envelope carried in the block. Required under gas
   * model v2 (see {@link envelopeBytesFor} and `SignedTxMsg`); ignored under v1, which billed only
   * the payload note.
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
   * The recipient is an NFT-derived address (an infusion): the chain reads that NFT's owner - one
   * extra query fee. Transfers and every mint kind pay it; a burn has no recipient. This is a fact
   * of the recipient's address form, not of chain state - `planFees` derives it from the message's
   * own recipient (`TokenHelper.isNftAddress`) - so only direct callers of this calculator pass it.
   */
  toIsNftAddress?: boolean;
  /**
   * The token's balances can exceed int64 (a big-fungible token). A fungible mint or burn answers
   * with the RESULTING balance as a variable-length integer - 9 bytes while it fits int64, up to
   * 33 for an int256 balance - and the resulting balance is chain state, so the default prices the
   * 33-byte maximum: a covering bound, refunded down. Pass `false` for an ordinary int64 token and
   * the estimate is exact.
   */
  bigFungible?: boolean;
  /** The token has been burned before, so its burnt counter row exists. Default false (first burn creates it). */
  tokenBurnedBefore?: boolean;
  /** Token symbol length in characters (CreateToken). 0 = no symbol. */
  symbolLength?: number;
  /** Serialized `TokenInfo` length (CreateToken) - the Call arguments; it becomes the token-info row. */
  tokenInfoBytes?: number;
  /** The token being created is non-fungible (CreateToken): one more row, the series counter. */
  nonFungible?: boolean;
  /** The token metadata carries `pre_burn` (CreateToken): the burnt counter row is created at once. */
  hasPreBurn?: boolean;
  /** The token metadata carries an inflation schedule (CreateToken): the next-inflation row is created. */
  hasInflationSchedule?: boolean;
  /** Serialized `SeriesInfo` length (CreateTokenSeries) - the Call arguments after the token id. */
  seriesInfoBytes?: number;
  /**
   * The series metadata carries a `_i` id (CreateTokenSeries): the meta-id lookup row is created.
   * Schema-encoded like the ROM, so the default is true - the row that may be billed.
   */
  seriesHasMetaId?: boolean;
  /** Registered name length in characters (RegisterName). Required for that kind. */
  nameLength?: number;
  /** ROM bytes per minted or burned instance (MintNonFungible / BurnNonFungible: as stored; MintPhantasmaNonFungible: the public ROM). */
  romBytes?: number | readonly number[];
  /** RAM bytes per instance. Default 0 (no RAM row). */
  ramBytes?: number | readonly number[];
  /**
   * The raw ROM carries a `_i` id, which the chain indexes in one more row (MintNonFungible /
   * BurnNonFungible). The ROM is schema-encoded, so a caller holding only the bytes cannot tell, and
   * the default is true - on a mint that is the reading which escrows for the row, and on a burn it
   * is the reading that mirrors what the mint created. The burn does not PRICE on it either way
   * (see {@link NativeFeeEstimate.deletedStorageQuanta}); a Phantasma mint always has one and
   * ignores this input.
   */
  romHasMetaId?: boolean;
  /**
   * The series mints duplicated NFTs (MintPhantasmaNonFungible). A duplicated series costs one more
   * query fee per instance than a unique one, plus one per distinct series (see
   * {@link distinctSeriesCount}). A call whose instances mix duplicated and unique series is priced
   * as if every instance were duplicated.
   *
   * Default true. A series' mode is chain state the message does not carry, so the costlier reading
   * is the only safe one: a duplicated mint priced as unique is short by exactly those query fees,
   * and the planner offers the bill with no headroom, so it aborts. Pass `false` only when the
   * series is known to be unique - the saving is a few query fees.
   */
  duplicatedSeries?: boolean;
  /**
   * How many distinct series a duplicated Phantasma mint writes into (MintPhantasmaNonFungible with
   * `duplicatedSeries`). The chain reads each series' supply once per transaction, not once per
   * instance, so this is the count of distinct series ids in the call - never more than `count`.
   * Default 1. Ignored for a unique series, which does not read the supply at all.
   */
  distinctSeriesCount?: number;
  /** User payload bytes attached to the tx (billed under gas model v1 only). */
  payloadBytes?: number;
  /**
   * VM work-unit allowance for the Script kind. The default (5000) exceeds every script seen in
   * mainnet history (max 3392 units) with margin.
   */
  scriptUnitsAllowance?: bigint;
  /** Event bytes allowance for the Script kind (Notify payloads count as block data). Default 512. */
  scriptEventBytes?: number;
  /** New storage quanta allowance for the Script kind. Default 4. */
  scriptStorageQuanta?: number;
}

/**
 * A fee quote for one transaction, from the Tier-1 calculator or from the node's own estimator.
 * Gas values are kcal-base (1 KCAL = 1e10 kcal-base); escrow is in data-token atoms
 * (1 SOUL = 1e8 atoms).
 */
export interface FeeQuote {
  /**
   * The gas offer that covers the bill (`TxMsg.maxGas`). From the Tier-1 calculator it is the
   * bill itself, floored at the chain's minimum offer; unused gas is refunded, so callers wanting
   * headroom add it on top.
   */
  maxGas: bigint;
  /** The storage-escrow ceiling (`TxMsg.maxData`): every new row priced at the current row price. */
  maxData: bigint;
  /**
   * The bill the chain formula yields for exactly the provided inputs - exact for every native
   * operation when the inputs describe the transaction and the state facts are right. For the
   * Script kind it is the budgeted allowance, not a prediction.
   *
   * One caveat on "exact": the chain scales each charge as it is made and adds the results, while
   * this calculator scales their sum. The two agree while `feeShift` is zero, which is the case on
   * every network running the v2 model today; under a non-zero shift the rounding differs, always
   * in the direction of this calculator quoting a few units MORE than the chain settles, so the
   * offer stays covering.
   */
  expectedGasBill: bigint;
}

/** Result of a Tier-1 fee estimate: the quote plus the storage rows it was computed from. */
export interface NativeFeeEstimate extends FeeQuote {
  /** Storage quanta the operation creates (1024-byte units per new paid row). */
  newStorageQuanta: number;
  /**
   * Storage quanta the operation deletes; their escrow is refunded at each row's own price.
   *
   * Informational. It does not enter the bill: `maxData` covers the rows an operation CREATES, and
   * the block-data term uses the net growth, which an operation that deletes more than it creates
   * floors at zero either way. A burn's figure is therefore a lower bound - the stored ROM is chain
   * state the message does not carry - and nothing depends on tightening it.
   */
  deletedStorageQuanta: number;
}

/**
 * Gas model v2 price of block-carried bytes, in gas units per byte. A versioned consensus constant
 * of the v2 gas model, deliberately not part of the on-chain config: it changes only with a new gas
 * model version, so a client can hold it as a constant rather than read it per block.
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
// ceil((key + value) / 1024) quanta; the small fixed rows never leave the first quantum, while the
// ROM-bearing rows are computed from the ROM the caller submits.
const NFT_INSTANCE_ROW_OVERHEAD = 17 + 32 + 8 + 1 + 4; // key + originator + created + flags + ROM length prefix
const NFT_RAM_ROW_OVERHEAD = 17; // key; the RAM is stored bare
const TOKEN_INFO_KEY_BYTES = 9;
const SERIES_INFO_KEY_BYTES = 13;
// The canonical ROM of a deterministic Phantasma mint: the public ROM fields, plus `_i` (int256,
// 32 bytes), plus a `rom` field holding the public ROM again with a 4-byte length prefix.
const PHANTASMA_CANONICAL_ROM_OVERHEAD = 32 + 4;
// Fungible mint / burn calls return the resulting balance as an IntX: 1 header + 8 bytes for
// int64 balances, up to 1 + 32 for int256 (big-fungible) balances.
const INTX_SMALL_RESULT_BYTES = 9;
const INTX_BIG_RESULT_BYTES = 33;

interface OperationModel {
  workUnits: bigint;
  policyFee: bigint;
  /** Bytes the Call returns; they are block data like the envelope. */
  resultBytes: number;
  newQuanta: number;
  deletedQuanta: number;
}

/**
 * Tier-1 fee calculator: the exact gas bill and storage escrow of a native operation under both gas
 * models (selected by `GasConfig.version`), reproducing the chain's own settlement arithmetic and
 * the gas each contract path charges. Any change to those formulas ships as a new gas-model
 * version, never silently, which is what makes an offline calculation safe.
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
  const count = params.count ?? 1;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError('count must be a positive integer');
  }
  const v2 = usesGasModelV2(config);
  const model = operationModel(kind, config, params, count);
  // Only the net growth of paid storage is block data; deleted rows are refunded, not billed.
  const netQuanta = Math.max(model.newQuanta - model.deletedQuanta, 0);

  let expected: bigint;
  let maxGas: bigint;
  if (v2) {
    const envelope = params.envelopeBytes;
    if (envelope === undefined) {
      throw new RangeError('envelopeBytes is required under gas model v2');
    }
    assertNonNegativeInteger(envelope, 'envelopeBytes');
    // v2: bill = mulShiftSat(work + blockData * 25, mult, shift) + policyFee, floored at
    // minimumGasBill, where blockData = envelope + net storage quanta + Call result bytes.
    const blockData = BigInt(envelope + netQuanta + model.resultBytes);
    const byteUnits = clampU64(blockData * GAS_MODEL_V2_UNITS_PER_BLOCK_DATA_BYTE);
    let bill = mulShift(
      clampU64(model.workUnits + byteUnits),
      config.feeMultiplier,
      config.feeShift
    );
    bill = clampU64(bill + model.policyFee);
    expected = bill < config.minimumGasBill ? config.minimumGasBill : bill;
    maxGas = expected < config.minimumGasOffer ? config.minimumGasOffer : expected;
  } else {
    // v1: bill = (work * mult >> shift) + blockData * gasFeePerByte, where blockData = payload +
    // Call result bytes + net storage quanta; no envelope term, no floor. The v1 product prices
    // ride the work term (see operationModel).
    const work = mulShift(model.workUnits, config.feeMultiplier, config.feeShift);
    const blockData = BigInt((params.payloadBytes ?? 0) + model.resultBytes + netQuanta);
    expected = clampU64(work + clampU64(blockData * config.gasFeePerByte));
    // Offer shape mirrors the validator's own test-agent stdFee: a 2x minimum-offer pad plus a
    // flat 1 KiB block-data allowance on top of the work term.
    const byteAllowance = blockData > 1024n ? blockData : 1024n;
    maxGas = clampU64(
      config.minimumGasOffer * 2n + work + clampU64(byteAllowance * config.gasFeePerByte)
    );
  }

  return {
    maxGas,
    maxData: clampU64(BigInt(model.newQuanta) * config.dataEscrowPerRow),
    expectedGasBill: expected,
    newStorageQuanta: model.newQuanta,
    deletedStorageQuanta: model.deletedQuanta,
  };
}

/**
 * Envelope size (signed tx bytes as carried in the block) from an already serialized unsigned
 * message length and the number of signers, for callers that hold bytes rather than a message.
 * With the message in hand prefer `SignedTxMsg.envelopeBytes`, which reads the witness count out of
 * the message instead of taking it on trust. Witness layout: the native transaction types append
 * bare 64-byte signatures, while the call, trade and script types append a length-prefixed array of
 * 32-byte address plus 64-byte signature entries.
 *
 * `witnessCount` has no default on purpose. A fee kind does not distinguish a `_GasPayer` message,
 * which carries two signatures, from the plain form that carries one - both are the same kind - so
 * a default of one would silently size a two-signature envelope as a one-signature envelope and
 * under-offer the transaction by 64 bytes.
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
      // CreateToken / CreateTokenSeries / MintPhantasmaNonFungible / RegisterName ride
      // TxTypes.Call; Script rides TxTypes.Phantasma - both carry the witness array form.
      return serializedMessageLength + 4 + WITNESS_ARRAY_ENTRY_BYTES * witnessCount;
  }
}

/** Storage quanta of one row: ceil((key + value) / 1024). */
export function storageQuantaFor(rowBytes: number): number {
  assertNonNegativeInteger(rowBytes, 'rowBytes');
  return Math.ceil(rowBytes / STORAGE_QUANTUM_BYTES);
}

/**
 * Bytes of the NFT ROM the chain stores for a deterministic Phantasma mint, from the public ROM the
 * caller submits: the chain builds a canonical ROM out of the public fields, the derived Phantasma
 * NFT id and a second copy of the public ROM, so storage grows at roughly twice the submitted size.
 */
export function phantasmaCanonicalRomBytes(publicRomBytes: number): number {
  assertNonNegativeInteger(publicRomBytes, 'publicRomBytes');
  return publicRomBytes * 2 + PHANTASMA_CANONICAL_ROM_OVERHEAD;
}

// Work units, policy fee, result bytes and row changes of each operation. Query fees (gasFeeQuery)
// are charged by the state lookups a contract path makes internally, so they are part of the bill
// even though nothing in the message mentions them.
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
      // Per instance the owner's lookup row is deleted and the recipient's created; the
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
        newQuanta: recipientRow,
        deletedQuanta: 0,
      };
    case NativeFeeKind.BurnFungible:
      return {
        workUnits: config.gasFeeTransfer,
        policyFee: 0n,
        resultBytes: balanceResultBytes,
        newQuanta: burntRow,
        deletedQuanta: 0,
      };
    case NativeFeeKind.MintNonFungible: {
      const roms = perInstance(params.romBytes, count, 'romBytes');
      const rams = perInstance(params.ramBytes, count, 'ramBytes');
      // Per instance: the instance row (ROM), the owner row, the lookup row, the RAM row when
      // RAM is given, the meta-id row when the ROM carries `_i`; plus the recipient's balance row.
      const romHasMetaId = params.romHasMetaId ?? true;
      let quanta = recipientRow;
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
      // As MintNonFungible, with the canonical ROM stored and the meta-id row always present.
      let quanta = recipientRow;
      for (let i = 0; i < count; i++) {
        quanta +=
          storageQuantaFor(NFT_INSTANCE_ROW_OVERHEAD + phantasmaCanonicalRomBytes(roms[i])) + 3;
        if (rams[i] > 0) quanta += storageQuantaFor(NFT_RAM_ROW_OVERHEAD + rams[i]);
      }
      // Per instance: the mint itself, the series lookup by meta id, and the token-info read the
      // series-mode check performs. A duplicated series reads the token info a SECOND time per
      // instance, to pick up the series' shared ROM, and reads that series' supply once per
      // distinct series in the call - the chain remembers the supply it already read, so the
      // supply fee does not scale with the instance count the way the other three do.
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
      // The instance, owner, lookup (and RAM, meta-id) rows are deleted and refunded; the burnt
      // counter row is created on the token's first burn. Each instance's infusion sweep reads the
      // NFT address balances twice. The deleted rows mirror what the mint created, which is why the
      // meta-id row is counted the same way here - but see `deletedStorageQuanta`: on a burn this
      // total is reported, never billed.
      const romHasMetaId = params.romHasMetaId ?? true;
      let deleted = 0;
      for (let i = 0; i < count; i++) {
        deleted += storageQuantaFor(NFT_INSTANCE_ROW_OVERHEAD + roms[i]) + 2;
        if (rams[i] > 0) deleted += storageQuantaFor(NFT_RAM_ROW_OVERHEAD + rams[i]);
        if (romHasMetaId) deleted += 1;
      }
      return {
        workUnits: clampU64((config.gasFeeTransfer + config.gasFeeQuery * 2n) * countU),
        policyFee: 0n,
        resultBytes: 0,
        newQuanta: burntRow,
        deletedQuanta: deleted,
      };
    }
    case NativeFeeKind.CreateToken: {
      const symbolLength = params.symbolLength ?? 0;
      const shift = symbolShift(symbolLength, config.maxTokenSymbolLength, 'symbolLength');
      const hasSymbol = symbolLength > 0;
      const infoBytes = params.tokenInfoBytes ?? 0;
      assertNonNegativeInteger(infoBytes, 'tokenInfoBytes');
      // Rows: the symbol lookup, the token info, the null-address supply row, the series counter
      // for NFT tokens, the burnt counter with pre_burn, the next-inflation row with a schedule.
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
      return {
        workUnits: v2 ? 0n : clampU64(base + symbol),
        policyFee: v2 ? clampU64(base + symbol) : 0n,
        resultBytes: 8, // the new token id, u64
        newQuanta: quanta,
        deletedQuanta: 0,
      };
    }
    case NativeFeeKind.CreateTokenSeries: {
      const infoBytes = params.seriesInfoBytes ?? 0;
      assertNonNegativeInteger(infoBytes, 'seriesInfoBytes');
      // Rows: the series info, the series supply, the meta-id lookup when the metadata has `_i`.
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
      // Governance-module rows are free data: the two name rows escrow nothing.
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

// Distinct series a duplicated mint touches, defaulting to one. More series than instances is
// impossible - every series in the call is written into by at least one instance - and catching it
// here turns a caller's bookkeeping slip into an error instead of an over-offer nobody notices.
function distinctSeries(params: NativeFeeParams, count: number): number {
  const distinct = params.distinctSeriesCount ?? 1;
  if (!Number.isSafeInteger(distinct) || distinct < 1 || distinct > count) {
    throw new RangeError(`distinctSeriesCount must be an integer between 1 and ${count}`);
  }
  return distinct;
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

// Chain fee scaling: (value * feeMultiplier) >> feeShift, saturating to u64. Saturation is what the
// chain does under gas model v2, so a hostile config cannot wrap a bill; under v1 the live values
// never approach 64 bits, so the same expression is bit-identical to the v1 arithmetic.
function mulShift(value: bigint, multiplier: bigint, shift: number): bigint {
  if (shift >= 64) return 0n; // the chain clamps oversized shifts to a zero delta
  return clampU64((value * multiplier) >> BigInt(shift));
}

/**
 * Longest name or symbol this calculator will price. The chain's length-halved policy fee is
 * defined up to here; past it no offline price exists, so the calculator refuses rather than
 * quote a number the chain may not agree with.
 */
const MAX_PRICEABLE_LENGTH = 64;

function symbolShift(length: number, maxLength: number, paramName: string): bigint {
  assertNonNegativeInteger(length, paramName);
  if (length === 0) return 0n;
  const shift = length - 1;
  // The chain asserts shift < maxNameLength / maxTokenSymbolLength; a longer input could never
  // be admitted, so reject it here instead of quoting a fee for an impossible tx.
  if (maxLength !== 0 && shift >= maxLength) {
    throw new RangeError(`${paramName} ${length} exceeds the chain maximum ${maxLength}`);
  }
  // Refusing beats guessing: see MAX_PRICEABLE_LENGTH. The transaction may well be admitted - this
  // says only that no honest price can be quoted for it offline.
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
 * Which gas model a config selects, read from the plain `version` field rather than through
 * `GasConfig.hasGasModelV2`.
 *
 * The difference matters because a config does not always arrive as a `GasConfig` instance. Wallets
 * cache prices, and a cached config comes back as a plain object - from a spread, a structured
 * clone, a store - which carries the data fields and not the prototype the accessor lives on. Read
 * through the accessor, such a config reports `undefined`, is billed under the v1 rules, and every
 * offer computed from it is short by orders of magnitude while nothing throws. The version field
 * survives every one of those round trips, so it is what the model is selected by.
 */
function usesGasModelV2(config: GasConfig): boolean {
  return config.version >= 1;
}
