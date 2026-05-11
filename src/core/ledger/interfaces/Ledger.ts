import { Device } from './Device.js';

export interface ILedger {
  device: Device;
  publicKey: string;
  address: string;
  signature: string;
  error?: boolean;
  message?: string;
}
