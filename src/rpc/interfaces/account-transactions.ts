import { TransactionData } from './transaction-data.js';

export interface AccountTransactions {
  address: string;
  txs: Array<TransactionData>; //List of transactions
}
