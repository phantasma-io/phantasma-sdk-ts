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

export interface LedgerClientConfig {
  debug?: boolean;
  transport: LedgerTransport;
  bip39: LedgerBip39;
  bip32Factory: LedgerBip32Factory;
  curve: unknown;
  nexusName: string;
  chainName: string;
  payload?: string;
  tokenNames?: string[];
  rpc: PhantasmaAPI;
  gasPrice?: number;
  gasLimit?: number;
  verifyResponse?: boolean;
}

export interface LedgerConfig {
  /** @deprecated Use `debug` on `LedgerClientConfig` instead. */
  Debug: boolean;
  /** @deprecated Use `transport` on `LedgerClientConfig` instead. */
  Transport: LedgerTransport;
  /** @deprecated Use `bip39` on `LedgerClientConfig` instead. */
  Bip39: LedgerBip39;
  /** @deprecated Use `bip32Factory` on `LedgerClientConfig` instead. */
  Bip32Factory: LedgerBip32Factory;
  /** @deprecated Use `curve` on `LedgerClientConfig` instead. */
  Curve: unknown;
  /** @deprecated Use `nexusName` on `LedgerClientConfig` instead. */
  NexusName: string;
  /** @deprecated Use `chainName` on `LedgerClientConfig` instead. */
  ChainName: string;
  /** @deprecated Use `payload` on `LedgerClientConfig` instead. */
  Payload: string;
  /** @deprecated Use `tokenNames` on `LedgerClientConfig` instead. */
  TokenNames: string[];
  /** @deprecated Use `rpc` on `LedgerClientConfig` instead. */
  RPC: PhantasmaAPI;
  /** @deprecated Use `gasPrice` on `LedgerClientConfig` instead. */
  GasPrice: number;
  /** @deprecated Use `gasLimit` on `LedgerClientConfig` instead. */
  GasLimit: number;
  /** @deprecated Use `verifyResponse` on `LedgerClientConfig` instead. */
  VerifyResponse: boolean;
}

export type LedgerCompatibleConfig = LedgerClientConfig | LedgerConfig;

export interface NormalizedLedgerConfig {
  debug: boolean;
  transport: LedgerTransport;
  bip39: LedgerBip39;
  bip32Factory: LedgerBip32Factory;
  curve: unknown;
  nexusName: string;
  chainName: string;
  payload: string;
  tokenNames: string[];
  rpc: PhantasmaAPI;
  gasPrice: number;
  gasLimit: number;
  verifyResponse: boolean;
}

type LedgerConfigRecord = Partial<LedgerClientConfig> & Partial<LedgerConfig>;

function asLedgerConfigRecord(config: LedgerCompatibleConfig): LedgerConfigRecord {
  if (config == undefined) {
    throw Error('config is a required parameter.');
  }
  return config as LedgerConfigRecord;
}

function requireConfigValue<T>(value: T | undefined, name: string): T {
  if (value === undefined || value === null) {
    throw Error(`${name} is a required ledger config parameter.`);
  }
  return value;
}

export function getLedgerDebug(config: LedgerCompatibleConfig): boolean {
  const candidate = asLedgerConfigRecord(config);
  return candidate.debug ?? candidate.Debug ?? false;
}

export function getLedgerTransport(config: LedgerCompatibleConfig): LedgerTransport {
  const candidate = asLedgerConfigRecord(config);
  return requireConfigValue(candidate.transport ?? candidate.Transport, 'transport');
}

export function getLedgerBip39(config: LedgerCompatibleConfig): LedgerBip39 {
  const candidate = asLedgerConfigRecord(config);
  return requireConfigValue(candidate.bip39 ?? candidate.Bip39, 'bip39');
}

export function getLedgerBip32Factory(config: LedgerCompatibleConfig): LedgerBip32Factory {
  const candidate = asLedgerConfigRecord(config);
  return requireConfigValue(candidate.bip32Factory ?? candidate.Bip32Factory, 'bip32Factory');
}

export function getLedgerCurve(config: LedgerCompatibleConfig): unknown {
  const candidate = asLedgerConfigRecord(config);
  return requireConfigValue(candidate.curve ?? candidate.Curve, 'curve');
}

export function getLedgerNexusName(config: LedgerCompatibleConfig): string {
  const candidate = asLedgerConfigRecord(config);
  return requireConfigValue(candidate.nexusName ?? candidate.NexusName, 'nexusName');
}

export function getLedgerChainName(config: LedgerCompatibleConfig): string {
  const candidate = asLedgerConfigRecord(config);
  return requireConfigValue(candidate.chainName ?? candidate.ChainName, 'chainName');
}

export function getLedgerPayload(config: LedgerCompatibleConfig): string {
  const candidate = asLedgerConfigRecord(config);
  return candidate.payload ?? candidate.Payload ?? '';
}

export function getLedgerTokenNames(config: LedgerCompatibleConfig): string[] {
  const candidate = asLedgerConfigRecord(config);
  return candidate.tokenNames ?? candidate.TokenNames ?? [];
}

export function getLedgerRpc(config: LedgerCompatibleConfig): PhantasmaAPI {
  const candidate = asLedgerConfigRecord(config);
  return requireConfigValue(candidate.rpc ?? candidate.RPC, 'rpc');
}

export function getLedgerGasPrice(config: LedgerCompatibleConfig): number {
  const candidate = asLedgerConfigRecord(config);
  return candidate.gasPrice ?? candidate.GasPrice ?? 0;
}

export function getLedgerGasLimit(config: LedgerCompatibleConfig): number {
  const candidate = asLedgerConfigRecord(config);
  return candidate.gasLimit ?? candidate.GasLimit ?? 0;
}

export function getLedgerVerifyResponse(config: LedgerCompatibleConfig): boolean {
  const candidate = asLedgerConfigRecord(config);
  return candidate.verifyResponse ?? candidate.VerifyResponse ?? false;
}

export function normalizeLedgerConfig(config: LedgerCompatibleConfig): NormalizedLedgerConfig {
  return {
    debug: getLedgerDebug(config),
    transport: getLedgerTransport(config),
    bip39: getLedgerBip39(config),
    bip32Factory: getLedgerBip32Factory(config),
    curve: getLedgerCurve(config),
    nexusName: getLedgerNexusName(config),
    chainName: getLedgerChainName(config),
    payload: getLedgerPayload(config),
    tokenNames: getLedgerTokenNames(config),
    rpc: getLedgerRpc(config),
    gasPrice: getLedgerGasPrice(config),
    gasLimit: getLedgerGasLimit(config),
    verifyResponse: getLedgerVerifyResponse(config),
  };
}
