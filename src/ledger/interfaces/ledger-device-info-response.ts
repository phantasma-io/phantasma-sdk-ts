import { VersionResponse } from './version-response.js';
import { ApplicationNameResponse } from './application-name-response.js';

export interface LedgerDeviceInfoResponse {
  version: VersionResponse;
  applicationName: ApplicationNameResponse;
}
