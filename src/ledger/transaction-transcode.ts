'use strict';

/**
 * Expiration Date is in UTC Seconds
 * @param expirationDate
 * @returns
 */
import { Transaction } from '../tx/index.js';

const DEFAULT_EXPIRATION_MINUTES = 5;

export const getDateAsUTCSeconds = (expirationDate: Date): number => {
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

/** @deprecated Use `getDateAsUTCSeconds` instead. This alias will be removed in v1.0. */
export const GetDateAsUTCSeconds = getDateAsUTCSeconds;

/**
 * Get Expiration Date
 * @returns
 */
export const getExpirationDate = (expirationMinutes = DEFAULT_EXPIRATION_MINUTES): Date => {
  const expirationDate = new Date(Date.now() + expirationMinutes * 60000);
  return expirationDate;
};

/** @deprecated Use `getExpirationDate` instead. This alias will be removed in v1.0. */
export const GetExpirationDate = getExpirationDate;

/**
 *
 * @param transaction
 * @returns
 */
export const encodeSendTxWithSignature = (transaction: Transaction): string => {
  // console.log('encodeSendTx', 'transaction', transaction);
  const sendTx = transaction.toString(true);
  // console.log('encodeSendTx', 'sendTx', sendTx);
  return sendTx;
};

/** @deprecated Use `encodeSendTxWithSignature` instead. This alias will be removed in v1.0. */
export const EncodeSendTxWithSignature = encodeSendTxWithSignature;

/**
 *
 * @param transaction
 * @returns
 */
export const encodeSendTxWithoutSignature = (transaction: Transaction): string => {
  const sendTx = transaction.toString(false);
  // console.log('encodeSendTx', 'sendTx', sendTx);
  return sendTx;
};

/** @deprecated Use `encodeSendTxWithoutSignature` instead. This alias will be removed in v1.0. */
export const EncodeSendTxWithoutSignature = encodeSendTxWithoutSignature;
