'use strict';

/**
 * Expiration Date is in UTC Seconds
 * @param expirationDate
 * @returns
 */
import { Transaction } from '../tx/index.js';

export const GetDateAsUTCSeconds = (expirationDate: Date): number => {
  const expirationDateUTCms = Date.UTC(
    expirationDate.getUTCFullYear(),
    expirationDate.getUTCMonth(),
    expirationDate.getUTCDate(),
    expirationDate.getUTCHours(),
    expirationDate.getUTCMinutes(),
    expirationDate.getUTCSeconds()
  );
  return expirationDateUTCms / 1000;
};

/**
 * Get Expiration Date
 * @returns
 */
export const GetExpirationDate = (): Date => {
  // TODO: make expirationDate configurable.
  const expirationMinutes = 5; // This is in minutes
  const expirationDate = new Date(Date.now() + expirationMinutes * 60000);
  return expirationDate;
};

/**
 *
 * @param transaction
 * @returns
 */
export const EncodeSendTxWithSignature = (transaction: Transaction): string => {
  // console.log('encodeSendTx', 'transaction', transaction);
  const sendTx = transaction.toString(true);
  // console.log('encodeSendTx', 'sendTx', sendTx);
  return sendTx;
};

/**
 *
 * @param transaction
 * @returns
 */
export const EncodeSendTxWithoutSignature = (transaction: Transaction): string => {
  const sendTx = transaction.toString(false);
  // console.log('encodeSendTx', 'sendTx', sendTx);
  return sendTx;
};
