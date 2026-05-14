// namespace PhantasmaPhoenix.Protocol.Carbon.Blockchain.TxHelpers

/** Common interface for fee option. */
export interface FeeOptionsLike {
  feeMultiplier: bigint;
  calculateMaxGas(...args: unknown[]): bigint;
}

/** @deprecated Use `FeeOptionsLike` instead. This compatibility interface will be removed in v1.0. */
export type IFeeOptions = FeeOptionsLike;

type CountInput = number | bigint;
type SymbolInput = string | { data: string };
type MintCountInput = CountInput | readonly unknown[];

function assertArgCount(args: readonly unknown[], max: number, methodName: string): void {
  if (args.length > max) {
    throw new TypeError(`${methodName} accepts at most ${max} argument${max === 1 ? '' : 's'}`);
  }
}

function parsePositiveCount(value: unknown, methodName: string): bigint {
  if (typeof value === 'bigint') {
    if (value <= 0n) {
      throw new RangeError(`${methodName} count must be a positive integer`);
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${methodName} count must be a positive safe integer`);
    }
    return BigInt(value);
  }

  throw new TypeError(`${methodName} count must be a number or bigint`);
}

function parseOptionalCount(args: readonly unknown[], methodName: string): bigint {
  assertArgCount(args, 1, methodName);
  return args.length === 0 ? 1n : parsePositiveCount(args[0], methodName);
}

function parseOptionalMintCount(args: readonly unknown[], methodName: string): bigint {
  assertArgCount(args, 1, methodName);
  if (args.length === 0) {
    return 1n;
  }

  const value = args[0];
  return Array.isArray(value)
    ? parsePositiveCount(value.length, methodName)
    : parsePositiveCount(value, methodName);
}

function assertNoMeaningfulCount(args: readonly unknown[], methodName: string): void {
  assertArgCount(args, 1, methodName);
  if (args.length === 0) {
    return;
  }

  const count = parsePositiveCount(args[0], methodName);
  if (count !== 1n) {
    throw new RangeError(`${methodName} is not count-sensitive; count must be 1 when provided`);
  }
}

function parseOptionalSymbol(args: readonly unknown[], methodName: string): string {
  assertArgCount(args, 1, methodName);
  if (args.length === 0) {
    return '';
  }

  const value = args[0];
  if (typeof value === 'string') {
    return value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    typeof value.data === 'string'
  ) {
    return value.data;
  }

  throw new TypeError(`${methodName} symbol must be a string or SmallString-like object`);
}

/** Base fee options with sensible defaults. */
export class FeeOptions implements FeeOptionsLike {
  gasFeeBase: bigint;
  feeMultiplier: bigint;

  constructor(gasFeeBase: bigint = 10_000n, feeMultiplier: bigint = 1_000n) {
    this.gasFeeBase = gasFeeBase;
    this.feeMultiplier = feeMultiplier;
  }

  calculateMaxGas(): bigint;
  calculateMaxGas(count: CountInput): bigint;
  calculateMaxGas(...args: [] | [CountInput]): bigint {
    const count = parseOptionalCount(args, 'FeeOptions.calculateMaxGas');
    return this.gasFeeBase * this.feeMultiplier * count;
  }
}

/** Fee options for token creation transactions. */
export class CreateTokenFeeOptions extends FeeOptions implements FeeOptionsLike {
  gasFeeCreateTokenBase: bigint;
  gasFeeCreateTokenSymbol: bigint;

  constructor(
    gasFeeBase: bigint = 10_000n,
    gasFeeCreateTokenBase: bigint = 10_000_000_000n,
    gasFeeCreateTokenSymbol: bigint = 10_000_000_000n,
    feeMultiplier: bigint = 10_000n
  ) {
    super(gasFeeBase, feeMultiplier);
    this.gasFeeCreateTokenBase = gasFeeCreateTokenBase;
    this.gasFeeCreateTokenSymbol = gasFeeCreateTokenSymbol;
  }

  override calculateMaxGas(): bigint;
  override calculateMaxGas(symbol: SymbolInput): bigint;
  override calculateMaxGas(...args: [] | [SymbolInput]): bigint {
    const symbol = parseOptionalSymbol(args, 'CreateTokenFeeOptions.calculateMaxGas');
    const symbolLen = symbol.length;
    const shift = symbolLen > 0 ? BigInt(symbolLen - 1) : 0n;
    const symbolCost = this.gasFeeCreateTokenSymbol >> shift;
    return (this.gasFeeBase + this.gasFeeCreateTokenBase + symbolCost) * this.feeMultiplier;
  }
}

/** Fee options for creating a new series on an NFT token. */
export class CreateSeriesFeeOptions extends FeeOptions implements FeeOptionsLike {
  gasFeeCreateSeriesBase: bigint;

  constructor(
    gasFeeBase: bigint = 10_000n,
    gasFeeCreateSeriesBase: bigint = 2_500_000_000n,
    feeMultiplier: bigint = 10_000n
  ) {
    super(gasFeeBase, feeMultiplier);
    this.gasFeeCreateSeriesBase = gasFeeCreateSeriesBase;
  }

  override calculateMaxGas(): bigint;
  override calculateMaxGas(...args: [] | [CountInput]): bigint {
    assertNoMeaningfulCount(args, 'CreateSeriesFeeOptions.calculateMaxGas');
    return (this.gasFeeBase + this.gasFeeCreateSeriesBase) * this.feeMultiplier;
  }
}

/** Fee options for minting non-fungible tokens (NFT instances). */
export class MintNftFeeOptions extends FeeOptions implements FeeOptionsLike {
  constructor(gasFeeBase: bigint = 10_000n, feeMultiplier: bigint = 1_000n) {
    super(gasFeeBase, feeMultiplier);
  }

  override calculateMaxGas(): bigint;
  override calculateMaxGas(count: CountInput): bigint;
  override calculateMaxGas(tokens: readonly unknown[]): bigint;
  override calculateMaxGas(...args: [] | [MintCountInput]): bigint {
    const count = parseOptionalMintCount(args, 'MintNftFeeOptions.calculateMaxGas');
    return this.gasFeeBase * this.feeMultiplier * count;
  }
}
