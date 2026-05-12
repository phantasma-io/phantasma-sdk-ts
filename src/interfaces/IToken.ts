import { Address, ContractInterface } from '../types/index.js';

export enum TokenFlags {
  None = 0,
  Transferable = 1 << 0,
  Fungible = 1 << 1,
  Finite = 1 << 2,
  Divisible = 1 << 3,
  Fuel = 1 << 4,
  Stakable = 1 << 5,
  Fiat = 1 << 6,
  Swappable = 1 << 7,
  Burnable = 1 << 8,
}

export enum TokenSeriesMode {
  Unique,
  Duplicated,
}

export interface TokenDescriptor {
  readonly name: string;
  readonly symbol: string;
  readonly owner: Address;
  readonly flags: TokenFlags;
  readonly maxSupply: BigInteger;
  readonly decimals: number;
  readonly script: Uint8Array;
  readonly abi: ContractInterface;
}

/** @deprecated Use `TokenDescriptor` instead. This compatibility interface will be removed in v1.0. */
export interface IToken {
  /** @deprecated Use `name` instead. */
  readonly Name: string;
  /** @deprecated Use `symbol` instead. */
  readonly Symbol: string;
  /** @deprecated Use `owner` instead. */
  readonly Owner: Address;
  /** @deprecated Use `flags` instead. */
  readonly Flags: TokenFlags;
  /** @deprecated Use `maxSupply` instead. */
  readonly MaxSupply: BigInteger;
  /** @deprecated Use `decimals` instead. */
  readonly Decimals: number;
  /** @deprecated Use `script` instead. */
  readonly Script: Uint8Array;
  /** @deprecated Use `abi` instead. */
  readonly ABI: ContractInterface;
}
