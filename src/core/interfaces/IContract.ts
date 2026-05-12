import { ContractInterface } from '../types/index.js';

export interface ContractDescriptor {
  name: string;
  abi: ContractInterface;
}

/** @deprecated Use `ContractDescriptor` instead. This compatibility interface will be removed in v1.0. */
export interface IContract {
  /** @deprecated Use `name` instead. */
  Name: string;
  /** @deprecated Use `abi` instead. */
  ABI: ContractInterface;
}

export enum NativeContractKind {
  Gas,
  Block,
  Stake,
  Swap,
  Account,
  Consensus,
  Governance,
  Storage,
  Validator,
  Interop,
  Exchange,
  Privacy,
  Relay,
  Ranking,
  Market,
  Friends,
  Mail,
  Sale,
  Unknown,
}
