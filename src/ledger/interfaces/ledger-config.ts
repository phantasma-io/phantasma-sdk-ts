import { PhantasmaAPI } from '../../rpc/phantasma.js';
import { LedgerTransportDevice } from './device.js';

export interface LedgerTransport {
  isSupported(): Promise<boolean>;
  list(): Promise<string[]>;
  open(path: string): Promise<LedgerTransportDevice>;
}

export interface LedgerBip39 {
  mnemonicToSeedSync(mnemonic: string): Uint8Array | Buffer;
  entropyToMnemonic(entropy: string): string;
}

export interface LedgerBip32Node {
  privateKey: Uint8Array | Buffer;
  derivePath(path: string): LedgerBip32Node;
}

export interface LedgerBip32 {
  fromSeed(seed: Uint8Array): LedgerBip32Node;
}

export type LedgerBip32Factory = (curve: unknown) => LedgerBip32;

export interface LedgerConfig {
  Debug: boolean;
  Transport: LedgerTransport;
  Bip39: LedgerBip39;
  Bip32Factory: LedgerBip32Factory;
  Curve: unknown;
  NexusName: string;
  ChainName: string;
  Payload: string;
  TokenNames: string[];
  RPC: PhantasmaAPI;
  GasPrice: number;
  GasLimit: number;
  VerifyResponse: boolean;
}
