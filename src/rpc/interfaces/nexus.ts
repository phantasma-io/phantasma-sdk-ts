import { Platform } from './platform.js';
import { Governance } from './governance.js';
import { Token } from './token.js';
import { Chain } from './chain.js';

export interface Nexus {
  name: string; //Name of the nexus
  protocol: string;
  platforms: Array<Platform>; //List of platforms
  tokens: Array<Token>; //List of tokens
  chains: Array<Chain>; //List of chains
  governance: Array<Governance>; //List of governance values
  organizations: Array<string>; //List of organizations
}
