import { Balance } from './balance.js';
import { Stake } from './stake.js';
import { Storage } from './storage.js';

export interface Account {
  address: string;
  name: string;
  stakes: Stake; //Info about staking if available
  stake: string;
  unclaimed: string;
  relay: string; //Amount of available KCAL for relay channel
  validator: string; //Validator role
  storage: Storage;
  balances: Array<Balance>;
  txs: Array<string>;
}
