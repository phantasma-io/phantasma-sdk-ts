import { LedgerTransportDevice } from './device.js';

export interface DeviceResponse {
  enabled: boolean;
  error: boolean;
  message?: string;
  device?: LedgerTransportDevice;
}
