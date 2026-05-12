import { Address } from '../../types/index.js';

export interface LedgerBalanceFromLedgerResponse {
  success: boolean;
  message: string;
  publicKey?: string;
  address?: Address;
  balances?: Map<string, string>;
}
