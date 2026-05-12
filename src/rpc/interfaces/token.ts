import { TokenExternal } from './token-external.js';
import { TokenPrice } from './token-price.js';
import { TokenSeries } from './token-series.js';
import type { TokenSchemasResult } from './token-schemas-result.js';

export interface Token {
  symbol: string; //Ticker symbol for the token
  name: string;
  decimals: number; //Amount of decimals when converting from fixed point format to decimal format
  currentSupply: string; //Amount of minted tokens
  maxSupply: string; //Max amount of tokens that can be minted
  burnedSupply: string;
  address: string;
  owner: string;
  flags: string;
  script: string;
  series: Array<TokenSeries>;
  carbonId: string;
  tokenSchemas?: TokenSchemasResult;
  external?: Array<TokenExternal>;
  price?: Array<TokenPrice>;
}
