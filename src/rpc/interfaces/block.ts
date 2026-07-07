import { Event } from './event.js';
import { Oracle } from './oracle.js';
import { TransactionData } from './transaction-data.js';

export interface Block {
  hash: string;
  previousHash: string; //Hash of previous block
  timestamp: number;
  height: number;
  chainAddress: string; //Address of chain where the block belongs
  protocol: number; //Network protocol version
  txs: Array<TransactionData>; //List of transactions in block
  validatorAddress: string; //Address of validator who minted the block
  // Fee payout address stamped by the block producer inside the hashed block input. Present on
  // gas-model-v2 blocks only, absent on earlier blocks. Distinct from validatorAddress (the
  // consensus-log leader): usually equal today, but a configurable payout address is a planned
  // compatible extension, so consumers must not assume equality.
  producerAddress?: string;
  reward: string; //Amount of KCAL rewarded by this fees in this block
  events?: Array<Event>; //Block events
  oracles?: Array<Oracle>; //Block oracles
}
