import { LedgerTransportDevice } from './Device.js';

export interface DeviceResponse {
  enabled: boolean;
  error: boolean;
  message?: string;
  device?: LedgerTransportDevice;
}
