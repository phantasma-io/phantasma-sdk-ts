import { Balance } from '../../rpc/interfaces/Balance.js';
import { LinkFile } from './IFile.js';

export interface LinkAccount {
  alias: string;
  name: string;
  address: string;
  avatar: string;
  platform: string;
  external: string;
  balances: Balance[];
  files: LinkFile[];
}

/** @deprecated Use `LinkAccount` instead. This compatibility interface will be removed in v1.0. */
export type IAccount = LinkAccount;
