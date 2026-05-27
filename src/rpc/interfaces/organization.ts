import type { KeyValue } from './key-value.js';

export interface Organization {
  name?: string;
  owner?: string;
  carbonOwner?: string;
  metadata?: KeyValue[];
  memberCount?: string;
}

export interface OrganizationMember {
  address?: string;
  carbonAddress?: string;
  isMember?: boolean;
  memberTime?: number;
}

export type RpcAddressType = 'Phantasma' | 'Carbon';
