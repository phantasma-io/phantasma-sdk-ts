import { GasConfig } from '../gas-config.js';

/** Native operation kinds supported by the Tier-1 fee estimator. */
export enum NativeFeeKind {
  /** Fungible token transfer (native TxTypes.TransferFungible / _GasPayer). */
  TransferFungible = 'TransferFungible',
  /** NFT transfer of `count` instances (TxTypes.TransferNonFungible_*). */
  TransferNonFungible = 'TransferNonFungible',
  /** Fungible mint (TxTypes.MintFungible or TokenContract.MintFungible call). */
  MintFungible = 'MintFungible',
  /** NFT mint of `count` instances (TxTypes.MintNonFungible or contract call). */
  MintNonFungible = 'MintNonFungible',
  /** Fungible burn (TxTypes.BurnFungible / _GasPayer). */
  BurnFungible = 'BurnFungible',
  /** NFT burn of `count` instances (TxTypes.BurnNonFungible / _GasPayer). */
  BurnNonFungible = 'BurnNonFungible',
  /** TokenContract.CreateToken call. Requires `symbolLength` when a symbol is set. */
  CreateToken = 'CreateToken',
  /** TokenContract.CreateTokenSeries call. */
  CreateTokenSeries = 'CreateTokenSeries',
  /** GovernanceContract.RegisterName call. Requires `nameLength`. */
  RegisterName = 'RegisterName',
  /**
   * Generic Phantasma VM script transaction (AllowGas/SpendGas pattern: stake, marketplace,
   * custom contract calls). Script opcode costs are not closed-form in Tier-1; the estimate
   * budgets `scriptUnitsAllowance` VM work units on top of the byte fee. For an exact script
   * bill use the node-side Tier-2 estimator once available.
   */
  Script = 'Script',
}

/**
 * Optional inputs for {@link estimateNativeFee}. Defaults produce a safe single-signer
 * estimate; set fields for exactness (the unused part of a gas offer is always refunded, so
 * generous values only lock the balance for the block, they cost nothing).
 */
export interface NativeFeeParams {
  /** Instance count for NFT kinds (transferred/minted/burned instances). Default 1. */
  count?: number;
  /** Token symbol length in characters (CreateToken). 0 = no symbol. */
  symbolLength?: number;
  /** Registered name length in characters (RegisterName). Required for that kind. */
  nameLength?: number;
  /**
   * Full signed transaction size in bytes (the envelope carried in the block). Omit to use a
   * conservative per-kind default. Under gas model v2 every envelope byte is billed, so pass
   * the real size (see {@link envelopeBytesFor}) for exact numbers.
   */
  envelopeBytes?: number;
  /** User payload bytes attached to the tx (billed under gas model v1). */
  payloadBytes?: number;
  /**
   * Maximum number of paid storage rows the transaction can create (fresh token-balance rows,
   * NFT lookup rows, ...). Omit to use the per-kind worst-case default. SOUL/KCAL balance rows
   * are free and never count. Determines maxData: escrow = rows * dataEscrowPerRow.
   */
  freshRows?: number;
  /** Per-instance ROM+RAM bytes for MintNonFungible (stored state, drives escrow). */
  romRamBytes?: number;
  /**
   * VM work-unit allowance for the Script kind. The default (5000) exceeds every script seen
   * in mainnet history (max 3392 units) with margin.
   */
  scriptUnitsAllowance?: bigint;
}

/**
 * Result of a Tier-1 fee estimate. All gas values are kcal-base (1 KCAL = 1e10 kcal-base);
 * maxData is in data-token atoms (SOUL, 1 SOUL = 1e8 atoms).
 */
export interface NativeFeeEstimate {
  /** Recommended gas offer (TxMsg.maxGas). Includes deterministic headroom; the unused part is refunded. */
  maxGas: bigint;
  /** Recommended storage-escrow ceiling (TxMsg.maxData). Only the actually created rows are escrowed. */
  maxData: bigint;
  /** The bill the chain formula yields for exactly the provided inputs (no headroom). */
  expectedGasBill: bigint;
}

/**
 * Gas model v2 price of block-carried bytes, in gas units per byte. A versioned consensus
 * constant of the v2 gas model (node data_blockchain.h kGasModelV2UnitsPerBlockDataByte),
 * deliberately not part of the on-chain config.
 */
export const GAS_MODEL_V2_UNITS_PER_BLOCK_DATA_BYTE = 25n;

/** Serialized size of one witness-array entry (32-byte address + 64-byte signature). */
export const WITNESS_ARRAY_ENTRY_BYTES = 96;

/** Serialized size of one bare signature (native TxTypes carry no witness array). */
export const NATIVE_SIGNATURE_BYTES = 64;

const U64_MAX = 0xffffffffffffffffn;

/**
 * Tier-1 static fee calculator: closed-form gas/data offers for native operations, exact under
 * both gas models (selected by GasConfig.version). Mirrors the validator billing formula
 * (node blockchain.cpp settlement + token/governance contract gas sites); any change to those
 * formulas ships as a new gas-model version, never silently.
 *
 * @param kind - Operation kind.
 * @param config - Current chain gas config (see the getGasConfig RPC method).
 * @param params - Optional inputs; omit for safe single-signer defaults.
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
  const countU = BigInt(count);
  const v2 = config.hasGasModelV2;

  // Work units consumed by the operation itself (the ConsumeGas amounts in the token /
  // governance contracts) and, under v2, the direct kcal-base policy fee that replaces the v1
  // unit-priced product prices.
  let workUnits: bigint;
  let policyFee = 0n;
  switch (kind) {
    case NativeFeeKind.TransferFungible:
    case NativeFeeKind.MintFungible:
    case NativeFeeKind.BurnFungible:
      workUnits = config.gasFeeTransfer;
      break;
    case NativeFeeKind.TransferNonFungible:
    case NativeFeeKind.MintNonFungible:
    case NativeFeeKind.BurnNonFungible:
      workUnits = clampU64(config.gasFeeTransfer * countU);
      break;
    case NativeFeeKind.CreateToken: {
      // Symbol price halves per character after the first; shift is validated by the chain
      // against maxTokenSymbolLength, mirror that bound here.
      const shift = symbolShift(
        params.symbolLength ?? 0,
        config.maxTokenSymbolLength,
        'symbolLength'
      );
      const hasSymbol = (params.symbolLength ?? 0) > 0;
      if (v2) {
        workUnits = 0n;
        policyFee = clampU64(
          config.policyFeeCreateTokenBase +
            (hasSymbol ? config.policyFeeCreateTokenSymbol >> shift : 0n)
        );
      } else {
        workUnits = clampU64(
          config.gasFeeCreateTokenBase + (hasSymbol ? config.gasFeeCreateTokenSymbol >> shift : 0n)
        );
      }
      break;
    }
    case NativeFeeKind.CreateTokenSeries:
      workUnits = v2 ? 0n : config.gasFeeCreateTokenSeries;
      policyFee = v2 ? config.policyFeeCreateTokenSeries : 0n;
      break;
    case NativeFeeKind.RegisterName: {
      const nameLength = params.nameLength ?? 0;
      if (nameLength <= 0) {
        throw new RangeError('nameLength is required for RegisterName');
      }
      const shift = symbolShift(nameLength, config.maxNameLength, 'nameLength');
      workUnits = v2 ? 0n : config.gasFeeRegisterName >> shift;
      policyFee = v2 ? config.policyFeeRegisterName >> shift : 0n;
      break;
    }
    case NativeFeeKind.Script:
      workUnits = params.scriptUnitsAllowance ?? 5000n;
      break;
    default:
      throw new RangeError(`unknown fee kind: ${kind}`);
  }

  const rows = BigInt(params.freshRows ?? defaultFreshRows(kind, count, params.romRamBytes ?? 0));
  if (rows < 0n) {
    throw new RangeError('freshRows must not be negative');
  }
  const envelope = BigInt(
    params.envelopeBytes ?? defaultEnvelopeBytes(kind, count, params.romRamBytes ?? 0)
  );
  // Native TxTypes store no events in the block; script txs do (Notify), so budget some.
  const eventBytes = kind === NativeFeeKind.Script ? 512n : 0n;

  let expected: bigint;
  let maxGas: bigint;
  if (v2) {
    // v2 formula: bill = mulShiftSat(workUnits + blockData*25, mult, shift) + policyFee,
    // floored at minimumGasBill. blockData = envelope + events + net storage quanta (quanta are
    // added to the byte count by the chain formula).
    expected = billV2(workUnits, envelope, eventBytes, rows, policyFee, config);
    // Offer headroom: +25% over the padded bill covers witness-size wiggle and event variance;
    // deterministic and always refunded down to the actual bill.
    const padded = billV2(workUnits, roundUp(envelope, 128n), eventBytes, rows, policyFee, config);
    maxGas = clampU64(padded + padded / 4n);
    if (maxGas < config.minimumGasBill) maxGas = config.minimumGasBill;
    if (maxGas < config.minimumGasOffer) maxGas = config.minimumGasOffer;
  } else {
    // v1 formula: bill = (workUnits * mult >> shift) + blockData * gasFeePerByte where
    // blockData = payload + events + net storage quanta (no envelope term, no floor).
    const work = mulShift(workUnits, config.feeMultiplier, config.feeShift);
    const blockData = BigInt(params.payloadBytes ?? 0) + eventBytes + rows;
    expected = clampU64(work + clampU64(blockData * config.gasFeePerByte));
    // Offer shape mirrors the validator's own test-agent stdFee: a 2x minimum-offer pad plus a
    // flat 1 KiB block-data allowance on top of the work term.
    const byteAllowance = blockData > 1024n ? blockData : 1024n;
    maxGas = clampU64(
      config.minimumGasOffer * 2n + work + clampU64(byteAllowance * config.gasFeePerByte)
    );
  }

  const maxData = clampU64(rows * config.dataEscrowPerRow);
  return { maxGas, maxData, expectedGasBill: expected };
}

/**
 * Envelope size (signed tx bytes as carried in the block) from a serialized unsigned message
 * length and the number of signers. Use with {@link NativeFeeParams.envelopeBytes} for exact v2
 * estimates. Witness layout mirrors SignedTxMsg: native TxTypes append bare 64-byte signatures
 * (one, or two for the _GasPayer variants); Call/Trade/Phantasma txs append a length-prefixed
 * witness array (32-byte address + 64-byte signature per entry).
 */
export function envelopeBytesFor(
  kind: NativeFeeKind,
  serializedMessageLength: number,
  witnessCount: number = 1
): number {
  if (!Number.isSafeInteger(serializedMessageLength) || serializedMessageLength < 0) {
    throw new RangeError('serializedMessageLength must be a non-negative integer');
  }
  if (!Number.isSafeInteger(witnessCount) || witnessCount < 0) {
    throw new RangeError('witnessCount must be a non-negative integer');
  }
  switch (kind) {
    case NativeFeeKind.TransferFungible:
    case NativeFeeKind.TransferNonFungible:
    case NativeFeeKind.MintFungible:
    case NativeFeeKind.MintNonFungible:
    case NativeFeeKind.BurnFungible:
    case NativeFeeKind.BurnNonFungible:
      return serializedMessageLength + NATIVE_SIGNATURE_BYTES * witnessCount;
    default:
      // CreateToken/CreateTokenSeries/RegisterName ride TxTypes.Call; Script rides
      // TxTypes.Phantasma - both carry the witness array form.
      return serializedMessageLength + 4 + WITNESS_ARRAY_ENTRY_BYTES * witnessCount;
  }
}

function billV2(
  workUnits: bigint,
  envelope: bigint,
  eventBytes: bigint,
  rows: bigint,
  policyFee: bigint,
  config: GasConfig
): bigint {
  const blockData = envelope + eventBytes + rows;
  const byteUnits = clampU64(blockData * GAS_MODEL_V2_UNITS_PER_BLOCK_DATA_BYTE);
  let bill = mulShift(clampU64(workUnits + byteUnits), config.feeMultiplier, config.feeShift);
  bill = clampU64(bill + policyFee);
  return bill < config.minimumGasBill ? config.minimumGasBill : bill;
}

// Chain fee scaling: (value * feeMultiplier) >> feeShift, saturating to u64. Matches the
// validator's v2 MulShiftSaturateU64; for sane v1 configs (live values never overflow 64 bits)
// it is also bit-identical to the v1 math.
function mulShift(value: bigint, multiplier: bigint, shift: number): bigint {
  if (shift >= 64) return 0n; // the chain clamps oversized shifts to a zero delta
  return clampU64((value * multiplier) >> BigInt(shift));
}

function symbolShift(length: number, maxLength: number, paramName: string): bigint {
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new RangeError(`${paramName} must be a non-negative integer`);
  }
  if (length === 0) return 0n;
  const shift = length - 1;
  // The chain asserts shift < maxNameLength / maxTokenSymbolLength; a longer input could never
  // be admitted, so reject it here instead of quoting a fee for an impossible tx.
  if (maxLength !== 0 && shift >= maxLength) {
    throw new RangeError(`${paramName} ${length} exceeds the chain maximum ${maxLength}`);
  }
  return BigInt(shift);
}

// Worst-case paid rows the operation can create (drives maxData). Refund-only operations
// (burns) need no escrow allowance: refunds never require maxData budget.
function defaultFreshRows(kind: NativeFeeKind, count: number, romRamBytes: number): number {
  switch (kind) {
    case NativeFeeKind.TransferFungible:
    case NativeFeeKind.MintFungible:
      return 1; // recipient balance row may be fresh (SOUL/KCAL rows would be free)
    case NativeFeeKind.TransferNonFungible:
      // Per instance the chain deletes the sender's NFT-lookup row and creates the recipient's
      // (creation escrows at the current price, the deletion refunds the old row's own deposit)
      // + possibly a fresh recipient balance row.
      return count + 1;
    case NativeFeeKind.MintNonFungible:
      // Per instance: owner row + lookup row + the instance state rows holding ROM/RAM (1 KiB
      // quanta), plus possibly a fresh recipient balance row.
      return count * (2 + Math.ceil(romRamBytes / 1024)) + 1;
    case NativeFeeKind.BurnFungible:
    case NativeFeeKind.BurnNonFungible:
      return 0;
    case NativeFeeKind.CreateToken:
      return 8; // token info + symbol lookup + supply/config rows, metadata-dependent
    case NativeFeeKind.CreateTokenSeries:
      return 4;
    case NativeFeeKind.RegisterName:
      return 2; // name->address and address->name rows
    case NativeFeeKind.Script:
    default:
      return 4;
  }
}

// Conservative single-witness envelope defaults per kind; used only when the caller did not
// measure the real signed size. Generous by design: under v2 an oversized estimate only raises
// the refunded offer, never the settled bill.
function defaultEnvelopeBytes(kind: NativeFeeKind, count: number, romRamBytes: number): number {
  switch (kind) {
    case NativeFeeKind.TransferFungible:
    case NativeFeeKind.MintFungible:
    case NativeFeeKind.BurnFungible:
    case NativeFeeKind.RegisterName:
      return 512;
    case NativeFeeKind.TransferNonFungible:
    case NativeFeeKind.BurnNonFungible:
      return 512 + 8 * count; // 8 bytes per carried instance id
    case NativeFeeKind.MintNonFungible:
      return 512 + count * (64 + romRamBytes); // ROM/RAM ride the envelope
    case NativeFeeKind.CreateToken:
      return 4096; // token metadata (icons, descriptions) dominates
    case NativeFeeKind.CreateTokenSeries:
      return 2048;
    case NativeFeeKind.Script:
    default:
      return 1024;
  }
}

function roundUp(value: bigint, step: bigint): bigint {
  const rem = value % step;
  return rem === 0n ? value : value + (step - rem);
}

function clampU64(value: bigint): bigint {
  return value > U64_MAX ? U64_MAX : value;
}
