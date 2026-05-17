import type { KeyValue } from './key-value.js';

export interface NFT {
  id: string;
  series: string;
  carbonTokenId: string;
  carbonSeriesId: string;
  carbonNftAddress: string;
  mint: string;
  chainName: string;
  ownerAddress: string;
  creatorAddress: string;
  ram: string;
  rom: string;
  status: string;
  infusion: KeyValue[];
  properties: KeyValue[];
}
